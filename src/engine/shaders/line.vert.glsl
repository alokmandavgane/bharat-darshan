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

in vec2 dir;                 // tangent of the run at this vertex, in the ground plane
in float side;               // -1 or 1: which edge of the ribbon
in float rank;               // 1, 2 or 3
in vec3 colour;

out vec3 vColour;
out float vFade;
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
  // A hair above the surface: enough to beat z-fighting, far below anything the eye reads.
  float y = lift(texture(uHeight, luv(vUv)).r) + uLift + 0.15;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position.x, y, position.z, 1.0);
  vec4 ahead = projectionMatrix * modelViewMatrix * vec4(position.x + dir.x, y, position.z + dir.y, 1.0);

  vec2 t = ahead.xy / ahead.w - clip.xy / clip.w;
  t = length(t) > 0.0 ? normalize(t * uResolution) : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float halfPx = byRank(uRankPx);
  clip.xy += n * side * halfPx / uResolution * 2.0 * clip.w;

  vColour = colour;
  vEdge = side;
  // A tributary is noise on the whole country and detail once the camera is in close.
  float z = byRank(uRankZoom);
  vFade = z <= 0.0 ? 1.0 : 1.0 - smoothstep(z * 0.8, z * 1.25, uZoom);
  gl_Position = clip;
}
