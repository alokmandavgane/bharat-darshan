# Bharat Darshan

Interactive isometric 3D map of India (geography + culture layers), mobile first,
English + Hindi. Read [docs/PLAN.md](docs/PLAN.md) before doing anything: it holds
the decisions, architecture, data sources, budgets, roadmap, open questions and
current status.

## Decisions already made (see PLAN.md section 2 for the reasoning)

- Pre-baked 3D diorama: offline data pipeline + custom three.js (WebGL2) scene.
  Not MapLibre / deck.gl, unless the Phase 0 spike fails its exit criteria.
- Orthographic camera, north-up with a slight yaw. Not strict 45° isometric.
- Two semantic levels (country, state) with lazily loaded state packages. No
  street-level detail.
- Tap + bottom sheet is the core interaction; hover is a desktop enhancement.
- Layers are data: a layer is a folder under `content/layers/<id>/` (a `layer.json`
  plus `items.json`). The engine knows layer types (terrain, choropleth, lines,
  points), never layer ids. Adding a layer must not need changes under `src/`.
- Stylised look: a hand-made clay / paper model. No imagery, no realism.
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
