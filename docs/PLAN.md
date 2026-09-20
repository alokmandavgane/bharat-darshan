# Bharat Darshan (भारत दर्शन): implementation plan

An interactive, isometric 3D map of India for exploring the country's geography and
culture: relief, rivers, roads, railways, languages, places, food, festivals. Most
users will be on phones; bigger screens should use their full width.

Last updated: 2026-09-20. Status and next steps are at the bottom of this file;
update them at the end of every working session so any machine can pick up the work.

---

## 1. Approach

India is a fixed, bounded dataset, so this does not need a general slippy-map engine.
Build it as a **pre-baked 3D diorama**: an offline pipeline turns elevation,
boundaries, networks and curated content into small static files, and a custom
three.js scene renders them with an orthographic camera.

Consequences: no tile server, no API keys, static hosting, and full control over the
look, which is where the delight comes from.

## 2. Decisions that shape everything else

| # | Decision | Why |
|---|----------|-----|
| D1 | Custom three.js scene, not MapLibre / deck.gl | Map libraries give tiles, labels and picking for free, but bring a perspective camera, Web Mercator and a "map app" look. As far as I know MapLibre has no true orthographic camera, and its WebGL text has historically been weak at shaping Indic scripts (re-check before relying on this). Limiting scope to two levels (country, state) keeps the custom cost manageable. The data pipeline is identical either way, so MapLibre + PMTiles remains the fallback if the Phase 0 spike disappoints. |
| D2 | Orthographic camera, north-up with a slight turn; not strict 45° isometric | Strict isometric (45° yaw, 35.26° elevation) turns India into a wide diamond: poor use of a portrait phone, and the silhouette stops being recognisable. About 15° of yaw with a 50-55° tilt keeps the familiar shape, suits portrait screens (India is about 3,200 km north-south by 2,900 km east-west), and keeps the Himalaya at the back where exaggerated relief never hides anything. Clamp yaw to roughly ±40°. |
| D3 | Two semantic levels instead of continuous zoom | Country view, then state view. Tap a state: the camera flies in, the state lifts out as its own block, the rest dims, and a lazily loaded state package (higher-res terrain, denser networks, districts, more places) swaps in. Street-level detail is out of scope; this is a showcase, not navigation. |
| D4 | Tap + bottom sheet is the core interaction; hover is a desktop enhancement | Phones have no hover. "Hover to learn" becomes: tap to select, peek card, "Explore" to go deeper, plus a swipeable card carousel that flies the camera to each item. Desktop adds real hover tooltips over the same data. |
| D5 | Layers are data, not code | Four layer types cover the whole wish-list: `terrain`, `choropleth` (languages; later climate, population...), `lines` (rivers, roads, rail), `points` (places, food, festivals). A manifest describes each layer's files, style, legend and tooltip template. Layer number 12 should need no engine changes. |
| D6 | Official boundaries from day one | Use Survey of India-compliant external boundaries (all of J&K and Ladakh including Aksai Chin; Arunachal Pradesh) and the current 28 states + 8 UTs. Default Natural Earth and OSM country outlines show de-facto lines, which is a legal problem for a map published in India. Review every rendered view, including share images. |

## 3. Experience design

### Levels

1. **Country**: whole of India, constrained orbit, pinch zoom about 1x-4x. Shows
   national highways, trunk rail, major rivers, top-tier places.
2. **State**: entered by tapping a state (or via list/search/URL). Districts become
   selectable; networks and points get denser.
3. **Item detail**: a card / full-height sheet for a place, dish, festival, river,
   range. Not a map zoom level.

### Interaction model

| Intent | Phone / touch | Desktop / fine pointer |
|--------|---------------|------------------------|
| Inspect | Tap: highlight + peek card in sheet | Hover: highlight + tooltip |
| Go deeper | "Explore" on the card, or double-tap | Click |
| Browse | Swipe the card carousel; camera follows | Same list in the side panel; arrow keys |
| Move | Drag pan, pinch zoom, twist rotate, two-finger drag tilt | Drag, wheel, right-drag rotate |
| Back | Back gesture / sheet header (URL-driven) | Esc / breadcrumb |

