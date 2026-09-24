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
uniform vec4 uGridRect;      // the country uv that mesh spans: u0, v0, u1, v1

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
  // river. So the height is read at the mesh's own nodes and laid on its own two
  // triangles per quad (terrain.js gridGeometry splits each along the b-c diagonal), and
  // lines.js cuts every run at those edges, so the ribbon lies on the drawn ground to
  // the last metre however steep the relief.
  vec2 span = uGridRect.zw - uGridRect.xy;
  vec2 g = (vUv - uGridRect.xy) / span * uGrid;
  vec2 i0 = floor(g);
  vec2 f = g - i0;
  vec2 a = uGridRect.xy + i0 / uGrid * span, b = uGridRect.xy + (i0 + 1.0) / uGrid * span;
  float h00 = lift(texture(uHeight, luv(a)).r);
  float h10 = lift(texture(uHeight, luv(vec2(b.x, a.y))).r);
  float h01 = lift(texture(uHeight, luv(vec2(a.x, b.y))).r);
  float h11 = lift(texture(uHeight, luv(b)).r);
  float ground = f.x + f.y <= 1.0
    ? h00 + f.x * (h10 - h00) + f.y * (h01 - h00)
    : h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
  // The steepest rise across this quad, km up per km along.
  vec2 cellKm = span * uSizeKm / uGrid;
  float slope = max(max(abs(h10 - h00), abs(h11 - h01)) / cellKm.x,
                    max(abs(h01 - h00), abs(h11 - h10)) / cellKm.y);
  // A hair above the surface: enough to beat z-fighting, far below anything the eye reads.
  float y = ground + uLift + 0.15;
  vec4 mv = modelViewMatrix * vec4(position.x, y, position.z, 1.0);
  vec4 ahead = projectionMatrix * modelViewMatrix * vec4(position.x + dir.x, y, position.z + dir.y, 1.0);

  vec4 here = projectionMatrix * mv;
  vec2 t = ahead.xy / ahead.w - here.xy / here.w;
  t = length(t) > 0.0 ? normalize(t * uResolution) : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  // A picked line thickens rather than changing colour: it is still the same river.
  vSel = uSelectedIdx >= 0.0 && abs(itemIdx - uSelectedIdx) < 0.5 ? 1.0 : 0.0;
  float halfPx = byRank(uRankPx) * widen * (1.0 + 0.9 * vSel);
  // The ribbon is widened on screen, so its edges reach past the centreline the height
  // was taken at, and on a slope facing the camera the ground there stands in front of
  // them. Pull the ribbon toward the eye by what the slope under it can raise its edge,
  // twice over for a neighbouring quad that is steeper and for the angle of view: the
  // camera is orthographic, so this moves the depth and nothing on screen. It is a
  // ribbon's width of climb, far below any hill tall enough to hide a line honestly.
  float halfKm = halfPx * uZoom / uResolution.y;
  mv.z += halfKm * (1.0 + 2.0 * slope);
  vec4 clip = projectionMatrix * mv;
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
