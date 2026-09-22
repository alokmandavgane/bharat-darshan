// The `lines` layer type (PLAN.md section 5): a ribbon per run, laid on the terrain and
// widened in screen space so a river keeps the same weight at every zoom.
uniform sampler2D uHeight;
uniform vec2 uSizeKm;
uniform float uExag;
uniform float uGamma;
uniform float uHRef;
uniform float uLift;         // height of the lifted block, 0 on the country plate
uniform vec4 uLocalRect;     // country-uv rect the bound heightmap covers
uniform vec2 uResolution;    // drawing buffer size in pixels
uniform vec3 uRankPx;        // half-width in pixels for rank 1, 2, 3
uniform vec3 uRankZoom;      // view height (km) below which each rank appears
uniform float uZoom;
uniform float uSelectedIdx;  // index of the highlighted item, or -1
uniform vec2 uGrid;          // quads across and down in the mesh this copy is drawn on

in vec2 dir;                 // tangent of the run at this vertex, in the ground plane
in float side;               // -1 or 1: which edge of the ribbon
in float rank;               // 1, 2 or 3
in float itemIdx;            // which item of the layer this vertex belongs to
in float dist;               // km from the start of the run, which is its upstream end
in float widen;              // per-vertex width multiplier: 1 for a line, a swell and a
                             // point for a flow's arrowhead
in vec3 colour;

out vec3 vColour;
out float vDist;
out float vFade;
out float vSel;
out vec2 vUv;
out float vEdge;

vec2 luv(vec2 v) { return (v - uLocalRect.xy) / uLocalRect.zw; }

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

float byRank(vec3 v) {
  return rank < 1.5 ? v.x : rank < 2.5 ? v.y : v.z;
}

void main() {
  vUv = vec2(position.x / uSizeKm.x + 0.5, position.z / uSizeKm.y + 0.5);
  // On the surface the mesh *draws*, not the raster it samples. The mesh lifts its own
  // vertices and the rasteriser interpolates between them, so in a valley -- which is
  // where a river is, and where a road follows it -- the drawn ground sits above the
  // height at the point itself. At the low tier's 256 grid that buries half of every
  // river; at the high tier's 1024 the grid is the raster and this is a no-op. The
  // marker shader does the same thing for the same reason.
  vec2 g = luv(vUv) * uGrid;
  vec2 i0 = floor(g);
  vec2 f = g - i0;
  vec2 a = i0 / uGrid, b = (i0 + 1.0) / uGrid;
  float h00 = lift(texture(uHeight, a).r);
  float h10 = lift(texture(uHeight, vec2(b.x, a.y)).r);
  float h01 = lift(texture(uHeight, vec2(a.x, b.y)).r);
  float h11 = lift(texture(uHeight, b).r);
  float ground = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  // A hair above the surface: enough to beat z-fighting, far below anything the eye reads.
  float y = ground + uLift + 0.15;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position.x, y, position.z, 1.0);
  vec4 ahead = projectionMatrix * modelViewMatrix * vec4(position.x + dir.x, y, position.z + dir.y, 1.0);

  vec2 t = ahead.xy / ahead.w - clip.xy / clip.w;
  t = length(t) > 0.0 ? normalize(t * uResolution) : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  // A picked line thickens rather than changing colour: it is still the same river.
  vSel = uSelectedIdx >= 0.0 && abs(itemIdx - uSelectedIdx) < 0.5 ? 1.0 : 0.0;
  float halfPx = byRank(uRankPx) * widen * (1.0 + 0.9 * vSel);
  clip.xy += n * side * halfPx / uResolution * 2.0 * clip.w;

  vColour = colour;
  vDist = dist;
  vEdge = side;
  // A tributary is noise on the whole country and detail once the camera is in close.
  float z = byRank(uRankZoom);
  vFade = z <= 0.0 ? 1.0 : 1.0 - smoothstep(z * 0.8, z * 1.25, uZoom);
  vFade = max(vFade, vSel);
  gl_Position = clip;
}