- Branch on capability (`@media (hover: hover) and (pointer: fine)`, `pointerType`),
  not on screen width. iPads with mice and touch laptops exist.
- Small regions (Goa, Sikkim, Tripura, Delhi, Chandigarh, Puducherry's four enclaves,
  Daman and Diu, Lakshadweep) are nearly untappable at country zoom on a phone. Bias
  hit-testing toward small regions within about 24 px, give tiny UTs a marker, and
  make every region reachable from the list and search regardless.
- Later: long-press-and-drag "scrub" mode with a tooltip offset above the finger, as
  a true hover equivalent on touch.

### Layout

Phone, portrait:

```
+------------------------+
| Bharat Darshan  [find] |  floating header
|                        |
|       3D canvas        |  full bleed, 100dvh, safe-area insets
|  (camera padded so the |
|  selection is centred  |
|   above the sheet)     |
|                        |
| [Relief][Rivers][Rail]>|  layer chips in the thumb zone, scroll sideways
+------------------------+
|          ----          |  bottom sheet: peek / half / full
| Kerala        Explore >|
| Malayalam, 14 districts|
| [card ] [card ] [car   |  carousel <-> camera sync
+------------------------+
```

Desktop / tablet landscape:

```
+------------------------------------------------------------------+
| +-----------+                                    +-------------+ |
| | Layers    |            3D canvas               | Detail      | |
| | x Relief  |        (whole viewport)            | panel for   | |
| | x Rivers  |     +---------------+              | the current | |
| |   Roads   |     | hover tooltip |              | selection   | |
| |   Rail    |     +---------------+              |             | |
| |   ...     |                                    |             | |
| | Legend    |       [ Relief --o-- 12x ]         |             | |
| +-----------+                                    +-------------+ |
+------------------------------------------------------------------+
```

- India is portrait-shaped, so wide screens have natural dead space either side of
  it. Panels float there; the same camera-padding mechanism that handles the phone's
  bottom sheet keeps the country centred between them.
- Canvas: `touch-action: none`, no page scroll, `overscroll-behavior: none` (stops
  pull-to-refresh on Android Chrome).
- Desktop extras: more simultaneous labels, higher-res data tier, tilt-shift depth of
  field for a miniature look, keyboard navigation.

### Accessibility and fallbacks

- The canvas is opaque to assistive tech. Mirror the content in DOM: state and place
  lists double as screen-reader content, SEO content and the no-WebGL fallback.
- Respect `prefers-reduced-motion` (crossfade instead of fly). Colour-blind-safe
  choropleth palettes. Label halos for contrast over terrain.
- i18n from day one: every name carries English + native script.

## 4. Architecture

### Stack

- **Vite + TypeScript.**
- **Engine: plain three.js on WebGL2**, framework-agnostic, with a small imperative
  API (`setLayers`, `flyTo`, `setSelection`, `onHover`, `onSelect`). Do not depend on
  WebGPU yet: the audience skews to budget Android phones.
- **UI: React** shell, **zustand** store. Engine never imports React; UI never
  touches three objects; they meet in the store.
- **URL is the source of truth for view state**: `/state/kerala?layers=relief,rivers`,
  `/place/hampi`. Everything is deep-linkable.
- **Pipeline:** Python (GDAL/rasterio, geopandas, shapely, pyproj, numpy), mapshaper,
  osmium-tool.
- **Hosting:** static, e.g. Cloudflare Pages (good India PoPs, free bandwidth; 25 MiB
  per-file limit, so big data packages may need R2). Content-hashed immutable assets.
- **Share previews:** the build emits per-route HTML shells with Open Graph tags and
  pre-rendered images. WhatsApp link previews will be a main distribution channel and
  they do not run JS.

### Planned repo layout

```
bharat-darshan/
  docs/            plan, decision notes, design notes
  pipeline/        offline data build; raw/ and cache/ are git-ignored
  content/         curated YAML/Markdown: states, places, dishes, festivals
  public/data/     generated, content-hashed assets + manifest.json
  src/
    engine/        three.js scene: terrain, camera rig, picking, labels
    layers/        layer types: terrain, choropleth, lines, points
    ui/            shell, bottom sheet, panels, cards, legends, search
    state/         store, URL sync, story player
```

