// @ts-check
// The engine: a three.js scene behind a small API. It touches nothing in the DOM but its
// canvas, and talks to the UI only through the store (PLAN.md section 4).
import { Color, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { basis, fitBounds } from './camera-math.js';
import { loadManifest, loadStates, loadTier, unionBbox } from './data.js';
import { biasedPick, createHeightfield, pickTerrain, projectGround } from './picking.js';
import { pickQuality } from './quality.js';
import { createTerrain, CURVE, PALETTE } from './terrain.js';
import { tween } from './tween.js';

const CAMERA_DISTANCE = 7000;   // km; anywhere outside the model works for an orthographic camera
const FIRST_TIER = '1024';      // always first: it is the first-view budget (PLAN.md section 8)

/**
 * @param {{ canvas: HTMLCanvasElement, store: ReturnType<import('../state/store.js').createStore> }} opts
 */
export function createEngine({ canvas, store }) {
  const quality = pickQuality();
  const renderer = new WebGLRenderer({
    canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dprCap));
  renderer.setClearColor(new Color(PALETTE.table), 1);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 200, 16000);
  camera.up.set(0, 1, 0);

  let terrain = null;
  let field = null;            // CPU heightfield + ids of the tier on screen, for picking
  let sizeKm = null;
  let viewport = { w: 1, h: 1 };
  let needsRender = false;
  let cancelFly = null;
  let cancelRelief = null;
  let cameraTouched = false;   // once the user moves the camera, layout changes stop refitting

  // --- render on demand: nothing draws unless something changed
  function invalidate() {
    if (needsRender) return;
    needsRender = true;
    requestAnimationFrame(render);
  }

  function render() {
    needsRender = false;
    if (!terrain) return;
    applyCamera();
    renderer.render(scene, camera);
  }

  function applyCamera() {
    const c = store.get('camera');
    const { toCam } = basis(c.yaw, c.pitch);
    camera.position.set(c.x + toCam[0] * CAMERA_DISTANCE, toCam[1] * CAMERA_DISTANCE, c.z + toCam[2] * CAMERA_DISTANCE);
    camera.lookAt(c.x, 0, c.z);
    const hh = c.zoom / 2, hw = (hh * viewport.w) / viewport.h;
    camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
    camera.updateProjectionMatrix();
    terrain.uniforms.uKmPerPx.value = c.zoom / viewport.h;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === viewport.w && h === viewport.h) return;
    viewport = { w, h };
    renderer.setSize(w, h, false);
    store.set('viewport', viewport);
    if (!cameraTouched) fit(false);
    invalidate();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // --- camera
  function flyTo(target, ms = 900) {
    cancelFly?.();
    const from = store.get('camera');
    cancelFly = tween(from, target, ms, (v) => store.set('camera', v, { source: 'tween' }), {
      onDone: () => { cancelFly = null; },
    });
  }

  /** Frame the whole country above the sheet and beside the panels. */
  function fit(animate = true) {
    const regions = store.get('regions');
    if (!regions) return;
    const [x0, z0, x1, z1] = regions.bbox;
    const pad = store.get('padding');
    const target = fitBounds(store.get('camera'), { x0, z0, x1, z1, points: regions.hull, ymax: 40 }, viewport, pad);
    if (animate) flyTo(target);
    else store.set('camera', target, { source: 'fit' });
  }

  store.subscribe('camera', (_, __, meta) => {
    if (meta.source === 'gesture') cameraTouched = true;
    if (meta.source !== 'tween' && cancelFly) { cancelFly(); cancelFly = null; }
    invalidate();
  });
  store.subscribe('flyTo', (req) => { if (req) { cameraTouched = true; flyTo(req.camera, req.ms); } });
  store.subscribe('padding', () => { if (!cameraTouched) fit(false); });

  // --- relief
  function applyRelief(r, animate) {
    if (!terrain) return;
    const target = r.on ? r.amount : 0;
    const u = terrain.uniforms.uExag;
    cancelRelief?.();
    if (!animate) { u.value = target; invalidate(); return; }
    cancelRelief = tween({ v: u.value }, { v: target }, 650, ({ v }) => { u.value = v; invalidate(); });
  }
  store.subscribe('relief', (r, _, meta) => applyRelief(r, !!meta.animate));
  store.subscribe('selection', (id) => { if (terrain) { terrain.uniforms.uSelected.value = id ?? -1; invalidate(); } });
  store.subscribe('hover', (id) => { if (terrain) { terrain.uniforms.uHover.value = id ?? -1; invalidate(); } });

  // --- picking: taps become selections, pointer moves become hovers
  const liftKm = (hM) => (hM <= 0 ? 0 : terrain.uniforms.uExag.value * Math.pow(hM / CURVE.hRef, CURVE.gamma) * CURVE.hRef * 0.001);

  /** Terrain hit under a screen point (px from the viewport centre, y up), or null before load. */
  function pick(sx, sy) {
    if (!field) return null;
    return pickTerrain(store.get('camera'), viewport, sx, sy, field, liftKm);
  }

  /** Screen position (px from the viewport centre, y up) of a ground point [x, z] on the terrain. */
  function project(point) {
    if (!field) return null;
    return projectGround(store.get('camera'), viewport, point[0], point[1], field, liftKm);
  }

  function areaOf(id) {
    const u = store.get('regions')?.byId?.[id];
    return u ? u.area_km2 : Infinity;
  }

  store.subscribe('tap', (tap) => {
    if (!tap || !field) return;
    const idAt = (sx, sy) => pick(sx, sy).id;
    const id = tap.type === 'touch' || tap.type === 'pen' ? biasedPick(tap.x, tap.y, idAt, areaOf) : idAt(tap.x, tap.y);
    store.set('selection', id || null);
  });

  let hoverRaf = 0;
  store.subscribe('pointer', (ptr) => {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const p = store.get('pointer');
      store.set('hover', p && field ? pick(p.x, p.y).id || null : null);
    });
  });

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); store.set('status', 'context-lost'); });
  canvas.addEventListener('webglcontextrestored', () => { store.set('status', 'ready'); invalidate(); });

  // --- loading: first-view tier first, finer tier in the background for capable devices
  async function start() {
    const manifest = await loadManifest();
    const states = await loadStates(manifest);
    const byId = Object.fromEntries(states.units.map((u) => [u.id, u]));
    store.set('regions', { units: states.units, byId, bbox: unionBbox(states.units), hull: states.country?.hull, grid: manifest.grid });
    const first = await loadTier(manifest, FIRST_TIER);
    sizeKm = { w: manifest.grid.width_km, h: manifest.grid.height_km };
    terrain = createTerrain({ tierData: first, grid: quality.grid, sizeKm });
    field = createHeightfield(first, sizeKm, terrain.grid);
    scene.add(terrain.mesh);
    applyRelief(store.get('relief'), false);
    fit(false);
    invalidate();
    store.set('status', 'ready');
    if (quality.heightTier !== FIRST_TIER && manifest.tiers[quality.heightTier]) {
      loadTier(manifest, quality.heightTier)
        .then((t) => { terrain.setTier(t); field = createHeightfield(t, sizeKm, terrain.grid); invalidate(); })
        .catch((err) => console.warn('finer tier skipped:', err));
    }
    return { manifest, quality };
  }

  return {
    start, invalidate, flyTo, fit, pick, project, quality,
    get viewport() { return viewport; },
    dispose() { terrain?.dispose(); renderer.dispose(); },
  };
}
