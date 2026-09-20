# Bharat Darshan

Interactive isometric 3D map of India (geography + culture layers), mobile first.
Read [docs/PLAN.md](docs/PLAN.md) before doing anything: it holds the decisions,
architecture, data sources, budgets, roadmap, open questions and current status.

## Decisions already made (see PLAN.md section 2 for the reasoning)

- Pre-baked 3D diorama: offline data pipeline + custom three.js (WebGL2) scene.
  Not MapLibre / deck.gl, unless the Phase 0 spike fails its exit criteria.
- Orthographic camera, north-up with a slight yaw. Not strict 45° isometric.
- Two semantic levels (country, state) with lazily loaded state packages. No
  street-level detail.
- Tap + bottom sheet is the core interaction; hover is a desktop enhancement.
- Layers are data: four layer types (terrain, choropleth, lines, points) driven by a
  manifest. Adding a layer should not need engine changes.

## Rules

- **Boundaries:** only Survey of India-compliant external boundaries (all of J&K and
  Ladakh including Aksai Chin; Arunachal Pradesh). Never swap in default Natural
  Earth or OSM country outlines, including in share images and placeholders.
- **Engine / UI split:** `src/engine` never imports React; UI code never touches
  three.js objects. They meet in the store.
- **Mobile budgets are requirements:** JS <= ~350 KB gz, first-view data <= ~1.5 MB,
  render on demand, DPR capped. See PLAN.md section 7.
- **Data:** everything is pre-projected offline to EPSG:7755. Raw downloads and
  pipeline caches stay out of git.
- **Content:** every media item needs credit, licence and source. Cite sources for
  facts; keep a neutral tone on contested topics.

## Workflow

The owner works on this from several machines. At the end of a working session,
update the Status section of docs/PLAN.md (and this file if a decision changed), so
the next session on any machine can pick up.
