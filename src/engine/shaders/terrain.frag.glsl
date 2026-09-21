// The clay / paper look (PLAN.md section 3): banded hypsometric colour, one soft key
// light from the north-west with wrap, baked AO, paper grain, flat ocean with a baked
// coastal shadow, lighter desaturated neighbours, scored borders from distance fields.
uniform sampler2D uHeight;     // R16F metres, LINEAR
uniform vec2 uHeightTexel;     // 1 / heightmap size
uniform vec4 uLocalRect;       // country-uv rect the bound rasters cover; (0,0,1,1) is the country tier
uniform sampler2D uShade;      // r: ambient occlusion, g: coastal shadow (half res, LINEAR)
uniform sampler2D uIds;        // r: state id / 255 (NEAREST)
uniform sampler2D uIndiaEdge;  // signed distance to India's outline: 0.5 on it, up inside
uniform float uEdgeRangeKm;    // distance the field reaches, each way
uniform sampler2D uStateEdge;  // the same, for the unit lifted out of the plate
uniform vec4 uStateRect;       // country-uv rect that field covers
uniform float uStateEdgeRangeKm;
uniform float uHasStateEdge;   // 0 until the unit's package has arrived
uniform sampler2D uBorders;    // r: internal, g: external border field, 255 on the line
uniform float uBorderRangeKm;  // distance at which the border field reaches 0
uniform float uBorderTexelKm;  // world size of one border-field texel
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
uniform float uOnlyIndia;      // 1: draw India alone as a cut-out on the page, no sea or neighbours
uniform vec2 uInnerKm;         // backdrop only: half-extents of the plate it hands over to
uniform vec3 uTable;           // colour the model sits on
uniform vec3 uOcean;
uniform vec3 uBands[7];        // hypsometric palette, low to high
uniform float uBandTops[7];    // upper edge of each band, m

in vec2 vUv;
in vec3 vPos;
out vec4 outColor;

// Country uv -> uv inside whatever rasters are bound. Identity unless a state package is.
vec2 luv(vec2 v) { return (v - uLocalRect.xy) / uLocalRect.zw; }

float lift(float h) {
  return h <= 0.0 ? 0.0 : uExag * pow(h / uHRef, uGamma) * uHRef * 0.001;
}