### Layer manifest (sketch)

```jsonc
{
  "id": "rivers",
  "type": "lines",
  "title": { "en": "Rivers", "hi": "नदियाँ" },
  "group": "physical",            // choropleths are mutually exclusive; lines/points stack
  "data": {
    "country": "data/rivers.country.<hash>.bin",
    "state": "data/states/{code}/rivers.<hash>.bin"
  },
  "style": { "color": "#3b82c4", "widthBy": "order", "flow": true },
  "tooltip": "{name} · {length_km} km",
  "legend": { "kind": "line-width", "field": "order" }
}
```

### Content model

One schema for places, dishes, festivals and named physical features. Content lives
in the repo as YAML/Markdown and is validated at build time.

```yaml
id: hampi
type: place                      # place | dish | festival | range | peak | river ...
name: { en: Hampi, native: ಹಂಪಿ, lang: kn }
anchor: { lat: 15.335, lon: 76.462 }   # marker + camera target
regions: [IN-KA]                 # ISO 3166-2:IN; districts by LGD code
months: []                       # 1-12, for festivals and seasonality
blurb: Ruined capital of the Vijayanagara empire, spread across a boulder landscape.
media:
  - src: hampi-virupaksha.jpg
    alt: Virupaksha temple gopuram at Hampi
    credit: <author>             # credit, license and source are mandatory
    license: <licence>
    source: <url>
sources: [https://whc.unesco.org/en/list/241]
related: [badami, pattadakal]
```

- Dishes and festivals are regional more than point-like: `anchor` places the marker,
  `regions` drives the highlight. Pan-India festivals get no single marker; they show
  regional variants (Mysuru Dasara, Kullu Dussehra, Durga Puja...).
- Festival dates move every year with the lunar calendar. Generate Hindu festival
  dates at build time from the HinduCalendar engine instead of hand-maintaining them;
  other calendars need their own sources.
- The build emits a light per-layer index (id, name, position, icon) for the country
  view and lazy per-item detail JSON, responsive AVIF/WebP images and a sprite atlas.

## 5. Rendering details

- **One projection, baked offline.** Pre-project everything (rasters, vectors and
  content anchors) to a Lambert Conformal Conic tuned for India: EPSG:7755 (WGS 84 /
  India NSF LCC). Web Mercator visibly inflates the north (roughly 20% linear scale
  difference between Kanyakumari and Ladakh). The runtime then needs no projection
  code. If a runtime forward projection is ever needed (geolocation), port the
  ellipsoidal LCC formula; d3-geo's conic conformal is spherical and will not match
  GDAL's output exactly.
- **Scene units.** 1 unit = 1 km, origin at the bounding-box centre, y up.
  Bounding box about 68.0-97.5°E, 6.5-37.5°N (covers the official boundary, Indira
  Point, Lakshadweep and the Andaman and Nicobar Islands in their true positions).
- **Terrain.** A grid mesh displaced in the vertex shader from a heightmap texture.
  Exaggeration is a uniform, so toggling relief makes the mountains grow, and it eases
  down when entering a state. Use a non-linear curve, `y = k * pow(h, g)` with `g`
  around 0.65, so the Western Ghats, Aravallis, Vindhyas and Satpuras read without
  the Himalaya becoming a wall. Light from the north-west (cartographic convention),
  hypsometric tint from a swappable 1-D ramp texture, baked ambient occlusion later.
- **Heightmap delivery.** Ship as delta-encoded 16-bit binaries (gzip, decoded with
  `DecompressionStream`), decode once on the CPU and upload as a half-float texture.
  CPU-side heights are needed anyway for picking and label placement. Never put
  heights through lossy or colour-managed image formats.
- **Regions as an ID texture.** Rasterise states (8-bit) and districts (16-bit) into
  a texture where each pixel stores a region id, aligned to the heightmap.
  Hover/selection highlight is a uniform compare in the terrain shader. Any choropleth
  is a tiny id-to-colour lookup texture, so switching thematic layers is a cheap
  crossfade. A signed-distance-field border texture gives crisp, animatable outlines.
