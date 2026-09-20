# Bharat Darshan (भारत दर्शन)

An interactive, isometric 3D map of India. Explore the country's relief, rivers,
roads and railways, its languages, places, food and festivals, by tapping or
hovering over the map and zooming into any state.

Mobile first; uses the full width on larger screens.

**Status:** Phase 0 spike built: data pipeline, terrain engine and the bilingual shell.
Waiting on a real-device check. Details in [docs/PLAN.md](docs/PLAN.md), section 12.

## Run it

```
npm install
npm run dev        # http://localhost:5173, also reachable on the LAN for phone testing
npm run build      # static site in dist/ (with /en and /hi shells)
npm run preview
```

The generated map data under `public/data/` is committed. To rebuild it (about 40 s,
downloads about 30 MB of open data once):

```
pip install -r pipeline/requirements.txt
npm run data
```

- [Implementation plan](docs/PLAN.md)
- [Data pipeline](pipeline/README.md)
- [Notes for Claude Code sessions](CLAUDE.md)
