# Bharat Darshan

An online interactive atlas of India on an isometric 3D model: pages ("plates") for
political, physical, climate, resources, industry, people, culture, fed by many data
sources. Mobile first, English + Hindi. Read [docs/PLAN.md](docs/PLAN.md) before doing anything: it holds
the decisions, architecture, data sources, budgets, roadmap, open questions and
current status.

## Decisions already made (see PLAN.md section 2 for the reasoning)

- Pre-baked 3D diorama: offline data pipeline + custom three.js (WebGL2) scene.
  Not MapLibre / deck.gl, unless the Phase 0 spike fails its exit criteria.
- Orthographic camera. The home view is north-up with a slight yaw, not strict 45°
  isometric; yaw is free through 360° and the compass brings north back.
- One camera rule (D13): a turn, tilt or zoom pivots on the 3D surface point grabbed
  when the gesture began, and that point stays put on screen. The target stays on the
  model; the key light stays upper-left of the screen as the model turns.
- Two semantic levels (country, state) with lazily loaded state packages. No
  street-level detail.
- Tap + bottom sheet is the core interaction; hover is a desktop enhancement.
- Layers are data: a layer is a folder under `content/layers/<id>/` (a `layer.json`
  plus `items.json`). The engine knows layer types (terrain, choropleth, lines,
  points, regional, and the rest of PLAN.md section 5's "Primitives" table) and marker
  kinds (token, label, symbol, dot, model), never layer ids. A figurine is a recipe under
  `content/models/`, not a mesh file. Adding a layer must not need changes under `src/`.
- Primitives first, then data (D12): finish the closed set of layer types, each proven
  on one real dataset with the full contract (legend, picking, card, search, URL, both
  languages), before adding maps in bulk.
- Plates over layers (D11): an atlas page is a JSON file under `content/plates/` naming
  a base style, layers and a camera. Adding a plate must not need changes under `src/`.
- Stylised look: a hand-made clay / paper model. No imagery, no realism. Markers are
  clay too: pegs, beads and figurines standing on the relief, drawn by the GPU, never
  flat stickers. The sea, the neighbours and the graticule show by default.
- English + Hindi from the first screen. Every user-facing string and content field
  exists in both.
- Content is AI-drafted and human-reviewed: items carry `sources` and a `status`;
  only `reviewed` items ship.

## Rules

- **Dependencies:** the owner avoids them. Plain JS ES modules: no TypeScript, no
  JSX, no UI framework, no codegen. three.js is the only runtime dependency and Vite
  the only build tool. Store, router, i18n, bottom sheet and gestures are small
  in-repo modules. The pipeline stays light too (Python stdlib + numpy + pillow until
  a step truly needs more). Do not add a dependency without asking.
- **Boundaries:** only Survey of India-compliant external boundaries (all of J&K and
  Ladakh including Aksai Chin; Arunachal Pradesh). Never swap in default Natural
  Earth or OSM country outlines, including in share images and placeholders.
- **Engine / UI split:** `src/engine` never touches the DOM outside its canvas and
  label container; UI code never touches three.js objects. They meet in the store.
- **Mobile budgets are requirements:** JS <= ~300 KB gz, first-view data <= ~1.5 MB,
  render on demand, DPR capped. See PLAN.md section 8.
- **Data:** everything is pre-projected offline to EPSG:7755. Raw downloads and
  pipeline caches stay out of git.
- **Content:** every media item needs credit, licence and source. Cite sources for
  facts; keep a neutral tone on contested topics.
- **Sources:** every dataset is declared once in `content/sources.json` and cited by id;
  each layer and plate must name at least one. The build refuses an unknown id, a layer
  that cites only URLs, a source marked `blocked`, and a source whose licence does not
  permit redistributing what we would ship. The credits screen and every source line are
  generated from it, so do not hand-write attribution anywhere.
- **Generated data:** `public/data/` is committed and rebuilt with `npm run data`
  (reproducible byte for byte; commit data changes separately from code). State
  raster ids come from `content/states/states.json` and are never renumbered.
- **Commits:** one feature or concern per commit.

## Workflow

The owner works on this from several machines. At the end of a working session,
update the Status section of docs/PLAN.md (and this file if a decision changed), so
the next session on any machine can pick up.

Checking a change: `npm run build`, then load the preview in a browser. In the web
sandbox there is no display, but Playwright's Chromium renders WebGL2 through
SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`), which catches
shader errors and layout mistakes; use `?quality=low` there, SwiftShader cannot keep
up with the desktop tier. `pipeline/tmp/preview-*.png` shows the rasters. `window.bd`
exposes the store and engine for checks from the console or a script. Headless
Chromium idles requestAnimationFrame unless something draws, so camera flights stall
there: force frames (mouse moves) or check the end state, and prefer `channel:
'chromium'` (new headless) over the headless shell for anything animated.
