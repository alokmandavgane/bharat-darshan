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
// A `prisms` layer: how far each region is raised, as a lookup by id (r: 0..1 of the
// layer's range, g: 255 where the region has a value). The drawing only a 3D atlas has
// -- population or output as the height of the ground itself rather than as its colour.
uniform sampler2D uPrismLut;
uniform float uPrismKm;      // km the top of the range stands up; 0 when no prisms layer is on

out vec2 vUv;
out vec3 vPos;               // scene km: x east, y up, z south

vec2 luv(vec2 v) { return (v - uLocalRect.xy) / uLocalRect.zw; }

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

void main() {
  float h = texture(uHeight, luv(uv)).r;
  float y = lift(h);
  float id = floor(texture(uIds, luv(uv)).r * 255.0 + 0.5);
  if (uHole >= 0.0 && abs(id - uHole) < 0.5) y = 0.0;
  // Prisms raise the ground a region at a time. The mesh spans the boundary, so the
  // step between two regions is a ramp one cell wide rather than a cliff -- about 6 km
  // at the 512 grid, under a pixel at the home view, and the honest alternative would
  // be 36 separate meshes.
  if (uPrismKm > 0.0) {
    vec2 pr = texture(uPrismLut, vec2((id + 0.5) / 256.0, 0.5)).rg;
    y += uPrismKm * pr.r * step(0.5, pr.g);
  }
  // the model settles into the paper towards the edge of the data, no hard rim
  float edge = min(min(uv.x, 1.0 - uv.x) * uSizeKm.x, min(uv.y, 1.0 - uv.y) * uSizeKm.y);
  y *= smoothstep(0.0, 260.0, edge);
  vec3 p = vec3((uv.x - 0.5) * uSizeKm.x, y + uLift, (uv.y - 0.5) * uSizeKm.y);
  vUv = uv;
  vPos = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
