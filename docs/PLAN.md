# Bharat Darshan (भारत दर्शन): implementation plan

An online interactive atlas of India on an isometric 3D model of the country. Like a
printed atlas it has pages -- political, physical, climate, minerals, industries,
transport, people, culture -- and unlike one, every page is the same model you can turn,
tilt, enter a state of, and tap for the facts. It grows by adding data: many sources,
many maps, a small fixed set of ways to draw them. Most users will be on phones; bigger
screens should use their full width.

Last updated: 2026-09-21 (nineteenth round). Status and next steps are at the bottom of this file;
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

**The atlas direction (2026-09-21).** The owner's vision is an atlas with many, many data
sources, not a showcase with a dozen layers. That changes the order of work, not the
architecture: first make the model a pleasure to handle and to look at (section 3,
"Camera handling" and "The missing wow"), then finish the set of drawing primitives so
that any thematic map an atlas carries can be expressed as data (section 5, "Primitives"),
then add the atlas's own structure -- plates and a contents page (section 5, "Plates") --
and from there on the work is sourcing and reviewing data, plate by plate.

## 2. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | Custom three.js scene, not MapLibre / deck.gl | Map libraries give tiles, labels and picking for free, but bring a perspective camera, Web Mercator and a "map app" look. As far as I know MapLibre has no true orthographic camera, and its WebGL text has historically been weak at shaping Indic scripts (re-check before relying on this). Limiting scope to two levels (country, state) keeps the custom cost manageable. The data pipeline is identical either way, so MapLibre + PMTiles remains the fallback if the Phase 0 spike disappoints. |
| D2 | Orthographic camera, north-up with a slight turn; not strict 45° isometric | Strict isometric (45° yaw, 35.26° elevation) turns India into a wide diamond: poor use of a portrait phone, and the silhouette stops being recognisable. About 15° of yaw with a 50-55° tilt keeps the familiar shape, suits portrait screens (India is about 3,200 km north-south by 2,900 km east-west), and keeps the Himalaya at the back where exaggerated relief never hides anything. **Amended 2026-09-21:** that describes the *home* view, and it stays the home view, the poster and every share image. The ±40° yaw clamp is dropped: the model turns the whole way round, because a model on a table that stops a third of the way is a broken turntable, and looking at the Himalaya from Tibet or at the peninsula from the south is exactly what a 3D atlas can do that a printed one cannot. The compass brings north back. See D13. |
| D3 | Two semantic levels instead of continuous zoom | Country view, then state view. Tap a state: the camera flies in, the state lifts out as its own block, the rest dims, and a lazily loaded state package (higher-res terrain, denser networks, districts, more places) swaps in. Street-level detail is out of scope; this is a showcase, not navigation. |
| D4 | Tap + bottom sheet is the core interaction; hover is a desktop enhancement | Phones have no hover. "Hover to learn" becomes: tap a state and it lifts out, with its card in the sheet, plus a swipeable card carousel that flies the camera to each item. There is no second step to press: a tap is the way in, and Back is the way out. Desktop adds real hover tooltips over the same data. |
| D5 | Layers are data, not code | The engine knows a few layer *types* (`terrain`, `choropleth`, `lines`, `points`, `regional`), never individual layers. A layer is a folder: a `layer.json` plus `items.json`. Adding "GI-tagged products" must not touch `src/`. See section 5; the full set of types the atlas needs is its "Primitives" table (D12). |
| D6 | Official boundaries from day one | Use Survey of India-compliant external boundaries (all of J&K and Ladakh including Aksai Chin; Arunachal Pradesh) and the current 28 states + 8 UTs. Default Natural Earth and OSM country outlines show de-facto lines, which is a legal problem for a map published in India. Review every rendered view, including share images. |
| D7 | Minimal dependencies: vanilla JS, no framework | Owner preference, and the same conventions as the owner's `gol` project: plain JS ES modules, no TypeScript, no JSX, no UI framework. **three.js is the only runtime dependency; Vite is the only build tool.** Store, router, i18n, bottom sheet and gestures are small in-repo modules. Raw WebGL2 without three.js was considered: it would save about 150 KB, but costs plumbing time and gives up a library the owner already knows well. Revisit only if the JS budget is threatened. |
| D8 | Stylised look: a hand-made clay / paper model, not realism | More distinctive, and cheaper: no imagery, low-frequency colour, tolerant of coarser meshes. Details in section 3. |
| D9 | English + Hindi at launch | Bilingual from the first screen, not retrofitted. Details in section 3. |
| D10 | Content is AI-drafted, human-reviewed | Every item carries sources and a review status; only reviewed items ship. Details in section 5. |
| D11 | It is an atlas: plates over layers | A printed atlas is a sequence of pages, each one map with a title, a legend and a source line. Here a **plate** is a JSON file naming a base style, the layers that are on, a camera and a few words; the contents page lists plates by section. A plate is the same shape as a story snapshot and a shared URL, so it needs no engine work, and it is the answer to layer sprawl: nobody faces a list of eighty switches, they open "Minerals". Layers remain the unit of data and stay individually switchable for anyone who wants to combine them. Adding a plate must not touch `src/`, the same rule as D5. |
| D12 | Primitives first, then data | With many sources coming, the engine work that matters is the closed set of ways to draw: finish it once, each primitive proven against one real dataset, each with the full contract (legend, picking, card, search, URL, both languages). After that a new map is sourcing and review, never rendering. The catalogue is in section 5. |
| D13 | One camera rule: the point you grab is the point that stays | Every turn, tilt and zoom pivots on the surface point under the pointer (or between the fingers) at the moment the gesture began, in 3D, and that point does not move on screen for the rest of the gesture. Yaw is free through 360°; the target is kept on the model; the key light belongs to the viewer's room, not to the model, so it stays upper-left of the screen as the model turns. Reasoning and the faults this replaces are in section 3, "Camera handling". |

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
| Move | Drag pan, pinch zoom, twist rotate, two-finger drag tilt; one two-finger gesture does one thing (see "Camera handling") | Left-drag slides, right-drag or Ctrl/Alt-drag turns and tilts, wheel zooms, Q/E turns |
| Back | Back gesture / sheet header (URL-driven) | Esc / breadcrumb |

- Branch on capability (`@media (hover: hover) and (pointer: fine)`, `pointerType`),
  not on screen width. iPads with mice and touch laptops exist.
- Small regions (Goa, Sikkim, Tripura, Delhi, Chandigarh, Puducherry's four enclaves,
  Daman and Diu, Lakshadweep) are nearly untappable at country zoom on a phone. Bias
  hit-testing toward small regions within about 24 px, give tiny UTs a marker, and
  make every region reachable from the list and search regardless.
- Later: long-press-and-drag "scrub" mode with a tooltip offset above the finger, as
  a true hover equivalent on touch.

### Camera handling (D13; diagnosed 2026-09-21, not yet built)

The complaint: after a pan, turning the model pivots somewhere unpredictable, and the
model cannot be turned far enough to put the south on top. Both are real, both are in
`src/ui/gestures.js` and `src/engine/camera-math.js`, and they come with company.
Reproduced in the browser: zoomed to the east coast, grabbed the Odisha shore, dragged
350 px right -- the shore left the screen on an arc and the yaw stopped dead at 40°.

