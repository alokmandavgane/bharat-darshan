// Displaces a flat grid by the heightmap. Heights <= 0 (ocean) stay on the y = 0 sheet.
uniform sampler2D uHeight;   // R16F metres
uniform vec2 uSizeKm;        // grid width, height in km
uniform float uExag;         // vertical exaggeration
uniform float uGamma;        // curve exponent (PLAN.md section 6)
uniform float uHRef;         // reference height for the curve, m
uniform sampler2D uIds;      // state id / 255 (NEAREST)
uniform float uHole;         // id whose ground is flattened (the socket a lifted block left), or -1
uniform float uLift;         // km added to everything drawn by this material (the lifted block)
uniform vec4 uLocalRect;     // country-uv rect the bound rasters cover; (0,0,1,1) is the country tier

out vec2 vUv;
out vec3 vPos;               // scene km: x east, y up, z south

vec2 luv(vec2 v) { return (v - uLocalRect.xy) / uLocalRect.zw; }

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

void main() {
  float h = texture(uHeight, luv(uv)).r;
  float y = lift(h);
  if (uHole >= 0.0) {
    float id = floor(texture(uIds, luv(uv)).r * 255.0 + 0.5);
    if (abs(id - uHole) < 0.5) y = 0.0;
  }
  // the model settles into the paper towards the edge of the data, no hard rim
  float edge = min(min(uv.x, 1.0 - uv.x) * uSizeKm.x, min(uv.y, 1.0 - uv.y) * uSizeKm.y);
  y *= smoothstep(0.0, 260.0, edge);
  vec3 p = vec3((uv.x - 0.5) * uSizeKm.x, y + uLift, (uv.y - 0.5) * uSizeKm.y);
  vUv = uv;
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
