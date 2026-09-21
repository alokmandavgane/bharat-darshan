# Bharat Darshan (भारत दर्शन): implementation plan

An interactive, isometric 3D map of India for exploring the country's geography and
culture: relief, rivers, roads, railways, languages, places, food, festivals, and
many more layers over time (GI-tagged products, crafts, wildlife...). Most users will
be on phones; bigger screens should use their full width.

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

The project is meant to keep growing by adding layers. The test of the architecture
is that **a new layer is a folder of data files, not a code change** (section 5).

## 2. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | Custom three.js scene, not MapLibre / deck.gl | Map libraries give tiles, labels and picking for free, but bring a perspective camera, Web Mercator and a "map app" look. As far as I know MapLibre has no true orthographic camera, and its WebGL text has historically been weak at shaping Indic scripts (re-check before relying on this). Limiting scope to two levels (country, state) keeps the custom cost manageable. The data pipeline is identical either way, so MapLibre + PMTiles remains the fallback if the Phase 0 spike disappoints. |
| D2 | Orthographic camera, north-up with a slight turn; not strict 45° isometric | Strict isometric (45° yaw, 35.26° elevation) turns India into a wide diamond: poor use of a portrait phone, and the silhouette stops being recognisable. About 15° of yaw with a 50-55° tilt keeps the familiar shape, suits portrait screens (India is about 3,200 km north-south by 2,900 km east-west), and keeps the Himalaya at the back where exaggerated relief never hides anything. Clamp yaw to roughly ±40°. |
| D3 | Two semantic levels instead of continuous zoom | Country view, then state view. Tap a state: the camera flies in, the state lifts out as its own block, the rest dims, and a lazily loaded state package (higher-res terrain, denser networks, districts, more places) swaps in. Street-level detail is out of scope; this is a showcase, not navigation. |
| D4 | Tap + bottom sheet is the core interaction; hover is a desktop enhancement | Phones have no hover. "Hover to learn" becomes: tap a state and it lifts out, with its card in the sheet, plus a swipeable card carousel that flies the camera to each item. There is no second step to press: a tap is the way in, and Back is the way out. Desktop adds real hover tooltips over the same data. |
| D5 | Layers are data, not code | The engine knows a few layer *types* (`terrain`, `choropleth`, `lines`, `points`), never individual layers. A layer is a folder: a `layer.json` plus `items.json`. Adding "GI-tagged products" must not touch `src/`. See section 5. |
| D6 | Official boundaries from day one | Use Survey of India-compliant external boundaries (all of J&K and Ladakh including Aksai Chin; Arunachal Pradesh) and the current 28 states + 8 UTs. Default Natural Earth and OSM country outlines show de-facto lines, which is a legal problem for a map published in India. Review every rendered view, including share images. |
| D7 | Minimal dependencies: vanilla JS, no framework | Owner preference, and the same conventions as the owner's `gol` project: plain JS ES modules, no TypeScript, no JSX, no UI framework. **three.js is the only runtime dependency; Vite is the only build tool.** Store, router, i18n, bottom sheet and gestures are small in-repo modules. Raw WebGL2 without three.js was considered: it would save about 150 KB, but costs plumbing time and gives up a library the owner already knows well. Revisit only if the JS budget is threatened. |
| D8 | Stylised look: a hand-made clay / paper model, not realism | More distinctive, and cheaper: no imagery, low-frequency colour, tolerant of coarser meshes. Details in section 3. |
| D9 | English + Hindi at launch | Bilingual from the first screen, not retrofitted. Details in section 3. |
| D10 | Content is AI-drafted, human-reviewed | Every item carries sources and a review status; only reviewed items ship. Details in section 5. |

## 3. Experience design

### Levels

1. **Country**: whole of India, constrained orbit, pinch zoom about 1x-4x. Shows
   national highways, trunk rail, major rivers, top-tier places; dense point layers
   appear as per-state count badges.
2. **State**: entered by tapping a state (or via list/search/URL). Districts become
   selectable; networks get denser; point layers expand into individual markers.
3. **Item detail**: a card / full-height sheet for a place, dish, festival, river,
   range, product. Not a map zoom level.

### Interaction model

| Intent | Phone / touch | Desktop / fine pointer |
|--------|---------------|------------------------|
| Inspect | Hover is the only inspect-without-entering; on touch a tap goes in | Hover: highlight + tooltip |
| Go deeper | Tap the state, or pick it from the list | Click |
| Put it down | Tap the state already lifted | Click it |
| Browse | Swipe the card carousel; camera follows | Same list in the side panel; arrow keys |
| Move | Drag pan, pinch zoom, twist rotate, two-finger drag tilt | Left-drag turns, right-drag slides, wheel zooms |
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
| Bharat Darshan  [find] |  floating header, language toggle
|                        |
|       3D canvas        |  full bleed, 100dvh, safe-area insets
|  (camera padded so the |
|  selection is centred  |
|   above the sheet)     |
|                        |
| [Relief][Rivers][Rail]>|  layer chips in the thumb zone, scroll sideways
+------------------------+
|          ----          |  bottom sheet: peek / half / full
| Kerala               ←|
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
- The layer list will grow long. Group layers (physical, networks, people, culture,
  produce...), make the phone chip row a scrollable shortlist with an "all layers"
  sheet behind it, and give the desktop panel collapsible groups.
- Canvas: `touch-action: none`, no page scroll, `overscroll-behavior: none` (stops
  pull-to-refresh on Android Chrome).
- Desktop extras: more simultaneous labels, higher-res data tier, tilt-shift depth of
  field for a miniature look, keyboard navigation.

### Visual direction: a hand-made model on a table (D8)

- **Material.** Matte clay / paper. No specular highlights, no satellite imagery or
  photo textures. A tiny tiling grain texture multiplied over everything.
- **Light.** One soft key light from the north-west (cartographic convention) plus
  generous ambient, with wrap lighting so shaded slopes never go black. Baked ambient
  occlusion from the pipeline gives the tactile creases: valleys darker, ridges
  lighter.
- **Colour.** A restrained banded hypsometric palette, 6-8 bands with soft edges
  (coastal plain, plains, plateau, hills, mountains, high mountains, snow), warm and
  desaturated. Thematic layers tint by multiplication so relief still reads.
- **Ocean.** A flat matte sheet, slightly darker near the coast (baked coastal shadow
  so the land reads as sitting on it), optional shelf band from bathymetry. No
  realistic water.
- **Borders and blocks.** State borders are thin scored lines. The selected state
  lifts like a puzzle piece with clean-cut, paler sides.
- **Neighbours.** Same relief, lighter and desaturated via the region mask, so India
  stands out without drawing anyone else's lines.