What is wrong:

1. **The mouse pivot is the canvas centre, not what was grabbed.** Left-drag calls
   `orbitAbout(c, yaw, pitch, 0, 0, vp)`: screen point (0, 0). After any pan or
   zoom-about-cursor that point is arbitrary, usually empty paper, and it ignores the
   padding, so on a wide screen it sits 200 px right of the visible middle, half under the panel, and on a phone
   it can be under the sheet. The model swings on an arm instead of turning in place.
2. **The target is unbounded.** `clampCamera` clamps zoom, yaw and pitch and leaves `x`
   and `z` alone. A few drags carry the pivot thousands of km off the model, which makes
   (1) wilder, and India can be lost off screen altogether with nothing to bring it back
   but the compass.
3. **The pivot lies on the sea-level plane.** `groundPoint` answers for `y = 0`, while
   the surface being looked at is up to ~90 km higher at relief 12, and higher again on a
   lifted block. Yaw does not care (the axis is vertical) but every tilt slides the
   grabbed point up or down the screen by `h * Δcos(pitch)`.
4. **Touch does everything at once.** Each two-finger move applies pan, zoom, twist and
   tilt together, and the midpoint's vertical travel feeds *both* the pan and the pitch.
   So a two-finger drag pans and tilts at the same time, and an ordinary pinch whose
   fingers drift wobbles the yaw and the pitch. Nothing classifies the gesture and
   nothing has a threshold.
5. **Yaw is clamped to ±40°** (D2 as first written), so there is no south-up. Lifting
   the clamp alone is not enough: `tween` interpolates yaw as a plain number, so a flight
   from 170° to -170° would spin 340° the long way; the wall shader hardcodes the
   north-west light; the idle sway and the tour assume small angles.
6. **The idle sway, the tour's sway and the compass write yaw directly**, which pivots
   on the canvas centre, so with a sheet open the country drifts behind it as it sways.
7. **Drags stop dead.** No momentum. Not a bug, but it is most of why the model feels
   like a picture being repositioned rather than an object being pushed.

The fixes, in the order to build them (each its own commit). F8's tests come first, so
every fix after them is checked against something:

- **F1. Grab-point pivot.** *Done.* On pointer-down (mouse) or second-finger-down (touch) the UI
  sets `grab { x, y }` in the store; the engine answers synchronously with
  `pivot { x, y, z }`, the surface point its picker already finds (heightfield, lifted
  block included) -- the same handshake as `tap` -> `selection`, so the UI still never
  touches the engine. `orbitAbout` takes that 3D pivot and the screen position it had at
  grab time and holds the one on the other for the whole gesture; `project` already
  handles height. A grab that misses the model falls back to the surface point at the
  *padded* centre. `zoomAbout` gets the same 3D point, so zooming on a Himalayan peak no
  longer creeps.
- **F2. Keep the model on the table.** *Done.* A pure
  `clampTarget(cam, bounds, viewport, pad)`: the ground point at the padded centre may
  not stray more than a margin from the model. Rubber-band past that while the finger is
  down, ease back on release. What "the model" means took four goes, and the three that
  failed are worth remembering, because each looks right until it is measured: one box
  round India has corners in Afghanistan and in open ocean; its convex hull fixes the
  corners and spans the 1,200 km of the Bay of Bengal to the Andamans; the 36 units' own
  boxes fix that and have offshore corners of their own, one level down. All three park
  the view on empty water. What shipped is a coarse land mask built from the ID raster,
  one cell per 50 km, 67 x 70 cells and 4.7 KB, rebuilt filtered to one unit when a
  state is lifted. *Not* `uIndiaEdge`, which would be the obvious choice: that field is
  signed distance in a band 6.8 km wide, so anything asked of it past that comes back
  saturated. (The same trap caught the shadow; see "The missing wow" 1.)
- **F3. Free yaw.** *Done.* Drop `LIMITS.yaw`; normalise to (-180°, 180°]; `flyTo` unwraps the
  target yaw to the nearest turn before tweening, so `tween.js` stays ignorant of angles.
  `?cam=` already carries yaw. The compass needle already turns with the map and already
  resets; give it a visible "not north" state, since it is now the only way home from
  upside-down. Pitch keeps its 25-89° range.
- **F4. The light stays with the viewer.** *Done.* One `uLightAzimuth` uniform, home azimuth plus
  camera yaw, read by the terrain, block, backdrop and wall shaders in place of the
  constant. Turning a model under a lamp is what this looks like in a room, and it is also
  the cartographic rule: light from the bottom of the screen inverts relief to the eye,
  valleys reading as ridges, worst near top-down. Baked AO and the coastal shadow are
  direction-free, so nothing in the pipeline changes.
- **F5. One gesture, one meaning on touch.** *Done.* Two fingers start undecided. Both moving the
  same way, mostly vertical, with the spread and the angle between them barely changing
  -> *tilt*, and only tilt. Anything else -> *pinch/pan*, with twist joining only once
  the angle has moved ~8°, then latched. The mode holds until a finger lifts. This is
  what Google Maps and Mapbox do and what thumbs already expect.
- **F6. Momentum.** *Done, except a look on a real phone: the pane here never fires a frame.* Release velocity carries pan and turn on with an exponential decay
  (~300 ms), killed by the next touch, off under reduced motion. It only runs while
  something moves, so render-on-demand stands.
- **F7. Everything else pivots properly too.** *Done.* Idle sway, tour sway and keyboard turning
  go through `orbitAbout` about the padded centre instead of writing yaw.
- **F8. Pin it down.** *Done: 24 cases, `npm test`.* `camera-math.js` is pure, so it gets tests with `node --test`
  (standard library, no dependency): the pivot's projection is unchanged by `orbitAbout`
  for random yaw, pitch and height; yaw unwrapping takes the short way; `clampTarget`
  holds. And one headless check: grab a point, turn through 360°, the point under the
  cursor has moved less than a pixel.

**F0. Desktop buttons go back** (open question 8, resolved 2026-09-21). *Done.* The sixth round
made left-drag turn the model and right-drag slide it. With a pivot that is wherever the
canvas centre happened to be, that put the least predictable motion on the most used
button. F1 cures the unpredictability whichever button it is on, but left-drag slides
again: an atlas is read zoomed in, zoomed in the commonest act is sliding the map, every
map a visitor has ever used slides on left-drag, and one finger on a phone already pans
-- one model for both. Turn and tilt go on right-drag and Ctrl/Alt-drag (trackpads have
no right-drag worth the name), plus Q/E and the compass.

### The missing wow (proposals, 2026-09-21; the look is the owner's call)

From a look at the home view as it stands: the clay is good, and the model still reads as
a picture laid on a page. In rough order of effect per hour:

1. **Put it on the table.** *Done 2026-09-21, with two corrections to this plan.* The
   shadow cannot come from `uIndiaEdge`: that field is signed distance in a narrow band
   (`uEdgeRangeKm` is 6.8 km at the first-view tier), so a look 85 km along the light
   lands outside everything it can say and comes back saturated -- measured, a flat wash
   of 0.06 over the whole page rather than a shadow. It is six weighted taps of the ID
   raster back along the light instead, coarse and stepped where the field is smooth,
   but the taps and their falloff blur that away at the size a shadow is. And it is
   thrown the height of the *relief*, not of the 22 km walls: a wall-sized shadow is
   about 5 px at the home view and reads as an outline round the coast rather than as a
   thing standing on a table. Knobs in `SHADOW` in `src/engine/terrain.js`. The lifted
   block casts one too, on the country around its socket: the same search, looking for
   the id it was cut from, and thrown by how far it stands above the plate rather than by
   the height of the relief.