vec3 terrainNormal(vec2 uv) {
  vec2 t = uHeightTexel;
  float hl = lift(texture(uHeight, uv - vec2(t.x, 0.0)).r);
  float hr = lift(texture(uHeight, uv + vec2(t.x, 0.0)).r);
  float hu = lift(texture(uHeight, uv - vec2(0.0, t.y)).r);   // north
  float hd = lift(texture(uHeight, uv + vec2(0.0, t.y)).r);   // south
  vec2 texelKm = t * uSizeKm * uLocalRect.zw;
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
  float h = texture(uHeight, luv(vUv)).r;
  float land = smoothstep(-20.0, -5.0, h);          // ocean texels are <= -25 m by construction
  vec2 shade = texture(uShade, luv(vUv)).rg;
  float id = floor(texture(uIds, luv(vUv)).r * 255.0 + 0.5);

  // The lifted unit's own signed edge, once its package is here. It is what the block
  // trims its rim with and what the plate cuts its socket from, so both end on the curve
  // the walls stand on rather than on the step the ID raster takes.
  vec2 sUv = (vUv - uStateRect.xy) / uStateRect.zw;
  float inRect = step(0.0, sUv.x) * step(sUv.x, 1.0) * step(0.0, sUv.y) * step(sUv.y, 1.0);
  float stateEdgeKm = uHasStateEdge * inRect > 0.5
    ? (texture(uStateEdge, sUv).r * 2.0 - 1.0) * uStateEdgeRangeKm
    : -uStateEdgeRangeKm;

  // The country's own silhouette comes from the signed field, not from the ID raster:
  // the walls standing on it follow the smoothed outline, and a staircase underneath a
  // smooth wall is what made the coast look sawn. The field is a country raster, so it
  // is read in country uv and only by the plate -- a lifted block has its own mask.
  float aaKm = 0.75 * uKmPerPx;
  float plate = step(uRegion, -0.5);
  float mine = 1.0;
  if (uRegion >= 0.0) {
    if (uHasStateEdge > 0.5) {
      if (stateEdgeKm < -2.0 * aaKm) discard;
      mine = smoothstep(-aaKm, aaKm, stateEdgeKm);
    } else if (abs(id - uRegion) >= 0.5) {
      discard;
    }
  }
  float edgeKm = (texture(uIndiaEdge, vUv).r * 2.0 - 1.0) * uEdgeRangeKm;
  float inIndia = smoothstep(-aaKm, aaKm, edgeKm);
  if (uOnlyIndia > 0.5 && plate > 0.5 && edgeKm < -2.0 * aaKm) discard;
  float india = mix(step(0.5, id), inIndia, plate);
  // Inside the cut-out everything is the model, whatever the heightmap says the sea does.
  // Without this the silhouette is clean but frays just inside itself, where coastal
  // texels read below sea level and were painted as ocean at full opacity.
  if (uOnlyIndia > 0.5 && plate > 0.5) land = max(land, inIndia);
  float hole = uHole >= 0.0 ? 1.0 - step(0.5, abs(id - uHole)) : 0.0;

  // --- land: colour by height, lit by one soft light with wrap, creased by AO
  vec3 n = terrainNormal(luv(vUv));
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

  // --- borders: the fields measure to the smoothed outlines of step 1, so a level set of
  // one is that curve rather than the pixels under it, and the line is drawn at a width
  // asked for in screen pixels. The old 0.55 and 0.85 were against a field that measured
  // to the border *pixels*, which lent every line half a texel of unearned weight that
  // grew with the zoom, so the numbers here are larger for the same look.
  //
  // What an unsigned field cannot do is hold a line thinner than its own texel: bilinear
  // interpolation across a cell never dips below the smallest of its four corners, so a
  // thinner level set breaks into dashes (5% of the cells on the line at 0.4 texels, none
  // by 0.75). Hold the width at that floor and let the line fade out instead of fattening
  // once the camera has outrun what the field can say.
  vec2 b = texture(uBorders, luv(vUv)).rg;
  float dInt = (1.0 - b.r) * uBorderRangeKm;
  float dExt = (1.0 - b.g) * uBorderRangeKm;
  float aa = aaKm;
  float grain = 0.75 * uBorderTexelKm;
  float askInt = 1.1 * uKmPerPx, askExt = 1.6 * uKmPerPx;
  float held = 1.0 - smoothstep(2.0, 6.0, grain / max(askInt, 1e-6));
  float wInt = max(askInt, grain), wExt = max(askExt, grain);
  // Only the plate scores borders: a block has one state in it, and its rasters are
  // its own, so the country field would be read through the wrong rect.
  float lineInt = plate * held * (1.0 - smoothstep(wInt - aa, wInt + aa, dInt));
  float lineExt = plate * held * (1.0 - smoothstep(wExt - aa, wExt + aa, dExt));
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
    float wSel = max(2.0 * uKmPerPx, grain);
    float outline = held * (1.0 - smoothstep(wSel - aa, wSel + aa, dEdge)) * onEdge;
    col = mix(col, col * vec3(1.16, 1.07, 0.84) + vec3(0.05, 0.025, 0.0), sel);
    col = mix(col, vec3(0.32, 0.12, 0.04), outline * 0.9);
  }
  col = mix(col, col * 1.07 + 0.015, hov);

  // --- state view: the rest of the country steps back, the socket is flat and dark.
  // The socket is the one edge still cut from the ID raster, a state at a time being
  // more than one field can hold; feathering it over a texel turns its staircase into
  // a shadow, which is what a cut in clay looks like anyway.
  // The socket: the state field when the package is here, else the old raster test
  // feathered over a texel, which is the best a 1.7 km mask can do.
  float socket = uHasStateEdge > 0.5
    ? smoothstep(-aaKm, aaKm, stateEdgeKm) * step(0.0, uHole)
    : hole * smoothstep(0.0, 1.2 * uBorderTexelKm, min(dInt, dExt));
  float lumd = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, mix(vec3(lumd), col, 0.45) * 0.82, uDim * land * (1.0 - socket));
  col = mix(col, uTable * 0.5, socket);

  // --- paper grain in world space
  float g = texture(uGrain, vPos.xz * 0.022).r;
  col *= 0.94 + 0.12 * g * (1.0 - socket);

  // dissolve into the page (premultiplied alpha) instead of ending at a rim
  float edge = min(min(vUv.x, 1.0 - vUv.x) * uSizeKm.x, min(vUv.y, 1.0 - vUv.y) * uSizeKm.y);
  // The backdrop is three times the plate across, so it needs a proportionate run-out or
  // it ends as a rectangle on the page rather than as land running out of the picture.
  float fadeKm = uInnerKm.x > 0.0 ? 0.16 * uSizeKm.y : 420.0;
  float fade = smoothstep(0.0, fadeKm, edge);
  if (uOnlyIndia > 0.5 && plate > 0.5) fade *= inIndia;   // the cut-out ends on the outline
  // The backdrop comes in exactly as the plate sinks into the page. The plate's rim fade
  // runs over its last 420 km, which is the outer quarter of its half-extent, so the two
  // alphas are complements of one smoothstep and never leave the page showing between.
  if (uInnerKm.x > 0.0) {
    vec2 q = abs(vPos.xz) / uInnerKm;
    fade *= smoothstep(0.75, 1.0, max(q.x, q.y));
  }
  fade *= mine;                                           // the block's rim, softened
  vec4 o = linearToOutputTexel(vec4(col, 1.0));
  outColor = vec4(o.rgb * fade, fade);
}
