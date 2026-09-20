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
| D4 | Tap + bottom sheet is the core interaction; hover is a desktop enhancement | Phones have no hover. "Hover to learn" becomes: tap to select, peek card, "Explore" to go deeper, plus a swipeable card carousel that flies the camera to each item. Desktop adds real hover tooltips over the same data. |
| D5 | Layers are data, not code | The engine knows a few layer *types* (`terrain`, `choropleth`, `lines`, `points`), never individual layers. A layer is a folder: a `layer.yaml` plus data files. Adding "GI-tagged products" must not touch `src/`. See section 5. |
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
    layers/<id>/     one folder per layer: layer.yaml + data (section 5)
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
  layer.yaml
  items.csv                     bulk rows from the GI registry
  items/darjeeling-tea.yaml     optional richer override for one item
```

```yaml
# layer.yaml
id: gi-products
type: points
group: produce
title: { en: GI-tagged products, hi: जीआई टैग उत्पाद }
icon: tag
categories:
  - { id: handicraft,   title: { en: Handicrafts,   hi: हस्तशिल्प } }
  - { id: agricultural, title: { en: Agricultural,  hi: कृषि } }
  - { id: foodstuff,    title: { en: Food,          hi: खाद्य पदार्थ } }
  - { id: manufactured, title: { en: Manufactured,  hi: निर्मित वस्तुएँ } }
  - { id: natural,      title: { en: Natural goods, hi: प्राकृतिक वस्तुएँ } }
fields:                        # extra structured fields on top of the base item schema
  gi_number:  { type: int }
  registered: { type: year }
tooltip: "{name} · {category}"
card: [name, category, registered, blurb, media, sources]
country_view: aggregate        # per-state count badges; markers appear in state view
attribution: Geographical Indications Registry, Government of India
```

```csv
id,name_en,name_hi,category,lat,lon,regions,gi_number,registered,source,status
darjeeling-tea,Darjeeling Tea,दार्जिलिंग चाय,agricultural,27.041,88.266,IN-WB,1,2004,<url>,draft
```

What every layer of a given type gets without writing code:

- **`points`**: category filter chips, per-state aggregation at country level,
  priority thinning so phones never show hundreds of markers, region highlight on
  selection, card carousel with camera sync, search indexing, deep links, both
  languages.
- **`choropleth`**: a `values.csv` of `region,value` plus a palette and legend spec.
  The id-to-colour lookup texture is generated at runtime; crossfades between
  choropleths are free.
- **`lines`**: styling by attribute (width, colour, dash), optional flow animation,
  LOD split by level, tooltips from a template.

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

```yaml
id: hampi
status: draft                    # draft | reviewed; only reviewed items ship
name: { en: Hampi, hi: हम्पी, native: ಹಂಪಿ }
anchor: { lat: 15.335, lon: 76.462 }   # marker + camera target
regions: [IN-KA]                 # ISO 3166-2:IN; districts by LGD code
category: heritage
months: []                       # 1-12, for festivals and seasonality
blurb:
  en: Ruined capital of the Vijayanagara empire, spread across a boulder landscape.
  hi: विजयनगर साम्राज्य की राजधानी के खंडहर, जो विशाल चट्टानों के बीच फैले हैं।
media:
  - src: hampi-virupaksha.jpg
    alt: { en: Virupaksha temple gopuram at Hampi, hi: हम्पी का विरूपाक्ष मंदिर }
    credit: <author>             # credit, license and source are mandatory
    license: <licence>
    source: <url>
sources: [https://whc.unesco.org/en/list/241]
related: [badami, pattadakal]
```

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
2. Hosting: Cloudflare Pages (recommended) or Firebase Hosting?
3. One display webfont for headings (Latin + Devanagari), or system fonts only?
4. Name: "Bharat Darshan" also names IRCTC's tourist-train scheme and a park in
   Delhi. Fine for a project; check domain availability and search competition before
   launch.

5. `layer.yaml` needs a YAML parser and Python's standard library has none (it does
   have `tomllib` since 3.11). Add PyYAML as the pipeline's one extra dependency, or
   specify layers as `layer.toml` / `layer.json`? Needed before Phase 2.
6. Screenshot checks: add Playwright as a devDependency for the CI budgets and
   shader-regression screenshots, or keep it out of `package.json` and install it in
   CI only? (The web sandbox has it globally; the check script lived there.)
7. Portrait phones show India width-limited (about 7 km/px), with paper above and
   below the model. Accept, or nudge the default yaw / pitch / padding, or move the
   relief slider into the sheet to give the map more height?

Resolved on 2026-09-20: stylised look (D8); no React, minimal dependencies (D7);
English + Hindi at launch (D9); AI-drafted, human-reviewed content (D10); layers must
be addable as data, with GI products as the test case (D5).

## 12. Status

- 2026-09-20: plan written; owner's decisions folded in (D7-D10, layer folders).
- 2026-09-20, second session: Phase 0 spike built end to end (pipeline, engine, shell;
  details below). Budgets met: the first view is 1.15 MB of data plus 142 KB gzipped
  JS (three.js 130 KB, app 12 KB). Still open from Phase 0: the real-device check
  (>= 30 fps on the reference phone) and the owner's verdict on the look. Both need a
  phone and eyes; nothing in the sandbox can stand in for them.

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
- `src/engine/`: pack decoder, textures, camera maths, tweens, quality tiers, the
  terrain shaders and the engine facade. `src/state/`: store and URL. `src/i18n/`:
  `en.json`, `hi.json`, `t()`. `src/ui/`: gestures, bottom sheet, shell, CSS.
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

### Next

1. Owner: `npm install && npm run dev`, open it on the reference phone (the dev server
   listens on the LAN), judge fps and the look. Knobs: `PALETTE` and `CURVE` in
   `src/engine/terrain.js`, the default camera and relief in `src/main.js`, the light
   and band edges in `src/engine/shaders/terrain.frag.glsl`.
2. Phase 1: state picking (pointer ray against the CPU heightfield, then the ID
   raster), tap / hover highlight (the shader already takes `uSelected` and
   `uHover`), peek cards from `states.json`, camera and layers in the URL, poster
   image, context-loss test on iOS, state fact cards in both languages.
3. Settle open questions 5-7.