- **Markers.** Paper-cut / sticker icons with a small contact shadow, one consistent
  illustrated set.
- **Motion.** Short, springy, restrained. Mountains grow when relief toggles; state
  lift about 400 ms; respects `prefers-reduced-motion`.
- Why it is also cheaper: no imagery downloads, textures compress well, smooth clay
  hides a coarse mesh, AO can be baked at low resolution.

### Languages: English + Hindi at launch (D9)

- UI strings live in `src/i18n/en.json` and `hi.json` with a ~30-line `t()` helper.
  No i18n library. Adding a UI language later = adding a JSON file.
- Content text fields are keyed by language: `name: { en, hi, native }`,
  `blurb: { en, hi }`. `native` is the name in the region's own script where that
  differs from Hindi ("കേരളം"). The build fails if `en` or `hi` is missing on a
  shipped item.
- Language is part of the URL (`/hi/state/kerala`) so a shared link opens in the
  sharer's language and share previews are localised. First visit picks from
  `navigator.languages`; the choice persists.
- Typography: system fonts only at first (Noto Sans Devanagari on Android, Kohinoor
  on iOS, Nirmala UI on Windows), so no font downloads. Devanagari needs more
  line-height (about 1.6-1.7) and a slightly larger size than Latin; never
  letter-space or uppercase it. Labels are measured per language for collision.
- Numbers through `Intl.NumberFormat('en-IN' | 'hi-IN')` for lakh / crore grouping.
- Hindi place names follow official Hindi usage where a government source exists.

### Accessibility and fallbacks

- The canvas is opaque to assistive tech. Mirror the content in DOM: state and place
  lists double as screen-reader content, SEO content and the no-WebGL fallback.
- Respect `prefers-reduced-motion` (crossfade instead of fly). Colour-blind-safe
  choropleth palettes. Label halos for contrast over terrain.

## 4. Architecture

### Stack (D7)

- **Plain JS ES modules.** No TypeScript, no JSX, no codegen. JSDoc types and
  `// @ts-check` where they help the editor.
- **three.js (WebGL2)** is the only runtime dependency, pinned. Custom
  `ShaderMaterial`s with raw GLSL for terrain, lines and markers. Do not depend on
  WebGPU: the audience skews to budget Android phones.
- **Vite** is the only build tool (dev server, bundling, hashing). A small Vite plugin
  emits per-route HTML shells with Open Graph tags and pre-rendered share images.
  WhatsApp link previews will be a main distribution channel and do not run JS.
- **In-repo micro-modules instead of libraries:** store (pub/sub with slices),
  router (History API), i18n, bottom sheet, gesture handling. Each stays small enough
  to read in one sitting.
- **Engine / UI split.** `src/engine` has a small imperative API (`setLayers`,
  `flyTo`, `setSelection`, `onHover`, `onSelect`) and never touches the DOM outside
  its canvas and label container. UI code never touches three.js objects. They meet
  in the store.
- **URL is the source of truth for view state**:
  `/hi/state/kerala?layers=relief,rivers`, `/en/layer/gi-products/darjeeling-tea`.
- **Pipeline:** Python. Keep it light too: standard library + numpy + pillow cover
  Phase 0 (tile mosaic, reprojection, rasterising regions). Add GDAL/rasterio or
  osmium only when a step truly needs them.
- **Hosting:** static. Cloudflare Pages is the recommendation (India PoPs, free
  bandwidth; 25 MiB per-file limit, so big data packages may need R2). Firebase
  Hosting is the familiar alternative, but its free tier's daily transfer cap is
  small for a site with ~2 MB first loads.

### Planned repo layout

```
bharat-darshan/
  docs/              plan, decision notes, design notes
  pipeline/          offline data build; raw/ and cache/ are git-ignored
  content/
    layers/<id>/     one folder per layer: layer.json + items.json (section 5)
    states/          per-state facts and copy
  public/data/       generated, content-hashed assets + manifest.json
  src/
    engine/          three.js scene: terrain, camera rig, picking, labels
    layers/          layer type implementations: terrain, choropleth, lines, points
    ui/              shell, bottom sheet, panels, cards, legends, search
    state/           store, URL sync, story player
    i18n/            en.json, hi.json, t()
```

## 5. Layers and content

### A layer is a folder (D5)

Everything the app knows about a layer comes from its folder. The build validates
it, emits runtime files, and adds it to `manifest.json`. Worked example, a future
GI-tagged products layer:

```
content/layers/gi-products/
  layer.json                    the layer itself: type, title, categories
  items.json                    one entry per registered product
```

Both are read with `json` from Python's standard library: no YAML parser, so no new
dependency (D7). Turning a registry export into `items.json` is a one-off converter,
not an input format the build supports.

```json
{
  "id": "gi-products",
  "type": "points",
  "group": "produce",
  "title": { "en": "GI-tagged products", "hi": "जीआई टैग उत्पाद" },
  "icon": "tag",
  "country_view": "aggregate",
  "categories": [
    { "id": "handicraft",   "title": { "en": "Handicrafts",   "hi": "हस्तशिल्प" } },
    { "id": "agricultural", "title": { "en": "Agricultural",  "hi": "कृषि" } },
    { "id": "foodstuff",    "title": { "en": "Food",          "hi": "खाद्य पदार्थ" } },
    { "id": "manufactured", "title": { "en": "Manufactured",  "hi": "निर्मित वस्तुएँ" } },
    { "id": "natural",      "title": { "en": "Natural goods", "hi": "प्राकृतिक वस्तुएँ" } }
  ],
  "fields": {
    "gi_number": { "type": "int" },
    "registered": { "type": "year" }
  },
  "tooltip": "{name} · {category}",
  "card": ["name", "category", "registered", "blurb", "media", "sources"],
  "attribution": "Geographical Indications Registry, Government of India"
}
```

`country_view: aggregate` gives per-state count badges, with markers in the state
view. `fields` adds structured columns on top of the base item schema: each one names
its type, whether it is required, a bilingual label and an optional bilingual unit
template, and the card renders them without knowing what they are.

```json
[
  {
    "id": "darjeeling-tea",
    "status": "draft",
    "name": { "en": "Darjeeling Tea", "hi": "दार्जिलिंग चाय" },
    "anchor": { "lat": 27.041, "lon": 88.266 },
    "regions": ["IN-WB"],
    "category": "agricultural",
    "gi_number": 1,
    "registered": 2004,
    "sources": ["<url>"]
  }
]
```

What every layer of a given type gets without writing code:

- **`points`**: category filter chips, per-state aggregation at country level,
  priority thinning so phones never show hundreds of markers, region highlight on
  selection, card carousel with camera sync, search indexing, deep links, both
  languages.
- **`choropleth`**: a `values.csv` of `region,value` plus a palette and legend spec.
  The id-to-colour lookup texture is generated at runtime; crossfades between
  choropleths are free.
- **`lines`**: geometry fetched from the source named in `layer.json` and joined to the
  curated items by name, so the names and facts stay in the folder and the courses come
  from a published dataset; styling by attribute (rank sets the width, category the
  colour), LOD by level, and a run drawn on whichever surface it belongs to -- the
  country plate or the lifted block -- so it is cut at a state boundary rather than
  climbing the block's wall. Still to come: flow animation, picking, tooltips.

A `points` layer can set `marker: "label"` to be drawn as its name alone, with no token,
for things that are a stretch of country rather than a spot on it (mountain ranges,
plateaus, deserts). Tokens claim their screen space first, so a label yields to a place.

Rules that keep this honest:

- The engine knows layer types, never layer ids. `grep -r "gi-products" src/` must
  return nothing.
- New layer *types* are engine work and should be rare: `raster` overlays (rainfall,
  night lights, forest cover) and `flows` (monsoon advance, migration) are the likely
  next two.
- Phase 3 exit criterion: the GI products layer goes in using data files only.

### Base item schema

One schema for places, dishes, festivals, products and named physical features.
Layers add structured `fields` on top.

```json
{
  "id": "hampi",
  "status": "draft",
  "name": { "en": "Hampi", "hi": "हम्पी", "native": "ಹಂಪಿ" },
  "anchor": { "lat": 15.335, "lon": 76.462 },
  "regions": ["IN-KA"],
  "category": "heritage",
  "priority": 1,
  "months": [],
  "blurb": {
    "en": "Ruined capital of the Vijayanagara empire, spread across a boulder landscape.",
    "hi": "विजयनगर साम्राज्य की राजधानी के खंडहर, जो विशाल चट्टानों के बीच फैले हैं।"
  },
  "media": [
    {
      "src": "hampi-virupaksha.jpg",
      "alt": { "en": "Virupaksha temple gopuram at Hampi", "hi": "हम्पी का विरूपाक्ष मंदिर" },
      "credit": "<author>",
      "license": "<licence>",
      "source": "<url>"
    }
  ],
  "sources": ["https://whc.unesco.org/en/list/241"],
  "related": ["badami", "pattadakal"]
}
```

`status` is `draft` or `reviewed`; only reviewed items ship. `anchor` places the
marker and the camera target. `regions` uses ISO 3166-2:IN, districts by LGD code.
`priority` ranks items for the zoom thinning. `months` (1-12) drives festivals and
seasonality. Media needs credit, licence and source on every entry.

- Dishes, festivals and products are regional more than point-like: `anchor` places
  the marker, `regions` drives the highlight. Pan-India festivals get no single
  marker; they show regional variants (Mysuru Dasara, Kullu Dussehra, Durga Puja...).
- Numeric facts (river length, peak height, registration year) live in structured
  fields, not prose, so they can be checked and formatted per language.
- Festival dates move every year with the lunar calendar. Generate Hindu festival
  dates at build time from the HinduCalendar engine instead of hand-maintaining them;
  other calendars need their own sources.

### Content workflow (D10)

1. Claude drafts items in batches (per layer, per state), in both languages, each
   with source URLs and `status: draft`.
2. The owner reviews, corrects, and flips items to `status: reviewed`.
3. The build ships only reviewed items (a dev flag shows drafts) and fails on:
   schema errors, a missing language, empty `sources`, media without
   credit/licence/source, over-long blurbs, or an `anchor` that falls outside its
   claimed `regions` (checked against the region ID raster, which catches geocoding
   mistakes automatically).

## 6. Rendering details

- **One projection, baked offline.** Pre-project everything (rasters, vectors and
  content anchors) to a Lambert Conformal Conic tuned for India: EPSG:7755 (WGS 84 /
  India NSF LCC). Web Mercator visibly inflates the north (roughly 20% linear scale
  difference between Kanyakumari and Ladakh). The runtime then needs no projection
  code. If a runtime forward projection is ever needed (geolocation), port the
  ellipsoidal LCC formula; d3-geo's conic conformal is spherical and will not match
  exactly.
- **Scene units.** 1 unit = 1 km, origin at the bounding-box centre, y up.
  Bounding box about 68.0-97.5°E, 6.5-37.5°N (covers the official boundary, Indira
  Point, Lakshadweep and the Andaman and Nicobar Islands in their true positions).
- **Terrain.** A grid mesh displaced in the vertex shader from a heightmap texture.
  Exaggeration is a uniform, so toggling relief makes the mountains grow, and it eases
  down when entering a state. Use a non-linear curve, `y = k * pow(h, g)` with `g`
  around 0.65, so the Western Ghats, Aravallis, Vindhyas and Satpuras read without
  the Himalaya becoming a wall. Shading per the visual direction in section 3.
- **Heightmap delivery.** Ship as delta-encoded 16-bit binaries (gzip, decoded with
  `DecompressionStream`), decode once on the CPU and upload as a half-float texture.
  CPU-side heights are needed anyway for picking and label placement. Never put
  heights through lossy or colour-managed image formats.
- **Regions as an ID texture.** Rasterise states (8-bit) and districts (16-bit) into
  a texture where each pixel stores a region id, aligned to the heightmap.
  Hover/selection highlight is a uniform compare in the terrain shader. Any choropleth
  is a tiny id-to-colour lookup texture. A signed-distance-field border texture gives
  crisp, animatable outlines.
- **Lines and points.** Rivers, roads and rail are screen-space thick lines
  (instanced quads); markers are instanced sprites from an icon atlas. Both sample the
  same heightmap in their vertex shaders, so they stay glued to the terrain while
  exaggeration animates. River width from stream order; animated dashes show flow
  direction. Depth-test against terrain with a small bias.
- **Labels in HTML, not WebGL.** Project anchors while the camera moves, cull by
  priority and collision, cap at about 40. The browser shapes Devanagari, Tamil,
  Bengali and the rest correctly using system fonts, and labels stay accessible.
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

## 7. Data pipeline and sources