- **Lines and points.** Rivers, roads and rail are screen-space thick lines
  (instanced quads); markers are instanced sprites from an icon atlas. Both sample the
  same heightmap in their vertex shaders, so they stay glued to the terrain while
  exaggeration animates. River width from stream order; animated dashes show flow
  direction. Depth-test against terrain with a small bias.
- **Labels in HTML, not WebGL.** Project anchors while the camera moves, cull by
  priority and collision, cap at about 40. The browser shapes Devanagari, Tamil,
  Bengali and the rest correctly using system fonts (no font downloads), and labels
  stay accessible. Dual names ("Kerala · കേരളം") come free.
- **Picking.** Regions: intersect the pointer ray with the CPU heightfield, read the
  id texture. Points: screen-space distance with a 44 px touch radius. Lines:
  nearest-segment test against a spatial index, on tap / throttled hover only.
- **State view.** Separate grid mesh over the state's bounding box using its hi-res
  heightmap; fragments outside the state mask are discarded; the boundary is extruded
  downward as a wall so the state reads as a lifted block. Start the flight
  immediately with country-res data and crossfade the hi-res package in when it
  arrives. Never block on the network.
- **Camera rig.** Orthographic; tweened `target / zoom / yaw / pitch` with
  interruptible ~900 ms eases; "fit bounds with padding" as the one framing primitive
  (handles sheet, panels, orientation change and resize).

## 6. Data pipeline and sources

| Layer | Source | Notes |
|-------|--------|-------|
| Boundaries | Survey of India; DataMeet community maps; Natural Earth India point-of-view files | Validate 36 units, ISO 3166-2:IN and LGD codes. Keep 2011 district shapes for census joins. |
| Elevation | Copernicus DEM GLO-90 (country), GLO-30 (states); GEBCO for sea floor (optional) | Free with attribution; fewer Himalayan voids than SRTM. |
| Rivers | HydroRIVERS (stream order, discharge); names from OSM / Natural Earth | |
| Roads, rail | OpenStreetMap via the Geofabrik India extract, filtered with osmium | Country: national highways + trunk rail. State: adds state highways and all rail. ODbL attribution. |
| Languages | Census 2011 C-16 mother-tongue tables, district level | Latest census available. Colour by family, shade by language; top-5 list and a diversity index per district. |
| Places, food, festivals | Curated; seed from the UNESCO list, the GI registry, Wikidata | Wikimedia Commons images with licence tracked per item. Prefer a consistent illustrated icon set for markers. |

Pipeline steps (numbered scripts in `pipeline/`, re-runnable end to end):

1. **Boundaries**: validate, project, simplify at several LODs (mapshaper,
   topology-preserving); emit outlines, state/district ID rasters, SDF border texture.
2. **DEM**: mosaic, warp to the LCC grid, crop, resample to 1024² / 2048² / 4096²;
   emit heightmaps, normal/AO maps; per-state crops from GLO-30.
3. **Vectors**: osmium tag filters, project, simplify and merge, split by LOD, clip
   per state, densify so lines follow terrain, emit compact binaries.
4. **Thematic**: census tables to per-district values; emit lookup textures + JSON
   for tooltips and legends.
5. **Content**: validate, pre-project anchors, build indexes, images, sprite atlas.
6. **Manifest**: hash everything, write `manifest.json`.

Working across machines: raw downloads (several GB) are never committed. Built assets
should live in object storage (or Git LFS) with a fetch script, so a fresh clone can
run the app without re-running the whole pipeline. To be decided in Phase 0.

## 7. Performance budgets (mobile first)

- **Reference device:** a Rs 10-12k Android phone, tested from Phase 0, including
  inside in-app browsers (WhatsApp, Instagram).
- **First paint < 1 s:** a pre-rendered poster image of the exact default camera is
  the LCP element; the canvas crossfades over it. It doubles as the fallback.
- **Transfer:** JS <= ~350 KB gzipped. First-view data <= ~1.5 MB (1024² heightmap,
  state ID texture, outlines, labels). Every layer loads on first toggle; every state
  package (<= ~1 MB) on entry. Respect `navigator.connection.saveData`. A service
  worker caches what has been visited.