2. **An entrance.** *Done 2026-09-21.* On a cold load of the home view the model rises
   out of the page: relief 0 -> 12 while the camera tips from 84 degrees to the home
   angle, 1.4 s, once, skipped for reduced motion, for the poster, and for any link that
   asked for somewhere in particular (`linked` in the store). The catch, which cost a
   round of measuring: the rise has to count as the camera being busy, because the
   shell's first padding write refits when it is not, and a fit keeps the angles it
   finds -- so the rise's own target was being replaced by one framed at 84 degrees and
   the model never tipped down at all.
3. **Handling is the look.** F1, F5 and F6 above. An object that turns about your finger
   and coasts to a stop is most of what "tactile" means on a screen.
4. **Let the relief show.** *Done 2026-09-21.* The home view was a priority-2 view, which
   put about forty full-size tokens over a country 3,000 km across: the markers were what
   you saw and the model was what they were on. Now 17 at the home view (priority 1
   only, the rest arriving as the camera comes in), scaled to 0.75 and growing to full
   size by 1,200 km of view height, and springing up one after another as they arrive.
   The contact shadow was already there. The scale is one custom property on the
   container, not one per marker: fifty style writes a frame would be fifty
   invalidations. And the stagger restarts the animation by unhiding a `display: none`
   element rather than by reading `offsetWidth`, which during a zoom-in would be one
   forced layout per token arriving.
5. **Bolder form at distance.** At 4 km per pixel the per-texel normal is fine grain;
   the big forms (the Ghats' scarp, the Deccan's tilt, the Gangetic trough) want a
   second, broader normal blended in as the view pulls back, so the country reads as
   sculpture from across the room and as terrain close up.
6. **Atlas furniture.** A title cartouche for the open plate in Yatra One, a scale bar
   (honest along the screen's x, the camera being orthographic), a compass rose that
   turns, and a graticule scored faintly into the table beyond the model -- which also
   makes turning legible, since the table's lines turn with it.
7. **Miniature depth of field** on the high tier, already planned in "Layout".
8. **A warmer room.** A vignette and a slight warm-to-cool falloff across the paper from
   the light's side; the page is currently one flat cream.

Items 1-4 are the round to do first; 5-8 are there to be picked from once those are in
and looked at on the reference phone.

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
- With the atlas direction (D11) the way in is the **contents**, not the layer list: the
  country sheet opens on the atlas's sections and their plates, the chip row on a phone
  holds the open plate's own layers, and the full layer list moves behind "all layers"
  for anyone who wants to mix their own. The contents is ordinary DOM, so it is also the
  screen-reader, search-engine and no-WebGL view of the atlas.
- Canvas: `touch-action: none`, no page scroll, `overscroll-behavior: none` (stops
  pull-to-refresh on Android Chrome).
- Desktop extras: more simultaneous labels, higher-res data tier, tilt-shift depth of
  field for a miniature look, keyboard navigation.

### Visual direction: a hand-made model on a table (D8)

- **Material.** Matte clay / paper. No specular highlights, no satellite imagery or
  photo textures. A tiny tiling grain texture multiplied over everything.
- **Light.** One soft key light from the north-west (cartographic convention) plus
  generous ambient; north-west of the *screen*, so it holds its place as the model
  turns (D13, F4), with wrap lighting so shaded slopes never go black. Baked ambient
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
    plates/<id>.json one file per atlas page: base, layers, camera, words (planned)
    sources.json     every dataset once: licence, vintage, URL (planned)
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
- **`choropleth`**, **categorical**: `"scale": "categorical"` instead of a list of bands, and
  then the layer declares `categories` exactly as a `points` or `lines` layer does -- an id,
  a bilingual title and a colour each -- and `values.csv` holds a category id per region
  instead of a number. One file format and one lookup serve both kinds: what reaches the
  shader is an index into the same eight colours either way, so the terrain reads one texel
  and cannot tell them apart. It is for what a region *is* rather than how much of
  something it has, so it has no unit, and the build says so if one is declared. The legend
  is the categories', not a set of ranges.
- **`choropleth`**: a `values.csv` of `region,value` beside `layer.json`, which carries
  the `scale` (a lower bound and a colour per band), a bilingual `unit` template and an
  optional `note` for a caveat the legend should show. The build turns the ISO codes into
  raster ids; the runtime makes a 256-texel lookup indexed by id and the terrain tints its
  albedo by it, so light, ambient occlusion and grain still go over the top and the relief
  reads under the colour. A region with no value keeps its own clay. Only one choropleth
  is drawn at a time, so switching one on switches the others off and changing between
  them fades out through the clay and back.
- **`regional`**: items that belong to the regions that keep them rather than to a point
  on the map, so they carry `regions` and no anchor and nothing is drawn for them. A
  lifted state's card lists what it keeps; tapping one opens the ordinary item card, and
  they are in the search index, narrowed to that state like everything else. An item kept
  everywhere says `"regions": ["*"]` rather than listing every code.
- **`lines`**: geometry fetched from the source named in `layer.json` and joined to the
  curated items either by the source's own names (`join: "name"`, which is how rivers
  work) or by routing through the places an item lists (`join: "route"`, for a source
  that carries geometry but no names, which is every road and railway over India). Either
  way the names and facts stay in the folder and the courses come from a published
  dataset. Styling by attribute (rank sets the width, category the colour), LOD by level,
  picking with tooltips and cards, declared `fields` on the card, and a run drawn on
  whichever surface it belongs to -- the country plate or the lifted block -- so it is cut
  at a state boundary rather than climbing the block's wall. With `"flow": true` the build
  points every run downstream and the shader runs crests along it.

A `points` layer can set `marker: "label"` to be drawn as its name alone, with no token,
for things that are a stretch of country rather than a spot on it (mountain ranges,
plateaus, deserts). Tokens claim their screen space first, so a label yields to a place.

Rules that keep this honest:

- The engine knows layer types, never layer ids. `grep -r "gi-products" src/` must
  return nothing.
- New layer *types* are engine work, and with the atlas direction they are the engine
  work: the closed set is in "Primitives" below, to be finished before the data pours in.
- Phase 3 exit criterion: the GI products layer goes in using data files only.

### Primitives: the closed set of ways to draw (D12)

Every thematic map in a school atlas is one of about ten drawings. The plan is to have
all of them, each proven on one real dataset, each honouring the full contract -- legend
from `layer.json`, picking, tooltip, card with declared `fields`, search, URL, both
languages, cut correctly between the plate and a lifted block -- so that after this a new
map is a folder and a source, whatever it shows.