| Layer | Source | Notes |
|-------|--------|-------|
| Boundaries | Survey of India; DataMeet community maps; Natural Earth India point-of-view files | Validate 36 units, ISO 3166-2:IN and LGD codes. Keep 2011 district shapes for census joins. Check the outline against the SoI political map before trusting any source. |
| Elevation, country | AWS Terrain Tiles (Terrarium PNG), zoom 7-8 | About 150-200 tiles, 15-25 MB at zoom 7, roughly 1.1 km per pixel, includes bathymetry. Open data with attribution. Ideal for Phase 0. |
| Elevation, states | Copernicus DEM GLO-30 | Free with attribution; fewer Himalayan voids than SRTM. Only needed once state packages are built. |
| Rivers | HydroRIVERS (stream order, discharge); names from OSM / Natural Earth | |
| Roads, rail | OpenStreetMap (Geofabrik India extract, or targeted Overpass queries) | Country: national highways + trunk rail. State: adds state highways and all rail. ODbL attribution. |
| Languages | Census 2011 C-16 mother-tongue tables, district level | Latest census available. Colour by family, shade by language; top-5 list and a diversity index per district. |
| Places, food, festivals | Curated; seed from the UNESCO list, Wikidata | Wikimedia Commons images with licence tracked per item. |
| GI products (later) | Geographical Indications Registry | 600+ registered items with category and state; anchors need geocoding and review. |

Pipeline steps (numbered scripts in `pipeline/`, re-runnable end to end):

1. **Boundaries**: validate, project, simplify; emit outlines, state/district ID
   rasters, SDF border texture.
2. **DEM**: fetch tiles, mosaic, reproject to the EPSG:7755 grid (numpy: map each
   output pixel back through the LCC and Mercator formulas, bilinear sample), crop,
   resample to 1024² / 2048² / 4096²; emit heightmaps, AO and coastal-shadow maps.
3. **Vectors**: filter, project, simplify and merge, split by LOD, clip per state,
   densify so lines follow terrain, emit compact binaries.
4. **Layers and content**: read every `content/layers/*`, validate, pre-project
   anchors, aggregate per state, build indexes, images and the sprite atlas.
5. **Manifest**: hash everything, write `manifest.json`.

Working across machines: raw downloads are never committed. Built assets should live
in object storage (or Git LFS) with a fetch script, so a fresh clone can run the app
without re-running the whole pipeline. To be decided in Phase 0; while the built data
is only a few MB it can simply be committed.

## 8. Performance budgets (mobile first)

- **Reference device:** a Rs 10-12k Android phone, tested from Phase 0, including
  inside in-app browsers (WhatsApp, Instagram).
- **First paint < 1 s:** a pre-rendered poster image of the exact default camera is
  the LCP element; the canvas crossfades over it. It doubles as the fallback.
- **Transfer:** JS <= ~300 KB gzipped (three.js is most of it). First-view data
  <= ~1.5 MB (1024² heightmap, state ID texture, outlines, labels). Every layer loads
  on first toggle; every state package (<= ~1 MB) on entry. Respect
  `navigator.connection.saveData`. A service worker caches what has been visited.
- **Frames:** render on demand, zero frames while idle; this matters more for battery
  and heat than peak fps. Target 60 fps mid-range, 30 fps floor. Ambient animation is
  subtle, throttled, paused when idle or hidden.
- **Quality tiers**, chosen by a startup micro-benchmark plus `deviceMemory`:

  | Tier | Mesh grid | Heightmap | DPR cap | Extras |
  |------|-----------|-----------|---------|--------|
  | Low | 256² | 1024² | 1.0 | none |
  | Medium | 512² | 2048² | 1.5 | flow animation |
  | High | 1024² | 4096² | 2.0 | tilt-shift, ambient animation |

- **Robustness:** handle `webglcontextlost` / restored, dispose state packages on
  exit, keep GPU memory under ~150 MB (iOS Safari kills heavy tabs).
- **Enforce in CI:** bundle-size and Lighthouse budgets; screenshots at fixed cameras
  to catch shader regressions.

## 9. Roadmap

Rough, focused solo effort. Content, not code, is the long pole from Phase 3 onward.
One feature or concern per commit.

**Phase 0: spike (~1 week).** De-risk the scariest things.
- Pipeline: terrain tiles to an EPSG:7755 heightmap; official boundaries to a state
  ID raster.
- Engine: displaced terrain, orthographic camera, exaggeration slider, first pass at
  the clay / paper look (banded palette, wrap lighting, AO, grain, coastal shadow).
- Shell: touch gestures and a bottom sheet coexisting on a real phone; English /
  Hindi toggle wired from the first string.
- Exit: >= 30 fps on the reference phone, < 2 MB first load, and the look makes
  someone say "wow". This is the go/no-go for D1 (custom engine vs MapLibre).

**Phase 1: core map (2-3 weeks).** State picking and highlight, tooltips and peek
cards, fly-in state view with lazy packages, responsive shell, URL state with
language, poster image, quality tiers, context-loss handling, state fact cards in
both languages.

**Phase 2: physical layers (~2 weeks).** The `lines` layer type and the layer-folder
build. Rivers with flow, roads, rail; named ranges, peaks and passes as hoverable
relief features; layer panel with groups, legends, line picking, LOD by level.
*Part done (2026-09-21): the `lines` type with picking, tooltips and cards; 28 rivers,
18 named ranges and 28 peaks and passes; declared `fields`; the layer panel grouped
with legends. Left: flow animation, roads and rail.*

**Phase 3: culture layers (3-4 weeks).** The `points` and `choropleth` layer types.
District-level languages with script samples and greeting audio; places, food and
festivals with card-carousel sync; a month scrubber ("India through the year");
search; first ~150 reviewed items. Exit: GI products added with data files only.

