// Ambient occlusion from the heights, one output texel per fragment (occlusion.js). A
// port of pipeline/02_dem.py's ambient_occlusion, which stays as the reference and for
// the pipeline's preview images: keep the two in step. Horizon-based sky visibility on
// the exaggerated terrain: in each of 8 directions, the steepest rise to any of the
// sampled distances, as an angle; the average of the 8 is how much sky is hidden.
uniform sampler2D uHeight;     // R16F metres, LINEAR
uniform sampler2D uCoast;      // r: coastal shadow, at this pass's own size
uniform vec2 uSize;            // output size in texels
uniform float uKmPerPx;        // ground size of one output texel
uniform float uSteps[MAX_STEPS]; // distances searched, in output texels
uniform int uStepCount;
uniform float uExag;
uniform float uGamma;
uniform float uHRef;

out vec4 outColor;

const float HALF_PI = 1.5707963;
const vec2 DIRS[8] = vec2[8](vec2(0, 1), vec2(1, 1), vec2(1, 0), vec2(1, -1),
                             vec2(0, -1), vec2(-1, -1), vec2(-1, 0), vec2(-1, 1));

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

// At an output texel's centre. Where the heights are twice as fine, LINEAR filtering
// there averages the 2x2 under it, which is the box_down the pipeline did first.
float liftAt(vec2 px) {
  return lift(texture(uHeight, (px + 0.5) / uSize).r);
}

void main() {
  vec2 px = floor(gl_FragCoord.xy);
  float y = liftAt(px);
  float occl = 0.0;
  for (int d = 0; d < 8; d++) {
    float horizon = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= uStepCount) break;
      vec2 q = px + DIRS[d] * uSteps[i];
      // Past the raster counts for nothing, as the pipeline's NaN fill did.
      if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, uSize - 1.0))) continue;
      float dist = uSteps[i] * uKmPerPx * length(DIRS[d]);
      horizon = max(horizon, (liftAt(q) - y) / dist);
    }
    occl += atan(horizon) / HALF_PI;
  }
  float ao = 1.0 - clamp(occl / 8.0, 0.0, 1.0);
  outColor = vec4(ao, texture(uCoast, gl_FragCoord.xy / uSize).r, 0.0, 1.0);
}
