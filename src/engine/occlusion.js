// @ts-check
// Ambient occlusion, computed on the GPU from the heights already loaded instead of baked
// into a pack and downloaded. It is all the heights decide -- 7.3 MB of the 8.2 MB the old
// shade packs weighed -- and one pass per raster at load costs a few milliseconds. What it
// makes is the texture the terrain shader has always read as uShade: r the occlusion, g
// the coastal shadow, which the pipeline still ships, since a distance to land within
// 30 km of sea is not something a texel's neighbours can say.
import {
  Camera, GLSL3, LinearFilter, Mesh, PlaneGeometry, RGFormat, Scene, ShaderMaterial, UnsignedByteType, Vector2,
  WebGLRenderTarget,
} from 'three';
import frag from './shaders/occlusion.frag.glsl?raw';
import { byteTexture } from './textures.js';

const MAX_STEPS = 8;
const vert = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** @param {import('three').WebGLRenderer} renderer */
export function createOcclusion(renderer) {
  const material = new ShaderMaterial({
    glslVersion: GLSL3, vertexShader: vert, fragmentShader: frag, defines: { MAX_STEPS },
    depthTest: false, depthWrite: false,
    uniforms: {
      uHeight: { value: null },
      uCoast: { value: null },
      uSize: { value: new Vector2(1, 1) },
      uKmPerPx: { value: 1 },
      uSteps: { value: new Array(MAX_STEPS).fill(0) },
      uStepCount: { value: 0 },
      uExag: { value: 12 },
      uGamma: { value: 0.65 },
      uHRef: { value: 8000 },
    },
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene().add(quad);
  const camera = new Camera();
  /** Every texture still in use, to draw again if the context is lost and comes back. */
  const live = new Set();

  function draw(job) {
    const u = material.uniforms, { ao, km_per_px: km } = job.coast.header;
    u.uHeight.value = job.heights;
    u.uCoast.value = job.coastTexture;
    u.uSize.value.set(job.target.width, job.target.height);
    u.uKmPerPx.value = km;
    u.uSteps.value.fill(0);
    ao.steps.forEach((s, i) => { u.uSteps.value[i] = s; });
    u.uStepCount.value = ao.steps.length;
    u.uExag.value = ao.exaggeration;
    u.uGamma.value = ao.gamma;
    u.uHRef.value = ao.h_ref;
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(job.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(before);
    u.uHeight.value = null;
    u.uCoast.value = null;
  }

  return {
    /**
     * The terrain's shade texture for one raster: r the ambient occlusion of `heights`
     * (heightTexture's R16F metres), g the coast pack's shadow, at the coast pack's size
     * and with the occlusion's parameters from its header (pipeline/02_dem.py ao_params).
     * Its dispose() frees the pass's target and the coast upload with it.
     * @param {import('three').Texture} heights
     * @param {import('./pack.js').Pack} coast
     */
    shadeTexture(heights, coast) {
      const ao = coast.header.ao;
      if (!ao || ao.steps.length > MAX_STEPS) throw new Error(`coast pack ${coast.header.kind}: no usable ao parameters`);
      const target = new WebGLRenderTarget(coast.width, coast.height, {
        format: RGFormat, type: UnsignedByteType, magFilter: LinearFilter, minFilter: LinearFilter,
        generateMipmaps: false, depthBuffer: false,
      });
      const job = { heights, coast, coastTexture: byteTexture(coast), target };
      draw(job);
      live.add(job);
      const texture = target.texture;
      // Callers own textures, not passes, so the texture's own dispose lets go of all of it.
      // RenderTarget.dispose only fires the event the renderer frees both by; no recursion.
      texture.dispose = () => {
        live.delete(job);
        job.coastTexture.dispose();
        target.dispose();
      };
      return texture;
    },
    /** Draw every live texture again: a context that comes back has lost what was in them. */
    restore() {
      live.forEach(draw);
    },
    dispose() {
      quad.geometry.dispose();
      material.dispose();
    },
  };
}
