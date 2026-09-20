// The clay / paper look (PLAN.md section 3): banded hypsometric colour, one soft key
// light from the north-west with wrap, baked AO, paper grain, flat ocean with a baked
// coastal shadow, lighter desaturated neighbours, scored borders from distance fields.
uniform sampler2D uHeight;     // R16F metres, LINEAR
uniform vec2 uHeightTexel;     // 1 / heightmap size
uniform sampler2D uShade;      // r: ambient occlusion, g: coastal shadow (half res, LINEAR)
uniform sampler2D uIds;        // r: state id / 255 (NEAREST)
uniform sampler2D uBorders;    // r: internal, g: external border field, 255 on the line
uniform float uBorderRangeKm;  // distance at which the border field reaches 0
uniform sampler2D uGrain;      // tiling noise
uniform vec2 uSizeKm;
uniform float uExag;
uniform float uGamma;
uniform float uHRef;
uniform float uKmPerPx;        // world size of one screen pixel (orthographic)
uniform float uSelected;       // state id or -1
uniform float uHover;          // state id or -1
uniform float uRegion;         // draw only this state id (the lifted block), or -1 for everything
uniform float uHole;           // state id drawn as a flat dark socket, or -1
uniform float uDim;            // 0..1: quieten every other state (state view)
uniform vec3 uTable;           // colour the model sits on
uniform vec3 uOcean;
uniform vec3 uBands[7];        // hypsometric palette, low to high
uniform float uBandTops[7];    // upper edge of each band, m

in vec2 vUv;
in vec3 vPos;
out vec4 outColor;

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

vec3 terrainNormal(vec2 uv) {
  vec2 t = uHeightTexel;
  float hl = lift(texture(uHeight, uv - vec2(t.x, 0.0)).r);
  float hr = lift(texture(uHeight, uv + vec2(t.x, 0.0)).r);
  float hu = lift(texture(uHeight, uv - vec2(0.0, t.y)).r);   // north
  float hd = lift(texture(uHeight, uv + vec2(0.0, t.y)).r);   // south
  vec2 texelKm = t * uSizeKm;
  return normalize(vec3((hl - hr) / (2.0 * texelKm.x), 1.0, (hu - hd) / (2.0 * texelKm.y)));
}

vec3 bandColour(float h) {
  vec3 c = uBands[0];
  for (int i = 0; i < 6; i++) {
    // soft band edges; the snow line is kept narrow so plateaus stay clay-coloured
    float w = i == 5 ? uBandTops[i] * 0.08 : max(20.0, uBandTops[i] * 0.3);
    c = mix(c, uBands[i + 1], smoothstep(uBandTops[i] - w, uBandTops[i] + w, h));
  }
  return c;
}

