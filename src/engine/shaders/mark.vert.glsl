// An instanced marker standing on the terrain: a bead or a figurine at an anchor, at a
// size given in screen pixels. The height under it is read from the same heightmap the
// terrain is displaced by, with the same curve, so a marker rides the relief as it
// grows, rides the lifted block, and rides a prisms layer's columns, without the CPU
// telling it anything per frame.
uniform sampler2D uHeight;   // R16F metres
uniform vec2 uSizeKm;
uniform float uExag;
uniform float uGamma;
uniform float uHRef;
uniform sampler2D uIds;      // state id / 255 (NEAREST)
uniform float uHole;         // the lifted state, or -1
uniform float uBlockLift;    // km it stands above the plate
uniform sampler2D uPrismLut;
uniform float uPrismKm;
uniform float uKmPerPx;      // world size of one screen pixel (orthographic)
uniform float uScale;        // the zoom's marker scale, shared with the HTML tokens
uniform float uFootprint;    // the shadow disc's radius, in units of the marker's size

in vec2 iAnchor;             // scene km: x east, z south
in float iSize;              // px per model unit
in vec3 iTint;               // the item's colour, where the recipe lets it in
in float iShow;              // 0 hides the instance
in float iSel;               // 1 for the item whose card is open
in vec3 color;               // the part's own colour
in float tint;               // 1 where iTint replaces it

out vec3 vColor;
out vec3 vNormal;
out float vSel;
out vec2 vLocal;

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

void main() {
  vec2 uv = iAnchor / uSizeKm + 0.5;
  float y = lift(texture(uHeight, uv).r);
  float id = floor(texture(uIds, uv).r * 255.0 + 0.5);
  if (uHole >= 0.0 && abs(id - uHole) < 0.5) y += uBlockLift;
  if (uPrismKm > 0.0) {
    vec2 pr = texture(uPrismLut, vec2((id + 0.5) / 256.0, 0.5)).rg;
    y += uPrismKm * pr.r * step(0.5, pr.g);
  }
  // The one whose card is open stands a little taller. The shadow disc is a flat thing
  // a hair above the ground, scaled to the figurine's footprint rather than its height.
  float s = iSize * uScale * uKmPerPx * iShow * (1.0 + 0.18 * iSel);
  vec3 local = position * (uFootprint > 0.0 ? uFootprint : 1.0);
  vec3 p = vec3(iAnchor.x, y + 0.12 * uKmPerPx, iAnchor.y) + local * s;
  vColor = mix(color, iTint, tint);
  vNormal = normal;
  vSel = iSel;
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
