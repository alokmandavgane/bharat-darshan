# Physical layers

Design note for the physical-geography layers. It expands PLAN.md section 5 (a layer
is a folder) and section 9, Phase 2, and it assumes the conventions already fixed
there: EPSG:7755 everywhere, layers are data under `content/layers/<id>/`, the engine
knows layer types and never layer ids, every item carries `sources` and a `status`,
and every user-facing string exists in English and Hindi.

Nothing here is decided. It is a proposal with sizes, sources and the engine work
each layer implies, so the cost of each one is visible before any of it is built.

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
layer here with no authoritative open vector: the polygons have to be drawn by hand
against the relief and reviewed, which is content work, not pipeline work.

```yaml
# content/layers/physical-divisions/layer.yaml
id: physical-divisions
type: areas
group: relief
title: { en: Physical divisions, hi: भौतिक विभाग }
icon: layers
raster: divisions            # pipeline rasterises items.geojson to an 8-bit id map
palette: categorical
opacity: 0.55                # the relief must stay readable underneath
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
type. The recommendation is `areas`, because the items want the base item schema and
choropleth's palette and legend model is built for continuous values.

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
| `basins` id raster, 1024 | 20 to 50 KB |
| `physical-divisions` id raster, 1024 | 10 to 30 KB |
| `peaks` | about 5 KB |
| `passes` | about 3 KB |
| `ranges` spines | about 2 KB |
| `reference-lines` | under 1 KB |

Tier 1 together is roughly 70 to 130 KB, which is comfortable. The expensive layers
are all in Tier 3, where the raster types arrive.

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

## 9. Open questions

1. `areas` as a new layer type, or choropleth generalised with `region_source`?
2. Is a 1024 id raster enough for divisions and basins at country level, given that
   both have long thin features along the coast and the Himalayan foot?
3. Who draws the physical-division polygons, and against which published map, so
   that each one can cite a source?
4. Islands. Andaman and Nicobar sit about 1200 km off the mainland, so at country
   framing they are specks. Do they get an inset, a camera preset, or both? Barren
   Island, India's only active volcano, and Indira Point, its southernmost land, are
   both strong content and both invisible at the default camera.
5. Do lakes need real outlines at country level, or are anchors enough until state
   view?
