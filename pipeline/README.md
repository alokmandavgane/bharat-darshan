# Data pipeline

Offline build that turns public elevation and boundary data into the small static files
under `public/data/`. Python 3.11+, numpy and pillow only (see `requirements.txt`);
everything is pre-projected to EPSG:7755 (see `lib/lcc.py`, `lib/grid.py`).

```
pip install -r pipeline/requirements.txt
npm run data                      # = python3 pipeline/build.py
python3 pipeline/02_dem.py --zoom 8 --tiers 2048   # one step, with options
```

Raw downloads are cached in `pipeline/raw/` and previews land in `pipeline/tmp/`; both
are git-ignored. The generated files are committed while they are only a few MB
(PLAN.md, open question 1).

| Step | Makes | Source |
|------|-------|--------|
| `01_boundaries.py` | `regions/states-ids-{H}.bin.gz`, `regions/states.json` | DataMeet community maps: `States/Admin2.shp` (36 units, official boundary) and `Country/india-soi.geojson` (Survey of India outline), CC BY 4.0 |
| `02_dem.py` | `terrain/heights-{H}.bin.gz`, `terrain/shade-{H}.bin.gz`, `regions/states-borders-{H}.bin.gz` | AWS Terrain Tiles (Terrarium), zoom 7 by default |
| `04_layers.py` | `layers/<id>.json` | `content/layers/<id>/`; a `lines` layer also fetches the source named in its `layer.json` (rivers: Natural Earth 10m physical vectors, public domain) |
| `05_manifest.py` | `manifest.json` | hashes of the above |

Names, ISO codes and the raster id of every state live in `content/states/states.json`;
ids are never renumbered.

All rasters share the project grid: rows run north to south, and a tier named `H`
is `H` pixels tall (`960x1024` and `1920x2048` today). `lib/pack.py` documents the
`.bin.gz` container; `src/engine/pack.js` is its decoder.
