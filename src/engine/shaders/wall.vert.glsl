// Sides of the lifted state block: quads along the outline, top edge on the terrain.
uniform sampler2D uHeight;
uniform vec2 uSizeKm;
uniform float uExag;
uniform float uGamma;
uniform float uHRef;
uniform float uLift;
uniform float uDepth;        // slab thickness, km

in vec2 side;                // outward normal of the segment, in the ground plane

out float vLit;
out float vT;                // 1 at the top edge, 0 at the bottom

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

void main() {
  vec2 st = vec2(position.x / uSizeKm.x + 0.5, position.z / uSizeKm.y + 0.5);
  float top = lift(texture(uHeight, st).r) + uLift;
  float y = position.y > 0.5 ? top : uLift - uDepth;
  vT = position.y;
  vLit = 0.72 + 0.28 * dot(normalize(side), normalize(vec2(-1.0, -1.0)));   // north-west light
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, y, position.z, 1.0);
}