**Phase 4: delight and launch (2-3 weeks).** Guided stories (follow the Ganga, the
monsoon's advance, the Golden Quadrilateral). Because camera, layers and selection
are declarative state, a story is a list of state snapshots with captions. Trains on
famous routes, low-poly landmarks, haptics, share cards, accessibility pass, PWA.

**Later.** More layers (crafts and handlooms, classical dance and music traditions,
national parks and wildlife, forts, pilgrimage circuits, climate, cricket grounds),
`raster` and `flows` layer types, a contribution workflow, more UI languages.

## 10. Risks

- **Boundaries.** Legal. See D6.
- **Low-end thermals and memory.** Hence real-device testing from week one, render on
  demand and tiers.
- **Content volume, accuracy and image licensing.** AI drafts can be confidently
  wrong: the review step, mandatory sources and automated checks are the defence.
  Licence fields are mandatory in the schema.
- **Contested facts.** Language vs dialect groupings in the census; dish origins
  (both West Bengal and Odisha hold rasgulla GI tags). Cite sources, keep a neutral
  tone, add a "suggest a correction" link.
- **Layer sprawl.** Many layers on a small screen: groups, a shortlist on phones, and
  mutually exclusive choropleths keep it usable.
- **iOS Safari quirks.** Memory limits, viewport units, context loss on backgrounding,
  no vibration API. Test early.

## 11. Open questions

1. Where do built data assets live once they outgrow git: object storage with a fetch
   script, or Git LFS?
2. Hosting: resolved on 2026-09-20, Cloudflare Pages; see [docs/DEPLOY.md](DEPLOY.md).
3. Resolved on 2026-09-20: one display face, Yatra One (SIL OFL), self-hosted as an
   82 KB Latin + Devanagari subset for the title and sheet headings; body text stays on
   system fonts.
4. Name: "Bharat Darshan" also names IRCTC's tourist-train scheme and a park in
   Delhi. Fine for a project; check domain availability and search competition before
   launch.

5. **Resolved**, by what Phase 1 shipped: layers are `layer.json` + `items.json`,
   read with `json` from the standard library. No YAML parser, so no new dependency
   (D7). Converting a bulk export into `items.json` is a one-off script rather than
   a second supported input format.
6. Screenshot checks: add Playwright as a devDependency for the CI budgets and
   shader-regression screenshots, or keep it out of `package.json` and install it in
   CI only? (The web sandbox has it globally; the check script lived there.)
7. Portrait phones show India width-limited (about 7 km/px), with paper above and
   below the model. Accept, or nudge the default yaw / pitch / padding, or move the
   relief slider into the sheet to give the map more height?

Resolved on 2026-09-20: stylised look (D8); no React, minimal dependencies (D7);
English + Hindi at launch (D9); AI-drafted, human-reviewed content (D10); layers must
be addable as data, with GI products as the test case (D5); hosting on Cloudflare Pages (question 2,
docs/DEPLOY.md).

## 12. Status

- 2026-09-20: plan written; owner's decisions folded in (D7-D10, layer folders).
- 2026-09-20, second session: Phase 0 spike built end to end (pipeline, engine, shell;
  details below). Budgets met: the first view is 1.15 MB of data plus 142 KB gzipped
  JS (three.js 130 KB, app 12 KB). Still open from Phase 0: the real-device check
  (>= 30 fps on the reference phone) and the owner's verdict on the look. Both need a
  phone and eyes; nothing in the sandbox can stand in for them.
- 2026-09-20: hosting decided: Cloudflare Pages at darshan.alokm.com. Project
  settings, caching headers, limits and the setup steps are in
  [docs/DEPLOY.md](DEPLOY.md). This closes open question 2.
- 2026-09-20, third session: Phase 1 begun with picking and tap selection. Picking
  runs on the CPU: the pointer ray marches down the surface the mesh actually draws
  (the heightmap sampled at the mesh vertices), then the ID raster names the unit.
  Touch taps get the small-region bias from section 3: a 6 px grid inside 24 px,
  smallest unit under 12,000 km² wins. A tap selects; the state's fill lifts warm and
  its outline firms up (a one-texel look-around in the ID raster, in the shader); the
  sheet head shows the name in the current language, the other names under it, and the
  unit type, with a close button; Escape clears. Fine pointers get a hover highlight
  and a tooltip. The selection lives in the URL as `?state=<slug>` (replaceState) so
  reloads and shared links keep it; double tap still zooms and does not select.
  `?quality=low|medium|high` forces a tier, for device testing. Verified headless:
  click on plains and hills, hover + tooltip, touch bias (Goa from a tap 19 px away),
  Escape, URL restore.
- 2026-09-20, fourth session: the rest of Phase 1's core, built for a demo. The state
  view: Explore lifts the state out as a block (a dense sub-grid drawn with the terrain
  material restricted to that region, walls from the traced outline, paler clay), the
  base flattens and darkens the socket and quietens the rest, relief eases to 60%,
  the camera flies in, the zoom floor drops to 30 km, and picking and labels follow
  the raised block. `/en/state/kerala` is the URL (pushState, Back leaves it), `?cam=`
  keeps the camera once moved. HTML labels for states (biggest first, no overlaps,
  hidden in the state view). A searchable list of all 36 units in the sheet, so every
  unit is reachable without hitting it; picking one focuses the camera with country
  context. Fact cards from `content/states/states.json` (capital, official languages,
  area, 2011 population, blurb, sources), drafted and validated, shown while drafts
  are on. The first content layer as data: `content/layers/places/` (layer.json +
  items.json) built by `04_layers.py` into `public/data/layers/places.json` with
  anchors checked against the ID raster; the engine's `points` type renders any such
  layer as sticker markers that ride the terrain and the lifted block, thinned by
  priority with zoom, with a card and a fly-to on tap. Drafts are shown by default
  until the first review (`src/main.js`, one line to flip).
- 2026-09-20, after the first demo feedback: the model no longer ends at a rim; it
  sinks and fades into the page over its last few hundred km, and by default only
  India is drawn: a clay cut-out with walls along the coast and the international
  boundary (from `regions/outlines/india.json`), on lit paper. A "Surroundings"
  switch in the menu brings the sea and neighbours back. The chrome is one paper
  material (gradient, grain, gold hairline), the controls (language, relief, layers)
  sit behind one menu button, the title is set in Yatra One (SIL OFL, self-hosted
  subset), and point markers are clay tokens tinted by category with a small built-in
  glyph set the layer names (`icon`, `color` per category in layer.json). Share cards:
  `index.html` carries Open Graph and Twitter tags; the Vite plugin localises them per
  shell (`/en`, `/hi`, canonical + hreflang); `tools/share-image.mjs` renders
  `public/share/og-{en,hi}.jpg` from the app in poster mode (`?poster=1`) with
  Playwright, a tool rather than a dependency. Site URL for the tags: `SITE_URL` env
  or darshan.alokm.com.
- 2026-09-20, third feedback round. The sheet body now ends at the bottom of the
  screen at every snap and scrolls whenever the sheet is open (it scrolled only at
  full, and the half sheet clipped its content); an open sheet also counts as camera
  padding, so the map stays framed above it. The about text, the how-to hints and the
  credits sit behind a small info button in the sheet head; a draft card turns that
  button terracotta with "Draft, not yet reviewed" as its tooltip and leads the about
  text with the note, instead of a line in every card. Two small corner buttons above
  the sheet: a compass whose needle turns with the map and resets the view (`home` in
  the store: item, state view, selection and `?cam=` cleared, the country framed again
  from the default angles), and a play button that tours every place on show
  (`src/engine/tour.js`: nearest-neighbour path from the north, a card and a flight per
  stop with a gentle sway of the yaw, a dwell scaled by the text length, pause and
  resume, any gesture, tap or card change hands control back, the home view at the
  end; inside a state view it tours that state's places). Verified headless; note that
  headless Chromium idles requestAnimationFrame unless something draws, so flights
  are checked with frames forced (mouse moves) or by their end state.
- 2026-09-20, fourth round. The places layer grows from 48 to 139 items, Madhya
  Pradesh first (29 places, Sanchi at priority 1), then forts, temples, hill stations,
  reserves, lakes and falls across the rest of the country; all drafts with sources,
  anchors validated against the ID raster (Amarkantak's nudged 5 km, noted on the
  item; Chitrakoot claims both states). And the map moves on its own: `src/engine/idle.js`
  sways the camera gently about the screen centre (yaw ±7°, a 2.5° dip, a 28 s cycle,
  30 fps cap) four seconds after the last interaction, and only while the country
  view is at rest (no selection, item, tour, flight or poster render). Any pointer,
  wheel, key or touch anywhere (`src/ui/activity.js` reports it as `activity`), any
  other camera write, tap or hover stops it at once; reduced motion disables it.
  With the denser layer, priority-3 places now appear one zoom step later (below
  2,400 km of view height) so the whole-country view keeps its state labels.
- 2026-09-21: the lifted block's edge, which read as sawn rather than moulded. Three
  faults, one cause: `06_states.py` built each package's mask by nearest-sampling the
  1.71 km country ID raster at 0.35 km, so the block's top stepped in 3.3 km risers;
  the walls followed a different curve, because `contour.trace` rounded the staircase
  with Chaikin and then let a one-pixel Douglas-Peucker tolerance flatten it back into
  8 km chords; and where the wall strayed outside the mask it sampled the -500 m
  sentinel fill, so its top collapsed to the lift plane in spikes. Now there is one
  boundary: `contour.trace` low-pass filters the traced loop along its arc length
  (Gaussian, sigma 1.2 px, mean turn 13.2 degrees -> 6.6) and simplifies at 0.2 px, and
  step 6 fills those same loops for the mask. The west edge of Chhattisgarh steps in
  0.70 km rather than 3.27. Heights are now kept for 10 km outside the unit instead of
  being flattened at its edge: the walls need real ground under the outline they stand
  on, and the ambient occlusion along the rim was being cast by a pit that is not there
  (up to 200 levels of 255 out, 31 at p95). That costs 11% on the packages, 27.2 -> 31.8
  MB; the largest is Maharashtra at 2.6 MB, so section 8's "<= ~1 MB per state package"
  has been wrong since the packages were built and needs a decision, not just an edit.
  Two engine fixes alongside: the block's material is a sibling with its own scalars and
  nobody was updating its `uKmPerPx`, so it drew border lines at the scale it was born
  at; and the border fields are only as sharp as the raster they were baked from, so
  past MAX_MAGNIFY the line is the border texel itself -- a blocky ribbon across the
  surrounding country once a package pulls the zoom floor five times closer. They now
  fade out instead.
  Two pre-existing faults found while checking this, both left alone:
  `/en/state/goa` (and other small units) lands on `?state=goa` with the country-wide
  camera instead of entering the state view, while Kerala and Chhattisgarh are fine;
  and every state package's border field is entirely zero, because `border_fields`
  asks for land on both sides of an edge and a package has only one labelled id, so a
  lifted block draws neither a scored edge nor a selection outline, and each package
  carries about 5 KB of zeros.
- 2026-09-21, same day: the scored border lines on the country surface, which were the
  last thing still following the ID raster. `border_fields` measured distance with
  `bounded_distance` to the pixels `raster.edges` marks either side of a boundary, and a
  distance field can only draw the curve it was measured from, so the lines were 1.71 km
  right angles as soon as the camera was close enough to see them. They are measured to
  the smoothed outlines now (`raster.distance_to_segments`, which measures to the line
  and only touches the window within range of it, so a tier still rebuilds in seconds).
  Each segment is named by what lies outward of it, a different state or land outside
  India, which reproduces the old internal/external split to within a percent of its
  length. The fields grow, a smooth field having more to say than a terraced one: the
  first view goes 1.19 -> 1.23 MB, inside the 1.5 MB budget.
  Two consequences in the shader. Measuring to the curve took half a texel of unearned
  weight off every line, so the screen-pixel half-widths went 0.55/0.85 -> 1.1/1.6 to
  keep the look. And an unsigned field cannot hold a line thinner than its own texel:
  bilinear interpolation across a cell never dips below the smallest of its four
  corners, so a thinner level set dashes (5% of the cells on the line at 0.4 texels,
  none by 0.75). The width is floored there and the line fades out past the floor,
  which also replaces the blockiness fade added earlier in the day -- that guessed at a
  threshold for a problem this removed.
- 2026-09-21, third round: the Explore button is gone. Tapping a state lifted it only
  after a peek card and a second press, which was a step too many for the one thing the
  map is for; a tap now enters the state view directly, and so does picking a unit from
  the sheet's list. Tapping the state already lifted is a no-op rather than a drop and
  re-raise, and tapping a neighbour hops straight to it, which turns out to be a good way
  to browse. Back still leaves. The `focus` store key and its country-context fit went
  with the button: nothing set them any more.
  Two bugs that only mattered once a tap was the way in, both on `/en/state/<slug>`
  opened cold. The camera was fitted against the first tier's zoom floor -- 1052 km,
  five times too far out -- and nothing re-fitted when the finer tier and the state
  package dropped the floor; `refreshZoomFloor` now re-fits when the floor drops under a
  camera the visitor has not touched. And the URL rewrote itself to the `?state=` peek
  form, because `selection` is restored before `level` and the URL writer ignored a
  level whose source was `init`; it now writes that one back.
- 2026-09-21, fourth round: rivers and mountain ranges, which the map had never had --
  `places` was the only layer, and the `lines` type was written up in section 5 but
  never built, so the engine silently skipped anything that was not `points`.
  `lines` now exists. A layer names its geometry source in `layer.json` and its features
  in `items.json`, and step 4 joins the two by name, which is the only field a published
  dataset and a content folder reliably share; folding accents off both sides is what
  makes "Godävari" meet "Godavari". Geometry is projected to the grid, clipped to the ID
  raster (the map draws India alone, so a river carrying on into Tibet would trail off
  over blank paper) and simplified. In the engine a run becomes a ribbon widened in
  screen space, laid on the terrain through the same height texture and vertical curve,
  and drawn twice: once on the country plate and once on the lifted block, each
  discarding the ids that are not its own, so a river is cut at a state boundary instead
  of climbing the block's wall. 28 rivers from Natural Earth 10m (public domain),
  52 KB. Rank sets the width and a tributary fades in below 2,400 km of view height.
  Mountain ranges needed no new type: a `points` layer can now set `marker: "label"` and
  be drawn as its name alone, quiet letterspaced caps set into the relief. 18 ranges,
  13 KB, and they stay on screen in a state view because a range crosses states.
  Both layers went in as data: `src/` gained the `lines` type and the label marker, and
  knows neither layer's id. Both are `default_on`, which section 8 did not plan for --
  it says every layer loads on first toggle, and `places` has quietly broken that since
  it shipped. The honest first-view figure is 1.25 MB over the wire (the tier's 1.23 MB,
  already gzipped, plus 54 KB of gzipped layer JSON), 1.38 MB on disk. Inside the 1.5 MB
  budget either way, but the margin is now thin enough that the next default-on layer
  needs a decision rather than a default.
  One bug fixed on the way: `read_dbf` stripped spaces but not the NUL padding Natural
  Earth writes, so every name came back with trailing NULs and nothing matched.
- 2026-09-21, fifth round: the rest of Phase 2 bar flow animation and the road and rail
  layers.
  Lines can be picked. Twenty-eight rivers had a blurb and sources apiece that nothing
  could reach; a tap now finds the nearest run within a few pixels and opens its card,
  and a hover names it. The search is in scene km rather than screen space -- the
  terrain pick already returns the ground point under the cursor, and a bounding box per
  item keeps it to a few hundred segment tests -- and rank breaks ties, so a great river
  wins over the tributary beside it. A picked line thickens rather than changing colour:
  it is still the same river. Because a line lies on top of the state it crosses, it
  takes the tap first and the state view is not entered.
  `fields` in layer.json now works, the way section 5 described it: a layer declares its
  own structured columns with a bilingual label and unit, step 4 validates and carries
  them, and the card renders them without knowing what they are. The first user is an
  elevation.
  A `summits` layer, 28 peaks and passes, off by default. Peaks outside Indian-
  administered territory are left out rather than claimed; four anchors sitting on the
  international boundary are nudged a few km inside and say so on the item, as
  Amarkantak already did.
  The layer panel is grouped by the `group` field each layer already carried, with a
  legend of the layer's own categories under each one that is on -- a dot for points, a
  stroke for lines, nothing for a label layer where the colours do not show. Group
  headings are strings keyed by the group id, so `t` grew a fallback for keys built from
  data. The catalogue in manifest.json carries `categories` and `marker` now, about
  1.5 KB, so a legend can be drawn before its layer is fetched.
- 2026-09-21, sixth round, from a look at the map at close range:
  India's own silhouette was the last edge still cut from the ID raster. Its coast and
  its international boundary were a test against a 1.71 km raster while the walls
  standing on that silhouette followed the smoothed outline, which is the same fault
  the lifted block had before its mask was filled from its loops, and it is why the
  coast looked sawn. Step 2 bakes a signed field for India's outline -- distance
  measured to the loops, sign from filling them, 128 on the line -- and the plate draws
  its cut-out from that. 44 KB at the first-view tier, the field being two constants
  either side of a narrow band; first view 1.26 -> 1.30 MB. Only the plate reads it: a
  lifted block has its own mask, and a coastal one would have had its edge eaten.
  The socket is the one edge still cut from the raster, a state at a time being more
  than a single field can hold; it is feathered over a texel, which turns its staircase
  into the shadow a cut in clay would cast.
  Four things about handling, all from the same look:
  the markers and labels were snapped to whole pixels, so every overlay stepped against
  a canvas that moves smoothly, worst exactly while the camera eases; they are sub-pixel
  now. Left-drag turns the model and right-drag slides it, the other way round from
  before, because the button you reach for first should turn the thing on the table;
  touch is untouched. Going from one state to another hands over -- the outgoing block
  sinks on its own tween while the incoming one rises -- instead of dropping instantly.
  And a tap on the state already lifted puts it back down, clearing the selection.
  The layer switches are small and carry their layer's glyph; the glyph set moved to
  src/glyphs.js, shared by the markers that draw tokens and the menu that draws chips.
- 2026-09-21, seventh round.
  The socket, done properly. Every state package had been carrying two border fields
  that were entirely zero -- `border_fields` wants land on both sides of an edge, and a
  package has one labelled id -- so they are replaced by a signed distance to the unit's
  own outline. The plate cuts its socket from it and the block trims its own rim with
  it, both landing on the curve the walls stand on instead of on the step the ID raster
  takes; until the package arrives, and under saveData, the feathered raster stands in.
  Border lines are now drawn only on the plate, which the zero field had been hiding.
  About 60 KB a package against the 5 KB of zeros: 31.8 -> 33.2 MB, none on first view.
  The coast was still fraying a pixel inside its own smooth silhouette: coastal texels
  reading below sea level were painted as ocean at full opacity, inside a cut-out that
  is all model by definition. Inside the outline everything is land now.
  Rotation follows the hand: dragging right turned the model left and dragging down
  tipped it away, which is backwards for something you reach out and turn on a table.
  And the land around India, so Surroundings is a landscape rather than a small island
  of terrain ending a few hundred km out. `03_world.py` crops a sheet three grid tiles
  across and down from a low zoom of the same elevation source -- 1216x1280 at about
  8 km per pixel, the Horn of Africa to Indonesia -- and the engine lays it under the
  plate as the terrain's own material with its own rasters bound, so the clay look
  cannot drift. It sits four km under the plate's sheet, because both are flat at sea
  level over the ocean and without the gap the water came out in depth-fighting
  stripes, and it fades in as the complement of the plate's own rim fade. 1.5 MB,
  fetched on the first toggle, skipped under saveData.
- 2026-09-21, eighth round: the seam and the corners.
  The seam was not a tone difference at all. The two alphas were exact complements and
  the page still showed between them, because the terrain material was opaque: the plate
  did not blend over the backdrop, it overwrote it, alpha and all, so where the plate had
  faded to a tenth the framebuffer was a tenth opaque and nine tenths paper whatever was
  drawn behind. Premultiplied and blended it composites properly; on its own that changes
  nothing, the canvas being premultiplied over a transparent clear already. Measured
  afterwards, the two sheets' ocean tint agrees to 0.003 across 325,000 pixels.
  Two things had also made the backdrop read as a different material. Its ambient
  occlusion searched thirteen cells out, as the plate's does, but its cells are five
  times wider -- hills shading each other across 200 km instead of 45 -- so
  `ambient_occlusion` takes its step list now and the backdrop asks for as many as fit
  the plate's reach in km. And its coastal shadow had been widened threefold along with
  everything else; it is the same 30 km the plate bakes.
  The corners are gone: the backdrop goes out as a round pool. Its projection has to be
  the plate's or the two could never meet, and a cone stretches badly five thousand km
  from its parallels, so the corners are dissolved before they are close enough to read
  as a shape. What is left across the band is a change of resolution, 3.4 km against
  8.2, which is inherent to two sheets at different pitch.
- 2026-09-21, ninth round: the page showing through the backdrop, properly this time.
  Blending the plate was necessary and not sufficient. Complementary alphas are the
  wrong arithmetic: one sheet over another comes to `a + b(1 - a)`, and for `b = 1 - a`
  that is `a + (1 - a)^2`, which dips to three quarters in the middle of the band. A
  quarter of the page, in a ring all the way round the plate. Measured on the scanline
  through the middle of the frame, the alpha fell to 194 and 165 of 255 either side.
  Two holes on top of it: `siblingMaterial` had never been given the blending the base
  material got in the eighth round, so the backdrop -- and the lifted block, whose rim
  is soft -- still overwrote alpha rather than compositing; and a solid backdrop under
  a coarser DEM can poke through the plate, a 500 m difference at 5000 m being 4 km of
  lift at this exaggeration, far more than the 4 km it had been sunk by.
  The fix is a depth clear. The backdrop is its own scene, drawn first, and the depth
  buffer is cleared after it, so the plate covers it wherever the plate is opaque
  however far a coarse hill rises, and it can be solid the whole way in -- alpha 1
  behind a fading 1, which is 1. It no longer needs the 4 km drop either, so both
  sheets meet at the same sea level. `uInnerKm` is gone; `uPool` is what marks the
  backdrop now, and all it does is round it off far out. Measured after: no interior
  pixel below 246 of 255 in the default view, none at all below 255 in a low one, and
  the only partial alpha left is the outer pool dissolving into the page.

### What exists

- `pipeline/` (Python, numpy + pillow only): EPSG:7755 LCC (`lib/lcc.py`), the project
  grid (`lib/grid.py`: 3341 x 3507 km, 1 unit = 1 km, rows north to south), a small
  shapefile reader, a gzip raster container (`lib/pack.py`), `01_boundaries.py`,
  `02_dem.py`, `05_manifest.py` and `build.py`. `npm run data` rebuilds everything in
  about 40 s and is reproducible byte for byte; raw downloads are cached in
  `pipeline/raw/`, previews land in `pipeline/tmp/`.
- `public/data/`: committed outputs for two tiers, 960x1024 (first view, 1.15 MB) and
  1920x2048 (4.4 MB), plus `regions/states.json` and `manifest.json`.
- `content/states/states.json`: the 36 units with ids, ISO codes, English and Hindi
  names (Hindi spellings pending review), native-script names where they differ.
- `src/engine/`: pack decoder, textures, camera maths, picking, tweens, quality
  tiers, the terrain shaders and the engine facade. `src/state/`: store and URL.
  `src/i18n/`: `en.json`, `hi.json`, `t()`. `src/ui/`: gestures, bottom sheet, shell,
  CSS. Taps and pointer moves go through the store (`tap`, `pointer`) and come back as
  `selection` and `hover`; the UI never calls the engine.
- Verified headless (Chromium + SwiftShader through Playwright): no shader errors,
  phone and desktop layouts in both languages, sheet snaps, relief toggle animation,
  drag / wheel / orbit gestures, the 2048 tier swapping in. Screenshots and the
  script are not committed (open question 6).

### Decisions made while building

- Boundaries: DataMeet `States/Admin2.shp` (CC BY 4.0) already carries the 36 current
  units with the official external boundary (all of J&K and Ladakh, Arunachal);
  `Country/india-soi.geojson` is the authoritative mask: gaps inside it are filled
  from the nearest state, state pixels more than about one pixel beyond it (tidal
  flats in Kutch, Khambhat, the Sundarbans) are dropped. Natural Earth was not needed.
- Tiers are rectangular and named by height (960x1024, 1920x2048): the grid is taller
  than wide, and square textures wasted a fifth of every byte.
- Heights: int16 metres, exact on land. Ocean quantised to 25 m and forced to <= -25 m,
  so the shader reads land as "filtered height > -12.5 m": a smooth coastline with no
  mask channel, and half the bytes the noisy sea floor cost. AO and coastal shadow
  are baked at half resolution (AO reads fine upsampled; full resolution cost 4x).
  Border distance fields are made in the DEM step because the coast must be excluded.
- The 1024 tier always loads first (first-view budget); medium and high quality tiers
  swap the 2048 tier in afterwards. No 4096 tier yet (zoom-8 tiles are cached).
- Heightmap texture is R16F: exact to 2048 m, within 4 m at 8 km. Region IDs are R8
  NEAREST, so highlight fills will be texel-stepped at country zoom; the border lines
  come from the distance fields and stay smooth at any zoom.
- Vertical curve `y_km = exag * (h / 8000)^0.65 * 8`; default exaggeration 12, which
  is also what the baked AO assumes.
- Camera fit uses India's convex hull (computed from the ID raster) rather than its
  bounding box, so the turned view is tight. Padding comes from the header, the
  controls and the sheet peek, or from the side panel on wide pointer screens.
- `/en` and `/hi` shells are emitted at build time by a small Vite plugin; the seed
  of the per-route share-preview plugin.
- Quality tier from `deviceMemory`, cores and pointer type; the startup benchmark can
  come later.
- The grid rectangle is a visible board with a 50 km slab under it, crisp-edged, sides
  shaded by the same north-west light. A soft fade looked like a blurred picture.
- Picking samples the mesh surface, not the raw raster: with a 256² grid on phones the
  raster has peaks the mesh never draws, and a ray against them lands the selection
  in front of where the finger is. `area_km2` in `states.json` is counted from raster
  pixels (within a few percent); it ranks units for the touch bias and is not shown.

### Next

1. Owner: `npm install && npm run dev`, open it on the reference phone (the dev server
   listens on the LAN), judge fps and the look. Knobs: `PALETTE` and `CURVE` in
   `src/engine/terrain.js`, the default camera and relief in `src/main.js`, the light
   and band edges in `src/engine/shaders/terrain.frag.glsl`.
2. Phase 1, remaining: review the drafted facts and places (flip `status`, then turn
   the drafts default off in `src/main.js`; the tour then visits reviewed places only),
   lazy hi-res state packages (needs open
   question 1: they are about 1 MB each, 36 MB in all, too much for git), districts in
   the state view, the poster image (needs open question 6), context-loss test on iOS,
   layer state in the URL, a card carousel for point layers, WebGL sprites for markers
   if the DOM ones ever get slow (they are fine at 50).
3. Settle open questions 6-7.
