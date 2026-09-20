# Physical layers

Design note for the physical-geography layers. It expands PLAN.md section 5 (a layer
is a folder) and section 9, Phase 2, and it assumes the conventions already fixed
there: EPSG:7755 everywhere, layers are data under `content/layers/<id>/`, the engine
knows layer types and never layer ids, every item carries `sources` and a `status`,
and every user-facing string exists in English and Hindi.

The layer inventory is a proposal, with sizes, sources and the engine work each
layer implies, so the cost of each one is visible before any of it is built. The
five questions that proposal raised are settled in section 9, which records the
reasoning rather than just the answer.

## 1. Why these, and in this order

Relief alone is a beautiful object that teaches nothing. A viewer sees that the
north is high and the middle is flat, but cannot name what they are looking at.
Each layer below exists to answer one question a viewer actually asks, in the order
they ask it.

| Question | Layer |
|----------|-------|
| What am I looking at? | `physical-divisions` |
| What are those mountains called? | `ranges` |
| How high is that one? | `peaks` |
| Where does the water go? | `rivers`, `basins` |
| How do people cross the mountains? | `passes` |
| Where exactly on the globe is this? | `reference-lines` |

That set is Tier 1. It is the smallest group that turns the diorama into a map, and
it is the recommended Phase 2 scope.

## 2. Inventory

| Layer | Type | Tier | Notes |
|-------|------|------|-------|
| `physical-divisions` | areas (new) | 1 | The six textbook regions. The framing layer. |
| `ranges` | lines | 1 | Labels along ridge spines; the line itself is not drawn. |
| `peaks` | points | 1 | Elevation from item data, never sampled from the DEM. |
| `rivers` | lines | 1 | Width by stream order, optional flow animation. |
| `basins` | areas (new) | 1 | Makes rivers a system rather than squiggles. |
| `passes` | points | 1 | Where geography turns into history and trade. |
| `reference-lines` | lines | 1 | Tropic of Cancer, 82.5°E standard meridian. |
| `landforms` | areas | 2 | Plateaus, deserts, the Rann, deltas, glaciers. |
| `lakes` | points | 2 | Points at country level; outlines only in state view. |
| `waterfalls` | points | 2 | High delight per kilobyte. |
| `dams` | points | 2 | Where physical geography meets what was built on it. |
| `coasts` | lines | 2 | Konkan, Malabar, Coromandel; gulfs, straits, capes. |
| `bathymetry` | terrain | 2 | Already in the elevation data. A palette change, not a fetch. |
| `monsoon` | flows (new) | 3 | Normal onset isolines. The highest-wow layer in the project. |
| `rainfall` | raster (new) | 3 | Annual normals. |
| `forest` | raster (new) | 3 | Forest Survey of India cover classes. |
| `soils` | choropleth | 3 | Explains the crops, and pairs with the culture layers. |
| `seismic` | choropleth | 3 | Zones II to V. |
| `protected` | points + areas | 3 | Parks, tiger reserves, Ramsar wetlands. |

Tier 3 waits on the `raster` and `flows` layer types that PLAN.md section 5 already
anticipates. Nothing in Tier 1 or Tier 2 needs them.

## 3. Tier 1 in detail

### physical-divisions

The Himalayan north, the Northern Plains, the Peninsular Plateau, the Coastal
Plains, the Thar Desert and the Islands. This is how Indian physical geography is
taught, so it is the layer that makes every other one legible. It is also the one
layer here with no authoritative open vector, so it is derived and then corrected
rather than drawn freehand. See decision 3.

```yaml
# content/layers/physical-divisions/layer.yaml
id: physical-divisions
type: areas
group: relief
title: { en: Physical divisions, hi: भौतिक विभाग }
icon: layers
raster: { id: divisions, size: 2048 }   # 8-bit id map, one resolution, decision 2
palette: categorical
fill: { opacity: 0.55, edge: feather }  # gradational limits get soft edges
label: { centroid: true, size: lg }
tooltip: "{name}"
card: [name, area_km2, states, blurb, sources]
country_view: always
attribution: Drawn for this project; see each item's sources.
```

### ranges

