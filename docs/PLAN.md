# Bharat Darshan (भारत दर्शन): implementation plan

An online interactive atlas of India on an isometric 3D model of the country. Like a
printed atlas it has pages -- political, physical, climate, minerals, industries,
transport, people, culture -- and unlike one, every page is the same model you can turn,
tilt, enter a state of, and tap for the facts. It grows by adding data: many sources,
many maps, a small fixed set of ways to draw them. Most users will be on phones; bigger
screens should use their full width.

Last updated: 2026-09-25 (seventieth round). Status and next steps are at the bottom of this file;
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
| D14 | One card, one stack: the sheet is the only surface, and the key is its strip | Decided 2026-09-23, replacing the three-things-three-places layout of 2026-09-22. That layout had three paper cards (menu, key, sheet) carrying three kinds of thing in the same material, a layer drawn three ways in three places with two different on/off controls, and a page's name in three places; on a phone with a page open there were seven screen elements, and the key stacked on the sheet read as one card with a broken header. Now: the atlas is a book, the map is the plate and the sheet is the margin. The sheet holds one stack, Contents › Page › State › Item, mirroring the URL (`/en/atlas/rivers/state/maharashtra`); the head shows the crumb and Back pops one level. The key is the sheet's *strip*, a second line of the head: one mark per layer drawn, a hidden layer greyed, the scale bar, and `+ layer`; tapping a mark unfolds that layer's legend, caveat and sources inside the head, so it stays visible on the state and item levels too. `+ layer` pushes the catalogue onto the same stack (relief, surroundings and graticule are its first group, Base). One control for on/off, a switch; the eye is gone. The chrome left on the map: the wordmark as text, and the compass. The other language, the tour, about and credits are rows at the foot of the contents. Nothing else is a card. |

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
- **F5. One gesture, one meaning on touch.** *Done.* Two fingers start undecided (panning and
  pinching). Both fingers moving the same way by similar amounts, mostly vertical, with
  the spread and the angle between them barely changing -> *tilt*, and only tilt. (Each
  finger's own travel is checked: a pinch with one finger still also moves the midpoint
  vertically, and was being taken for a tilt, which shut the zoom out.) Anything else ->
  *pinch/pan*, with twist joining only once the angle has moved 12° *and* each finger
  has swept 20 px of arc (close fingers wobble through many degrees), then latched. The mode holds until a finger lifts. This is
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
   *The cartouche and the scale bar shipped on 2026-09-22.* The cartouche carries the
   open page's section and title, stands down inside a state view, and is the way back to
   the contents from the map itself; the bar is a round 1/2/5 distance, exact along the
   screen's horizontal at any yaw or tilt, which is a property of the orthographic camera
   and the reason it is worth drawing (`src/ui/scale.js`, `test/scale.test.js`).
   The compass rose is **not** wanted: the compass control in the corner already turns
   with the model, says "turn back to north" once the view is off north, and is the way
   back; a second rose on the table would be decoration competing with a control.
   *The graticule shipped on 2026-09-22*, as furniture rather than content: as a layer
   every parallel would need a name, a blurb in two languages and a card nobody wants.
   `08_graticule.py` walks the parallels and meridians every 5 degrees, projects them and
   clips them to the board (the runtime has no projection code, D3); the engine draws the
   lot as one `LineSegments` of 54 hairlines, 1.8 KB over the wire, fetched the first time
   the switch is used. Meridians come out straight and parallels bowed, which is what a
   Lambert conformal conic does, and turning the model turns its grid with it -- the point
   of having it. It sits a quarter of a km above the paper and writes no depth: drawn
   after the terrain and left to the depth test, so the model hides its own lines and the
   grid shows on the table around it, and on the sea once Surroundings puts one there.
   With relief off the model is flat and the grid crosses it, which is what a flat map
   should look like.
7. **Miniature depth of field** on the high tier, already planned in "Layout".
8. **A warmer room.** A vignette and a slight warm-to-cool falloff across the paper from
   the light's side; the page is currently one flat cream.

Items 1-4 are the round to do first; 5-8 are there to be picked from once those are in
and looked at on the reference phone.

### Layout

*Reworked 2026-09-23 (D14): one card, one stack. The menu, the key card, the cartouche
and the corner buttons are gone; the sheet is the only surface. What follows is what is
built.*

Phone, portrait:

```
+------------------------+
| Bharat Darshan         |  text on the map, not a card
|                        |
|       3D canvas        |  full bleed, 100dvh, safe-area insets
|  (camera padded so the |
|  selection is centred  |
|   above the sheet)     |
|                    [N] |  the compass, the one control left on the map
+------------------------+
|          ----          |  the sheet: peek / half / full
| PHYSICAL · PAGE 4      |  the head: kicker or crumb, title, back
| Rivers            [<]  |
| [~][=][ABC][o] +layer  |  the strip: one mark per layer drawn, greyed when
|      2 layers · 500 km |  hidden, "+ layer", the scale bar as its foot
|------------------------|
| blurb · sources ·      |  the body: the level's own words and rows
| rows ...               |
+------------------------+
```

Desktop / tablet landscape:

```
+------------------------------------------------------------------+
| Bharat Darshan                                                   |
|                                                +-------------+   |
|                     3D canvas                  | Rivers › Phy |   |
|               (padded between the              | Maharashtra |   |
|                compass and the panel)          | [~][=] +lyr |   |
|                                                |  Rivers     |   |  a tapped mark:
|                                                |  - Snow-fed |   |  its legend unfolds
| [N]                                            | facts ...   |   |  under the strip
|                                                +-------------+   |
+------------------------------------------------------------------+
```

- **One stack.** The sheet's levels are the URL's: Contents (`/en`), Page
  (`/en/atlas/rivers`), State (`.../state/maharashtra`), Item (`?item=`), plus Layers,
  the catalogue, which `+ layer` pushes on top of whatever is open and which has no URL
  of its own. The head names the level (a kicker for a page, a crumb for anything inside
  one) and Back pops one level, never two.
- **The strip is the key.** One mark per layer drawn, in catalogue order, the page's own
  layers listed even when hidden (greyed) so they can be brought back; a tap on a mark
  opens that layer's legend under the strip -- its categories, bands, sizes or heights,
  its caveat, its sources and their year, and a switch -- and a second tap closes it. The
  scale bar sits at the strip's end. The strip belongs to the head, so it is on every
  level, and a reader inside a state card can still look a colour up.
- **The catalogue is a level.** Every layer as a row (mark, name, key in miniature,
  switch), grouped as the catalogue groups them, with a search field at the top; the
  first group, Base, holds relief (with its slider), surroundings and graticule, which are
  layers in all but name. Two fills fight over the clay, so switching one on switches the
  other off, by type (`FILL_TYPES`), never by id.