- **Frames:** render on demand, zero frames while idle; this matters more for battery
  and heat than peak fps. Target 60 fps mid-range, 30 fps floor. Ambient animation is
  subtle, throttled, paused when idle or hidden.
- **Quality tiers**, chosen by a startup micro-benchmark plus `deviceMemory`:

  | Tier | Mesh grid | Heightmap | DPR cap | Extras |
  |------|-----------|-----------|---------|--------|
  | Low | 256² | 1024² | 1.0 | none |
  | Medium | 512² | 2048² | 1.5 | flow animation |
  | High | 1024² | 4096² | 2.0 | AO, tilt-shift, ambient animation |

- **Robustness:** handle `webglcontextlost` / restored, dispose state packages on
  exit, keep GPU memory under ~150 MB (iOS Safari kills heavy tabs).
- **Enforce in CI:** bundle-size and Lighthouse budgets; Playwright screenshots at
  fixed cameras to catch shader regressions.

## 8. Roadmap

Rough, focused solo effort. Content, not code, is the long pole from Phase 3 onward.

**Phase 0: spike (~1 week).** De-risk the three scariest things.
- Boundaries + DEM through the pipeline in EPSG:7755.
- Displaced terrain, orthographic camera, exaggeration slider.
- Touch gestures and a bottom sheet coexisting on a real phone.
- Exit: >= 30 fps on the reference phone, < 2 MB first load, and the look makes
  someone say "wow". This is the go/no-go for D1 (custom engine vs MapLibre).

**Phase 1: core map (2-3 weeks).** State picking and highlight, tooltips and peek
cards, fly-in state view with lazy packages, responsive shell, URL state, poster
image, quality tiers, context-loss handling, state fact cards.

**Phase 2: physical layers (~2 weeks).** Rivers with flow, roads, rail; named ranges,
peaks and passes as hoverable relief features; layer panel, legends, line picking,
LOD by level.

**Phase 3: culture layers (3-4 weeks).** District-level language choropleth with
script samples and greeting audio; places, food and festivals with card-carousel
sync; a month scrubber ("India through the year"); search; first ~150 curated items.

**Phase 4: delight and launch (2-3 weeks).** Guided stories (follow the Ganga, the
monsoon's advance, the Golden Quadrilateral). Because camera, layers and selection
are declarative state, a story is a list of state snapshots with captions. Trains on
famous routes, low-poly landmarks, haptics, share cards, Hindi UI, accessibility
pass, PWA.

**Later.** More thematic layers (climate, forests and national parks, GI products,
crafts, classical dance and music traditions, forts, pilgrimage circuits), a
contribution workflow, more UI languages.

## 9. Risks

- **Boundaries.** Legal. See D6.
- **Low-end thermals and memory.** Hence real-device testing from week one, render on
  demand and tiers.
- **Content volume and image licensing.** Start narrow; licence fields are mandatory
  in the schema.
- **Contested facts.** Language vs dialect groupings in the census; dish origins
  (both West Bengal and Odisha hold rasgulla GI tags). Cite sources, keep a neutral
  tone, add a "suggest a correction" link.
- **Scope creep.** The manifest-driven layer system is the defence; ship a phase at a
  time.
- **iOS Safari quirks.** Memory limits, viewport units, context loss on backgrounding,
  no vibration API. Test early.

## 10. Open questions

1. Visual direction: realistic hypsometric terrain, or a stylised clay / paper model
   look? Recommendation: stylised. More distinctive and cheaper to render.
2. Are React + TypeScript fine for the UI? The engine is unaffected either way.
3. v1 content scope and authorship. Suggestion: AI-drafted, human-reviewed, about 5
   items per state per category.
4. English only at launch, or English + Hindi?
5. Where do built data assets live: object storage with a fetch script, or Git LFS?
6. Name: "Bharat Darshan" also names IRCTC's tourist-train scheme and a park in
   Delhi. Fine for a project; check domain availability and search competition before
   launch.

## 11. Status

- 2026-09-20: plan written. No code yet.
- Next: answer the open questions above, then start Phase 0.