The relief already shows the mountains. What is missing is their names, so this
layer draws no line at all: each range is a polyline along its ridge that exists
only to carry a label. Himalaya, Karakoram, Zanskar, Pir Panjal, Aravalli, Vindhya,
Satpura, Western Ghats, Eastern Ghats, Nilgiris, Purvanchal, Shillong Plateau.

```yaml
id: ranges
type: lines
group: relief
title: { en: Mountain ranges, hi: पर्वत श्रेणियाँ }
style: { render: none }      # spine geometry, label only
label: { along: true, size: lg, letter_spacing: 0.14 }
card: [name, length_km, highest_peak, states, blurb, sources]
```

### peaks

Roughly sixty entries: the eight-thousanders in territory India claims, the highest
point of each state, and the peaks people have heard of. Kangchenjunga, Nanda Devi,
Kamet, K2 and Saltoro Kangri in the north; Anamudi, Doddabetta, Mullayanagiri and
Guru Shikhar in the peninsula; Kangto in the east; Dhupgarh on the Satpura.

The "highest in your state" hook is worth building the layer for on its own.

```yaml
id: peaks
type: points
group: relief
title: { en: Peaks, hi: चोटियाँ }
icon: peak
categories:
  - { id: eight-thousander, title: { en: Above 8000 m, hi: 8000 मीटर से ऊपर } }
  - { id: state-highest,    title: { en: Highest in state, hi: राज्य का उच्चतम बिंदु } }
  - { id: notable,          title: { en: Notable, hi: उल्लेखनीय } }
fields:
  elevation_m: { type: int }
  range:       { type: ref, layer: ranges }
pin: { to: terrain, leader: true }   # see section 5
tooltip: "{name} · {elevation_m} m"
card: [name, elevation_m, range, states, blurb, sources]
country_view: aggregate
```

### rivers and basins

Rivers come from HydroRIVERS with stream order, so width and the flow animation
speed are attribute-driven and need no hand tuning. Names have to come from
elsewhere and be reviewed.

Basins are the reason to build rivers at all. A river on its own is a line; the
Ganga basin shaded across a quarter of the country is a fact people remember.
Confluences worth naming as points: Devprayag, Prayagraj, and the Brahmaputra
meeting the Ganga in the delta.

```yaml
id: rivers
type: lines
group: water
title: { en: Rivers, hi: नदियाँ }
style:
  colour: water
  width_by: { field: order, stops: [[5, 1.0], [7, 2.2], [9, 4.0]] }
  flow: { enabled: true, speed_by: order }
levels: { country: "order >= 6", state: "order >= 4" }
label: { along: true, size: sm }
tooltip: "{name}"
card: [name, length_km, basin, rises_in, drains_into, blurb, sources]
attribution: HydroRIVERS (WWF and McGill University); names from OpenStreetMap
```

### passes

Thirty or so. Zoji La, Khardung La, Rohtang, Nathu La, Bomdi La in the mountains;
the Palakkad Gap, Thal Ghat and Bhor Ghat in the Ghats. The peninsular gaps are the
better story: they explain where the railways went and why the monsoon reaches the
rain shadow the way it does.

### reference-lines

The Tropic of Cancer and the 82.5°E standard meridian. A few hundred bytes for two
dashed polylines, and they answer "which states does the Tropic cross" and "why is
Indian Standard Time five and a half hours ahead", both of which are near-universal
school memories.

## 4. Tier 2 notes

`bathymetry` deserves attention because it costs almost nothing. The AWS Terrain
Tiles source already includes sea-floor elevation, so the continental shelf, the
Lakshadweep ridge and the arc that carries the Andamans are sitting unused in data
already downloaded. Revealing them is a palette and a shader branch, not a fetch.

`landforms` reuses whatever `areas` turns out to be. Glaciers belong here, including
the Gangotri and Siachen systems.

## 5. New engine work

Four pieces, in the order they block things.

**The `areas` layer type.** Choropleth as specified binds values to the existing
state and district id rasters. Physical divisions and basins are neither: they are
categorical named regions with their own geometry, their own id raster, cards and
selection. Two options. Either generalise choropleth with an optional
`region_source` so a layer can ship its own raster, or add `areas` as a third region
type. Decision 1 takes `areas`, because the items want the base item schema and
choropleth's palette and legend model is built for continuous values. Decisions 2
covers what it ships and how its edges are drawn.

