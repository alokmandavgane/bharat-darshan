// Displaces a flat grid by the heightmap. Heights <= 0 (ocean) stay on the y = 0 sheet.
uniform sampler2D uHeight;   // R16F metres
uniform vec2 uSizeKm;        // grid width, height in km
uniform float uExag;         // vertical exaggeration
uniform float uGamma;        // curve exponent (PLAN.md section 6)
uniform float uHRef;         // reference height for the curve, m

out vec2 vUv;
out vec3 vPos;               // scene km: x east, y up, z south

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

void main() {
  float h = texture(uHeight, uv).r;
  vec3 p = vec3((uv.x - 0.5) * uSizeKm.x, lift(h), (uv.y - 0.5) * uSizeKm.y);
  vUv = uv;
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
