// An instanced marker standing on the terrain: a bead, a peg or a figurine at an anchor,
// at a size given in screen pixels. The height under it is read from the same heightmap
// the terrain is displaced by, with the same curve, so a marker rides the relief as it
// grows, rides the lifted block, and rides a prisms layer's columns, without the CPU
// telling it anything per frame. The same shader draws the shadow disc under it and,
// for a peg, the glyph decal on its head, which turns to face the camera.
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
uniform float uFootprint;    // > 0: this draw is the shadow disc, at this radius in model units
uniform float uDecal;        // 1: this draw is the glyph quad on a peg's head
uniform float uHeadY;        // the head's centre, model units up from the ground
uniform float uHeadR;        // the head's radius, model units
uniform float uAtlasCols;
uniform float uTime;         // seconds

in vec2 iAnchor;             // scene km: x east, z south
in float iSize;              // px per model unit
in vec3 iTint;               // the item's colour, where the recipe lets it in
in float iShow;              // 0 hides the instance
in float iSel;               // 1 for the item whose card is open
in float iGlyph;             // cell of the atlas, for a peg
in float iBorn;              // seconds at which it came into view, or -1 for always
in vec3 color;               // the part's own colour
in float tint;               // 1 where iTint replaces it

out vec3 vColor;
out vec3 vNormal;
out float vSel;
out vec2 vLocal;
out vec2 vUv;

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

void main() {
  vec2 uv0 = iAnchor / uSizeKm + 0.5;
  float y = lift(texture(uHeight, uv0).r);
  float id = floor(texture(uIds, uv0).r * 255.0 + 0.5);
  if (uHole >= 0.0 && abs(id - uHole) < 0.5) y += uBlockLift;
  if (uPrismKm > 0.0) {
    vec2 pr = texture(uPrismLut, vec2((id + 0.5) / 256.0, 0.5)).rg;
    y += uPrismKm * pr.r * step(0.5, pr.g);
  }
  // Coming into view a marker springs up, with a little overshoot, one after another:
  // a handful of pieces being set down on the model rather than appearing all at once.
  float pop = iBorn < 0.0 ? 1.0 : clamp((uTime - iBorn) / 0.42, 0.0, 1.0);
  float ease = 1.0 - pow(1.0 - pop, 3.0);
  ease *= 1.0 + 0.22 * sin(pop * 3.14159);
  // The one whose card is open stands a little taller.
  float s = iSize * uScale * uKmPerPx * iShow * ease * (1.0 + 0.18 * iSel);
  vec3 base = vec3(iAnchor.x, y + 0.12 * uKmPerPx, iAnchor.y);
  vec3 p;
  if (uDecal > 0.5) {
    // A quad on the near side of the head, in the camera's own frame, so the glyph is
    // read square-on at every yaw and tilt while the head it sits on stays a lit sphere.
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 toCam = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    vec3 head = base + vec3(0.0, uHeadY * s, 0.0);
    p = head + (right * position.x + up * position.y) * uHeadR * 0.78 * s + toCam * uHeadR * 1.04 * s;
    vUv = (vec2(uv.x, 1.0 - uv.y) + vec2(mod(iGlyph, uAtlasCols), floor(iGlyph / uAtlasCols))) / uAtlasCols;
  } else {
    // The shadow disc is a flat thing a hair above the ground, scaled to the footprint.
    vec3 local = position * (uFootprint > 0.0 ? uFootprint : 1.0);
    p = base + local * s;
    vUv = vec2(0.0);
  }
  vColor = mix(color, iTint, tint);
  vNormal = normal;
  vSel = iSel;
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