| Primitive | Draws | Atlas maps it carries | Status | First dataset to prove it |
|-----------|-------|-----------------------|--------|---------------------------|
| `terrain` | the clay relief | physical | built | -- |
| `choropleth`, banded | a number per region, in bands | density, literacy, sex ratio, rainfall by state, crop output | built (states) | population density (done) |
| `choropleth`, categorical | a category per region, a colour each | **the political map**, language families, climate zones by state, ruling-era maps | built (`"scale": "categorical"`) | zonal councils (done) |
| `choropleth`, districts | either of the above on the 16-bit district raster | anything the census publishes | blocked on a boundary source (open question 10) | Census 2011 literacy |
| `lines` | named courses, width by rank, colour by category, optional flow | rivers, roads, rail, waterways, pipelines, transmission | built | done |
| `lines`, generated | geometry made by the build, not fetched | graticule, Tropic of Cancer, Standard Meridian, isohyets / isotherms from a raster | small: a `source.kind` | reference lines |
| `points`, token / label | a marker or a name at a spot | places, summits, ranges, ports, airports, plants | built | done |
| `symbols` | a circle (or glyph) **sized by a value**, coloured by category | city populations, mines by output, power plants by MW, ports by cargo | new; shares the points path, adds a size scale and a size legend | power plants by capacity and fuel |
| `areas` | named polygons that are not regions: fill, hatch or outline, draped on the relief | coalfields, mineral belts, national parks and tiger reserves, river basins, physiographic divisions, soil and forest types, industrial regions | new; rasterised by the build to an id raster + edge field, so it reuses the choropleth lookup and the border shader | physiographic divisions, then coalfields |
| `raster` | a continuous field tinting the clay through a colour ramp | rainfall, temperature, forest cover, night lights, land use | new; one 8-bit texture per layer at the tier's resolution, same multiply-into-albedo as a choropleth | annual rainfall normals |
| `flows` | curved arrows between places, width by volume, animated along their length | monsoon advance, migration, trade, pilgrimage circuits, freight | new; the ribbon shader plus an arc and an arrowhead | monsoon onset |
| `prisms` | a region or a spot extruded by a value -- the one drawing only a 3D atlas has | population, GDP, production by state; rainfall columns at stations | new; the block extruder already exists | state population |
| `regional` | nothing on the map; listed on a state's card | festivals, languages, food | built | done |

Two things cut across all of them rather than being primitives:

- **Time.** Any layer may declare a time field (month already works this way; year is
  the obvious next). The scrubber shows itself when something on show can be scrubbed and
  the primitive redraws for the chosen step: a choropleth swaps its lookup, symbols
  resize, flows advance. Census decades and the monsoon's month-by-month advance are the
  first users.
- **Charts on cards.** A `series` field type (year,value pairs) the card draws as a small
  inline SVG spark-bar. No chart library.

Rules for building them: smallest first (categorical choropleth, generated lines,
symbols, areas, raster, flows, prisms); one primitive per round, never a primitive
without its proving dataset; each must degrade on the low tier rather than drop out; and
only one fill-type layer (choropleth, areas, raster) tints the clay at a time, by the
same type-decides rule that already keeps choropleths exclusive.

### Base styles

A thematic map wants a quieter base than the physical one, or its colours fight the
hypsometric bands. Three, chosen by the plate, never by a layer id: **physical** (today's
bands), **political** (categorical state fills over gentle relief) and **plain** (one warm
clay, relief by light alone) for everything thematic. It is a uniform or two on the
existing terrain material, with the same fade-through-clay the choropleths use.

### Plates: the atlas's pages (D11)

```
content/plates/minerals.json
```

```json
{
  "id": "minerals",
  "section": "resources",
  "title": { "en": "Minerals", "hi": "खनिज" },
  "blurb": { "en": "...", "hi": "..." },
  "base": "plain",
  "layers": ["coalfields", "mines", "rail"],
  "relief": 8,
  "camera": "home",
  "status": "draft"
}
```

- A plate is a preset of view state, nothing more: opening one sets `base`, `layers`,
  `relief` and the camera through the store, exactly as a URL or a story step does. The
  engine never learns the word.
- URL: `/en/atlas/minerals`, with its own share image and Open Graph shell from the same
  Vite plugin that makes `/en` and `/hi`. State view composes: `/en/atlas/minerals/state/jharkhand`.