**A label engine.** This is the largest piece and the one most likely to be
underestimated. Ranges and rivers need text placed along a projected polyline,
oriented to the curve, thinned under collision, and laid out again when the camera
moves. Point labels need the same collision pass. Without it the map is a tangle at
any zoom where more than a handful of features are visible.

**Terrain pinning for points.** A marker's height has to be sampled from the
displaced surface and run through the same exaggeration curve as the mesh, or every
peak and pass will drift when the relief slider moves. Peaks additionally need a
leader line, because of the resolution problem below.

**A legend.** The banded clay palette is decorative until a viewer can read it, and
every categorical layer here needs one too.

### The peak elevation trap

A summit cannot be represented at country resolution.

| Quantity | Value |
|----------|-------|
| Country grid, 1024 tier | about 3.4 km per pixel |
| Country grid, 2048 tier | about 1.7 km per pixel |
| Elevation source, zoom 7 | about 1.1 km per pixel |
| Footprint of a summit | well under 1 km |

So the height sampled at Kangchenjunga's coordinates is substantially below 8586 m,
and will change between quality tiers. Two consequences, both mandatory:

- The elevation shown in a tooltip or card comes from the item's `elevation_m`
  field, which is sourced and reviewed. It is never read from the heightmap.
- The marker is pinned to the rendered surface and drawn with a leader line, so it
  reads as "this peak is here" rather than appearing to float or sink.

## 6. Data sources

| Layer | Source | Licence |
|-------|--------|---------|
| `rivers` | HydroRIVERS (HydroSHEDS) | Free with attribution; confirm the exact terms before shipping |
| River and peak names | OpenStreetMap | ODbL, attribution required |
| `peaks`, `passes` | Wikidata (elevation P2044) seeded, then curated | CC0 for Wikidata; the curation is ours |
| `ranges` | Spines drawn against the relief | Ours; cite a source per range |
| `physical-divisions`, `landforms` | Drawn by hand, reviewed | Ours; cite sources per item |
| `basins` | HydroBASINS, clipped | As HydroRIVERS |
| `bathymetry` | AWS Terrain Tiles, already fetched | Open data with attribution |
| `monsoon`, `rainfall` | India Meteorological Department normals | Confirm terms; government publication |
| `forest` | Forest Survey of India, State of Forest Report | Confirm terms |
| `soils` | NBSS and LUP soil map | Confirm terms |
| `seismic` | BIS seismic zoning, IS 1893 | Confirm terms |

Hindi names are part of the content work for every layer here and will not come from
any of these sources.

## 7. Budget

Estimates to verify in the pipeline, gzipped, country level. Every layer loads on
first toggle, so none of this touches the first-view budget in PLAN.md section 8.

| Layer | Estimate |
|-------|----------|
| `rivers`, order >= 6 | 25 to 40 KB |
| `basins` id raster, 2048 | 25 to 60 KB |
| `physical-divisions` id raster, 2048 | 15 to 40 KB |
| `peaks` | about 5 KB |
| `passes` | about 3 KB |
| `ranges` spines | about 2 KB |
| `reference-lines` | under 1 KB |

Tier 1 together is roughly 75 to 150 KB, which is comfortable. The shipped state id
raster at 2048 is 31 KB for 36 regions, which is the anchor for those two estimates:
divisions has a seventh as many regions and far shorter internal edges, basins about
half as many. The expensive layers are all in Tier 3, where the raster types arrive.

The number deliberately absent is a signed-distance edge texture. The equivalent for
state borders costs 96 KB at 1024 and 236 KB at 2048, which would more than double
this table. Decision 2 says why the areas layers do not need one.

## 8. Boundary compliance

CLAUDE.md requires Survey of India-compliant external boundaries. For these layers
that has three consequences that are easy to miss.

- **Clip to our outline, not the source's.** HydroRIVERS, HydroBASINS and OSM all
  carry their own country geometry. A river clipped to a source's polygon will stop
  at the wrong line, which draws a non-compliant boundary in negative space even
  though our outline is correct. Every clip operates on our own projected outline.
- **Named features in claimed territory belong in the data.** The plan takes all of
  Jammu and Kashmir and Ladakh, including Aksai Chin, and Arunachal Pradesh. Peaks,
  glaciers, passes and river reaches there are included on the same footing as
  everywhere else. K2, Saltoro Kangri and the Siachen glacier are the notable
  entries.