- **One control for on/off.** A switch, everywhere.
- **The rest of the chrome is text.** The wordmark is set into the paper top-left. The
  other language is a row at the foot of the contents ("हिन्दी में देखें" / "Read in
  English"): a first visit already arrives in the browser's language, and `/hi` links
  carry it, so the switch need not sit on the map (owner's call, 2026-09-23). The compass is the only button on the map; it
  brightens when the view is turned. The tour, about-this-map and credits are rows at
  the foot of the contents. The share card (`?poster=1`) still dresses the wordmark up.
- India is portrait-shaped, so wide screens have natural dead space either side of it:
  the sheet becomes a panel on the right and the camera padding keeps the country centred
  between the compass and the panel. On a phone the sheet's peek height is the padding.
- **A layer's mark** is a miniature of how it draws, made from its declared type and its
  own colours (`src/ui/legend.js`): a clay token with its glyph and the other categories'
  dots for points, three strokes for lines, a mosaic for a categorical fill, a ramp for a
  banded one, three columns for prisms, graded circles for symbols, "ABC" for a layer of
  names, a tagged card for a regional layer read in the state cards. The contents tile of
  a page is the mark of its first layer that draws a thing, on the page's base. Nothing in
  this reads a layer id (D5, D12).
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
- **Markers.** One clay set, in four kinds of thing: a peg with a glyph on its head for a
  place, a bead the size of a pinhead for a town, a counter sized by a value for a
  quantity, and a figurine for a thing made or grown -- low-poly, flat-shaded,
  vertex-coloured, lit by the same key light as the terrain, standing on it with a
  contact shadow, all of them instanced by the GPU. Nothing flat: a 2D sticker on a 3D model reads
  as a label, not as a thing on the model (decided 2026-09-22; the sticker icons were the
  first cut).
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
    plates/<id>.json one file per atlas page: base, layers, camera, words
    sources.json     every dataset once: publisher, licence, vintage, URL, use
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
- **`lines`**, **generated**: `"join": "generated"` and the layer fetches nothing; each
  item describes a line that is defined rather than surveyed -- `{"parallel": 23.43928}`
  or `{"meridian": 82.5}` -- and the build walks it across the grid's geographic box,
  then clips, simplifies and cards it exactly as a river. Walked, not drawn between its
  ends: a meridian is straight in a conic projection and comes out as two points, a
  parallel is not, so it is sampled every 0.05 degrees and the curve that survives is the
  projection's. A line that misses the box generates nothing and the build says so.
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

- **`symbols`**: a `points` layer that sets `marker: "symbol"` and declares
  `size: { field, domain, range, legend }`. Each item is a circle whose *area* is the
  value -- radius as the square root, so twice the value is twice the ink -- centred on
  the point rather than standing above it as a token does, carrying no glyph (a disc
  eleven pixels across is read by its area and nothing else), and not thinned by zoom:
  the comparison between one circle and the next is the reason the layer is on, so the
  reader gets the set and only collision thins it, biggest first. The menu draws two
  keys, the categories' colours and the sizes, the second using the engine's own sizer so
  each circle is exactly the diameter the map would draw.

- **`areas`**: named polygons that are not regions. The layer names a polygon source and
  joins it to curated items by name, exactly as a `lines` layer joins a river to its
  course, and an item may take several of the source's features (the Western Ghats are its
  WESTERN GHATS and Southern Ghats, which is how the chain runs past the Palghat gap).
  The build rasterises the lot into one uint8 id raster for the layer, clipped to India,
  and reports how much of each area falls inside -- a number the card then carries.
  Rasterising is what makes it cheap: an outline would have to be clipped to the coast as
  a polygon, which is far harder than clipping a line, and then triangulated to be filled.
  The drawing is the choropleth's, because they are the same drawing: clay tinted per
  pixel by an id, differing only in where the id comes from. So an areas layer reaches
  the shader as a categorical choropleth whose regions are its own areas, which is also
  why the two are one channel and only one fill shows at a time. Picking is the terrain's
  rather than a marker's, and an area answers before a state does.

- **`prisms`**: `values.csv` of `region,value` exactly as a choropleth's, plus a
  `height: { domain, km, legend }`. The terrain's vertex shader already reads the ID
  raster, so a prism is one more lookup there -- a 256-texel table of per-region heights
  -- and the ground steps up a region at a time. Linear, not square-rooted as a symbol's
  radius is: a circle is read by its area and a column by its height. Height is its own
  channel, so unlike two fills a prisms layer and a fill compose into a two-variable map.
  The lift happens on the GPU, so the CPU heightfield the picker marches against has to
  be told the same thing or every tap on a raised region lands on the ground beneath it.

- **`flows`**: not a type of its own but a third kind of generated geometry on `lines`.
  The layer sets `"arrows": true` and an item gives `{ from, to, bow }`; the build bends
  an arc between the two places and shapes the ribbon into an arrowhead with a per-vertex
  width multiplier, so the head picks, fades, animates and takes its colour exactly as a
  river does. Two things an arrow does not inherit from a river: it is never turned
  downstream against the heightmap, having been given its direction, and it is not
  clipped to India, because a monsoon arrow that stopped at the coast would tell the
  opposite of the story. The head is resampled rather than shaped over whatever vertices
  simplification left, or a long arc has none to shape.

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
| `choropleth`, districts | either of the above on the 16-bit district raster | anything the census publishes | built (`"regions": "districts-2011"`, numeric scales; the 2011 districts, see the fortieth round) | Census 2011 literacy (done) |
| `lines` | named courses, width by rank, colour by category, optional flow; joined to a source by `name`, by `route` (walking its graph) or by `corridor` (what runs along the way); optionally a finer copy per state, fetched when that state is lifted (`detail`) | rivers, roads, rail, waterways, pipelines, transmission | built | done; districts at two resolutions |
| `lines`, generated | geometry made by the build, not fetched | graticule, Tropic of Cancer, Standard Meridian, isohyets / isotherms from a raster | built (`"join": "generated"`) | reference lines (done) |
| `lines`, network | one item that is the *whole* of a source, drawn fine and unnamed under the routes that are named | the road and rail mesh, canals, transmission, pipelines | built (`"network": true` on an item; `"format": "districts"` for the district mesh) | roads and rail (done); district boundaries (done) |
| `points`, token / label | a marker or a name at a spot | places, summits, ranges, ports, airports, plants | built | done |
| `points`, dot | a clay bead the size of a pinhead, sized by a value, drawn by the GPU with only the names in HTML | every town, ports, stations, mines | built (`"marker": "dot"`) | every state's ten biggest towns, generated from GeoNames (done) |
| `points`, model | a figurine built from a recipe (`content/models/`), standing on the relief, instanced by the GPU | GI products, crops, crafts, animals, monuments | built (`"marker": "model"`) | GI tags (done) |
| `points`, generated | items made by the build from a source and merged with the curated ones | towns, stations, airports, plants by the hundred | built (`"source": { "format": "geonames" }`, `"districts"`) | cities (1,021 towns, done); district names (785, done) |
| `symbols` | a counter **sized by a value**, coloured by category, lying on the relief and drawn by the GPU | city populations, mines by output, power plants by MW, ports by cargo | built (`"marker": "symbol"`) | power stations by capacity and fuel (done) |
| `areas` | named polygons that are not regions, filled and draped on the relief, their edges reconstructed from the raster to sub-texel accuracy | coalfields, mineral belts, national parks and tiger reserves, river basins, physiographic divisions, soil and forest types, industrial regions | built (`type: "areas"`) | physical divisions (done); coalfields next |
| `raster` | a continuous field tinting the clay through a colour ramp | rainfall, temperature, forest cover, night lights, land use | new; one 8-bit texture per layer at the tier's resolution, same multiply-into-albedo as a choropleth | annual rainfall normals |
| `flows` | curved arrows between places, animated along their length, drawn over the model rather than on it | monsoon advance, migration, trade, pilgrimage circuits, freight | built (`"arrows": true` and `"float": true` on a `lines` layer; `"arc": true` lifts each arrow into the air) | the monsoon's advance (done); the History tours fly as arcs |
| `prisms` | a region extruded by a value -- the one drawing only a 3D atlas has | population, GDP, production by state | built (`type: "prisms"`) | 2011 population (done) |
| `regional` | listed on a state's card; drawn as a peg at its anchor when it has one (the place it is most seen at), and the build says which by shipping `anchored` | festivals, languages, food | built | done; festivals anchored 2026-09-22 |

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

*`physical` and `plain` shipped on 2026-09-22.* `plain` is two uniforms -- the clay colour
and how far it has faded in -- and one `mix` where the hypsometric colour used to be
assigned, so the light and the baked occlusion carry the whole of the relief. The base is
a property of the page: it arrives through the store like the layers do, crossfades over
420 ms when a page opens or closes, and the backdrop is told as well, or the neighbours
would stay banded while India went clay. Four pages ask for it: power, transport, culture
and people. On the people page it is the prism walls that gain the most -- a column of
population had been showing hypsometric rock up its sides.

`political` is **specified and not built**, and the build refuses a page that asks for it
rather than quietly drawing physical. The design, for when a page wants it: the colours
cannot be hashed from the state id, because a political map's one job is that neighbours
differ, so it wants an offline greedy colouring of the state adjacency graph (which the ID
raster already gives: any two neighbouring pixels with different non-zero ids are an edge)
emitted as a colour index per unit, then drawn through a second fill channel of its own so
that a page's choropleth still composes over it. It is maybe 150 lines, and nothing today
would use it: the one political page reads better as the zonal councils it already shows.
D12's rule applies to base styles too -- build it when a page needs it.

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
  Vite plugin that makes `/en` and `/hi` (*built 2026-09-22*): the plugin reads
  `plates.json`, so a new page brings its own shells with it, titled and described by the
  words the page already carries. Its card is the page itself, rendered in poster mode by
  `tools/share-image.mjs` -- the title block shows the page's title, the same title in the
  other language and its blurb -- and a page whose card has not been rendered yet falls
  back to the language card rather than pointing a link preview at a 404. State view
  composes: `/en/atlas/minerals/state/jharkhand`; those deeper paths are not shelled (the
  host serves the root shell for unknown paths), so a shared state link previews as the
  atlas rather than as that state.
- Sections (the contents page's headings, strings keyed by id like layer groups):
  political, physical, climate, resources, agriculture, industry and energy, transport,
  people, census by district, culture, history.
- The legend, the source line and the data's vintage come from the plate's layers, so a
  plate cannot show a map without saying where it came from and when.
- The build validates a plate the way it validates a layer: every layer it names exists,
  both languages present, only `reviewed` plates ship. `grep -r minerals src/` stays
  empty.
- Stories (Phase 4) become a plate with steps. *Built 2026-09-24 (forty-ninth round), in its
  smallest form:* a plate may carry `"tour": {"layer", "stops", "title"}` -- one of its own
  points layers and the ids to visit, in order. The tour then visits exactly those stops in
  that order instead of everything on show nearest-first, the card's prev/next walks the same
  route, and the page shows its own play button under `title`. `07_plates.py` checks the layer
  is the page's, is a points layer and has every stop. Captions are the stops' own cards; the
  route is an ordinary arrows layer on the same page. Per-step camera, text or layer changes
  are not built; nothing has needed them yet.

### Source registry

With dozens of datasets, attribution per layer stops scaling: the same census or the same
yearbook feeds ten layers. `content/sources.json` declares each source once -- id, title,
publisher, URL, licence, vintage, date retrieved, and a note saying what this atlas took
from it -- and layers and plates cite it by id. A plain URL stays legal as a citation on
one item, for a fact that has not earned an entry, but a layer must name at least one id:
a URL has no title, no licence and no year, so a page built on it could not say whose map
it is. *Built 2026-09-22.*

The registry's teeth are in `use`, which says what we do with a source and which the
build enforces (`pipeline/lib/sources.py`):

| `use` | Means | The build requires |
|-------|-------|--------------------|
| `data` | files or rasters derived from it ship | a licence that permits redistribution |
| `software` | it ships as code or a font | the same |
| `facts` | figures checked against it | a URL a reader can follow; a licence when one is stated |
| `blocked` | looked at, and not usable | that nothing cites it -- the build fails with the reason |

`blocked` is the part worth keeping: WorldClim and CHIRPS (open question 13) are in the
file with the reason they cannot be used and the way out, so the next person to reach for
them is stopped by the build rather than by memory. `facts` is the honest distinction the
project was already making informally -- a census figure in a card is a citation, not a
redistributed dataset -- and it keeps us from claiming a licence we have not read.

`public/data/sources.json` is the build's cut of the registry: only what the layers
actually cite, plus a `base` list for the sources that make the model itself rather than
one layer of it (boundaries, elevation, the vectors, three.js, the lettering). The credits
screen is generated from it, so it cannot credit a dataset the atlas does not use or miss
one it does; each legend shows the layer's sources and their year; and an open plate shows
the union of its layers'. `src/ui/credits.js` does the resolving and is pure, so
`test/credits.test.js` checks it both on a fixture and on the registry that ships.

One prose attribution is left, inside `public/data/regions/states.json`, where step 1
writes it as that file's own provenance line; nothing reads it on screen. Government of
India open data is mostly under GODL-India, which allows reuse with attribution; anything
else is checked before it is used, not after.

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

### District boundaries (open question 10: surveyed 2026-09-21, **taken 2026-09-22**)

**Decided.** `LGD_Districts` it is, read as the TopoJSON the catalogue publishes at
`docs/maps/data/districts.topo.json` (785 polygons, 2,622 shared arcs, 1 MB of plain
JSON, no parquet or pmtiles reader needed). The eight probes below were re-run against
it and all eight pass. What shipped is lines and labels, not a raster; the uint16
raster and district choropleths are still ahead. The licence caveat below is unchanged
and is recorded in `content/sources.json` in both languages, so a reader sees it.

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
(*done 2026-09-21, proven by the zonal councils*) -> generated lines (*done 2026-09-21,
proven by the Tropic of Cancer and the Standard Meridian*) -> `symbols` (*done
2026-09-21, proven by 24 power stations*) -> `areas` (*done 2026-09-21, proven by 16
physical divisions*) -> `prisms` (*done 2026-09-21, proven by the 2011 population*) ->
`flows` (*done 2026-09-21, proven by the monsoon's advance*). Only `raster` is left, and
it is **blocked on licensing**: see open question 13. Base styles and the year
scrubber land with the first primitive that needs them. District choropleths join when
open question 10 has an answer. Exit: a mineral map, a rainfall map and a political map
exist, and `src/` names none of them.

**Phase 6: the atlas shell (1-2 weeks).** Plates, the contents page, `/atlas/<id>` URLs
with share images, the source registry and generated credits, the cartouche, scale bar
and legend as atlas furniture. Exit: a plate added with a JSON file only, and the first
ten plates -- one or two per section -- reading as an atlas rather than a demo.
*Begun 2026-09-21: plates, the contents page and `/atlas/<id>` are in, with nine pages
across seven sections; `grep -r plate src/engine/` is empty and a page is a JSON file.
The source registry followed on 2026-09-22: every dataset declared once, cited by id,
enforced by the build, with the credits screen and every source line generated from it.
Then the share shells, the same day: 18 Open Graph shells generated from `plates.json`,
and poster mode now renders a page's own card. The card images themselves need a
Playwright run (`node tools/share-image.mjs`) and until then each page's shell points at
its language card. The cartouche, the scale bar and the graticule followed the same day,
which is the furniture done, and the `plain` base style after them. What is left of the
phase is not code: the tenth page landed the same day, as minerals, which opened the
resources section and met the exit -- ten pages across eight sections, every one of them a
JSON file. Agriculture and history are still empty, and the 20 card images still want a
Playwright run.*

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
13. **Climate data, and the `raster` primitive it is meant to prove.** Blocked on
    licensing, not on code. Checked on 2026-09-21:
    - **WorldClim 2.1** (the obvious choice, 10 arc-minute annual precipitation, a 2 MB
      zip that downloads cleanly) says on its own about page: *"The data are freely
      available for academic use and other non-commercial use. Redistribution or
      commercial use is not allowed without prior permission."* This project publishes
      derived rasters in `public/data/` on a public site, which is redistribution. Out,
      unless permission is asked for and given.
    - **CHIRPS** (UCSB Climate Hazards Center, long-term annual means as GeoTIFF, the
      right shape for this) states **no licence at all** in its README -- only a citation.
      It is widely described as public domain, being a USGS Data Series product, but
      "widely described as" is exactly what open question 10 got caught by.
    So: ask WorldClim for permission, find the primary statement that puts CHIRPS in the
    public domain, or use an IMD product and deal with its registration. Until one of
    those, `raster` has the engine work but no dataset it may ship, and D12 says a
    primitive is not built until one real dataset proves it. `prisms` was built first for
    this reason -- its data was already in the repository.
    There is a second, smaller question behind it: nothing in the pipeline reads GeoTIFF,
    and doing it with pillow alone wants checking before a dataset is chosen on the
    assumption that it can be read.
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
- 2026-09-21, twenty-first round: the second primitive, generated lines, proven by the
  Tropic of Cancer and the Indian Standard Meridian. A layer writes `"join": "generated"`
  and fetches nothing -- the first layer in the project with nothing in `pipeline/raw/` --
  and each item describes its own line. Everything after that is the path the rivers
  already take.
  Two things the doing taught. A generated line has to be *walked* rather than drawn
  between its two ends: a meridian is straight in a conic projection and comes out as two
  points, but a parallel is not except at the standard parallels, so the arc has to be
  sampled finely enough that what survives the simplify is the projection's curve and not
  the sampling's. And a reference line has to be read against the ground it crosses: the
  first pair of colours were a warm grey that vanished into the clay at every zoom.
  One thing left alone, and worth knowing before it bites again: a `lines` layer whose
  `layer.json` fails validation falls through to the per-item *points* validation, so the
  problems reported are about anchors and priorities that a line has never had. It is
  pre-existing and only shows up while a layer file is being written, but it sends you
  looking in the wrong place.
- 2026-09-21, twenty-second round: the third primitive, `symbols`, proven by 24 of
  India's largest power stations. A circle whose area is a value, which is the drawing an
  atlas uses for anything that has a quantity as well as a place.
  Three assumptions the pin-shaped token had quietly made, each of which had to be undone
  for a symbol: it stands *above* its point rather than on it, so the collision rectangle
  was wrong; it carries a glyph, which at eleven pixels is unreadable; and it is thinned
  by zoom, which for a symbols layer throws away the comparison the layer exists to make.
  The last one also needed the build to write a symbols layer biggest first, so that the
  collision pass keeps the circles that matter.
  The dataset is curated rather than fetched, against what this plan said. A points layer
  supplies its own anchors, its own names in two languages and its own blurbs, and the
  WRI database named in section 7 has none of those in a usable form; what it would have
  saved is capacities, which are a column. Each item's `regions` was resolved from its
  own anchor against the ID raster rather than typed, because Bhakra and Srisailam both
  sit on a border and I would have got one of them wrong.
  The note on that layer is the kind an atlas has to carry: installed capacity is what a
  station *could* produce, not what it does, and the ratio differs by fuel -- about a
  fifth for solar against two thirds for coal -- so the biggest circle is not the most
  electricity. Sizing circles by capacity without saying that would be quietly wrong.
- 2026-09-21, twenty-third round: the fourth primitive, `areas`, proven by 16 of India's
  physical divisions off Natural Earth's public-domain physical regions.
  The thing worth recording is that it needed almost no new drawing. A choropleth and an
  areas layer are the same picture -- clay tinted per pixel by an id -- and differ only in
  where the id comes from, so an areas layer reaches the shader as a categorical
  choropleth whose regions are its own areas, and the shader gained one branch. What it
  did need was a pipeline stage: rasterise the joined polygons into one uint8 raster and
  clip it to India. Keeping outlines instead would have meant clipping polygons to the
  coast, which is a far harder problem than clipping a line, and then triangulating them.
  7 KB for the sixteen.
  One bug it turned up, of a kind worth watching for: the "only one fill at a time" rule
  was written twice, in the engine and in the shell, and the shell's copy tested for
  `choropleth` by name. So an areas layer and a choropleth could both be switched on, the
  engine drew one and the chips showed two. The list of fill types is shared now.
  And a note about honesty in a map: physical divisions have no surveyed borders. A
  plateau fades into a plain over tens of kilometres, textbooks draw the line
  differently, and these are generalised outlines. Filling them edge to edge without
  saying so would claim a precision that does not exist, so the layer's note says it.
- 2026-09-21, twenty-fourth round: `prisms`, out of order, because `raster` is blocked on
  licensing rather than on code. WorldClim forbids redistribution in as many words and
  CHIRPS states no licence at all; both are written up as open question 13, and neither
  may ship on an assumption -- which is the lesson open question 10 already paid for.
  `prisms` needed no download: the 2011 populations were already in
  `content/states/states.json`, and values.csv is generated from them so the columns and
  the state cards cannot read different censuses.
  Cheaper than expected. PLAN assumed the block extruder would do the work; the terrain's
  *vertex* shader already reads the ID raster, so a prism is one more lookup there and 36
  extruded meshes were never needed. The mesh ramps across a boundary rather than
  cliffing, one cell wide, which is under a pixel at the home view.
  The part that needed care was picking, and it is a general lesson: anything that moves
  geometry in a shader has to be told to the CPU heightfield as well, or every tap lands
  on the surface as it was before. pickTerrain and projectGround take the lift now, and
  the ray starts above the tallest column rather than inside it.
  And two population maps now exist that look alike and say different things -- density
  colours a state by how crowded it is, prisms raise it by how many people live there,
  and Delhi is the extreme of one and invisible in the other. Both notes say which.
- 2026-09-21, twenty-fifth round: `flows`, proven by the monsoon's advance, and with it
  every primitive of Phase 5 except `raster`, which is blocked on licensing rather than
  on code (open question 13).
  It turned out not to be a type at all: a `lines` layer with `"arrows": true` and a
  third kind of generated geometry. The head is the existing ribbon widened by a
  per-vertex multiplier, so it picks, fades, animates and colours like a river for free.
  Three faults, and all three were the primitive inheriting something right for rivers.
  The head needs vertices of its own, because simplification leaves a 2,200 km arc nine
  points and one of them inside the last ninety km -- a width profile over the survivors
  produced no head at all. `flow: true` also turns a run downstream against the
  heightmap, which is right for water whose direction the source does not carry and had
  the monsoon arriving from Kerala into the Arabian Sea. And everything is clipped to
  India, which would have stopped the arrows at the coast and told the opposite of the
  story they are for.
  Worth remembering as a shape of bug: each of those was a default that had been correct
  every previous time it ran.
- 2026-09-21, twenty-sixth round: Phase 6 begun. The layers became pages: nine plates
  across seven sections, a contents page in the sheet, and `/en/atlas/<id>` with a state
  view nesting inside it. A plate is a preset and nothing more, so opening one writes the
  store keys a URL already writes; `grep -r plate src/engine/` is empty.
  The interesting part was the query string. A page says which layers it wants, so the
  baseline for `?layers` and `?relief` is the open plate's rather than the catalogue's
  defaults, and `/en/atlas/rivers` stays that short. The same idea bit twice going the
  other way: a URL with no `?layers` means "whatever this page asks for", not "leave them
  as they are", and until popstate was told so, backing out of a page left its layers
  drawn over the contents and turned `/en` into `/en?layers=monsoon,physiography`. Relief
  had the identical fault one field over.
  Two of the pages exist only because the primitives compose: population as height with
  density as colour, and the monsoon's arrows over the physical divisions. Neither needed
  any new drawing, which is what D12 was for.
- 2026-09-22, twenty-seventh round: the source registry. Twenty-two datasets declared
  once in `content/sources.json` with publisher, URL, licence, what we do with it and a
  note on what this atlas took; fifteen layers and two plates cite them by id; and the
  credits screen, every legend's source line and every page's source line are generated
  from the build's cut of it. The five hand-written credit strings are gone from `i18n`.
  The part worth keeping is `use`. A source whose files ship needs a licence that permits
  redistribution, a source we only check figures against needs a URL and no more, and a
  source marked `blocked` fails the build for anything that cites it, printing the reason.
  WorldClim and CHIRPS are in the file as blocked, so open question 13's two refusals are
  now enforced rather than remembered: `layer.sources: source 'worldclim' may not be used.
  Its terms say redistribution or commercial use is not allowed...`. That distinction also
  keeps the file honest -- census figures are cited, not redistributed, so nothing claims
  a licence that was never read.
  Two rules earned themselves during the round. A layer must cite at least one registry
  id, not only a URL: the power layer briefly reverted to its plain URL, passed validation
  because URLs are legal, and left the power page with nothing to name -- a URL has no
  title, licence or year. And the vintage is dropped when the title already carries it,
  which is what "Census of India 2011, 2011" asked for. Per-layer `attribution` prose
  stopped shipping to the runtime: it was never on screen, and two places saying who to
  credit is the sprawl the registry exists to stop.

- 2026-09-22, twenty-eighth round: a page of the atlas now shares as itself. The Vite
  plugin reads `plates.json` and emits a shell per page per language -- 18 of them, with
  the page's title, its blurb as the description, its own canonical and hreflang pair, and
  a share card -- so adding a page still means adding one JSON file. Poster mode learned
  the same trick: with a page open the title block becomes the page's, the atlas's name
  shrinking to a kicker above it, which is what `tools/share-image.mjs` photographs.
  The plugin's head rewriting moved from swapping the English strings it found to
  replacing tags by name, which is what let a page's metadata be set the same way a
  language's is; the two language shells came out byte-identical afterwards, which was the
  point of checking.
  Two things worth keeping. A page whose card has not been rendered points at its language
  card rather than at a 404, so the shells are useful before the images exist -- and they
  do not exist yet: no Playwright on this machine, and it is a tool, not a dependency.
  I verified the other half instead, which is the half that could be wrong: all 18 poster
  routes were loaded in sequence and each reached `ready` with the right page open and the
  page's own words in the block. And the kicker's small caps are scoped to the Latin name,
  because the Devanagari one is never letter-spaced or uppercased; that meant two spans
  rather than one string.

- 2026-09-22, twenty-ninth round: two pieces of atlas furniture. The cartouche puts the
  open page's section and title on the map, which is the only place the page is named when
  the sheet is down, and tapping it is the way back to the contents without opening the
  sheet first; it stands down inside a state view, where the sheet belongs to the state.
  The scale bar is the one an orthographic camera can draw honestly: a pixel across the
  screen is the same number of kilometres everywhere in the view at any yaw, and tilting
  compresses only the vertical axis, so the bar is true rather than indicative. Measured
  it: yaw 137 and pitch 34 left the bar unchanged to a tenth of a pixel. The 1/2/5 choice
  is pure and tested across every zoom and viewport the app allows -- always a round
  number, always inside its box, never shorter than a third of it.
  One bug, caught by loading the page rather than by reading it: `scaleSpan` was a `const`
  arrow declared after the camera subscriber that calls it, and `{ immediate: true }` runs
  that subscriber at once, so the app died on the temporal dead zone before the first
  frame. A function declaration hoists; a const does not.
  The compass rose on the list is ruled out rather than built, and the graticule is now
  specified as furniture rather than as a layer -- reasons in section 3, item 6.

- 2026-09-22, thirtieth round: the graticule, and with it the furniture is done. Twelve
  lines every 5 degrees, walked across the projection by `08_graticule.py`, clipped to the
  board and shipped as 1.8 KB the engine fetches the first time the switch is used. What
  it draws is the projection itself: the meridians come out straight, the parallels bowed,
  and the grid turns with the model, which was the argument for having it.
  The depth behaviour took three goes and is the whole of the work. `renderOrder = -1`
  with no depth write hid the grid everywhere, because the terrain is transparent too and
  simply painted over it afterwards. Letting the pass order alone hid it under the sea the
  moment Surroundings was switched on. What is right is the pattern the line layers
  already use: drawn after the terrain, writing no depth, and placed by the depth test --
  a quarter of a km above the paper, which is above the sea sheet and far below any land,
  so the model hides its own lines and the table keeps them. Checked in all four states:
  cut-out, surroundings, relief off (the grid crosses the flat model, as a flat map's
  should) and the state view (nothing to say at 200 km, and nothing wrong either).

- 2026-09-22, thirty-first round: the `plain` base style, which is what the thematic pages
  had been waiting for. Two uniforms and one `mix` where the hypsometric colour used to be
  assigned: the bands give way to one warm clay and the light and baked occlusion carry
  the relief by themselves, which is what a clay model looks like before anyone paints
  heights onto it. It crossfades over 420 ms as a page opens or closes, and the backdrop
  is told too, or the neighbours would stay banded while India went clay.
  The colour took five tries in the browser, which is the only way to pick one: the light
  and the grain take about a third of the value out, so the first honest-looking clay
  (`#c9b8a0`) came out mushroom grey on screen. `#e8cb9c` is warm at the value the shader
  leaves it at, and it holds the orange of a highway and the blue of a railway against it.
  Four pages ask for it -- power, transport, culture, people -- and the people page gains
  the most, because a column of population had been showing hypsometric rock up its sides.
  `political` is specified in section 5 and not built: a political map's one job is that
  neighbours differ, which needs an offline colouring of the adjacency graph rather than a
  hash, and no page today would use it. The build refuses a page that asks for it, so
  nobody ships one that silently comes out physical.

- 2026-09-22, thirty-second round: the tenth page, and the resources section opened.
  `minerals`, 22 fields, belts and mining districts in eleven commodities, which is the
  plan's own worked example of a plate finally built. Everything it needed already
  existed: a `points` layer with tokens, the registry (one new entry, the Indian Minerals
  Yearbook), the plain base, the cartouche, the source line. The only code was one glyph.
  Content discipline held in two places. The anchors are checked against the ID raster, as
  every points layer's are, and it caught exactly one: Singrauli at 24.11N 82.67E is on the
  Uttar Pradesh side of a field that straddles the border, so the item now claims both
  states, which is what its blurb already said. And the Wikipedia titles were verified
  against the API before being written down -- four I would have guessed were wrong
  (`Joda, Odisha`, `Hutti Gold Mines`, `Rampura Agucha mine`, `Panchpatmali` are missing
  or redirects), and a citation that 404s is worse than no citation. Every item ships
  `draft` and wants the owner's reading.
  Also: the layer groups gained `resources` ("Rocks and mining"), which is a string and no
  code, and is the first of the headings the sections were meant to settle.

- 2026-09-22, thirty-third round: Phase 7's first page, and the one the atlas was most
  obviously missing: cities. The thirty largest municipal corporations at the 2011 census,
  each circle's area carrying its population, coloured by whether the place is a capital --
  which is the fact the sizes cannot tell you, and it turns out ten of the thirty are.
  The data came from Wikipedia's tabulation of the census, fetched rather than remembered,
  and all thirty anchors passed the ID-raster check first time. Two corrections while
  drafting: the page's blurb had said Mumbai's circle was four times Patna's, which was
  wrong twice over (the ratio is about seven, and it is the area that carries it, not the
  width); and each item had cited two Wikipedia pages, which the card renders by host, so
  it read as one source twice -- the second citation is now the census itself.
  I looked at the two empty sections before choosing this one, and Next records why both
  are harder than they look. The short version: a crop map's values would be claims rather
  than published numbers, and a history layer would restate 20-odd places the `places`
  layer already holds. Cities restates nothing.

- 2026-09-22, thirty-fourth round: iron and steel, which is the page the minerals one was
  asking for: fourteen works, eleven of them inland between the Jharkhand coal and the
  Odisha and Chhattisgarh ore, three on the coast importing what they melt. The
  categories carry that distinction and the inland ones take the same rust colour the
  minerals page gives iron ore, so the two pages read as one argument.
  The round's finding is about composition, and it cost a page layout to learn. The plate
  first named `["steel", "minerals"]`, on the reasoning that the coal and the ore explain
  the plants -- and the map said no: 36 tokens on one screen, and the mineral gems sitting
  on top of the works the page is about. **Primitives compose across channels, not within
  one.** Population as height under density as colour works because they are two channels;
  arrows over areas works for the same reason; two token layers are one channel and fight
  over the same paper. The page now names its own layer and the blurb points at the other,
  which is what prose is for.
  Also: `power` was filed under "Roads and rail" and `steel` would have gone under "Rocks
  and mining". Both are now "Works and power", which is one more of the group headings the
  sections were meant to settle -- strings, no code.

- 2026-09-22, the UI round. The owner's verdict on the shell as it stood: the menu's
  buttons were big and said nothing about what they switched, and the sheet was a dumping
  ground. Three things now have three places (section 3, "Layout"): the **key** is on the
  map, bottom-left beside the compass with the scale bar as its foot, one row per layer
  drawn with an eye to hide it; the **menu** is a compact view strip and then every layer
  as a row with a mark, its key in miniature and a switch; the **sheet** is the subject --
  contents with a tile per page, the open page with its words and "On this page" rows, a
  state's card, an item's card -- with one search field and the 36 units behind a fold.
  `src/ui/legend.js` holds the marks and the keys, all read off a layer's type and colours;
  `shell.js` lost its chip rendering and gained one `renderSheet` that decides what the
  head says and which blocks show, so the body is never two answers at once. Things
  learned: on a phone the key must start folded (open, it covered the model's south) and
  open itself when a page is turned to, including by link -- which the plate subscription
  never sees, since a linked page is set before the store has subscribers; on a wide
  screen the open key pads the camera on the left as the panel does on the right, and the
  model grows back when it folds. The Relief page's tile wanted the summits, not the
  ranges: a layer of names previews nothing, so the tile takes the first layer that draws
  a thing. A typed search clears when the subject changes, or the results rule would hide
  the new card. Sizes after: app JS 47 KB gzipped, CSS 7 KB; `npm test` passes; checked in
  Chromium at 375 x 812 and 1280 x 800 in both languages. Not yet looked at on the
  reference phone.

- 2026-09-22, the overlay round. The owner's brief: the clay tokens are good but take
  room; festivals were listed and never drawn, and everything should be drawn; every
  state's ten biggest towns, at a small footprint; and real 3D objects as markers, for a
  GI-tagged layer to begin with, without much bandwidth or compute. What was done:
  - **Tokens shrank** a fifth (26/22/19 px by priority, 0.62 at the home view).
  - **Regional items may carry an anchor**, the one place they are most seen at (Onam at
    Thrissur, the Hornbill at Kisama, Diwali at Ayodhya); the build checks it falls in one
    of the item's regions, and the engine draws such items as tokens through the points
    type while the state cards go on listing them. All 30 festivals have one.
  - **Beads** (`marker: "dot"`) for the towns: a low-poly sphere instanced by the GPU, sized
    by population through the same sizer as symbols, standing on the terrain by sampling
    the heightmap in the vertex shader (so it rides the relief, the lifted block and a
    prisms layer with nothing done per frame), with a soft instanced shadow disc under it.
    HTML carries only the names, set beside the beads in small halo type, thinned by
    priority and collision; picking projects the anchors, since a bead has no element.
    The cities layer is now **generated**: `source.format: "geonames"` takes GeoNames'
    towns, places each by the ID raster, keeps a candidate only when Wikidata has it, has
    it as a town rather than a district filed under a town's name, and has its Hindi
    name, takes Wikidata's population where it has one, then the ten biggest per state,
    with the thirty curated cities laid over them. 249 towns; a rebuild reuses the cached
    Wikidata answer. Two registry entries (GeoNames CC BY 4.0, Wikidata CC0).
  - **Figurines** (`marker: "model"`): a recipe under `content/models/<name>.json` is a
    few primitives -- sphere, cylinder, cone, box, torus, lathe, extrude -- each placed,
    turned, scaled and coloured, that `src/engine/models.js` builds into one flat-shaded,
    vertex-coloured geometry; a part marked `tint` takes the item's colour, so one saree
    serves four silks. Twenty-two recipes at 200-1,200 bytes each, the mesh made on the
    device; instanced per kind, lit by the terrain's key light. This was the design
    question in the brief, and the reasons for recipes over authored models: no download
    and no loader (GLTFLoader would be 9 KB and a format nobody edits by hand), no licence
    to clear, one clay look by construction, and a new thing is a JSON file. A glTF
    `shape: "mesh"` can be added to the same recipe format the day something needs it.
  - **The GI-tags page**, 36 registered products with figurines, journal years from the
    registry's list, drafted and awaiting review.
  Learned: the marker's height for picking comes from the built geometry, not the recipe;
  the shadow disc must share the instance buffers or it drifts from what it shadows; and a
  scaled-down screenshot catches tokens mid pop-in and shows their shadows alone, which
  looked like a rendering bug and was not. Not yet looked at on the reference phone.

- 2026-09-22, the second look at the overlays. The owner's notes, and what each turned
  out to be:
  - *The GI objects look very dark.* A colour-space slip: every three.js colour is linear,
    and the mark shader wrote it out as it was, where the terrain and the lines convert
    with `linearToOutputTexel` on the way out. One line, and a little more fill light.
  - *The clay marker still needs improvement.* The tokens were the one flat thing left on
    the model: a DOM sticker with a gradient, beside figurines that are lit and stand.
    Now a token is a **peg** -- a pale clay post and a head in the category's colour,
    drawn by the same instanced path as the beads and figurines -- with the category's
    glyph as a **decal** on the head: a quad in the camera's own frame on the near side
    of the sphere, cut from an atlas the device rasterises once from `src/glyphs.js`, so
    the glyph is read square-on at every yaw and tilt while the head stays a lit sphere.
    They spring up one after another as before, now in the vertex shader (`iBorn` and a
    time uniform; the engine keeps drawing until the last one has landed). HTML keeps
    only the name tags. `points.js` draws nothing itself now but symbols and range names.
  - *Reference lines are cut off by relief.* They were laid on the surface, where every
    hill in front of them hid them, which is correct for a river and wrong for the Tropic
    of Cancer. A lines layer may now `"float": true`: a wire stretched above the model at
    the height of a 1,500 m hill, draped only where the land stands higher, rising and
    falling with the exaggeration. The tropic and the standard meridian float.
  - *Show surroundings and the graticule by default.* Done. The backdrop was 1.5 MB, so
    it is rebuilt at 640 px (471 KB; it is scenery, and its mesh was coarser than its
    raster anyway) and fetched only after the first frame is on screen, so the first
    view's budget still holds. What shows at a wide desktop fit deserves a word: the plate
    reads as a softly edged rectangle on the backdrop. That is not a bug -- the open sea
    matches across the join to two levels in 255 -- it is the plate's coastal shadow and
    baked occlusion against a backdrop that has neither, and the backdrop ending as a
    pool 2,600-4,300 km out. Worth a look on the reference phone before deciding whether
    the backdrop should carry a coast band of its own.
  - *No month filter for festivals in the legend.* The scrubber is gone from the menu, and
    the month panel from the sheet. `?month=` still narrows what is drawn and listed, for
    a link that asks, but nothing in the UI sets it.
  - *A search for the setting to change.* The menu opens with a field that narrows the
    layers and the view's switches to those whose names, keys or group headings match, in
    the language showing; on a fine pointer it takes focus as the menu opens.
  Also: the default layers land before the first tier does, so they were handed to the
  DOM before the GPU marker module existed; the engine now hands them over once it is.
  Sizes after: app JS 53 KB gzipped, three.js 142 KB.

- 2026-09-22, the counters. The last DOM markers were the proportional circles of a
  `symbols` layer -- flat discs with a CSS highlight, beside figurines that are lit and
  stand -- so they join the instanced path as clay counters: a shallow dome lying on the
  relief, sized by the same sizer as before (a layer's declared diameter is halved on the
  way in, a counter and a bead both being radius 1), with the pale collar a cartographer
  draws round a proportional circle so two that overlap still read as two. A flat top
  would not do: a cylinder's face and its rim meet the wrapped light at nearly the same
  angle, so the first cut read as a blot. `points.js` now draws nothing at all -- every
  marker is the GPU's, and what is left of a marker element is its name -- which took the
  DOM token, its contact shadow and its pop animation out of the stylesheet with it.
  Three things this turned up, each worth more than the change that found them:
  - **A lathe is wound in the order of its profile.** The counter's was written from the
    top down, which turned the surface inside out: front-face culling hid the dome and
    showed the collar through it. `test/models.test.js` now measures, for every recipe,
    the area-weighted lean of its faces away from its own centre, which is negative
    exactly when a part is inside out. It reproduced the bug before the fix.
  - **A marker must stand on the surface the mesh draws, not on the raster it samples.**
    The mesh lifts its own vertices and the rasteriser interpolates between them, so
    between two vertices the drawn ground sits above the height at a point in the middle
    -- on the phone's coarse grid by more than a counter lying flat on it is tall, and
    all but two of them were buried. The marker shader now lifts the four corners of the
    grid cell and mixes them, which is what the mesh itself does. Pegs and figurines
    never showed it because they stand a hundred km up.
  - **A regression from the round before:** beads and figurines were not restricted to
    the lifted state, which the DOM markers had always been, so a state view kept the
    whole country's towns. Every GPU marker now belongs to the state it is in.
  Also, a scaled-down screenshot loses small markers entirely: two rounds running, a
  0.6-scale capture showed two counters where a full-resolution one showed all
  twenty-four. Check the marker work at full size.

- 2026-09-22, two overlays that were being cut up by the relief.
  - **The `areas` fill was a staircase.** The layer ships one area id per texel and the
    shader read it NEAREST, so past the raster's own pitch -- 3.4 km, which a 700 km view
    crosses in four pixels -- every edge stepped along the texel grid. It is now
    reconstructed: bilinear weights over the four texels around the pixel give each
    candidate area a coverage, the contour where a coverage passes a half is a smooth
    curve through the grid rather than along its steps, and `fwidth` holds that crossing
    to about a screen pixel so the edge stays crisp instead of softening as the texels
    grow. It is the trick a distance-field glyph is drawn with, on a field the build
    already ships, so it costs no bytes and no rebuild. Checked down to a 200 km view,
    where a texel is twelve pixels and the edge is still a clean curve. The branch is on
    a uniform, not a ternary, so a page without an `areas` layer does not pay for the
    four samples. A choropleth keeps the old single lookup: its edges are the state
    borders, which the shader already draws as crisp lines from their distance fields.
  - **`float` on a lines layer now means "the model never hides it".** The first cut
    raised a floating line to the height of a 1,500 m hill, which was enough for the
    Tropic of Cancer and nothing else: the monsoon's arrows cross the Western Ghats and
    the north-eastern hills, and at a 1,400 km view they were sawn into fragments. The
    height trick cannot hold -- something taller always comes along -- so a floating line
    keeps following the relief, which is what keeps it over the ground it marks on a
    tilted view, and simply turns its depth test off. The monsoon's arrows float now, and
    so the two reference lines are drawn under the same rule rather than a raised one.
  Also checked, since both changes touch what a tap lands on: an `areas` layer still
  picks by its own raster, and the reconstruction moves a drawn edge by less than half a
  texel from the one picking uses.

- 2026-09-22, the rivers, the roads and the languages.
  - **Rivers and roads were sinking into their own valleys on every device but a good
    desktop.** The question was whether they had the reference lines' problem; they did
    not -- they have the markers' one. A line was laid at the height the heightmap gives
    at its own vertices, while the mesh draws the bilinear surface through *its* grid,
    and in a valley -- which is where a river is, and where a road follows it -- that
    drawn surface sits above the point itself. Measured off the data: at the low tier's
    256 grid **49% of river vertices and 33% of road vertices are buried**, median 0.45 km
    and worst 15 km; at 512, 26% and 18%; at the high tier's 1024 the grid is the raster
    and it is nothing. The line shader now samples the four corners of the mesh cell and
    mixes them, as the marker shader does. Measured in the browser at the low tier, a
    900 km view: 22% more river ink in the Himalaya, 10% on the Ganges plain, 2.5% over
    the Deccan, and no change at all on the high tier. What is left after that is genuine
    occlusion -- a ridge standing between the eye and the water -- which is 3% at the home
    view and is the depth cue that makes the thing read as a model, so it stays.
  - **`?quality=` had been dead since the URL learned to write itself.** The tier override
    is how CLAUDE.md says to test on the reference phone, but `buildUrl` composes the
    query from view state alone, so the first write dropped it, and `pickQuality` -- which
    reads `location.search` afterwards -- never saw it. `?poster=` was going the same way.
    Both now pass through. This is why the low tier had never been looked at in a browser.
  - **Languages drew nothing.** The layer is `regional`, so it was a list in the state
    cards and no ink. It now has a companion: `language-families`, a categorical
    choropleth colouring each state by the family its people mostly speak as a first
    language at the 2011 census. Deliberately not the *official* language, which was the
    first thing tried and makes a bad map: Nagaland, Mizoram, Meghalaya and Arunachal are
    governed in English, so a quarter of the north-east came out "Other" when what is
    spoken there is Naga, Mizo, Khasi and Nyishi. The layer's note says exactly that. The
    culture page carries it, and drops `places`: with festivals anchored it had become two
    token layers fighting over the same paper, which is the composition rule's own case.
  - **The key was offering colours that are nowhere on the map.** A `regional` layer with
    no anchors draws nothing, but the key showed its categories as swatches all the same.
    The build now ships `anchored` on a regional layer, the key reads the unanchored ones
    as what they are ("Read in each state's card"), and an anchored one reads as the peg
    layer it has become.
  - **Nothing said how to get back to the contents.** Turning to a page left only an
    arrow in the sheet's head, which does not say where it goes. The page's block opens
    with "All pages" in words again, as the first design had it.
- 2026-09-22, the pre-publish pass: the owner is about to put it up, review to follow.
  - **The phone's whole-country view named two states.** Odisha and Assam, at 375 px,
    on a map whose whole point is India's states; a narrow desktop window was little
    better. Three rules, each written for a wide screen and a few place pegs. The fit
    rule measured a state by the smaller of its width and 0.8 of its height, and a name
    runs across, so only the width matters; it asked the name to fit inside 85% of that,
    when a name overhanging a large state by a quarter still reads as that state's (0.75
    now, and the overlap test keeps names apart regardless). A two-word name now stands
    on two lines when one line will not fit, broken at the space nearest the middle,
    which is the only way "Madhya Pradesh" gets onto a phone. And the towns' names
    claimed their strips before the state names, so Delhi hid Uttar Pradesh and Mumbai
    hid Maharashtra: big cities sit in big states, and this got worse the moment the
    cities became the default layer. `points.js` now holds one order -- things that stand
    up, then the state names, then names laid flat (a range's), then the towns' -- except
    on a page, whose own names go before the states' because they are the point of it
    (the engine reads whether a page is open, never which). A name laid flat is only
    text, so it no longer takes the famous-place exemption that let "Aravalli" print
    through "Madhya Pradesh". Phone, home view: nine state names in English, sixteen in
    Hindi, none overlapping; the relief page still names its ranges and peaks first.
  - **Cities are the default layer, not places** (owner's call). The transport page
    carries them too: roads and rails join towns.
  - **A `main.js:87` "null addEventListener" error in the console was a ghost**: it was
    in the tab's buffer from an HMR reload mid-edit, and a fresh load with an error hook
    installed does not reproduce it. Worth knowing: the browser pane keeps console
    history across navigations in a tab, so check errors in a fresh tab.
  - **Left for the owner, in order of how visible each is.** (1) The share cards
    `public/share/og-{en,hi}.jpg` date from the morning of the 21st: sticker markers, the
    old menu, no pages; and no per-page card exists, so every page's link preview shows
    the stale language card. This is the first thing anyone sees when a link is pasted.
    Rendering them needs Playwright's Chromium, which is not on this machine (`npx
    playwright install chromium`, `npm run preview`, `FORCE=1 node
    tools/share-image.mjs`). (2) The backdrop join: at a phone's wide fit the sea and the
    neighbours end in a soft-edged rectangle, plainly visible above and left of the
    country. (3) On a phone the key opens itself on every page and covers half the map
    (the relief page: two layers, half the screen). (4) At peek the sheet shows "India ·
    28 states · 8 union territories" and nothing says thirteen pages are one drag away.
    (5) `drafts` is hard-coded on, so every card's info button is terracotta with "Draft,
    not yet reviewed"; fine for a soft launch, but it is what a visitor will see.
    (6) `fallback.webgl` promises "a text version of the content is on its way".
- 2026-09-22, the suggestions done, before publishing.
  - **Share cards rendered**: 28 of them, two per language and one per page per language,
    on this machine's GPU through Playwright's new headless mode. Two things the tool
    needed. Headless Chromium idles requestAnimationFrame once nothing animates, and the
    backdrop is fetched after the first frame and asks for a redraw that never comes, so
    every card would have shown India on bare paper; a pointer move over the canvas
    forces the frame. And poster mode gave the GPU markers nothing to draw -- a rule from
    the sticker days -- so "Made here" and "Cities" were bare tan; the pieces draw now,
    the names stay off.
  - **The sheet says what it holds**: "Contents · 13 pages" with a chevron at peek, a tap
    on the head opens it, the line stays as the contents' heading once open. **The key
    folds on a phone** and opens itself only where there is room; folded, its head still
    carries every mark. **The fallback** promises nothing now.
  - **The rim**: the vertex shader still sank the relief to sea level over the plate's last
    260 km, from when the plate was a rectangle on the page; against a backdrop that keeps
    its height it was a trench along the north edge, and in the cut-out it flattened the
    Karakoram. Gone. And the cut-out's rim fade multiplied by the outline, so the west of
    Kutch, 20 km inside the rect, faded almost away; the cut-out ends on its outline only.
  - **What the "backdrop join" actually is, after a long look**: the plate's 3 km/px
    neighbours strip dissolving over 420 km into the 16 km/px backdrop, visible along the
    north edge as fine snowy Tibet turning to fog. A finer backdrop is the only cure and
    costs bandwidth; left as a look question. A caution for the next person measuring it:
    the key panel sits over the Arabian Sea on a desktop, and an hour went into a "missing
    sea" that was the key's paper.
  - **The `main.js:87` console error** appears only in a tab that has been through a Vite
    HMR reload; two cold loads in a fresh tab are clean. Not a production issue.
  - **Left**: drafts stay on by the owner's call (review comes later); the reference phone
    has still not seen any of this.
- 2026-09-22, after the first deploy (darshan.alokm.com is live).
  - **The whole country went dark at the zoom ceiling.** The border fields reach 14 km
    from a border at the fine tier and saturate there; a 1.6 px line at 12 km per pixel
    asked for 19 km plus 9 of anti-aliasing, so every land pixel was "on a border" and
    took the darkening. Width capped at half the range, anti-aliasing at a quarter, and
    the line fades once the cap is under a pixel. Cards re-rendered.
  - **State names shrink with the zoom** (0.7 at the ceiling), through `--lscale`.
  - **URLs in the shells carry their slash** (`/en/`, `/hi/atlas/rivers/`): the host
    redirects the bare form, which cost every link preview a hop. And `public/_redirects`
    has four 200 rewrites so a state deep link (`/hi/state/kerala`,
    `/hi/atlas/rivers/state/kerala`) gets its language's shell and its page's card rather
    than the root English shell. Unverified on the host until the next deploy: check
    `curl -sL https://darshan.alokm.com/hi/state/kerala | grep '<html lang'` says `hi`.
- 2026-09-22, from the reference phone at last: taps.
  - **Panning and turning selected states.** When one of two fingers lifts,
    `resetOrigins` restarts the survivor so the pan carries on; if it then lifted within
    a third of a second and eight pixels -- the end of every pinch and twist -- it was a
    tap. A finger now remembers its gesture was two-fingered and never taps, and a tap
    is judged by distance travelled, not displacement. Checked with CDP touch events
    against both versions (`scratchpad/touch.mjs`): pinch, twist and a wandering pan each
    selected a state before, nothing after; a plain tap still lands.
  - **Rivers took the taps.** 49 taps on a grid across a phone's country view: 22 rivers,
    4 states (14 px tolerance); at 4 px still 12 rivers. At the country view a finger
    now goes to the state and a river is a zoom away (under 2,500 km: 8 px); a cursor
    keeps 9 px. After: 25 states, 0 rivers, 2 beads, 22 sea.
  - The showcase video (`tools/`-less: a Playwright script in the scratchpad) was
    recorded by driving the real app with real clicks; `recordVideo` + ffmpeg to MP4.

- 2026-09-22, thirty-fifth round: the atlas got thicker. Four asks, all of them "more":
  four times the towns, the GI register brought up to date, roads and rail as a real
  network, and districts.
  - **Towns: 249 to 1,021.** The knobs were already data, so this was 10 per state to 50,
    a floor of 15,000 people, and the cities5000 dump in place of cities15000 -- which
    turns out to have no town at all in Lakshadweep, so Kavaratti (11,473 people, a union
    territory capital) is curated by hand and every one of the 36 units now has a bead.
    What it cost: at 4,500 ids the Wikidata query service starts refusing. A URL long
    enough to carry 300 ids is a 431; a batch of 150 times out after three minutes and
    loses the hour. `pipeline/lib/wikidata.py` posts, retries with a widening pause, and
    caches **one batch at a time under the ids that batch asked about**, so an
    interrupted run resumes. That is the reusable lesson: cache the question, not the
    answer set.
  - **Roads and rail: a network, not a list.** Natural Earth holds 53,850 km of road and
    39,746 km of railway inside India and the map was drawing 14,009 and 5,427 of it. An
    item may now say `network: true` instead of naming geometry, and the build hands it
    the whole source: one card, rank 3, fine and unnamed, under the routes that are
    named. Picking already broke ties by rank, so a tap still gets NH 44 and not the
    tracery beneath it. Named routes went from 8 and 5 to 35 and 21.
    **The routes were checked, not trusted, and that is the round's real finding.** The
    build already prints how far each waypoint sat from the network; on top of that,
    every drawn route's extent was read back in degrees and compared against its
    published termini. That caught NH 5: the gazetteer resolved "Rampur" to Rampur in
    Uttar Pradesh, and the Hindustan-Tibet road came out running down from Shimla into
    the plains and 200 km east. A name gazetteer picks the biggest match, which is right
    for Nagpur and wrong for every small town that shares a name. **Read back what was
    drawn; do not trust what was asked for.**
  - **GI tags: 36 to 169**, and the map now reaches every state and union territory that
    has a GI at all -- Chandigarh, Lakshadweep and Dadra and Nagar Haveli and Daman and
    Diu have none, which the note says rather than leaving three blanks. 25 of the new
    ones are from 2020 on, 16 from 2023-24, which was the ask.
    Everything is checked against the Registry's published list of registered
    indications: a product whose registered name is not on that list does not ship. That
    refused eight items that had never been registered, and corrected a dozen spellings.
    Anchors are resolved from the gazetteer rather than typed, and the layer's existing
    "does the anchor fall in the state it claims" check caught the two that went to the
    wrong Pratapgarh and the wrong Jeypore.
    **What was not done, and why.** The register holds 647. Generating the rest was
    tried and abandoned: matching a product name to a place gets 30% (Mysore is Mysuru,
    Alleppey is Alappuzha, Allahabad is Prayagraj), and resolving the products' own
    Wikipedia pages through Wikidata got 184 of 610, with a Hindi label on 36 and a
    coordinate on 6. The binding constraint is not geometry, it is that **a name in Hindi
    has to be written by somebody**. That is the gate on the remaining 478.
  - **Districts, at last** (open question 10, answered). PLAN.md's own survey recommended
    the LGD layer a round ago and the recommendation held up: all eight disputed-territory
    probes fall where Survey of India puts them. It is published as TopoJSON, which is
    better than it sounds -- every boundary is stored once as a shared arc, so the mesh
    draws without inking an internal line twice, and an arc whose two sides fall in
    different states is dropped, because that line is the state border and the terrain
    draws it already.
    Two layers, because a boundary is a line and a name is a label: `district-lines` (the
    mesh, one item per state) and `districts` (785 labels, each at the pixel deepest
    inside its own shape). Both started at rank and priority 3 -- hold them back until
    the camera is inside a state -- and that was wrong: the districts page then opened on
    a country with no districts on it, and its share card was a picture of an empty map.
    They are rank and priority 2 now. At the home view the mesh reads as a fine political
    plate rather than a smudge, because the label thinning drops nearly every district
    name there; the names fill in as the camera comes down. The states page is untouched
    -- it names `zones` and nothing else -- so "not on the political page" is kept by
    composition rather than by weight, which is the better way to keep it. No engine
    change either way.
    The join is a **code** match, not a name match: the source carries LGD and PC11
    codes, Wikidata files Indian districts under the same LGD code (P12746), and 779 of
    785 meet their item exactly. The 29 too new for a Hindi label are named by hand. Each
    district's state comes from the project's own ID raster, not from the state named in
    the source, so the two can never disagree; all 785 land, none disagrees.
    Left open on purpose: the uint16 district raster, and therefore district choropleths.
    The primitives table says so. And the licence is still the aggregator's assertion
    over data of LGD and Survey of India lineage -- the registry entry says that in both
    languages, and the map is dated (August 2024) rather than current.
  - **A `name` field type**, because a headquarters is a proper name and exists in both
    languages, which `text` could not carry. One line in `shell.js`, one in the pipeline.
  - **A reproducibility wobble worth knowing about**, not caused by this round: rerunning
    the DEM step on this machine changes `shade-1024` in 3 pixels of 491,520, each by 1,
    and `shade-2048` likewise. Rounding, almost certainly a numpy version, invisible on
    screen -- but "reproducible byte for byte" is no longer quite true, and the two files
    were reverted rather than committed so the shipped bytes stay as they were.

- 2026-09-22, thirty-sixth round: better sources, and the state view sharpened.
  Two asks: find roads and rail worth drawing, and stop the district lines looking
  coarse the moment a state fills the screen.
  - **Natural Earth is gone from both networks.** It was never a good source for India
    -- 53,850 km of road, 39,746 km of rail, and *no names on any of it*, which is why a
    highway had to be found by walking a graph between towns and a card could never be
    sure the line under it was the road it named. The government surveys are published
    as plain GeoJSON by INDIAN-SHAPEFILES (MIT over MoRTH/GatiShakti and Indian Railways
    data): **124,000 km of national highway, 1,013 numbered routes, and the number is on
    every feature**, so the 35 named roads join by that number and nothing is guessed.
    Railways: 85,000 km of track centreline, with gauge.
  - **The finding that cost the most and is worth the most.** The railway source cannot
    be routed. Its sections do not meet: only 69% of chain ends have a neighbour within
    200 m, and a branch's first vertex sits somewhere along the main line rather than at
    a vertex of it. Noding the crossings and then bridging the gaps got the graph to one
    component of 11,980 nodes out of 12,000 -- and still only 10 of 21 routes walked.
    **A drawing is not a network, and no amount of snapping makes it one.** What works
    instead is to stop asking for a path: `corridor` keeps the source's own chains that
    lie within 8 km of the line through the places an item names. No connectivity, no
    invention, every metre the source's own -- at the cost that a junction's approaches
    and a parallel branch are counted in, which the layer's note says rather than
    claiming route mileage.
  - **`stitch`, which paid for itself twice.** A published network is cut wherever an
    attribute changes, so NH 44 arrives as 2,992 fragments, most of them two points long.
    Simplification cannot touch a two-point fragment. Stitched into chains broken only at
    real junctions, the same network is *smaller and longer*: 13,667 runs and 102,919 km
    became 7,434 runs and 117,422 km.
  - **Verification, again the useful part.** Extents were read back in degrees and
    compared against published termini. Lengths now agree with the Ministry's own
    figures: NH 44 3,481 km of a published 4,225, NH 27 3,099 of 3,507.
  - **Districts: the source was the ceiling.** The LGD TopoJSON's own vertices are
    1.665 km apart (median), so simplifying at 1.5 km lost nothing -- the coarseness was
    the file, not the build. The survey polygons have eighteen times the vertices, so the
    mesh is drawn from those now, and written twice: the country tier at 1.5 km and a
    file per state at 0.2 km, 32 of them, 1.6 MB in all, 161 KB at worst, fetched only
    when that state is lifted. **A `lines` layer can do this generally** -- a `detail`
    map of state to path, the block drawing it while the plate keeps the country's --
    which is the "denser networks" half of D3's state package, and roads, rail and rivers
    are next in line for it.
    The identity is untouched: names, headquarters, populations and codes still come from
    the directory's layer through Wikidata, which is the only thing that joins. The
    survey polygons are asked for geometry and nothing else, and the boundary between two
    districts is found by counting segments -- seen twice, it is an internal line; seen
    once, it is the state's own edge, which the model draws itself.
  - **A real bug, found by watching a build sit at 100% CPU for ten minutes.**
    `erode` only removes a pixel whose four neighbours are inside the array, so a shape
    touching the array edge is never worn away there and a shape *filling its bounding
    box* is never worn away at all -- and `pole_of_inaccessibility` crops to exactly that
    box, so its input always touches the edge. Real outlines usually come to a point near
    the top of their box and erode from the sides, which is why it had never bitten; a
    survey polygon set has plenty that do not. Fixed with a one-pixel false margin, plus
    a `max_side` cap, because the loop costs one pass over the shape per pixel of its
    inscribed radius and a country-sized mask is 600 passes over four million pixels.
  - **What the look decided.** The district mesh reads at the home view and is drawn at
    rank 2. The road and rail networks do not -- at rank 2 India is a solid mass of ink --
    so they stay at rank 3 and arrive as the camera comes in. Same question, opposite
    answers, and only the screen could tell them apart.
  - **Left**: Natural Earth still draws the rivers and the physiographic regions, and
    both could probably do better now that GeoJSON is a source format. The gauge on every
    railway feature is an atlas map nobody has drawn yet.

- 2026-09-22, thirty-seventh round: the rivers, on the government's own survey.
  - **India-WRIS replaces Natural Earth.** 30,546 features naming 27,584 rivers, each with
    its basin and sub-basin, from indian_water_features (CC0 on the india-geodata
    catalogue's word; the republishing repo carries no licence and WRIS's own terms are
    unconfirmed -- the registry says so). The 28 named rivers join by WRIS's name, and by
    name *in a basin* where there are namesakes: `qualify: "ba_name"` lets an item ask for
    "Mahanadi @ Mahanadi", because WRIS also has a 300 km Mahanadi in the Ganga basin and
    a Brahmani in Kutch. Spellings to know: Sone, Satluj, Cauvery, Pennar, Teesta.
    Lengths agree with the published ones (Narmada 1,328 km to 1,312).
  - **It only ships as PMTiles, Parquet or 7z**, and of those only a tile archive can be
    read without a dependency, so `pipeline/lib/pmtiles.py` reads PMTiles v3 and decodes
    vector tiles in about 300 lines of stdlib -- 46,000 tiles at zoom 10 in six seconds.
    Each tile's geometry is clipped to its own square (archives draw a buffer past the
    edge, so neighbours overlap), which lets `stitch` rejoin the pieces. The Ganga still
    arrives as 244 chains, but that is the source's braids and confluences, not the
    tiles: only 23 of 488 chain ends sit on a tile edge.
  - **Two tiers, and the second is where the richness is.** The country view carries the
    28 named rivers over every other river WRIS counts as major (47,000 km, 69 KB
    compressed). Lift a state and every river in it at least 40 km long arrives at 0.25 km:
    35 files, 3.1 MB in all, Uttar Pradesh the largest at 146 KB compressed. `detail` is
    now general to any named `lines` layer, and a detail tier's network may be looser
    than the country's (`where`, `min_length_km`). All 591,000 km of WRIS was 7.9 MB and
    1 MB for one state; the 40 km floor keeps 42% of the length for 39% of the bytes.
  - **HydroRIVERS was looked at and set aside.** It has no names, and its licence is a
    contract WWF may terminate at its sole discretion that asks the licensee to keep
    records of end users. Worth writing down so nobody reaches for it again.
  - **A side effect caught before commit**: the new network code stitched across road
    names, which moved the highway network by 350 km and 600 runs. Stitching a name at a
    time, as the named items always were, restored roads and rail byte for byte.
  - **Left**: the physical divisions are the last layer still on Natural Earth. The
    catalogue's WRIS basins and sub-basins (also tile archives, now readable) are the
    obvious replacement, and a basin map is one the atlas lacks anyway.

- 2026-09-22, thirty-eighth round: river basins, a map the atlas did not have.
  - **The Central Water Commission's 25 basins**, from India-WRIS by way of the same
    catalogue as the rivers, on a new physical page with the rivers over them. Coloured
    by where the water goes, in seven groups (the fill has eight colours): the Bay from the
    Himalaya or across the peninsula, the Arabian Sea from the Himalaya or the west of the
    peninsula, nowhere (Rajasthan's inland drainage, and the corner of Ladakh that drains
    towards the Tarim), out to Myanmar and Bangladesh, and the islands. In the peninsula
    the green-ochre line is the Western Ghats divide, which is what the page is for.
  - **Joined on the basin code**, because three polygons have no name. 21, 22 and 23 are
    North Ladakh, the Andamans and Lakshadweep -- confirmed against the sub-basin file and
    the polygons' coordinates, not the order first guessed, which was wrong.
  - **Checked by area.** Each basin's drawn area against WRIS's published figure: 21 of 23
    within 12%. The exception explained itself: Kutch-Saurashtra-Luni draws at 185,573 km²
    against 321,851, and adding Rajasthan's inland drainage (143,814, unpublished) makes
    329,387 -- the Commission counts the two as one. That card omits the figure; the
    inland basin's blurb says why.
  - **Polygons from tile archives.** `pmtiles-polygon` is now a source an `areas` layer can
    name. Winding needed no correction: a vector tile's outer ring, flipped into latitude,
    is already clockwise -- the shapefile convention. Reversing it made every basin a hole.
  - **Two changes to the `areas` primitive**, both general. A pixel-wide line where two
    areas meet, so neighbours of one colour (Godavari and Krishna; two plateaus) no longer
    merge -- the physical divisions have outlines now too. And `fillItem` never looked in
    `areas` layers, so a basin or a physical division opened by link, search or carousel
    showed an empty card; it fills now, and frames the area from its raster (a tap keeps
    the view, since a basin is half a subcontinent).
  - **Left**: `physiography` is the last layer on Natural Earth, and nothing better has
    turned up for it yet. (The sub-basins followed in the next round.)

- 2026-09-22, thirty-ninth round: the 99 sub-basins, a page after the basins.
  - **India-WRIS's sub-basin layer**, the division the Central Water Commission works to,
    in the basins' colours so the legend carries over, with the rivers drawn over them.
    The Ganga alone is nineteen of them; a big peninsular river is its upper, middle and
    lower reaches. 98 cards for 99 polygons: WRIS files Aksai Chin and the Shaksgam
    valley under one name, and they are one card.
  - **Every card matches WRIS's own name**, checked by the build (a name WRIS does not
    use fails it). WRIS's names are sometimes administrative ("Above Ramganga
    Confluence") and sometimes its own spellings ("Weinganga", "Kynchiang", "Varrar");
    the card uses the usual name and the blurb says what WRIS calls it where that is not
    obvious. One trap worth knowing: WRIS's "Pamba and others" is in Tamil Nadu -- the
    Vaigai's country -- not Kerala's Pamba.
  - **The parent basin is a `name` field**, so the card says "Ganga basin" in both
    languages. Area checked, not shown: 97 of 98 draw within 0.6-1.6x of the area WRIS
    records (in a projection it does not name, so not a figure for the card);
    Lakshadweep is the exception, enlarged by the raster.
  - **Left**: at the whole-country view the sub-basin page looks much like the basin page,
    since the lines between sub-basins are a pixel wide and the colours are shared. It
    comes into its own from about 1,500 km of view height in; whether it wants to open
    closer than the home view is a look question for the owner.

- 2026-09-25, seventieth round: the Mauryas under Aśoka, and eras on one page. "Kingdoms and
  empires" now carries `eras` (07_plates validates them; the page's `layers` is their union) and the
  page shows a stepper, "‹ c. 250 BCE · era 2 of 2 · The Mauryas under Aśoka ›", with the era's blurb;
  stepping swaps the layers on, and the era is read back off the layers, so a link restores it. The
  Maurya era is the first graded extent: one empire in five shades carried as each area's own
  colour (an areas item may now bring `color`), core round Pāṭaliputra, held (an edict in the
  region or a seat the edicts name), the Andhras named inside, the forest peoples, and within the
  edicts' bounds; the Coḍas, Pāṇḍyas, Keralaputa and Satiyaputa outside in their own colours. 27 edict
  sites as evidence pins (kind and year found) and three seats; cards quote Hultzsch 1925 and the
  edicts themselves. Checked in the browser; 48 tests and the build pass.
- 2026-09-24, sixty-ninth round: divisions and kingdoms. Journeys paused at the owner's word; two new
  history pages from the Jñānakośa's new gazetteer/regions.json. An `areas` layer can now be made of
  whole 2011 census districts (`"source": {"format": "districts-2011"}`, each item listing its codes;
  the build looks the census raster up to area ids), which is the unit every historical area will use:
  honest to the nearest district, no invented polygon. "The old divisions of India": 63 traditional
  regions over all 640 districts, coloured by the Matsya Purāṇa's seven divisions of the peoples and
  shaded apart within each, with their names laid on the map. "Kingdoms and empires": its first era,
  the sixteen mahājanapadas of the Aṅguttara Nikāya c. 500 BCE, 14 drawn (Gandhāra and Kamboja lie
  outside), each card quoting Raychaudhuri 1923 for the extent, with 13 capitals and the names. An
  areas layer with more than eight categories (one per kingdom) now carries each area's colour itself,
  since the band lookup holds eight. The era stepper comes with the second era (Aśoka, c. 250 BCE).
  Checked in the browser; 48 tests and the build pass.
- 2026-09-24, sixty-eighth round: episodes, a story page one chapter at a time. With 92 stops and
  131 arrows the Mahābhārata page drawn whole was a tangle (the owner: "a mess"). A page whose tour
  visits every group its layers have now opens on its first group, with a stepper under the play
  button (‹ Episode 4 of 18 · Arjuna's pilgrimage ›) and "Show all at once". An episode draws its own
  stops at every zoom (no priority thinning) and its own arrows, plus one borrowed pin where an arrow
  starts or lands without a stop of its own (the latest earlier visit to that place, so tapping it
  steps back in the story). Stepping frames the episode; the tour and the card's steps carry the
  episode along with them. Arrows are hidden in the vertex shader by a per-vertex category index
  (`uEpisode`), pins in marks.js and points.js; the logic is src/engine/episodes.js, with tests.
  Mahābhārata (18) and Sugrīva (4) get it; Rāma's exile does not yet, because three of its groups
  (Rāvaṇa's flight, Hanumān's leap, the march) are arrows only and could never be stepped to.
  Checked in the browser; 48 tests and the build pass.
- 2026-09-24, sixty-seventh round: Karṇa's conquest of the earth added to the Mahābhārata tour.
  92 stops and 131 arrows in eighteen colours. A crimson group in the forest years, after the return to
  Kāmyaka: Karṇa's one-man answer to the four Sabhā digvijayas. Eleven stops (Kāmpilya, Prāgjyotiṣa,
  Aṅga, Ahikṣatra, Vatsa, Vidarbha, Pāṇḍya, the Cedi city, Avanti, Rohītaka, Hastināpura) and fifteen
  thin arrows, two of them out to Nepāla and the western land beyond the boundary. The last card names
  the Vaiṣṇava sacrifice the conquest paid for. Checked in the browser; tests and build pass.
- 2026-09-24, sixty-sixth round: Nakula's conquest of the west; the four quarters complete.
  81 stops and 116 arrows in seventeen colours. A khaki group after Sahadeva's: Rohītaka (Rohtak), the
  Trigartas, the Puṣkara forest, then arrows out to the Sindhu's bank and Śākala (both beyond the
  boundary) and home with ten thousand camels. All four Sabhā digvijayas are now on the tour, in the
  text's order: Arjuna north, Bhīma east, Sahadeva south, Nakula west. Checked in the browser; tests and
  build pass.
- 2026-09-24, sixty-fifth round: Arjuna's conquest of the north added to the Mahābhārata tour.
  78 stops and 110 arrows in sixteen colours. A light-blue group before Bhīma's (the text tells
  Arjuna's first): Prāgjyotiṣa, Kashmir, Abhisārī and the Daradas (Gilgit). Seven thin arrows run from
  Śākala (beyond the boundary), across to Prāgjyotiṣa, back along the hills, out to lake Mānasa
  (beyond the boundary) and home. The southern text's detour round Meru is not mapped. Checked in the
  browser; tests and build pass.
- 2026-09-24, sixty-fourth round: Sahadeva's conquest of the south added to the Mahābhārata tour.
  74 stops and 103 arrows in fifteen colours. A pink group after Bhīma's: the Śūrasenas, Avanti,
  Kiṣkindhā (seven days against Rāma's monkeys, on the Rāma tour's Hampi pin), Māhiṣmatī (Maheshwar),
  Surāṣṭra, Śūrpāraka, Kanyātīrtha and Bhṛgukaccha (Bharuch), where Ghaṭotkaca is sent to Laṅkā; then
  home. Nine thin arrows. Checked in the browser; tests and build pass.
- 2026-09-24, sixty-third round: Bhīma's conquest of the east added to the Mahābhārata tour.
  66 stops and 94 arrows in fourteen colours. An indigo group after Jarāsandha's killing: the Pāñcāla
  city, Daśārṇa, Cedi (Śiśupāla submits), Ayodhyā, Kāśi, Girivraja, Modāgiri (Munger, where Karṇa of
  Aṅga is beaten) and Tāmralipta (Tamluk), then the Lauhitya and home with the tribute for the
  rājasūya. Ten thin arrows; the Lauhitya point is the compiler's. Checked in the browser; tests and
  build pass.
- 2026-09-24, sixty-second round: Arjuna's pilgrimage filled out in the Mahābhārata tour.
  58 stops and 84 arrows. The Arjuna group grows from one stop to seven: Gaṅgādvāra, then up the
  Himavat and east to Gayā, down the Kaliṅga coast to Maṇalūra, up the western sea to Prabhāsa, the
  Raivataka (Girnar) festival, Subhadrā carried off from Dvārakā, and home to Indraprastha. Nine thin
  arrows replace the Gaṅgādvāra → Mahendra placeholder. The date line carries the text's own crux:
  "twelve months" here, twelve years in the CE. Checked in the browser; tests and build pass.
- 2026-09-24, sixty-first round: Balarāma's Sarasvatī pilgrimage added to the Mahābhārata tour.
  52 stops and 76 arrows in thirteen colours. A periwinkle group follows the war stop: Prabhāsa, where
  the river meets the sea; Pṛthūdaka (Pehowa); Samantapañcaka; and the source, Plakṣaprasravaṇa (Adi
  Badri, by tradition). It then comes down again for the last duel. It replaces the single Prabhāsa →
  Kurukṣetra placeholder with five thin arrows up the river; the Vinaśana point is the compiler's.
  Checked in the browser (52 stops in order, no console errors); tests and build pass.
- 2026-09-24, sixtieth round: the horse sacrifice closes the aśvamedha group.
  One new stop at Hastināpura, "The horse sacrifice", after the horse's return by Pañcanada and
  Gandhāra (48 stops). Its card has the kosha's new passages: twenty-one posts, a golden altar in the
  shape of Garuḍa, the horse offered, and the earth given as the fee and bought back with gold. Checked
  in the browser; tests and build pass.
- 2026-09-24, fifty-ninth round: the pilgrimage with Lomaśa added to the Mahābhārata tour.
  Same page, now 47 stops and 72 arrows in twelve colours. An orange group, "The pilgrimage with
  Lomaśa", replaces the two placeholder arrows (Kāmyaka → Śūrpāraka, Prabhāsa → Badarī) with the
  route the brothers walk. It runs east to Naimiṣa, Prayāga, the Kauśikī and the Gaṅgā's mouth; down
  the coast by Kaliṅga and Mahendra to the Godāvarī and the Draviḍas; over to Śūrpāraka and Prabhāsa;
  then by the Narmadā to Kurukṣetra's door, Kashmir, Kanakhala and Badarī; and home to Kāmyaka "as
  the twelfth year came on".
  - Revisits get their own cards: Naimiṣa, Prayāga, the Gaṅgā's mouth, Kurukṣetra, Gaṅgādvāra and
    Kāmyaka.
  - The Kosi, Godāvarī-mouth, Draviḍa and Narmadā points are the compiler's and say so.
  - Checked in the browser (47 stops in order, no console errors); tests and build pass.
- 2026-09-24, fifty-eighth round: tour arrows fly as arcs instead of following the ground.
  A floating arrow still followed the relief, which at the exaggerated heights (tens of km) bent a
  1,000 km leg into a wobble over every range it crossed. That is right for a monsoon front and wrong
  for a journey. A lines layer may now set `"arc": true` (it needs `arrows` and `float`):
  - The vertex shader lifts each run on a parabola from the ground at its first point to the ground
    at its last. The crown is 0.1 of the run's length, and at least 18 km so a short hop clears the
    hills. The ends stay on their pins, which keeps them in place on a tilted view, and the depth
    test stays off.
  - The ribbon's screen direction takes the climb into account, so the width stays even up the arc.
  - The shape is drawn in screen pixels too. The shipped profile made the head 260 km long (45% of a
    short leg), so short legs swelled like wedges, and the tip landed under the pin it pointed at. An
    arc now has an even shaft (1.7 × its rank's width) and a 15 px head, 3 × the shaft. The tip stops
    11 px short of the destination pin and the shaft starts 6 px from the origin. `densifyEnds` adds
    vertices at geometric distances from both ends, so the head has vertices to be shaped from at
    every zoom.
  - Picking: an arc is not on the ground, so `lines.nearestArc` lifts each run the same way (`ARC`
    and `arcY` in lines.js) and measures on the screen. It answers before the ground lines.
  - On: sugriva-routes, rama-exile-route, mahabharata-route. The monsoon keeps following the land.
  - Checked in the browser: all three tours draw as smooth arcs at flat and tilted views, a tap on
    an arc's crown opens that leg's card, no console errors; tests and build pass.
- 2026-09-24, fifty-seventh round: Pulastya's tīrtha circuit added to the Mahābhārata tour.
  Same page (`/en/atlas/mahabharata`), now 37 stops and 59 arrows in eleven colours. An olive group
  after Kāmyaka, where Nārada recites it: Puṣkara, Mahākāla, Arbuda, Kurukṣetra, Gaṅgādvāra, Naimiṣa,
  Kāśī, Gayā, the Gaṅgā's mouth (Gangasagar, by tradition), Kanyātīrtha, Gokarṇa, Kālañjara, Prayāga:
  a clockwise circuit of the country, as the text frames it ("a rightwise circuit of the earth").
  - Its 18 arrows are rank 2 (thin): the circuit is recited, and no one in the story walks it.
  - The Indus mouth arrow points beyond the boundary; the Kashmir point is the compiler's.
  - Epic-rivers cards now cite only Bhīṣmaparvan 6.9 (the new passages would otherwise have been
    added to their sources).
  - Checked in the browser (37 stops in order, en and hi, no console errors); tests and build pass.
- 2026-09-24, fifty-sixth round: the aśvamedha horse added to the Mahābhārata tour.
  Same page (`/en/atlas/mahabharata`), now 24 stops and 41 arrows in ten colours. A tenth colour
  (magenta, "The aśvamedha horse") follows the coronation: Hastināpura (the horse let go on the Caitra
  full moon), Trigarta, Prāgjyotiṣa, Girivraja (Meghasandhi), Śuktisāhvayā (the Cedi city, near Banda),
  Daśārṇa, Gokarṇa and Dvārakā, then home by Pañcanada and Gandhāra for the Māgha full moon.
  - The route is drawn in the text's order, which zig-zags: the text says the horse wandered "at will",
    though it announces a rightwise circuit, north first.
  - The Sindhu and Gandhāra arrows point beyond the Survey of India boundary; no pins there. The Vaṅga
    and southern-sea points are the compiler's and say so.
  - Checked in the browser (24 stops in order, horse cards read, en and hi, no console errors); tests
    and build pass.
- 2026-09-24, fifty-fifth round: the Mahābhārata chronology, a third History tour.
  New page `/en/atlas/mahabharata`, "The Pāṇḍavas' road: a Mahābhārata chronology". 16 stops and 27
  arrows in nine colours, from the boys' arrival at Hastināpura to the last journey over the Himavat.
  - Each stop card has two new fields, "What happens" and "When". The dates are the southern text's own
    count of Yudhiṣṭhira's years (Ādiparvan 1.134): 16 at Hastināpura, 29 at the lac house, 30 at the
    svayaṃvara, 36 to 59 at Indraprastha, 59 at the dice, 71 at Virāṭa, 72 at Kurukṣetra, 108 at the end.
  - Revisits: Hastināpura (arrival, dice, coronation) and Prabhāsa (pilgrimage, Mausala) have one item
    per visit, each with its own id, so the tour shows a different card each time. No engine change was
    needed; the gazetteer writes the ids.
  - Side journeys (Arjuna's pilgrimage, Girivraja, the embassy, Balarāma up the Sarasvatī, out to
    Bhīṣma) are rank 2. Points the text does not give (the Gaṅgā crossing, the Panjab camp, the two sea
    ends of the last journey) are placed by the compiler and say so on their cards.
  - Not placed: Śataśṛṅga, Ekacakrā, Dvaitavana, Upaplavya, Maṇalūra. Kāmyaka is pinned on the
    Sarasvatī at Pehowa from the text's directions; Dvārakā at Dwarka by tradition.
  - Checked in the browser (16 stops in order in en and hi, revisit cards distinct, no console errors);
    tests and build pass.
- 2026-09-24, fifty-fourth round: Rāma's road completed with the Yuddhakāṇḍa, Ayodhyā to Laṅkā and home.
  Same page (`/en/atlas/rama-exile`), now "Rāma's road: Ayodhyā to Laṅkā and home". 12 stops and 22
  arrows in ten colours.
  - New stops: Setubandha (Rameswaram) and Nandigrāma (Bharatkund, 15 km south of Ayodhyā), both
    "likely, by tradition". The Setubandha card quotes the text's own tīrtha, "where Mahādeva showed
    his grace", without the later name Rāmeśvara.
  - New colours: the march (Kiṣkindhā over the Sahya and Malaya to the sea), the setu (Setubandha
    across the strait, a hundred yojanas in five days by the text), and the Puṣpaka return in six
    arrows, Laṅkā → Kiṣkindhā → Pañcavaṭī → Citrakūṭa → Prayāga → Nandigrāma → Ayodhyā, bowed
    apart from the outbound arrows. The return is the text's own recapitulation of the whole route.
  - The Prayāga arrow carries the exile's closing date: the fourteenth year full, the fifth day.
  - Checked in the browser (12 stops in order, new stop and leg cards read); tests and build pass.
  - The route is now attested from Ayodhyā round to Ayodhyā. The kosha gazetteer holds 124 places;
    34 are recorded and not drawn (outside the boundary, disputed, or unplaced by the text).
- 2026-09-24, fifty-third round: Hanumān's leap and return added to Rāma's road (Sundarakāṇḍa).
  Same page (`/en/atlas/rama-exile`). No new stops: the kāṇḍa's action is in Laṅkā, which is not
  placed. A seventh colour, Hanumān's leap and return, replaces the Kiṣkindhā stage's "leap to come"
  arrow with three: Mahendra out to sea (the leap to Laṅkā on Trikūṭa), back from sea to Mahendra
  (the return from Mount Ariṣṭa, bowed the other way), and Mahendra to Kiṣkindhā by Madhuvana (the
  report, bowed apart from the southern party's arrow). 10 stops, 14 arrows.
  - The arrows stop at sea where Laṅkā would be; the layer note and each card say Laṅkā is not placed.
  - Checked in the browser (the three new cards read, 10 stops in order); tests and build pass.
  - **Next for the route**: Yuddhakāṇḍa 4-22 (the march to the sea and the setu), then Laṅkā and the
    return to Ayodhyā by the Puṣpaka.
- 2026-09-24, fifty-second round: Rāma's road extended through the Kiṣkindhākāṇḍa to Mahendra.
  Same page (`/en/atlas/rama-exile`), now "Rāma's road: Ayodhyā to the southern sea".
  - 10 stops (Kiṣkindhā and the southern Mahendra added) and 12 arrows in six colours; the two new
    groups are Kiṣkindhā and the rains (Ṛṣyamūka to Kiṣkindhā) and the southern party (Kiṣkindhā
    through the Vindhya caves and Ṛkṣabila to Mahendra, then the hundred-yojana crossing to come,
    stopping at sea).
  - Kiṣkindhā's card carries the dated rains (four months from Śrāvaṇa, in a cave on Prasravaṇa);
    Prasravaṇa itself is not pinned, since no verifiable coordinates were found for the
    Mālyavanta hill tradition. Mahendra's card names the text's own crux, a "Vindhya" on the
    southern shore.
  - Checked in the browser (10 stops in order, new stop and leg cards read); tests and build pass.
  - **Next for the route**: Sundarakāṇḍa (the leap, Laṅkā) and Yuddhakāṇḍa 4-22 (the march to
    the sea and the setu).
- 2026-09-24, fifty-first round: Rāma's road extended through the Araṇyakāṇḍa to the Pampā.
  Same page (`/en/atlas/rama-exile`), same layers, now titled "Rāma's road: Ayodhyā to the Pampā".
  - 8 stops (Pañcavaṭī and the Pampā added) and 9 arrows in four colours: the road into exile,
    the Daṇḍaka hermitages to Pañcavaṭī, Rāvaṇa's flight with Sītā (over the Pampā and on towards
    Laṅkā, the arrow stopping at sea), and Rāma's search to the Pampā. The flight and the search
    both run Pañcavaṭī to the Pampā and bow apart so they read as two routes.
  - Pañcavaṭī is pinned at Nashik and the Pampā at the Pampā Sarovar near Hampi, both "likely, by
    tradition"; Pañcavaṭī's card names Bhadrachalam's rival claim. The hermitages, the Krauñca
    forest and Kabandha are named in the leg cards and not pinned.
  - The search arrow is a diagram: the text's own bearings contradict one another (west, south,
    east, then west) and its distances are a few krośas; the card says so.
  - Checked in the browser (8 stops in order, new stop and leg cards read); tests and build pass.
  - **Next for the route**: Kiṣkindhākāṇḍa (Ṛṣyamūka, Kiṣkindhā, Prasravaṇa, the search parties
    already drawn on the Sugrīva page) and Yuddhakāṇḍa 4-22 (the march to the sea and the setu).
- 2026-09-24, fiftieth round: Rāma's own road, Ayodhyā to Citrakūṭa (`/en/atlas/rama-exile`).
  The kosha attested Ayodhyākāṇḍa 46-56, which tells this stretch as a real itinerary in order,
  unlike Sugrīva's lists. Second story on the `tour` primitive, no engine change.
  - `rama-exile-stops` (6: Ayodhyā, the Gomatī and Syandikā crossings, Śṛṅgaverapura, Prayāga,
    Citrakūṭa) and `rama-exile-route` (5 arrows, halt to halt), plus the plate, all generated by
    the kosha gazetteer's export. The Gomatī and Syandikā crossings are not placed by the text;
    their pins stand on Sultanpur and Bela Pratapgarh, towns on those rivers along the road, and
    the cards say so. The Tamasā, the Vedaśruti, the Yamunā ford and the dark banyan are named in
    the leg cards and not pinned.
  - The Prayāga-to-Citrakūṭa arrow is straight; the text sends the exiles up the Yamunā to an old
    ford first, and the layer note says the arrow is a diagram, not the track.
  - Checked in the browser: the tour plays 6 stops in order under "Walk the road", every stop
    and leg card reads, tests and build pass.
  - **Next for the route**: the Araṇyakāṇḍa (Atri's hermitage, Daṇḍaka, Pañcavaṭī), then
    Kiṣkindhā and Yuddha 4-22, each one more `tours` entry or an extension of this one.
- 2026-09-24, forty-ninth round: the first story, Sugrīva's four quarters (`/en/atlas/sugriva`).
  The owner asked for a Rāma tour from Rāmāyaṇa Kiṣkindhā 40-43. Those sargas are Sugrīva's
  orders to the four search parties, not Rāma's own journey; the page follows them as written
  and says so, and its southern leg is the road to the sea that Rāma's army later takes.
  - **Stories, the primitive**: a plate's `tour` (PLAN.md section 5, "Plates") names stops in
    order. Engine: `index.js` hands the tour the page's stops when it has them, `tour.js` keeps
    a given order; shell: the page gets its own play button. The tour's card handover now
    passes the layer's fields too (they were missing from every tour card before).
  - **Two layers and the plate, all generated** by the kosha gazetteer's export:
    `sugriva-search` (25 stops coloured by party, in Sugrīva's order) and `sugriva-routes` (11
    arrows: one out of Kiṣkindhā per party, the southern road past Agastya to Mahendra and the
    island, and the ways out over the sea or the snow). `content/plates/sugriva.json` is
    written by the export too; edit the tour in the kosha, not here.
  - Arrow items no longer carry `km`: the card printed "Length in India" for the monsoon's
    arrows and these, a number that measures nothing on a diagram. The `locus` field on all
    five History layers is now a bilingual name, so the Hindi card says रामायण, not Rāmāyaṇa.
  - Not drawn: the island (named only as Rāvaṇa's country), Yavadvīpa, the Indus mouth and
    Kailāsa; arrows point at them and stop. Checked in the browser in both languages: the tour
    plays 25 stops in order, prev/next and pause work, every stop and leg card reads.
  - **Next for History**: Rāma's own route needs the kosha to attest Ayodhyā 46-56 (to
    Śṛṅgaverapura, Prayāga, Citrakūṭa), the Araṇyakāṇḍa (Pañcavaṭī) and Yuddha 4-22 (the march
    and the setu), then it is one more `tours` entry. The Mahābhārata chronology would want
    steps that change the layers or the date, which the primitive does not do yet.
- 2026-09-24, forty-eighth round: the first History page, Bhāratavarṣa in the old texts
  (`/en/atlas/bharatavarsha`). The owner asked for the old names of places on the atlas,
  as a data layer off the front page, with tours of routes (Rāma's) and chronologies (the
  Mahābhārata's) to follow.
  - **Three layers, no engine change**: `kurma-vibhaga` (points, 47 places of Bṛhat-saṃhitā
    14 coloured by the nine sectors Varāhamihira puts them in), `kula-parvatas` (labels, six
    of the seven ranges of Mahābhārata 6.9.11) and `epic-rivers` (lines, 21 rivers of MBh
    6.9 drawn on the Rivers layer's own features under the epic name, coloured by how
    certain the identification is). Each card gives the modern site, the verse's own word
    in Devanagari, the locus and whose identification it is.
  - **Where the items come from**: the Jñānakośa (`~/dev/jnanakosha`), which quotes the
    verses verbatim from revision-pinned sa.wikisource pages. Its `gazetteer/places.json`
    ties each place to a quoted form and, separately, to a graded identification;
    `python3 tools/kosha_gazetteer.py export ~/dev/bharat-darshan` writes the three
    items.json files. Edit the gazetteer there, not the items here. Registry gains
    `sa-wikisource` (data, CC BY-SA) and `kern-brhat-samhita` (facts, public domain).
  - **Not drawn, on purpose**: disputed identifications (Laṅkā, Gauḍaka, Śuktimat) and
    places outside the Survey of India boundary (Takṣaśilā, Puṣkalāvatī, Gandhāra, Madra,
    Sindhu-Sauvīra, Samataṭa, Puṇḍra, Siṃhala, Kailāsa). Gilgit (the Daradas) is drawn in
    Ladakh, as the boundary rule requires. Amarkantak falls on the Chhattisgarh side of the
    coarse ID raster and is claimed there, with the reason in the gazetteer.
  - Country zoom shows the certain cities, the sector-kings' countries of 14.32-33 and at
    least one pin per sector, so all nine colours read at once; Kashmir shows in the
    north-east colour, which is the text's own error and the card says so.
  - `epic-rivers` repeats the Rivers source block, so the pipeline caches a second copy of
    the 84 MB PMTiles under `pipeline/raw/layers/epic-rivers/`. A shared cache would save it.
  - **Next for History**: a plate with steps (PLAN.md section 5, "Stories") for Rāma's
    route, fed by Rāmāyaṇa Kiṣkindhā 40-43 and the Ayodhyā-kāṇḍa itinerary once the kosha
    attests them; the Mahābhārata chronology as dated steps after that.
- 2026-09-24, forty-seventh round: lines stay on high relief. The owner found roads,
  railways and district lines vanishing in the Himalaya and breaking up over the Ghats
  once the relief was turned up.
  - **Cause**: a run's segments are ~5 km (p95 16, up to 100) against a ~3.3 km mesh
    cell, so each straight chord passed under every ridge between its ends. Rivers
    escaped by lying in valleys, where a chord runs above the ground.
  - **Fix**: `lines.js` cuts every run where it crosses a grid line or a quad's
    diagonal of the mesh it is drawn on, and the shader lays the height on that mesh's
    own two triangles per quad, so the ribbon lies exactly on the drawn ground. The
    lifted block cuts its own copy (only the runs reaching it) to its finer grid, which
    `block.grid.rect` now describes. The ribbon's screen-space edges get a view-space
    depth bias of `halfWidthKm * (1 + 2 * slope)` of the quad under it; the camera is
    orthographic, so nothing moves on screen and a real ridge in front still hides it.
    Picking and search keep the uncut runs.
  - Cost: ~3-4x the vertices of a line layer at the high tier (roads 58 K -> 216 K),
    fewer on the low tier's coarser grid.
  - Checked headless at relief 30 and 16 (Uttarakhand, Himachal, the Ghats, the lifted
    Uttarakhand block), before and after. Left: at relief 30 on a lifted block, a line
    deep in a narrow valley is still mostly hidden, which is largely honest occlusion.
    The marker shader still stands on the bilinear height, not the mesh's triangles.
- 2026-09-24, forty-sixth round: gestures and a performance audit.
  - Pinch on a phone was often read as a tilt or a twist (F5 above has the new rule).
  - An audit of the engine, the UI and the pipeline is in
    [docs/AUDIT-2026-09-24.md](AUDIT-2026-09-24.md): about 45 findings with file and
    line, ranked. Four are done:
    - the idle sway swings twice and settles, and the low tier does not sway, so an
      idle phone draws nothing;
    - the relief slider updates its own row instead of rebuilding the catalogue per
      step, and the URL is written once the drag stops;
    - the store compares arrays by their elements, and the shell queues its renders
      and runs each once per task (opening a page: 29 sheet mutations -> 16);
    - one `Intl.NumberFormat` per language instead of one per call.
  - Then five more:
    - a frame projects its markers through one reused projector (no per-marker arrays);
    - a pointer move marches the terrain once, lazily, not three times;
    - heights go to half floats through a 64 K lookup table (half the time, same bits);
    - the last state package is kept after leaving it (not on the low tier);
    - `raster.bounded_distance` is separable: same bytes, `npm run data` ~4.5 -> 2.4 min.
  - Found on the way: the committed `regions/states.json` and `terrain/shade-*.bin.gz`
    are not what the pipeline makes today (a few state anchors move ~2 km). The old and
    the new `bounded_distance` both give the new bytes, so this predates today; rebuilt
    and committed on its own. And `npm run data` calls the system `python3`, which has no
    numpy on the owner's Mac; `.venv/bin/python pipeline/build.py` works.
  - Next from the audit: the idle-sway tier question (medium sways), the uncapped
    marker/label collision loops, per-frame `lines.setView`, and in the pipeline
    `corridor` (24 s) and step caching in `build.py`.
- 2026-09-23, forty-fifth round: the language switch left the map. The owner found it too
  big beside the wordmark; it is now the first row at the foot of the contents, named in
  the other language with a globe, above the tour and the about fold.
- 2026-09-23, forty-fourth round: the industry layers filled out. The owner found the
  minerals, power and steel pages thin. Added, all as drafts with a Wikipedia article and
  the registry's publisher as sources: four steel plants (Angul, Meramandali, Sambalpur,
  Nagarnar, so the page now says fifteen inland and three coastal); thirty-six power
  stations (fifteen coal from Sasan and Tiroda down to Wanakbori, nine hydro from Idukki
  and Sharavathi to Purulia's pumped storage, the four missing nuclear stations, Rewa,
  Charanka, Kamuthi and Khavda for solar, Brahmanvel for wind, Bawana, Uran and Gandhar
  for gas); and twenty-one mineral fields, with a `chromite` category for Sukinda, which
  holds nearly all of India's. Offshore oil is anchored where it comes ashore -- Bombay
  High at Uran, the KG basin at Kakinada -- and the blurb says so, because the ID raster
  has no sea. Amarkantak sits on the MP-Chhattisgarh line and claims both.
  Facts that want a reviewer's eye: Khavda's running capacity (about 2,000 MW of a
  planned 30,000, 2024), Neyveli's combined figure after TPS-I retired, Anpara's four
  stages summed, Teesta III listed at its rating though its dam went in October 2023.
- 2026-09-23, forty-third round: one card, one stack (D14). The owner found the chrome
  confusing -- a menu for layers, a key card on the map, a sheet that was the contents,
  a page, a state and an item in turn, all in the same paper -- and asked for a
  consistent model with fewer screen elements. The mockup (six artboards over
  screenshots of the real map) was agreed and built in the same session.
  What went: the wordmark card, the page cartouche, the menu button and its panel, the
  key card, the corner buttons for the tour and the info screen, and the "On this page"
  rows that repeated the key. What is left on the map: the wordmark as text with the
  language toggle beside it, and the compass. The sheet holds one stack -- contents,
  page, state, item, and the catalogue of layers on top of any of them -- with a crumb
  above the title inside a page and Back popping one level. The key is the sheet's
  strip: one mark per layer drawn, greyed when hidden, "+ layer", and the scale bar; a
  tapped mark unfolds that layer's legend, caveat, sources and switch under the strip,
  and the strip is in the head, so the peek grows to fit it and a reader inside a state
  card can still look a colour up. Relief (with its slider), the surroundings and the
  graticule are the catalogue's first group, Base. The tour is a row at the foot of the
  contents and a play/pause on the card's step row; about-this-map and the credits are
  a fold at the same foot; a draft card says "Draft" in its meta line.
  Camera padding lost its left column, since nothing sits there but the compass.
  Two things found on the way: a button given focus inside the sheet's head could
  scroll the fixed, overflow-hidden app box and leave the map half off screen (the shell
  now pins that box's scroll to zero), and the browser-tool's ref clicks do exactly that,
  so a phone-sized check should click by coordinate. The share card still dresses the
  wordmark up as a card, so the poster CSS carries the paper material the wordmark lost.
- 2026-09-23, forty-second round: the sub-basins shaded apart within their basin.
  - An `areas` layer may say `"shades": {"by": <field>}`. The build keeps each area's
    category colour, turns a family (here, a basin) a few degrees round the wheel from
    any family of its category it touches, and gives each member a lightness step that
    no neighbour in the family has, largest first so the biggest keeps the plain colour.
    Items then carry `color`, and the engine draws per-area colours from an RGBA lookup
    (sRGB in the texture, decoded in the shader). The legend still shows the categories.
  - Fixed: on the basin pages the river mesh took every click ("Other rivers") and a
    hover named the state beneath. With an area fill on, the area now answers hover and
    click; a line wins only if it is a named course within 4 px. District census maps
    name the district on hover the same way.
  - The basins page shades too, with `"by": "id"`: every basin its own family. A hue
    turn alone was invisible on the soft greens (#8db39a against #8db3a3), so with `id`
    the whole category is one family and neighbours differ in lightness instead. The
    Godavari, Krishna, Mahanadi and Cauvery now read as four greens.

- 2026-09-23, forty-first round: six more district census maps, nine in all.
  - Scheduled Castes, the urban share ("Town and country"), women at work, work on the
    land ("Living off the land"), children under seven ("Where the children are") and
    women per 1,000 men, all ages ("Women and men"). Each is a folder and a page; no
    code beyond letting the census reader fold each district's rural and urban rows
    into its total one (`U_TOT_P`, `R_...`), which the urban share needed.
  - Every blurb's claim was checked against the numbers (the district extremes and the
    states named). The two sex-ratio maps share one red-to-green palette so the same
    colour means the same thing on both.
  - The nine district maps have their own contents heading, "Census 2011 by district"
    (a `census` section after People), rather than crowding People; a section is a
    list entry in `07_plates.py` and two strings, so no shell change was needed.

- 2026-09-23, fortieth round: district choropleths, three census maps in People.
  - **Drawn on the 2011 districts, not today's.** The 785 LGD polygons cannot carry
    2011 figures: 145 are newer than the census, and a split district's surviving polygon
    is the remnant, not what was counted. So a choropleth may say `"regions":
    "districts-2011"` and is drawn on DataMeet's `Census_2011` districts (already in the
    registry as `datameet-maps`), rasterised once to a uint16 raster
    (`layers/districts-2011.bin.gz`, 1920 x 2048, 77 KB, fetched only when a census map
    is on), cut to the SoI outline. PoK and Shaksgam are one uncounted polygon and stay
    clay; Aksai Chin is inside Leh, as the census counted it.
  - **Values from the Registrar General's own table**, the Primary Census Abstract for
    India, states and districts (`lib/census.py` reads the .xlsx with the stdlib). Its
    censusindia.gov.in address is dead; it comes from the Internet Archive's copy of that
    address. The layer declares its formula (`census: { numerator, denominator, per,
    digits }`, a `-COL` subtracts), so a new census map is a folder. Codes join all 640
    with none over. Cards use today's names in both languages from the district layer.
  - **Engine**: a fill with its own raster may carry two-byte ids (low, high); the
    lookup grows to 1,024 texels. `areas` is unchanged and state choropleths too.
  - Pages: literacy ("Who can read"), child sex ratio ("Missing girls"), Scheduled
    Tribes. Cards rendered. Also fixed: Jalore was lettered "kishangarh sub
    division.Ajmer" from a vandalised Wikidata label; a curated district may now give
    its headquarters.
  - **Next along this line**: the PCA has workers, SC share and households too, and the
    same mechanism takes any census table keyed by district code (religion, language,
    the Houselisting tables). Density needs areas, which the PCA does not carry.

### What exists

- `pipeline/` (Python, numpy + pillow only): EPSG:7755 LCC (`lib/lcc.py`), the project
  grid (`lib/grid.py`: 3341 x 3507 km, 1 unit = 1 km, rows north to south), a small
  shapefile reader, a gzip raster container (`lib/pack.py`), `01_boundaries.py`,
  `02_dem.py`, `05_manifest.py` and `build.py`, plus a TopoJSON reader (`lib/topo.py`),
  the district source (`lib/districts.py`) and a batched, cached, retrying Wikidata
  client (`lib/wikidata.py`). `npm run data` rebuilds everything in about 40 s; it was
  reproducible byte for byte and is now reproducible everywhere but three pixels of the
  two `shade` rasters, which drift by one between numpy versions (see the thirty-fifth
  round). Raw downloads are cached in `pipeline/raw/`, previews land in `pipeline/tmp/`.
- `public/data/`: committed outputs for two tiers, 960x1024 (first view, 1.15 MB) and
  1920x2048 (4.4 MB), plus `regions/states.json` and `manifest.json`. 24 layers and 14
  plates; the first-view tier is 1,271 KB of the 1.5 MB budget and every layer past the
  default set is lazily loaded.
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

0. **Phase 6, continued.** Plates, the contents page, the source registry and the share
   shells are in. The share cards are rendered: 14 of 14 pages have their own, made with
   `node tools/share-image.mjs` against a running server (Playwright is a tool here, not a
   dependency; `PLAYWRIGHT_MODULE` points at an npx copy). Re-run it with `ONLY=<page>
   FORCE=1` whenever a page's map changes. Everything else in Phase 6 is built and its exit is met: ten pages
   across eight sections, each of them a JSON file. `political` as a base style is
   specified in section 5 and deliberately unbuilt until a page needs it.
   **Phase 7 is the work now.** Cities and iron-and-steel landed on 2026-09-22; the 66
   items of minerals, cities and steel are drafts and want reading. The two still-empty sections
   were looked at and both are harder than they sound:
   - **Agriculture** wants a crop map, which would be the first choropleth whose values
     are claims rather than published numbers. A leading crop per state needs a source
     table, and a choropleth has no per-item review gate to catch a wrong row. The
     tables that exist (Ministry of Agriculture, via Wikipedia) are per-crop and of
     2014-15 vintage, so it wants deliberate sourcing rather than a quick page.
   - **History** cannot be a layer of sites: `places` already holds 139, among them most
     of what a history page would name (Ajanta, Sanchi, Nalanda, Hampi, Khajuraho,
     Konark, Fatehpur Sikri, the Qutb Minar, Lothal, the Cellular Jail). Two layers
     describing the same places with different blurbs is the sprawl the source registry
     was built to stop. What history wants instead is either a `period` on the places
     that have one -- which needs a way to colour points by a field and not only by
     category -- or the empires as `areas`, which is the better map and is blocked on
     polygons nobody publishes under a licence this project can use.
   Two smaller things the registry left behind: `content/layers/<id>/layer.json` still carries an
   `attribution` line that the build no longer ships (it says what the build did with the
   source, which is worth keeping for whoever edits the layer, but it is prose in a place
   nothing reads); and items still cite plain URLs, which is by design, but the busier
   hosts among them -- Wikipedia is on 291 items, UNESCO on 32 -- would read better
   resolved through the registry like everything else.
0. **Phase 5 is done bar one primitive.** Six of the seven are built, each proven on a
   real dataset with the full contract, and `src/` names none of the layers. Only
   `raster` is left and it is blocked on licensing, not on code: open question 13 sets
   out the three ways out. Once it is unblocked, or set aside, Phase 6 is the atlas shell
   -- plates, the contents page, `/atlas/<id>` URLs, the source registry, the cartouche
   and the scale bar -- which is what turns eighteen layers into pages someone can read.
   Two smaller things wait there too: the group vocabulary is physical / culture /
   network, and three layers have now been filed under a heading that does not really fit
   them, which Phase 6's sections are meant to settle.
0. **Phase 4 is done bar the owner's eyes.** F0-F8 and "The missing wow" items 1, 2 and
   4 all shipped on 2026-09-21, one commit each; item 3 was the handling itself. What
   remains needs a phone and a person: judge the momentum, the entrance and the new
   marker density on the reference device, and give the verdict that is the Phase 0 exit
   criterion and has never been signed off. Items 5-8 of that list wait behind that
   verdict on purpose -- they are there to be picked from once 1-4 have been looked at,
   not done blind.
1. Phase 3 leftovers: food as content, drafted the way the festivals and languages were, and
   probably regional for the same reason -- a dish belongs to a region, and two states
   hold GI tags on the same sweet. Districts have their source now and are drawn as lines
   and labels, coarse over the country and sharp inside a state; what is left there is
   district choropleths are built now, on the 2011 districts (fortieth round). Rivers have their state
   tier too; roads and rail could take one the same way when a closer look wants it.
   The scrubber has no map expression yet -- it changes what the sheet says, not what the
   model shows -- which is worth a look once there is more dated content than festivals.
2. Roads and rail ship as drafts: 35 highway and 21 railway cards to read, plus the two
   network items. The source is the Ministry's own network now and a highway joins by its
   number, so a road's course needs no checking beyond the eye; a railway's does, because
   a corridor join takes whatever track runs along the way and will have swept in a
   branch here and there. The gauge on every railway feature (BG, MG, NG) is an atlas map
   waiting to be drawn.
3. Owner: `npm install && npm run dev`, open it on the reference phone (the dev server
   listens on the LAN), judge fps and the look. Knobs: `PALETTE` and `CURVE` in
   `src/engine/terrain.js`, the default camera and relief in `src/main.js`, the light
   and band edges in `src/engine/shaders/terrain.frag.glsl`.
4. Phase 1, remaining: review the drafted facts and places (flip `status`, then turn
   the drafts default off in `src/main.js`; the tour then visits reviewed places only),
   lazy hi-res state packages (needs open
   question 1: they are about 1 MB each, 36 MB in all, too much for git), the poster image (needs open question 6), context-loss test on iOS,
   WebGL sprites for markers if the DOM ones ever get slow (they are fine at 50).
   Done on 2026-09-21: layer state in the URL, and the card carousel.
5. Settle open questions 6-7.