- Sections (the contents page's headings, strings keyed by id like layer groups):
  political, physical, climate, resources, agriculture, industry and energy, transport,
  people, culture, history.
- The legend, the source line and the data's vintage come from the plate's layers, so a
  plate cannot show a map without saying where it came from and when.
- The build validates a plate the way it validates a layer: every layer it names exists,
  both languages present, only `reviewed` plates ship. `grep -r minerals src/` stays
  empty.
- Stories (Phase 4) become a plate with steps.

### Source registry

With dozens of datasets, attribution per layer stops scaling: the same census or the same
yearbook feeds ten layers. `content/sources.json` declares each source once -- id, title,
publisher, URL, licence, vintage, date retrieved -- and layers and items cite it by id
(plain URLs stay legal for one-off facts). The build fails on an unknown id or a source
with no licence, the credits screen is generated from it, and each legend shows its
source and year. Government of India open data is mostly under GODL-India, which allows
reuse with attribution; anything else is checked before it is used, not after.

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
  (handles sheet, panels, orientation change and resize). Per D13: yaw is free and flights
  take the short way round; every turn, tilt and zoom holds a 3D pivot fixed on screen;
  the target is clamped to the level's bounds; the key light's azimuth follows the yaw.

## 7. Data pipeline and sources

| Layer | Source | Notes |
|-------|--------|-------|
| Boundaries | Survey of India; DataMeet community maps; Natural Earth India point-of-view files | Validate 36 units, ISO 3166-2:IN and LGD codes. Keep 2011 district shapes for census joins. Check the outline against the SoI political map before trusting any source. |
| Districts, current | `LGD_Districts` (785 districts, 36 units, LGD 2024) via india-geodata / bharatlas | See "District boundaries" below. |
| Districts, 2011 | DataMeet `Districts/Census_2011/2011_Dist.shp` (641 features, CC BY 4.0) | `censuscode` 1-640 is the PC11 key every census table joins on. |
| Elevation, country | AWS Terrain Tiles (Terrarium PNG), zoom 7-8 | About 150-200 tiles, 15-25 MB at zoom 7, roughly 1.1 km per pixel, includes bathymetry. Open data with attribution. Ideal for Phase 0. |
| Elevation, states | Copernicus DEM GLO-30 | Free with attribution; fewer Himalayan voids than SRTM. Only needed once state packages are built. |
| Rivers | HydroRIVERS (stream order, discharge); names from OSM / Natural Earth | |
| Roads, rail | OpenStreetMap (Geofabrik India extract, or targeted Overpass queries) | Country: national highways + trunk rail. State: adds state highways and all rail. ODbL attribution. |
| Languages | Census 2011 C-16 mother-tongue tables, district level | Latest census available. Colour by family, shade by language; top-5 list and a diversity index per district. |
| Places, food, festivals | Curated; seed from the UNESCO list, Wikidata | Wikimedia Commons images with licence tracked per item. |
| GI products (later) | Geographical Indications Registry | 600+ registered items with category and state; anchors need geocoding and review. |

Candidate sources for the atlas's plates. These are from memory, as leads: each one's
licence, vintage and boundary treatment is checked and entered in `content/sources.json`
before a byte of it ships, and any dataset that draws India's outline is used for its
values only, never its shapes (D6).

| Section | Plates | Primitive | Leads |
|---------|--------|-----------|-------|
| Political | States and capitals; districts; Lok Sabha seats by state | categorical choropleth, points, prisms | what is already built; Election Commission of India |
| Physical | Relief; physiographic divisions; rivers and basins; soils; geology | terrain, areas, lines | India-WRIS (basins); NBSS&LUP (soils); Geological Survey of India |
| Climate | Annual and monsoon rainfall; temperature; monsoon onset; cyclone tracks; climate zones | raster, flows, lines | IMD normals and gridded rainfall; IMD onset isochrones |
| Resources | Coal and lignite fields; metallic and non-metallic minerals; forests; protected areas | areas, symbols, raster | Indian Minerals Yearbook (IBM); GSI; Forest Survey of India ISFR; WII ENVIS |
| Agriculture | Principal crops; irrigation; cropping seasons | choropleth, time | Directorate of Economics and Statistics; data.gov.in |
| Industry and energy | Power plants by fuel and size; refineries and pipelines; steel; industrial corridors | symbols, lines, areas | Central Electricity Authority; WRI Global Power Plant Database (CC BY 4.0); PPAC |
| Transport | Highways; railways; ports by cargo; airports; national waterways | lines, symbols | built; Indian Ports Association; AAI; IWAI |
| People | Density; literacy; sex ratio; urbanisation; decadal growth; religions; languages | choropleth, time, regional | Census of India 2011 and earlier; NFHS for anything newer |
| Culture | Places; festivals; food; GI products; crafts; classical arts | points, regional | built; GI Registry; UNESCO; Wikidata |
| History | Later, and carefully: extents of empires are contested and need sources per boundary | areas + time | -- |

### District boundaries (open question 10, surveyed 2026-09-21)

Every candidate was downloaded and tested: point-in-polygon on eight disputed-territory
probes, and 1,500 random vertices against the project's own `india-soi.geojson` mask.

| Source | Units / vintage | Licence | External boundary | Codes |
|--------|-----------------|---------|-------------------|-------|
| **`LGD_Districts`** (india-geodata / bharatlas) | **785 districts, 36 units, LGD 2024** -- Telangana 33, Ladakh 2, current throughout | "CC0 / CC BY 4.0", *asserted by the aggregator* | **Compliant.** Aksai Chin, Shaksgam and Gilgit inside `Leh Ladakh`; PoK as two named blobs; full Arunachal | **Both** LGD (`dist_lgd`) and PC11 (`dtcode11`), plus `year_stat` per polygon |
| **DataMeet `Districts/Census_2011`** | 641 features = 640 PC11 districts + one for PoK; 2011, so no Telangana, no Ladakh | CC BY 4.0, the same repo the state file already comes from | Compliant | `censuscode` 1-640, the PC11 key |
| geoBoundaries gbOpen ADM2 | 736, 2021 | ODbL 1.0 (the layer's own, not the project-wide CC BY) | Compliant | **None usable**: a name string, no state, no codes |
| SHRUG / Development Data Lab | PC11 districts | CC BY-**NC**-SA: non-commercial | -- | `pc11_d_id` |
| GADM 4.1 | ADM2 | **redistribution prohibited** | splits J&K into pseudo-units | -- |
| Natural Earth | **no ADM2 for India at all** (Admin 2 is US counties) | CC0 | -- | -- |

Against the project's own SoI mask, sampling 1,500 vertices: `LGD_Districts` has 3.6%
outside it, DataMeet's 2011 districts 23.1%, and the state file the pipeline already
trusts 12.7%. The recommended district file nests inside the mask *better* than the
state file does.

**Use both**: `LGD_Districts` for what the map draws, DataMeet 2011 for census joins.
They join on the PC11 code, many-to-one from current districts to 2011 parents. Do not
try to rebuild 2011 shapes by dissolving the 785: a split district's surviving row is
the post-split remnant, not the 2011 polygon.

Before any of it ships:

- **Provenance, the one real risk.** LGD publishes codes, not geometry; the dbf schema
  says an ArcGIS-simplified layer of census / Survey of India lineage with LGD codes
  attached, and the licence label is the aggregator's assertion. D6 says chase that to a
  primary statement first. A Survey of India product (`OVSF/1M/7`, free, admin boundaries
  to district level), data.gov.in's district-boundary resource and Esri's Living Atlas of
  India would each settle it; all three need a browser and an account, so they are the
  owner's to check. Until then, geoBoundaries is the fallback that is already clear.
- The district ID raster must be **uint16**: 785 will not fit the state raster's uint8,
  which doubles that texture. Keep districts out of the first view (section 8's budget)
  and ship them in the state packages.
- `year_stat` is 622 polygons dated 2011 and 163 dated 2012-2023, so it is a
  current-district file, not a single-epoch one. Carry that field so a district card can
  say when its shape was drawn.
- Aksai Chin, Shaksgam and Gilgit-Baltistan have no real internal district lines: they
  sit inside `Leh Ladakh`, and PoK is two polygons with `dist_lgd = 0`. Every
  district-level choropleth needs an explicit "no data" treatment there, and the count
  shown to a visitor should say 785 *polygons*, not 785 administered districts.
- `read_dbf` defaults to latin-1 and the file's `.cpg` says UTF-8. It happens not to
  matter for `LGD_Districts`, whose names are ASCII, and it does for the SoI-lineage
  sibling file, whose names carry diacritics.

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
*Done (2026-09-21): the `lines` type with picking, tooltips, cards and declared
`fields`; 28 rivers with flow, 18 named ranges, 28 peaks and passes, 8 national
highways and 5 railway lines; the layer panel grouped with legends. Three railways
the source cannot supply are noted in the status log below.*

**Phase 3: culture layers (3-4 weeks).** The `points` and `choropleth` layer types.
District-level languages with script samples and greeting audio; places, food and
festivals with card-carousel sync; a month scrubber ("India through the year");
search; first ~150 reviewed items. Exit: GI products added with data files only.
*Part done (2026-09-21): both layer types exist plus a third, `regional`; the card
carousel, search and the month scrubber all work; and population density, 30
festivals and 23 languages went in as data alone. Left: districts, which need a
boundary source; food; and the reviewed items, which are the owner's.*

**Re-ordered on 2026-09-21 for the atlas direction (D11-D13).** Phases 0-3 above stand
as the record of what was built. What is left of Phase 3 (food, districts, reviewed
items) moves into Phase 7; the order from here is handling, look, primitives, atlas,
data.

**Phase 4: handling and look (1-2 weeks). Next.** Section 3, "Camera handling" F1-F8
in that order, then "The missing wow" 1-4. One fix per commit; the camera maths gets its
tests first so every later fix is checked against them. Exit: the 360° pivot check
passes; on the reference phone a pinch never tilts and a tilt never pans; and the owner
says wow -- the Phase 0 exit criterion that was never signed off.

**Phase 5: primitives (3-4 weeks).** Section 5's catalogue, smallest first, one per
round, each with its proving dataset and the full contract: categorical choropleth
(*done 2026-09-21, proven by the zonal councils*) -> generated lines (graticule, Tropic
of Cancer) -> `symbols` (power plants) -> `areas` (physiographic divisions, coalfields)
-> `raster` (rainfall) -> `flows` (monsoon onset) -> `prisms` (state population).
Base styles and the year
scrubber land with the first primitive that needs them. District choropleths join when
open question 10 has an answer. Exit: a mineral map, a rainfall map and a political map
exist, and `src/` names none of them.

**Phase 6: the atlas shell (1-2 weeks).** Plates, the contents page, `/atlas/<id>` URLs
with share images, the source registry and generated credits, the cartouche, scale bar
and legend as atlas furniture. Exit: a plate added with a JSON file only, and the first
ten plates -- one or two per section -- reading as an atlas rather than a demo.

**Phase 7: fill it, and launch (ongoing).** Plate by plate, section by section, from the
source table in section 7. Content is the long pole: sourcing, licences, review. Food,
GI products, crafts and the rest of the culture layers continue here. Alongside:
stories as plates with steps (follow the Ganga, the monsoon's advance, the Golden
Quadrilateral), the poster image, accessibility pass, PWA, the CI budgets.

**Later.** Trains on famous routes, low-poly landmarks, haptics, a contribution
workflow, more UI languages, the history section.

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
  mutually exclusive choropleths keep it usable. At atlas scale the answer is plates
  (D11): the visitor chooses a map, not switches.
- **Data sprawl.** Dozens of sources with different licences, vintages and ideas of
  India's outline. The source registry, values-not-shapes for anything with a boundary
  (D6), and a vintage on every legend are the defence. A 2011 census figure beside a 2023
  production figure must say so.
- **Budgets under many layers.** Nothing new is `default_on`; a plate's first view is
  budgeted like the home view (<= ~1.5 MB including its layers); rasters ship at the
  tier's resolution, 8-bit, one at a time.
- **Free rotation.** Relief can now stand in front of what it used to stand behind, and
  labels and tokens are not depth-tested against it. Accept at first; if it grates, fade
  markers whose anchor the heightfield hides from the camera.
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
   launch. Resolved on 2026-09-21 along with question 11: the name stays.

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

8. **Resolved on 2026-09-21**: left-drag slides the map again, and turning moves to
   right-drag and Ctrl/Alt-drag (plus Q/E and the compass). An atlas is read zoomed in,
   where sliding is the commonest act, and one finger on a phone already pans.
9. **Resolved on 2026-09-21**: the key light stays with the viewer, upper-left of the
   screen, as the model turns (F4). Turning a model under a lamp is what this looks like
   in a room, and light from the bottom of the screen inverts relief to the eye.
10. District boundaries: **answered on 2026-09-21, pending one check.** Two files, for
    two jobs -- `LGD_Districts` (785 current districts) for the map and DataMeet's
    `Districts/Census_2011` (640) for census joins. Both are in section 7 with their
    licences and their treatment of J&K. The open part is provenance: the current-district
    file comes from an aggregator whose licence label is its own assertion rather than a
    government grant, and D6 says chase that to a primary statement before a byte ships.
    Until then the fallback is geoBoundaries ADM2 (ODbL, 2021, no codes).
11. **Resolved on 2026-09-21** with question 4: "Bharat Darshan" stays, with "an atlas of
    India" as the line under it. Revisit before launch, not before.
12. Pipeline reproducibility: `pipeline/requirements.txt` asks for `numpy>=1.26`, and
    "reproducible byte for byte" does not survive that range. On 2026-09-21, on a fresh
    machine with numpy 2.5.3 and no pipeline change at all, `shade-2048.bin.gz` came back
    687,155 bytes against the committed 687,146 -- a marginal numerical difference in the
    ambient occlusion at the finer tier, invisible on screen but enough to make every
    rebuild look like a data change in `git status`. Pin numpy (and pillow) to the
    versions the committed data was built with, or drop the byte-for-byte claim to
    "reproducible on one machine" and stop treating a terrain diff as a signal? Pinning
    is the recommendation: the guarantee is what makes an unexpected diff worth looking
    at.

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
- 2026-09-21, tenth round: phase 2 closed -- flow, then roads and rail.
  Flow first. Every vertex carries how far along its run it lies, measured from the
  upstream end, and the shader runs soft crests down that distance; a cubed sine gives
  long quiet stretches with a crest between them rather than marching ants, and the mean
  of the cube is subtracted so a river keeps the weight it has at rest. Peak to trough is
  about 18 levels of 255. Knowing which way a river runs is the build's job: Natural
  Earth's centrelines are not digitised downstream, so each run is fitted against the
  heightmap and turned round when it climbs. 20 of the rivers' 74 runs turned. It is the
  one thing here that draws while nothing has changed, so it is on a short leash --
  medium tier and up, 30 fps, stopped when the tab is hidden or less motion is asked for.
  23 fps with the rivers on and a still camera, 0 with them off.
  Then roads and rail, which needed a second way to join. Natural Earth carries no names
  at all over India: every one of its 1,601 road records in the India box has an empty
  name, label and route number, and the railway file has no name field to begin with. So
  an item can name the places its route is known by and the build walks the source's own
  parts between them. Three things make that honest rather than merely plausible: parts
  are cut at the border rather than dropped for crossing it, cut again at the vertex
  nearest each waypoint (a road passes through a city whose nearest part endpoint is
  ninety km away, which put six of eight highways out of reach), and a stretch far longer
  than the flight between its two places is treated as a gap in the source and left out
  -- asked for the west coast highway across a gap, a shortest path returned 687 km of
  inland road for an 81 km hop.
  Eight highways and five railways came out of it, most within a few per cent of their
  published lengths, the two Ladakh roads 25 to 30% short because a 10m dataset has no
  room for hairpins. Three railways cannot come from this source at all: its railways
  predate the Konkan Railway, which opened in 1998 and whose coast is 42 to 98 km from
  the nearest line in the data, and it has neither the Kalka-Shimla nor the Nilgiri
  Mountain Railway. The guards caught all three rather than drawing something else in
  their place. They are worth having when there is a source with names in it.
  Two gaps in the `lines` type turned up on the way and are fixed: a layer's declared
  columns never reached a line's card (dropped by the build, unvalidated, and missing
  from the selection a tap sets), and PLAN's own `year` field type did not exist.
- 2026-09-21, eleventh round: the last two things a link could not carry, and the card
  carousel. `?layers=rivers,roads` names what is on show and only appears when it is not
  the catalogue's own defaults, so an ordinary link stays `/en`; `?layers=none` is the
  difference between everything off and not asked. `?item=roads:nh-44` carries whatever
  card is open, switching that layer on whatever else the link says, because a card with
  nothing drawn under it is not what the link meant. A link arrives at its item rather
  than flying to it, as `/state/<slug>` already does.
  The card grew a prev / next row that walks the stops the tour would visit, in the same
  order, so playing and stepping follow one path. It narrows with everything else, 157
  stops at country level against 6 inside Kerala, and hides itself while the tour runs.
  Three bugs came out of this, all of them quiet ones:
  `start` framed the country unconditionally at the end, and the layer files are fetched
  the moment the catalogue lands, which is before the first tier is awaited -- so an item
  named in the URL was reliably framed and then thrown away a moment later. `lines.find`
  did not return the categories a card needs. And the store shallow-merges objects, so
  opening a card by name alone over an open one kept the old card's `data`: the engine
  saw data already there and left it, and the card showed the old place under the new
  name while the map flew to the right one. Opening by name says `data: null` and means
  it. That merge is worth remembering before adding another slice that is sometimes a
  stub.
- 2026-09-21, twelfth round: the `choropleth` type, and the first one.
  A folder brings a values.csv of region,value beside its layer.json and the whole layer
  reaches the shader as one 256-texel lookup indexed by raster id. It tints the clay
  rather than covering it: the value replaces the hypsometric colour and the same light,
  ambient occlusion and grain go over the top, so the relief still reads under it. A
  region with no value keeps its own colour, and so do the sea, the neighbours and the
  backdrop, whose id is 0.
  The lookup stores a band index rather than a colour. The band colours go as ordinary
  Color uniforms, which three.js converts from sRGB to linear; an 8-bit texture of linear
  colour would have thrown the darks away.
  Population density is the first one, as data alone -- `grep -r population-density src/`
  is empty. It is the 2011 census population over the published area of each state, the
  same two figures the state cards carry, so the map and the cards cannot drift. 17 per
  km² in Arunachal Pradesh against 11,320 in Delhi, which is why the bands are 0, 50,
  150, 300, 500 and 1,000 rather than even steps. Jammu and Kashmir and Ladakh are left
  uncoloured and the legend says why: the census predates their 2019 reorganisation, and
  published areas for them differ by which territory is counted, so any single number
  would be taking a side in a boundary question.
  Only one choropleth is drawn at a time -- two would fight over the same clay -- so
  switching one on switches the others off, and changing between them fades out through
  the clay and back. The type decides that, never a layer's name.
- 2026-09-21, thirteenth round: search finds what is on the map.
  The list box found states and union territories; it now also finds whatever the layers
  on show can answer with. The engine publishes an index of every item's name rather than
  the shell fetching the layer files again, so what can be found is exactly what is
  drawn. 198 things at country level, 7 inside Kerala.
  Narrowing a run to a state is the part worth recording. A bounding box is no good: a
  highway from Kashmir to Kanyakumari has a box that contains every state, and a box test
  duly offered NH 44 in Kerala and the Darjeeling Himalayan Railway in Bihar. Asking the
  ID raster about the run's own points instead is exact and no more expensive, and it
  only runs when the level changes. Kerala answers with NH 66; Bihar with the Ganga, the
  Gandak, the Ghaghara, the Son, NH 19, NH 27 and the Howrah-Delhi main line.
  Both languages come free, the index carrying the whole name object: "गंगा" finds the
  Ganga and the Wainganga.
- 2026-09-21, fourteenth round: a fourth layer type, for things that are not points.
  Festivals were the case that made it. Onam is Kerala's, Durga Puja is kept across six
  states and Diwali the country over; not one of them is a marker anywhere in particular,
  and anchoring them somewhere would have been a quiet assertion that they belong there.
  So `regional`: items carrying `regions` and no anchor, drawn nowhere, read in the
  lifted state's card with the month each usually falls in. Tapping one opens the
  ordinary item card, and they are in the search index like everything else. An item kept
  everywhere says `"regions": ["*"]` rather than listing thirty-six codes.
  With it, a `month` field type: an int the card renders as a month name, so the number
  stays in the data and the name comes from the interface in whichever language is on.
  The scrubber will want the same number.
  Thirty festivals went in on top of it, needing no engine change -- `grep -r festivals
  src/` is empty. Dates move from year to year, so the month is the one each usually
  falls in and the attribution says so; Eid al-Fitr carries no month at all, because it
  moves about eleven days earlier each year through every season, and naming one would be
  wrong rather than approximate.
- 2026-09-21, fifteenth round: the month scrubber.
  Thirteen switches under the layer menu, the whole year and each month, and everything
  with a month of its own narrows to it: the state card's list, the country sheet and
  what search can find. It shows itself only when something on show has months to scrub,
  which the layer's own declared fields say, so the shell still names no layer. The month
  rides in the URL with the rest of the view state.
  With no state lifted the sheet answers for the country -- "In October" lists Durga
  Puja, Navratri and Bathukamma with the states that keep each -- and with one lifted it
  is that state's own list. An item with no month is never scrubbed away and appears in
  every month's list rather than none: Eid moves about eleven days earlier each year
  through every season, so hiding it eleven months in twelve would be the wrong kind of
  tidy.
  The bug worth remembering: the scrubber cleared the month whenever nothing on show had
  months, which at startup -- before the catalogue has landed -- threw away a month the
  URL had asked for. Anything that clears state on a "nothing here" test has to know the
  difference between nothing and not yet.
- 2026-09-21, sixteenth round: languages, the second regional layer.
  The twenty-two of the Eighth Schedule and English, each with its name in its own
  script, its family, its first-language speakers from the 2011 census and a greeting to
  try. A state's card now reads Bengali বাংলা, Nepali नेपाली, Santali ᱥᱟᱱᱛᱟᱲᱤ.
  The rule is where a language is *official*, not where it is spoken, because the two
  are not the same and a map that blurred them would be making a claim. Sindhi is the one
  Eighth Schedule language with no state of its own in India, Sindh having gone to
  Pakistan in 1947, so it is listed where its speakers are concentrated and its own blurb
  says the rule is bent for it. English carries no speaker count: it is an associate
  official language of the Union rather than a census mother tongue for most who use it,
  and the optional-field path leaves the row out rather than printing a nought.
  One thing the layer asked for and got: a regional item's second line falls back from
  the month it falls in, which a festival has, to the name it calls itself by, which a
  language has. Whatever tells an item apart at a glance.
- 2026-09-21, seventeenth round: a change of direction, plan only, no code.
  The owner's vision is an online interactive atlas -- political and physical pages,
  minerals, industries and the rest, from many data sources -- and the UX comes first,
  because the handling has real faults and the look is still short of wow. Recorded as
  D11 (plates over layers), D12 (primitives first) and D13 (one camera rule), with D2
  amended to drop the yaw clamp. New in this file: "Camera handling" and "The missing
  wow" in section 3; "Primitives", "Base styles", "Plates" and "Source registry" in
  section 5; the candidate source table in section 7; the roadmap re-ordered from Phase 4
  on; open questions 8-11.
  The camera faults were read out of the code and one was reproduced in the browser: the
  mouse orbit pivots on the canvas centre rather than the point grabbed, so after a pan
  the model swings on an arm (grab the Odisha shore, drag right, it leaves the screen);
  `x`/`z` are never clamped, so the pivot can be carried off the model entirely; the pivot
  lies at sea level under terrain up to ~90 km high at relief 12, so tilting slides it;
  two-finger touch applies pan, zoom, twist and tilt in the same move, with the midpoint's
  vertical travel feeding both pan and pitch; and yaw stops at ±40°. None of it is fixed
  yet: F0-F8 are the next round.
  The owner answered four open questions on reading this: left-drag slides the map again
  and turning moves to the right button (8); the light stays with the viewer (9); the
  name stays (4 and 11); and the district boundary source is mine to find (10).
- 2026-09-21, eighteenth round: the camera fixes, F0 to F8, one commit each.
  `camera-math.js` was pure and nothing checked it, so the tests came first and every
  fix after them was written against something: 24 cases now, `npm test`, on node:test
  and node:assert, which are standard library and so add no dependency.
  The pivot is the fix the others hang off. A gesture now makes an *anchor* when it
  begins -- a scene point and the screen position it must keep -- and holds it until it
  ends, so whatever the hand has hold of does not move under it. `holdAnchor` is exact
  in one step rather than iterated, the camera being orthographic and the target only
  sliding in the ground plane. The point is a full 3D one, which matters more than it
  sounds: the surface is up to 96 km above sea level at the default exaggeration, and a
  pivot on the plane slides high ground across the screen as the view tilts. The engine
  supplies the point through a `grab` -> `pivot` handshake, the same shape as
  `tap` -> `selection`, so the UI still never calls the engine. Measured: turning and
  tilting about grabs at 0.8 and 5.3 km of lift, and ten wheel steps on a point 68 km
  up, all hold their point to 0.000 px.
  Two-finger touch got shorter as well as better: scale and angles, then one
  `holdAnchor` to the current midpoint, and the pan falls out of that. With a
  classifier in front of it -- undecided for twelve pixels, then tilt or map, latched
  until a finger lifts -- a sloppy pinch that used to wobble both yaw and pitch now only
  zooms.
  Yaw lost its clamp, which is what the owner asked for. Three consequences: flights
  unwrap to the short way round, the stored angle wraps into one turn, and the compass
  became load-bearing, so it brightens and says "Turn back to north" once the view is
  turned. Eight right-drags take the yaw right round and back to where it started.
  The key light was a constant in two shaders, the model's north-west, which was right
  while yaw was clamped and wrong the moment it was not: at south-up the relief was lit
  from below and read inverted. It is one uniform now, turned with the camera, and the
  home view is unchanged to the pixel.
  Two things added on the way that PLAN had not asked for. The camera target was never
  bounded at all -- twenty hard drags carried the view 12,227 km off the model -- and it
  now stops at about 1,300 km, against the units' own boxes. One box around India, and
  India's convex hull, were both tried first and both park the view on open water; the
  residual is written up against F2. And a release now glides, tau 130 ms, damped harder
  for turning than for sliding.
  One thing worth remembering for the next round of checks: the browser pane in this
  environment reports `document.hidden` and fires no animation frame, so anything on
  requestAnimationFrame -- the glide, the flow, the idle sway -- cannot be exercised
  there at all. Pure functions and end states can; motion needs a phone.
- 2026-09-21, nineteenth round: the look, items 1, 2 and 4 of "The missing wow", and the
  residual F2 left behind in the eighteenth.
  The model casts a shadow on the paper now, and stands on the page instead of being
  printed on it. It rises out of the page on a cold load, relief growing while the camera
  tips down from 84 degrees over a second and a half, once, and not at all for a link
  that asked for somewhere in particular. And the markers stopped being the thing you
  see: 17 tokens at the home view instead of about 40, scaled to three quarters and
  growing to full size as the camera comes in, springing up one after another.
  Three lessons, each of which cost a measurement:
  `uIndiaEdge` answers one question only, and close to the line. It is signed distance
  in a band 6.8 km wide, so both the shadow (85 km out) and the camera clamp (180 km
  out) got a saturated constant back from it, which looks like a bug in the caller. The
  shadow reads the ID raster instead; the clamp reads a coarse land mask built from it.
  Anything that animates the camera over the first second of a session has to hold
  `cameraTouched`, or the layout settling underneath it takes the flight over. The
  entrance looked like an animation that simply was not running; it was the shell's first
  padding write refitting mid-flight, and a fit keeps whatever angles it finds.
  And the fourth shape for "where the model is" was the first that is actually it. A box,
  a convex hull and the 36 units' boxes each park the view on open water, each for its own
  reason. The mask costs 4.7 KB and has none of those problems.
- 2026-09-21, twentieth round: Phase 5 begun with its smallest primitive, the categorical
  choropleth, and the zonal councils as the dataset that proves it. A layer says
  `"scale": "categorical"` and then declares `categories` the way a points or lines layer
  already does; values.csv keeps its `region,value` header and holds a category id.
  One lookup still serves both kinds -- the shader reads an index into the same eight
  colours either way and cannot tell them apart -- so the engine change is which list the
  colours come from, and the legend's is which fork it takes.
  The proving dataset is not the one this plan suggested. "States in pastel fills, no two
  neighbours alike" wants an adjacency graph the build does not have, and produces a
  legend of colours that mean nothing, which is not a legend. The zonal councils colour
  the same 36 units from a real source, so it is still the political map and the key is
  worth reading. Drafted, and wants review: values.csv has no per-row status, which is a
  gap in the choropleth type that did not matter while the only choropleth was arithmetic
  off the census and matters now that one carries a claim.
  Two things about this machine, both worth the next session knowing. numpy and pillow
  were not installed at all, so the pipeline could not run; `.venv/` is already
  git-ignored and a project venv is the setup the README's `requirements.txt` implies.
  And with numpy 2.5.3 and no pipeline change, `shade-2048.bin.gz` rebuilt 9 bytes
  different from the committed one -- see open question 12. Steps 4 and 5 were run alone
  and the terrain restored, so this round's data commit is the new layer and nothing else.

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

0. **Phase 4 is done bar the owner's eyes.** F0-F8 and "The missing wow" items 1, 2 and
   4 all shipped on 2026-09-21, one commit each; item 3 was the handling itself. What
   remains needs a phone and a person: judge the momentum, the entrance and the new
   marker density on the reference device, and give the verdict that is the Phase 0 exit
   criterion and has never been signed off. Items 5-8 of that list wait behind that
   verdict on purpose -- they are there to be picked from once 1-4 have been looked at,
   not done blind.
1. Phase 3 leftovers: food as content, drafted the way the festivals and languages were, and
   probably regional for the same reason -- a dish belongs to a region, and two states
   hold GI tags on the same sweet. Districts still need a district boundary source that
   meets the boundary rule in CLAUDE.md, which is a sourcing decision before it is code.
   The scrubber has no map expression yet -- it changes what the sheet says, not what the
   model shows -- which is worth a look once there is more dated content than festivals.
2. Roads and rail ship as drafts: read the eight highway and five railway cards and
   flip their `status` when they are right. The courses are the source's, so check the
   two Ladakh roads and NH 66 in particular, which run short where it is coarse or has
   a gap. Konkan, Kalka-Shimla and the Nilgiri Mountain Railway wait for a source with
   names in it.
3. Owner: `npm install && npm run dev`, open it on the reference phone (the dev server
   listens on the LAN), judge fps and the look. Knobs: `PALETTE` and `CURVE` in
   `src/engine/terrain.js`, the default camera and relief in `src/main.js`, the light
   and band edges in `src/engine/shaders/terrain.frag.glsl`.
4. Phase 1, remaining: review the drafted facts and places (flip `status`, then turn
   the drafts default off in `src/main.js`; the tour then visits reviewed places only),
   lazy hi-res state packages (needs open
   question 1: they are about 1 MB each, 36 MB in all, too much for git), districts in
   the state view, the poster image (needs open question 6), context-loss test on iOS,
   WebGL sprites for markers if the DOM ones ever get slow (they are fine at 50).
   Done on 2026-09-21: layer state in the URL, and the card carousel.
5. Settle open questions 6-7.