void main() {
  float h = texture(uHeight, vUv).r;
  float land = smoothstep(-20.0, -5.0, h);          // ocean texels are <= -25 m by construction
  vec2 shade = texture(uShade, vUv).rg;
  float id = floor(texture(uIds, vUv).r * 255.0 + 0.5);
  if (uRegion >= 0.0 && abs(id - uRegion) >= 0.5) discard;
  float india = step(0.5, id);
  float hole = uHole >= 0.0 ? 1.0 - step(0.5, abs(id - uHole)) : 0.0;

  // --- land: colour by height, lit by one soft light with wrap, creased by AO
  vec3 n = terrainNormal(vUv);
  vec3 L = normalize(vec3(-1.0, 1.35, -1.0));         // from the north-west, high
  float wrap = 0.6;
  float diff = clamp((dot(n, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 sun = vec3(1.0, 0.97, 0.92);
  vec3 sky = vec3(0.90, 0.93, 1.0);
  vec3 light = sky * 0.50 + sun * 0.62 * diff;
  float ao = mix(1.0, shade.r, 0.75);
  vec3 albedo = bandColour(h);
  vec3 col = albedo * light * ao;

  // neighbours: same relief, paler and quieter, so India reads without drawing their lines
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  vec3 quiet = mix(vec3(lum), vec3(0.83, 0.78, 0.71), 0.55);
  col = mix(quiet, col, max(india, 1.0 - land));

  // --- ocean: a flat matte sheet, darker under the coast, a hint of the shelf
  float depth = clamp(-h / 3000.0, 0.0, 1.0);
  vec3 ocean = uOcean * (1.0 - 0.18 * depth);
  ocean = mix(ocean * 1.025, ocean, smoothstep(0.0, 250.0, -h));
  float coast = shade.g * shade.g * (3.0 - 2.0 * shade.g);       // smoothstep of the baked distance
  ocean *= 1.0 - 0.32 * coast;
  col = mix(ocean, col, land);

  // --- borders: distance fields give constant screen-width lines at any zoom
  vec2 b = texture(uBorders, vUv).rg;
  float dInt = (1.0 - b.r) * uBorderRangeKm;
  float dExt = (1.0 - b.g) * uBorderRangeKm;
  float aa = 0.75 * uKmPerPx;
  float lineInt = 1.0 - smoothstep(0.55 * uKmPerPx - aa, 0.55 * uKmPerPx + aa, dInt);
  float lineExt = 1.0 - smoothstep(0.85 * uKmPerPx - aa, 0.85 * uKmPerPx + aa, dExt);
  col = mix(col, col * 0.70, lineInt * 0.85 * land);
  col = mix(col, vec3(0.075, 0.058, 0.050), lineExt * 0.85 * land);

  // --- selection: a warm lift of the fill and a firm outline where it meets its
  // neighbours (one-texel look-around in the ID raster); hover is a whisper of the same
  float sel = india * (1.0 - step(0.5, abs(id - uSelected)));
  float hov = india * (1.0 - step(0.5, abs(id - uHover))) * (1.0 - sel);
  if (uSelected >= 0.0) {
    float n0 = floor(textureOffset(uIds, vUv, ivec2( 1, 0)).r * 255.0 + 0.5);
    float n1 = floor(textureOffset(uIds, vUv, ivec2(-1, 0)).r * 255.0 + 0.5);
    float n2 = floor(textureOffset(uIds, vUv, ivec2( 0, 1)).r * 255.0 + 0.5);
    float n3 = floor(textureOffset(uIds, vUv, ivec2( 0,-1)).r * 255.0 + 0.5);
    float anySel = max(max(1.0 - step(0.5, abs(n0 - uSelected)), 1.0 - step(0.5, abs(n1 - uSelected))),
                       max(1.0 - step(0.5, abs(n2 - uSelected)), 1.0 - step(0.5, abs(n3 - uSelected))));
    float anyOther = max(max(step(0.5, abs(n0 - uSelected)), step(0.5, abs(n1 - uSelected))),
                         max(step(0.5, abs(n2 - uSelected)), step(0.5, abs(n3 - uSelected))));
    float onEdge = max(sel * anyOther, (1.0 - sel) * anySel);
    float dEdge = min(dInt, dExt);
    float outline = (1.0 - smoothstep(1.1 * uKmPerPx - aa, 1.1 * uKmPerPx + aa, dEdge)) * onEdge;
    col = mix(col, col * vec3(1.16, 1.07, 0.84) + vec3(0.05, 0.025, 0.0), sel);
    col = mix(col, vec3(0.32, 0.12, 0.04), outline * 0.9);
  }
  col = mix(col, col * 1.07 + 0.015, hov);

  // --- state view: the rest of the country steps back, the socket is flat and dark
  float lumd = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, mix(vec3(lumd), col, 0.45) * 0.82, uDim * land * (1.0 - hole));
  col = mix(col, uTable * 0.5, hole);

  // --- paper grain in world space
  float g = texture(uGrain, vPos.xz * 0.022).r;
  col *= 0.94 + 0.12 * g * (1.0 - hole);

  outColor = linearToOutputTexel(vec4(col, 1.0));
}
