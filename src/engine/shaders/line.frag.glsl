// A river on the clay: a soft-edged stroke, drawn only on the surface it belongs to.
// The country plate and the lifted block draw the same geometry with the ids swapped,
// so a river crossing a state boundary is cut at the boundary rather than climbing the
// block's wall.
uniform sampler2D uIds;        // r: state id / 255 (NEAREST)
uniform vec4 uLocalRect;
uniform float uLiftedId;       // state lifted out of the plate, or -1
uniform float uOnBlock;        // 1: this draw is the block's copy
uniform float uDim;            // 0..1: the surface this copy is drawn on has stepped back

in vec3 vColour;
in float vFade;
in float vSel;
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
  if (a <= 0.002) discard;
  vec3 c = mix(vColour, vColour * 0.72 + vec3(0.04, 0.02, 0.0), vSel);
  vec4 o = linearToOutputTexel(vec4(c, 1.0));
  outColor = vec4(o.rgb * a, a);
}
