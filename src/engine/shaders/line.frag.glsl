// A river on the clay: a soft-edged stroke, drawn only on the surface it belongs to.
// The country plate and the lifted block draw the same geometry with the ids swapped,
// so a river crossing a state boundary is cut at the boundary rather than climbing the
// block's wall.
uniform sampler2D uIds;        // r: state id / 255 (NEAREST)
uniform vec4 uLocalRect;
uniform float uLiftedId;       // state lifted out of the plate, or -1
uniform float uOnBlock;        // 1: this draw is the block's copy
uniform float uDim;            // 0..1: the surface this copy is drawn on has stepped back
uniform float uFlow;           // 1 when this layer's runs are pointed downstream and move
uniform float uTime;           // seconds, only advanced while the flow is running
uniform float uZoom;           // view height in km

in vec3 vColour;
in float vFade;
in float vSel;
in float vDist;
in vec2 vUv;
in float vEdge;
out vec4 outColor;

void main() {
  vec2 local = (vUv - uLocalRect.xy) / uLocalRect.zw;
  if (uOnBlock > 0.5 && (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0)) discard;
  float id = floor(texture(uIds, local).r * 255.0 + 0.5);
  if (uOnBlock > 0.5) {
    if (abs(id - uLiftedId) >= 0.5) discard;
  } else if (uLiftedId >= 0.0 && abs(id - uLiftedId) < 0.5) {
    discard;
  }
  float a = vFade * (1.0 - smoothstep(0.45, 1.0, abs(vEdge))) * (1.0 - 0.6 * uDim * (1.0 - vSel));
  a *= 1.0 + 0.35 * vSel;
  vec3 c = mix(vColour, vColour * 0.72 + vec3(0.04, 0.02, 0.0), vSel);
  // Flow: crests running downstream, the run's own distance being measured from its
  // upstream end. The wavelength is a fraction of the view, so a river reads the same at
  // any zoom, as its width already does. Cubing a sine leaves long quiet stretches with a
  // soft crest between them -- light moving on water rather than marching ants -- and the
  // mean of that cube, 5/16, is subtracted so the river keeps the weight it had at rest.
  if (uFlow > 0.5) {
    float lambda = 0.16 * uZoom;
    float s = 0.5 + 0.5 * sin(6.2831853 * (vDist - uTime * lambda * 0.22) / lambda);
    float crest = s * s * s;
    a *= 1.0 + 0.30 * (crest - 0.3125);
    c = mix(c, c * 1.45 + 0.05, 0.8 * crest);
  }
  a = clamp(a, 0.0, 1.0);
  if (a <= 0.002) discard;
  vec4 o = linearToOutputTexel(vec4(c, 1.0));
  outColor = vec4(o.rgb * a, a);
}