- **Share images inherit this.** The Open Graph card and the QR assets under
  `public/share/` already render the silhouette from our own region raster. Any new
  share image does the same, never from a mapping library default.

Keep a neutral tone in blurbs for features in disputed areas, as section 5 requires
for contested topics generally.

## 9. Decisions

Taken 2026-09-20. Each one is reversible; the reasoning is recorded so that
reversing it is a decision too.

**1. `areas` is a new layer type, not a generalised choropleth.** Choropleth binds
values to the administrative id rasters and its palette and legend model is built
for continuous data. Divisions, basins and landforms are categorical named regions
that carry their own geometry, their own cards and their own selection, and their
items want the base item schema. Forcing them through choropleth would mean an
optional `region_source`, a second palette mode and a second legend mode inside a
type that currently has one of each. A third region type is the smaller change.
This makes `areas`, `raster` and `flows` the three new types the project expects,
and the engine still knows no layer ids.

**2. Area id rasters ship at 2048, in a single resolution, with feathered edges and
no distance field.** Three parts, each with a reason.

- *2048, up from 1024.* The thin features decide it. The coastal plain narrows to
  roughly 20 to 50 km in places, which is six to fifteen pixels at the country
  grid's 3.4 km, and the Himalayan foot is thinner still. At 1.7 km those features
  survive simplification and hit-testing. The shipped state id raster at 2048 costs
  31 KB for 36 regions, so the increase is tens of kilobytes, not hundreds.
- *One resolution, not per-tier.* The quality tiers exist for mesh density and
  displacement cost. A flat categorical lookup has neither. A 2048 single-channel
  texture is 4 MB on the GPU against a budget of 150 MB, which the low tier can
  afford, and one resolution halves the pipeline output and the manifest entries
  for these layers. This deliberately differs from the state raster, which ships
  per tier because it is sampled in the terrain shader alongside the heightmap.
- *Feathered edges, no signed-distance texture.* State borders get a distance field
  because an administrative border is an exact line. A physical division is not:
  nobody can say which kilometre the plain becomes the plateau. So the edge is
  softened in the shader from the id texture itself, which is cheaper, truer to the
  clay and paper look, and honest about the data. It also saves the 96 KB at 1024
  or 236 KB at 2048 that the state border field costs.

**3. Division polygons are derived in the pipeline, then corrected by hand.**
Freehand polygons cannot be re-run, cannot be reviewed against anything, and cannot
cite a source. A first pass can be derived from data the project already has:
elevation and slope separate the mountain divisions, the plains fall out of low
elevation inside the Indus and Ganga basins, the plateau is the high ground south
of them, and the coastal plains are a distance-from-coast band below a height
threshold. The Thar needs an aridity mask or a hand edit, and the islands come
straight from the boundary.

That pass is a drafting aid, not the shipped layer. A human corrects it against a
published physical map, each item cites which one, and only `status: reviewed`
items ship, exactly as for every other content item. The thresholds live in the
layer folder so the derivation re-runs and the hand corrections stay visible as
diffs against it. Because the derivation reads the basins, `basins` is built before
`physical-divisions`.

**4. Islands get camera presets and a locator, not an inset.** An inset is a second
viewport with its own camera, picking, labels and render pass, which is a large
amount of engine work for two island groups and it fights the feeling of one object
you hold and turn. The cheaper path already exists: the URL carries view state and
regions already have anchors, so Andaman and Nicobar and Lakshadweep become two
more places to fly to at no new cost. Discoverability is the real problem, so they
get a labelled marker each at country view that flies the camera on tap. Revisit
only if testing shows people still never find them. Barren Island and Indira Point
are content items inside those views.

**5. Lakes are anchors at country level and outlines in state packages.** At 3.4 km
per pixel an outline is not informative for most of them. Vembanad is about 96 km
long and around 3 km wide, so its shape collapses to a line, and Wular and Sambhar
are smaller again. A marker states the position more clearly than a degenerate
polygon does, and the largest water bodies already show up in the terrain shading
where the elevation data captures them. Outlines arrive with the state packages,
whose grids are fine enough to carry them.
