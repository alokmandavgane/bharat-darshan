// @ts-check
// The engine: a three.js scene behind a small API. It touches nothing in the DOM but its
// canvas, and talks to the UI only through the store (PLAN.md section 4).
import { Color, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { blockDimensions, createBlock, createCountryWalls } from './block.js';
import { asChoropleth, choroplethLookup, FILL_TYPES, prismLookup } from './choropleth.js';
import { createLines } from './lines.js';
import { createGraticule } from './graticule.js';
import { createWorld } from './world.js';
import { basis, DEFAULT_CAMERA, fitBounds, groundAnchor, MAX_MAGNIFY, setZoomFloor, unwrapYaw, wrapYaw, ZOOM_MIN } from './camera-math.js';
import { DATA_BASE, loadJson, loadManifest, loadStatePackage, loadStateIndex, loadStates, loadTier, loadWorld, unionBbox } from './data.js';
import { createIdle } from './idle.js';
import { createLabels } from './labels.js';
import { createMarks } from './marks.js';
import { loadPack } from './pack.js';
import { biasedPick, createHeightfield, landMask, pickTerrain, projectGround } from './picking.js';
import { createPoints, markerScale, priorityAt } from './points.js';
import { pickQuality } from './quality.js';
import { createTerrain, CURVE } from './terrain.js';
import { byteTexture } from './textures.js';
import { createTour } from './tour.js';
import { easeOutCubic, reducedMotion, tween } from './tween.js';

const CAMERA_DISTANCE = 7000;   // km; anywhere outside the model works for an orthographic camera
const FIRST_TIER = '1024';      // always first: it is the first-view budget (PLAN.md section 8)
const STATE_EXAG = 0.6;         // relief eases down when a state is lifted out (PLAN.md section 6)
const ITEM_ZOOM = 700;          // km of view height when flying to a place at country level
// The entrance: how far overhead the model starts, and how long it takes to rise.
const RISE = { fromPitch: 84, ms: 1400 };

/**
 * @param {{ canvas: HTMLCanvasElement, store: ReturnType<import('../state/store.js').createStore>,
 *           labelContainer?: HTMLElement, markerContainer?: HTMLElement,
 *           labelText?: (unit: any, lang: string) => string }} opts
 */
export function createEngine({ canvas, store, labelContainer, markerContainer, labelText }) {
  const quality = pickQuality();
  const renderer = new WebGLRenderer({
    canvas, antialias: true, alpha: true, premultipliedAlpha: true, stencil: false, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dprCap));
  renderer.setClearColor(0x000000, 0);   // the page's paper shows through where the model fades out
  renderer.autoClear = false;            // render() clears once, then draws the backdrop and the model
  const scene = new Scene();
  const backdrop = new Scene();          // the wide sheet behind the model, on its own depth buffer
  const camera = new OrthographicCamera(-1, 1, 1, -1, 200, 16000);
  camera.up.set(0, 1, 0);

  let terrain = null;
  let field = null;            // CPU heightfield + ids of the tier on screen, for picking
  let sizeKm = null;
  let manifest = null;
  let viewport = { w: 1, h: 1 };
  let needsRender = false;
  let cancelFly = null;
  let cancelRelief = null;
  let cameraTouched = false;   // once the user moves the camera, layout changes stop refitting
  let level = { name: 'country' };
  let block = null;            // the lifted state block while in the state view
  let dropping = null;         // the outgoing block mid-sink, so a handover cancels nothing
  let lines = null;            // every `lines` layer on screen, once loaded
  let marks = null;            // the beads and figurines the GPU draws (marks.js), once the terrain exists
  let world = null;            // the wide backdrop, once Surroundings has asked for it
  let worldLoad = null;
  let graticule = null;        // the parallels and meridians, once they have been asked for
  let graticuleLoad = null;
  let raised = null;           // { id, km }: the block, for picking and projecting
  let fineIds = null;          // 2048-tier ids for the block when the tier on screen is coarser
  let tierIds = null;          // the tier on screen, for the land mask the camera clamp uses
  let countryMask = null;      // ...and that mask for the whole country, built once
  let stateIndex = null;       // the state-package index, once fetched
  let pkgLoad = null;          // AbortController for the package in flight
  let countryKmPerPx = 0;      // ground size of one height texel in the country tier on screen
  let localKmPerPx = 0;        // ...and in the state package, while one is bound
  let cancelLevel = null;
  let countryWalls = null;     // the cut-out's sides when surroundings are hidden
  const labels = createLabels(labelContainer, labelText);
  const points = createPoints(markerContainer, {
    text: (field, lang) => field?.[lang] || field?.en || '',
    onSelect: (layer, id) => {
      const data = points.find(layer, id);
      store.set('item', data ? { layer, id, data, categories: points.categories(layer), fields: points.fields(layer) } : null);
    },
  });

  // --- render on demand: nothing draws unless something changed
  function invalidate() {
    flowCheck();
    if (needsRender) return;
    needsRender = true;
    requestAnimationFrame(render);
  }

  /** The GPU part of a frame, on its own because the flow needs it and nothing else. */
  function draw() {
    if (!terrain) return;
    applyCamera();
    // The backdrop is scenery behind the model, not part of it. Drawing it first and
    // clearing the depth buffer after it means the plate covers it wherever the plate is
    // opaque, however far a coarse hill pokes above the fine one under it, and it shows
    // only through the rim the plate fades out over.
    renderer.clear();
    if (world?.mesh.visible) {
      renderer.render(backdrop, camera);
      renderer.clearDepth();
    }
    renderer.render(scene, camera);
  }

  function render() {
    needsRender = false;
    if (!terrain) return;
    const cam = store.get('camera');
    const active = new Set(store.get('layers')?.active || []);
    // The GPU markers decide what shows before the frame is drawn; the HTML ones after,
    // since they are placed on it. Both thin by the same zoom bands and shrink together.
    // The share-image render shows the model without its names: the CSS hides the HTML
    // markers. The clay pieces are part of the model and draw as they would for a visitor,
    // so a page's card carries what the page is about (a figurine per product, a bead per
    // town); when the markers were flat stickers they were left off the cards.
    const now = performance.now();
    const until = marks?.setView({ active, level, drafts: !!store.get('drafts'), month: store.get('month'),
      maxPriority: priorityAt(cam.zoom), selected: store.get('item'), scale: markerScale(cam.zoom), now }) || 0;
    draw();
    if (until > now) invalidate();      // pieces are still springing up
    // Markers first (they are interactive), the state names among them where points.js
    // says -- ahead of a page's own names only when no page is open -- and the towns'
    // names last, keeping clear of everything.
    points.update({ project, level, viewport, camera: cam, active,
      selected: store.get('item'), lang: store.get('lang'), drafts: !!store.get('drafts'), month: store.get('month'),
      stateNamesFirst: !store.get('plate'),
      stateNames: (taken) => labels.update({ project, level, viewport, camera: cam, regions: store.get('regions'),
        selection: store.get('selection'), hover: store.get('hover'), lang: store.get('lang'), avoid: taken }) });
  }

  // --- the flow (PLAN.md section 8): the one thing here that draws while nothing has
  // changed, so it is kept on a short leash. Medium tier and up, capped well under the
  // display, stopped the moment the tab is hidden, the visitor asks for less motion or
  // the last layer whose runs move goes off. Only the GPU part of the frame runs: the
  // camera has not moved, so no marker or label has anywhere to go.
  const FLOW_FPS = 30;
  let flowRaf = 0;
  let flowLast = 0;
  function flowAllowed() {
    return quality.name !== 'low' && !document.hidden && !reducedMotion() && !!lines?.flowing;
  }
  function flowTick(now) {
    if (!flowAllowed()) { flowRaf = 0; return; }
    flowRaf = requestAnimationFrame(flowTick);
    if (now - flowLast < 1000 / FLOW_FPS) return;
    flowLast = now;
    lines.setTime(now / 1000);
    draw();
  }
  function flowCheck() {
    if (!flowRaf && flowAllowed()) flowRaf = requestAnimationFrame(flowTick);
  }
  document.addEventListener('visibilitychange', flowCheck);

  /**
   * Fill in a { layer, id } stub. A link and the card's own steps both open a card by
   * name alone and whichever layer holds it supplies the rest. False means no layer on
   * show has it, which is ordinary while one is still being fetched.
   */
  function fillItem(sel, source) {
    const region = regionalFiles.get(sel.layer);
    const held = region?.items?.find((i) => i.id === sel.id);
    if (held) {
      store.set('item', { layer: sel.layer, id: sel.id, data: held, categories: region.categories, fields: region.fields },
                { source });
      return true;
    }
    // An `areas` item -- a basin, a physical division -- is opened by a tap through its
    // raster, but a link, a search result or the carousel names it by id, and without
    // this it opened an empty card.
    const fill = choroFiles.get(sel.layer);
    const area = fill?.raster ? fill.items?.find((i) => i.id === sel.id) : null;
    if (area) {
      store.set('item', { layer: sel.layer, id: sel.id, data: area, categories: fill.categories, fields: fill.fields },
                { source });
      return true;
    }
    const line = lines?.find(sel.layer, sel.id);
    if (line) {
      store.set('item', { layer: sel.layer, id: sel.id, data: line.item, categories: line.categories, fields: line.fields },
                { source });
      return true;
    }
    const data = points.find(sel.layer, sel.id);
    if (!data) return false;
    store.set('item', { layer: sel.layer, id: sel.id, data, categories: points.categories(sel.layer), fields: points.fields(sel.layer) },
              { source });
    return true;
  }

  // --- regional layers: items that belong to states rather than to a point on the map,
  // so nothing is drawn for them and the engine only hands them to the sheet.
  const regionalFiles = new Map();

  function publishRegional() {
    const active = store.get('layers')?.active || [];
    store.set('regional', active.filter((id) => regionalFiles.has(id)).map((id) => regionalFiles.get(id)));
  }

  /** The regional items on show: the lifted state's, and the scrubbed month's. */
  function regionalRows(active, drafts, lv) {
    const month = store.get('month');
    const out = [];
    for (const [id, data] of regionalFiles) {
      if (!active.has(id)) continue;
      for (const item of data.items || []) {
        if (!drafts && item.status !== 'reviewed') continue;
        if (lv?.name === 'state' && !(item.regions || []).includes(lv.id)) continue;
        // An item with no month of its own is never scrubbed away: Eid moves through
        // the year, and hiding it in eleven months out of twelve would be a lie.
        if (month && item.month && item.month !== month) continue;
        out.push({ layer: id, item });
      }
    }
    return out;
  }

  /**
   * What the search box can find: every item of the layers on show, by name. The engine
   * publishes it rather than the shell fetching the layer files a second time, and it
   * narrows exactly as the map does -- a state view lists that state's places only.
   */
  function publishIndex() {
    const active = new Set(store.get('layers')?.active || []);
    const drafts = !!store.get('drafts');
    const lv = store.get('level') || level;
    // In a state view a run counts only where it actually crosses that state, which the
    // ID raster answers exactly; a bounding box would reach into the neighbours.
    const inState = lv?.name === 'state' && field ? (x, z) => field.idAt(x, z) === lv.id : null;
    // A regional item with a home is drawn as a point too; it is listed once, as regional.
    const rows = [
      ...points.list({ active, drafts, level: lv }).filter(({ layer }) => !regionalFiles.has(layer)),
      ...(lines?.list(active, inState) || []),
      ...regionalRows(active, drafts, lv),
    ].map(({ layer, item }) => ({ layer, id: item.id, name: item.name }));
    store.set('index', rows);
  }

  // --- choropleths: at most one is drawn at a time (PLAN.md section 10, layer sprawl),
  // so changing one fades out through the clay and back rather than cross-dissolving two
  // lookups. The whole layer is one 256-texel texture; swapping it costs nothing.
  const choroFiles = new Map();      // layer id -> its file, once fetched
  let choroId = null;                // the one on show
  let choroLook = null;
  let areaFill = null;        // the fill on show that has its own id raster, for picking by it
  const prismFiles = new Map();
  let prismLook = null;
  let prismKm = 0;           // how far the top of the prisms layer's range stands up
  let prismValues = null;    // { values, domain }: the same lift on the CPU, for picking
  let cancelChoro = null;
  let cancelBase = null;

  function fadeChoro(to, ms, onDone) {
    cancelChoro?.();
    cancelChoro = tween({ v: terrain.uniforms.uChoroMix.value }, { v: to }, ms,
      (s) => { terrain.setChoroMix(s.v); invalidate(); },
      { onDone: () => { cancelChoro = null; onDone?.(); } });
  }

  // The base styles (PLAN.md section 5): what the clay looks like under everything else.
  // `plain` is one warm colour with the relief carried by light alone, for a thematic page
  // whose own colours would fight the hypsometric bands. The base is a property of the
  // page, so it arrives through the store exactly as the layers do and no layer id is
  // involved. `political` is specified but not built, and the build refuses it.
  const BASES = { physical: 0, plain: 1 };
  const BASE_MS = 420;

  function applyBase(name, animate = true) {
    if (!terrain) return;
    const to = BASES[name] ?? 0;
    cancelBase?.();
    if (!animate) {
      terrain.setPlain(to);
      world?.setPlain(to);
      invalidate();
      return;
    }
    cancelBase = tween({ v: terrain.uniforms.uPlain.value }, { v: to }, BASE_MS, (st) => {
      terrain.setPlain(st.v);
      world?.setPlain(st.v);
      invalidate();
    }, { onDone: () => { cancelBase = null; } });
  }
  store.subscribe('base', (name, _prev, meta) => applyBase(name, meta?.source !== 'init'));

  /**
   * Which fill the visitor has switched on, or null. A choropleth and an `areas` layer
   * are the same drawing -- clay tinted per pixel by an id -- so they are one channel
   * and only one of them shows at a time.
   */
  function activeChoro() {
    const active = store.get('layers')?.active || [];
    return active.find((id) => FILL_TYPES.includes(manifest?.layers?.find((l) => l.id === id)?.type)) || null;
  }

  function showChoropleth(id) {
    if (!terrain || id === choroId) return;
    if (id && !choroFiles.has(id)) return;        // still being fetched; the load calls back
    const put = () => {
      choroLook?.dispose();
      const file = id ? choroFiles.get(id) : null;
      const area = file?.raster ? file : null;
      choroLook = file ? choroplethLookup(area ? asChoropleth(file) : file) : null;
      terrain.setChoropleth(choroLook);
      terrain.setChoroIds(area?.texture || null);
      areaFill = area;
      choroId = id;
      fadeChoro(id ? 1 : 0, 350);
    };
    if (terrain.uniforms.uChoroMix.value <= 0.01) put();
    else fadeChoro(0, 250, put);
  }

  /**
   * The `prisms` layer on show, if any. Height is its own channel -- a fill colours the
   * clay, a prism raises it -- so this is independent of which fill is on.
   */
  function showPrisms() {
    if (!terrain) return;
    const active = store.get('layers')?.active || [];
    const id = active.find((x) => manifest?.layers?.find((l) => l.id === x)?.type === 'prisms') || null;
    const file = id ? prismFiles.get(id) : null;
    prismLook?.dispose();
    prismLook = file ? prismLookup(file) : null;
    prismKm = file?.height?.km || 0;
    terrain.setPrisms(prismLook, prismKm);
    prismValues = file ? { values: file.values, domain: file.height?.domain || [0, 1] } : null;
    invalidate();
  }

  // --- layers (data, never ids): load a layer's file the first time it is switched on
  /** A points layer the GPU draws: everything but a layer that is only a name. */
  const drawnByGpu = (data) => data.marker !== 'label';
  const loading = new Set();
  const failed = new Set();

  /**
   * Fetch whatever the active layers still need. Called when the switches change and
   * again once the engine has started, because a layer's home -- `lines` needs the
   * terrain's uniforms -- does not exist until then.
   */
  function loadActiveLayers() {
    const active = store.get('layers')?.active || [];
    lines?.setActive(active);
    for (const id of active) {
      if (loading.has(id) || failed.has(id)) continue;
      const entry = manifest?.layers?.find((l) => l.id === id);
      if (!entry) continue;
      const done = (fn) => {
        loading.add(id);
        loadJson(entry.path).then((data) => {
          fn(data);
          // A link can name an item before its layer has arrived. Fill it in now, and
          // give up on an id this layer turns out not to have.
          const sel = store.get('item');
          if (sel && !sel.data && sel.layer === id && !fillItem(sel, 'init')) store.set('item', null);
          invalidate();
        })
          .catch((err) => { failed.add(id); console.warn(`layer ${id} skipped:`, err); })
          .finally(() => loading.delete(id));
      };
      if (entry.type === 'points' && !points.loaded.includes(id)) {
        done((data) => {
          points.setLayer(data);
          // Pegs, beads and figurines are drawn by the GPU; the HTML element then carries
          // only the name. The pieces take a moment to build, so the frame follows them.
          if (drawnByGpu(data)) marks?.setLayer(data).then(invalidate);
          tour.refresh();
          publishIndex();
        });
      } else if (entry.type === 'lines' && lines && !lines.has(id)) {
        done((data) => {
          lines.setLayer(data);
          lines.setActive(store.get('layers')?.active || []);
          loadDetail();          // the layer has only now said whether it has a finer copy
          publishIndex();
        });
      } else if (FILL_TYPES.includes(entry.type) && !choroFiles.has(id)) {
        // A fill that brings its own id raster -- an `areas` layer, or a choropleth on the
        // census's districts -- takes two fetches: the items, and the raster they are
        // drawn from. A state choropleth is one, and colours the state ids already here.
        loading.add(id);
        loadJson(entry.path)
          .then(async (data) => {
            if (!data.raster) {
              choroFiles.set(id, data);
            } else {
              const pack = await loadPack(DATA_BASE + data.raster);
              choroFiles.set(id, { ...data, raster: areaIds(pack), texture: byteTexture(pack, { nearest: true }) });
            }
            showChoropleth(activeChoro());
            // As for the other layer types: a link may have named an area before it arrived.
            const sel = store.get('item');
            if (sel && !sel.data && sel.layer === id && !fillItem(sel, 'init')) store.set('item', null);
            invalidate();
          })
          .catch((err) => { failed.add(id); console.warn(`layer ${id} skipped:`, err); })
          .finally(() => loading.delete(id));
      } else if (entry.type === 'prisms' && !prismFiles.has(id)) {
        done((data) => { prismFiles.set(id, data); showPrisms(); });
      } else if (entry.type === 'regional' && !regionalFiles.has(id)) {
        done((data) => {
          regionalFiles.set(id, data);
          // Items with a home are drawn there as tokens, exactly as a place is; the rest
          // are read in the state cards alone.
          const anchored = (data.items || []).filter((i) => typeof i.x === 'number');
          if (anchored.length) {
            const asPoints = { ...data, items: anchored };
            points.setLayer(asPoints);
            marks?.setLayer(asPoints).then(invalidate);
            tour.refresh();
          }
          publishRegional();
          publishIndex();
        });
      }
    }
    showChoropleth(activeChoro());
    showPrisms();
    publishRegional();
    publishIndex();
    invalidate();
  }
  store.subscribe('layers', loadActiveLayers);
  store.subscribe('drafts', publishIndex);
  store.subscribe('level', publishIndex);
  store.subscribe('month', publishIndex);

  // --- a layer's finer copy of one state (PLAN.md D3: a state package is denser networks)
  //
  // A `lines` layer may ship one file per state at a resolution the whole country could
  // not afford. It is fetched when that state is entered and given to the lifted block,
  // which is the only place it would be seen; the country's own tier never changes.
  const detailLoading = new Set();

  /** Fetch what the layers on show have of the state now lifted, and drop what they do not. */
  function loadDetail() {
    const lv = store.get('level');
    const slug = lv?.name === 'state' ? store.get('regions')?.byId?.[lv.id]?.slug : null;
    for (const id of store.get('layers')?.active || []) {
      if (!lines?.has(id)) continue;
      const path = slug && lines.detailPath(id, slug);
      if (!path) { lines.setDetail(id, null); continue; }
      const key = `${id}:${slug}`;
      if (detailLoading.has(key)) continue;
      detailLoading.add(key);
      loadJson(path)
        .then((data) => {
          // The visitor may have left the state while this was in the air.
          const now = store.get('level');
          if (now?.name === 'state' && store.get('regions')?.byId?.[now.id]?.slug === slug) {
            lines.setDetail(id, data);
            invalidate();
          }
        })
        .catch((err) => console.warn(`detail ${key} skipped:`, err))
        .finally(() => detailLoading.delete(key));
    }
  }
  store.subscribe('level', loadDetail);
  store.subscribe('layers', loadDetail);

  /** Fly to a place: closer at country level, a pan inside a state; returns the flight time. */
  function flyToItem(item, { ms = 800, yaw = undefined } = {}) {
    const cam = { ...store.get('camera') };
    if (yaw !== undefined) cam.yaw = yaw;
    cameraTouched = true;
    const zoom = level.name === 'state' ? cam.zoom : Math.min(cam.zoom, ITEM_ZOOM);
    const { forward } = basis(cam.yaw, cam.pitch);
    // keep the marker a little above the padded centre so its card does not cover it
    const pad = store.get('padding');
    const shift = ((pad.bottom - pad.top) / 2) * (zoom / viewport.h) / Math.sin((cam.pitch * Math.PI) / 180);
    flyTo({ ...cam, zoom, x: item.x - forward[0] * shift, z: item.z - forward[2] * shift }, ms);
    return ms;
  }

  /** A selected item flies into view; the tour does its own flying. */
  store.subscribe('item', (sel, _, meta) => {
    // Opened by name alone: fill it in and let the set that does it carry on from here.
    if (sel && !sel.data) { fillItem(sel, meta.source); return; }
    lines?.setSelected(sel ? { layer: sel.layer, id: sel.id } : null);
    invalidate();
    if (!sel || meta.source === 'tour') return;
    // A link arrives at its item rather than flying to it from wherever the default
    // camera happened to be, which is how /state/<slug> already opens.
    const ms = meta.source === 'init' ? 0 : undefined;
    const item = points.find(sel.layer, sel.id);
    if (item) return flyToItem(item, ms === undefined ? {} : { ms });
    const line = lines?.find(sel.layer, sel.id);
    if (line) return fitBox(line.bbox, ms);
    // An area is framed by the texels its raster gives it, as a line is by its runs.
    const fill = choroFiles.get(sel.layer);
    const area = fill?.raster ? fill.items?.find((i) => i.id === sel.id) : null;
    if (area && meta.source !== 'tap') {
      const box = areaBox(fill.raster, area.area_id);
      if (box) fitBox(box, ms);
    }
  });

  /**
   * A fill's id raster as one id per pixel. An `areas` layer has at most 255 areas and
   * ships a byte each; the census's 640 districts do not fit a byte, so theirs ships two,
   * low then high, and is put back together here once, for picking and framing.
   */
  function areaIds(pack) {
    if (pack.channels === 1) return pack;
    const n = pack.width * pack.height, data = new Uint16Array(n);
    for (let i = 0; i < n; i++) data[i] = pack.data[i * 2] | (pack.data[i * 2 + 1] << 8);
    return { width: pack.width, height: pack.height, data };
  }

  /** An area id's extent in scene km, from its layer's raster. */
  function areaBox({ width, height, data }, id) {
    let c0 = width, r0 = height, c1 = -1, r1 = -1;
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (data[r * width + c] !== id) continue;
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
      }
    }
    if (c1 < 0) return null;
    const x = (c) => (c / width - 0.5) * sizeKm.w;
    const z = (r) => (r / height - 0.5) * sizeKm.h;
    return [x(c0), z(r0), x(c1 + 1), z(r1 + 1)];
  }

  /** Frame a scene-km box, the way entering a state frames its unit. */
  function fitBox([x0, z0, x1, z1], ms = 800) {
    cameraTouched = true;
    const lift = raised ? raised.km : 0;
    flyTo(fitBounds(store.get('camera'), { x0, z0, x1, z1, ymax: lift + 40 }, viewport, store.get('padding')), ms);
  }

  function applyCamera() {
    const c = store.get('camera');
    const { toCam } = basis(c.yaw, c.pitch);
    camera.position.set(c.x + toCam[0] * CAMERA_DISTANCE, toCam[1] * CAMERA_DISTANCE, c.z + toCam[2] * CAMERA_DISTANCE);
    camera.lookAt(c.x, 0, c.z);
    const hh = c.zoom / 2, hw = (hh * viewport.w) / viewport.h;
    camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
    camera.updateProjectionMatrix();
    // The border fields are distance fields: the shader needs the current pixel scale to
    // keep their lines one screen pixel wide. The block's material is a sibling with its
    // own scalars, so it has to be told too, or it draws them at the scale it was born at.
    const kmPerPx = c.zoom / viewport.h;
    terrain.uniforms.uKmPerPx.value = kmPerPx;
    if (block) block.material.uniforms.uKmPerPx.value = kmPerPx;
    lines?.setView(viewport.w, viewport.h, c.zoom);
    world?.setKmPerPx(kmPerPx);
    // The key light turns with the camera, so it stays over the viewer's left shoulder
    // instead of being bolted to the model's north-west (F4).
    const lit = terrain.setLightYaw(c.yaw);
    world?.setLightDir(lit.x, lit.y);
  }

  /**
   * Keep the closest zoom to what the loaded heightmap can resolve. The country tier is
   * about 1.7 km per texel, so the old fixed 180 km floor magnified it more than eight
   * times; the state view's 30 km floor magnified it fifty. A package is five times
   * finer, and this floor moves with it instead of staying a constant.
   */
  let zoomFloor = 0;

  function refreshZoomFloor() {
    const kmPerPx = block && localKmPerPx ? localKmPerPx : countryKmPerPx;
    const hard = block ? ZOOM_MIN.state : ZOOM_MIN.country;
    const km = kmPerPx ? Math.max(hard, kmPerPx * viewport.h / MAX_MAGNIFY) : hard;
    const dropped = zoomFloor && km < zoomFloor;
    zoomFloor = km;
    setZoomFloor(km);
    // The floor clamps the framing a view asks for, and it only moves down as finer data
    // arrives. A state opened from a link is fitted against the first tier's floor, five
    // times too far out, and used to stay there; re-fit when the floor drops under a
    // camera the visitor has not touched.
    if (dropped && !cameraTouched && store.get('regions')) fit(true, { ms: 450 });
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === viewport.w && h === viewport.h) return;
    viewport = { w, h };
    renderer.setSize(w, h, false);
    store.set('viewport', viewport);
    refreshZoomFloor();
    if (!cameraTouched) fit(false);
    invalidate();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // --- camera
  function flyTo(target, ms = 900) {
    cancelFly?.();
    const from = store.get('camera');
    // Yaw runs the whole way round now, so a flight has to be told which way to turn:
    // from 170 degrees, home at -12 is 22 degrees away, not 342 (F3).
    const to = { ...target, yaw: unwrapYaw(from.yaw, target.yaw) };
    cancelFly = tween(from, to, ms, (v) => store.set('camera', { ...v, yaw: wrapYaw(v.yaw) }, { source: 'tween' }), {
      onDone: () => { cancelFly = null; },
    });
  }

  /** Frame the whole country, or the lifted state, above the sheet and beside the panels. */
  function fit(animate = true, opts = {}) {
    const regions = store.get('regions');
    if (!regions) return;
    const pad = store.get('padding');
    // home: the default angles too, not just the framing
    const cam = opts.home ? { ...store.get('camera'), yaw: DEFAULT_CAMERA.yaw, pitch: DEFAULT_CAMERA.pitch } : store.get('camera');
    let box;
    if (level.name === 'state' && regions.byId[level.id]) {
      const u = regions.byId[level.id];
      box = { x0: u.bbox[0], z0: u.bbox[1], x1: u.bbox[2], z1: u.bbox[3], ymax: blockDimensions(u).lift + 30 };
    } else {
      const [x0, z0, x1, z1] = regions.bbox;
      box = { x0, z0, x1, z1, points: regions.hull, ymax: 40 };
    }
    const target = fitBounds(cam, box, viewport, pad);
    if (animate) flyTo(target, opts.ms);
    else store.set('camera', target, { source: 'fit' });
  }

  /**
   * How far the view may wander (PLAN.md F2): the country, or the unit lifted out of it.
   * The UI does the clamping -- it is where a gesture ends and where a spring back
   * belongs -- but only the engine knows how big the model is, so it says so here.
   */
  function publishBounds() {
    const regions = store.get('regions');
    if (!regions) return;
    // Where the model is, as a coarse mask of the ID raster rather than as a box round
    // it: see clampTarget for why a box, or a hull, parks the view on open water. The
    // country's is built once with the tier; a state's is filtered to that unit, which
    // is a pass over the raster and happens only when the level changes.
    if (!tierIds) return;
    const u = level.name === 'state' ? regions.byId[level.id] : null;
    store.set('bounds', u
      ? { mask: landMask(tierIds, sizeKm, u.id), extent: [...u.bbox] }
      : { mask: countryMask || (countryMask = landMask(tierIds, sizeKm)), extent: [...regions.bbox] });
  }

  /** The compass: everything cleared by the UI, the country framed again from the default angles. */
  store.subscribe('home', (req) => {
    if (!req || !terrain) return;
    cameraTouched = false;
    fit(true, { home: true });
  });

  store.subscribe('camera', (_, __, meta) => {
    if (meta.source === 'gesture' || meta.source === 'url') cameraTouched = true;
    if (meta.source !== 'tween' && cancelFly) { cancelFly(); cancelFly = null; }
    invalidate();
  });
  store.subscribe('flyTo', (req) => { if (req) { cameraTouched = true; flyTo(req.camera, req.ms); } });
  store.subscribe('padding', (_, __, meta) => { if (!cameraTouched) fit(!!meta.animate, { ms: 450 }); });

  // --- relief
  function applyRelief(r, animate) {
    if (!terrain) return;
    const target = (r.on ? r.amount : 0) * (level.name === 'state' ? STATE_EXAG : 1);
    const u = terrain.uniforms.uExag;
    cancelRelief?.();
    if (!animate) {
      u.value = target;
      world?.setCurve({ exag: target, gamma: terrain.uniforms.uGamma.value, hRef: terrain.uniforms.uHRef.value });
      invalidate();
      return;
    }
    cancelRelief = tween({ v: u.value }, { v: target }, 650, ({ v }) => {
      u.value = v;
      world?.setCurve({ exag: v, gamma: terrain.uniforms.uGamma.value, hRef: terrain.uniforms.uHRef.value });
      invalidate();
    });
  }
  store.subscribe('relief', (r, _, meta) => applyRelief(r, !!meta.animate));
  store.subscribe('selection', (id) => { if (terrain) { terrain.uniforms.uSelected.value = id ?? -1; invalidate(); } });
  store.subscribe('hover', (id) => { if (terrain) { terrain.uniforms.uHover.value = id ?? -1; invalidate(); } });

  // --- picking: taps become selections, pointer moves become hovers
  const liftKm = (hM) => (hM <= 0 ? 0 : terrain.uniforms.uExag.value * Math.pow(hM / CURVE.hRef, CURVE.gamma) * CURVE.hRef * 0.001);

  /** Terrain hit under a screen point (px from the viewport centre, y up), or null before load. */
  /**
   * A `prisms` layer raises the ground in the vertex shader, so the CPU heightfield has
   * to be told the same thing or every pick would land on the ground the prism stands on
   * rather than on its top. -1 asks for the tallest, which is where a ray must start.
   */
  function prismLift(id) {
    if (!prismValues || !prismKm) return 0;
    if (id === -1) return prismKm;
    const v = prismValues.values?.[id];
    if (v === undefined) return 0;
    const [lo, hi] = prismValues.domain;
    return prismKm * Math.min(1, Math.max(0, (v - lo) / ((hi - lo) || 1)));
  }

  function pick(sx, sy) {
    if (!field) return null;
    return pickTerrain(store.get('camera'), viewport, sx, sy, field, liftKm, raised, prismLift);
  }

  /**
   * Which area of the fill layer lies under a screen point, or null. The raster is a
   * country one at its own pitch, so the scene point is turned into its pixel rather
   * than the heightfield's.
   */
  function pickArea(sx, sy) {
    if (!areaFill?.raster || !field) return null;
    const p = pick(sx, sy);
    if (!p) return null;
    const { width, height, data } = areaFill.raster;
    const col = Math.floor((p.x / sizeKm.w + 0.5) * width);
    const row = Math.floor((p.z / sizeKm.h + 0.5) * height);
    if (col < 0 || row < 0 || col >= width || row >= height) return null;
    const id = data[row * width + col];
    return id ? (areaFill.items || []).find((it) => it.area_id === id) || null : null;
  }

  /** Screen position (px from the viewport centre, y up) of a ground point [x, z] on the terrain. */
  function project(point) {
    if (!field) return null;
    return projectGround(store.get('camera'), viewport, point[0], point[1], field, liftKm, raised, prismLift);
  }

  // --- state view: the unit lifts out as a block, the rest steps back, the camera flies in
  async function fineIdsTexture() {
    if (quality.heightTier !== FIRST_TIER) return null;          // the tier on screen is already 2048
    if (!fineIds) {
      const rel = manifest.tiers['2048']?.ids;
      if (!rel) return null;
      const pack = await loadPack(`/data/${rel}?v=${manifest.files?.[rel]?.sha256 || ''}`);
      fineIds = { texture: byteTexture(pack, { nearest: true }), width: pack.width, height: pack.height };
    }
    return fineIds;
  }

  async function enterState(unit, immediate) {
    const dims = blockDimensions(unit);
    const fine = await fineIdsTexture().catch(() => null);
    if (level.name !== 'state' || level.id !== unit.id) return;   // the user moved on meanwhile
    const idsW = fine ? fine.width : terrain.uniforms.uIds.value.image.width;
    const idsH = fine ? fine.height : terrain.uniforms.uIds.value.image.height;
    block = createBlock({ unit, material: terrain.siblingMaterial(), sizeKm, idsTexture: fine?.texture, idsTexel: [1 / idsW, 1 / idsH] });
    scene.add(block.group);
    lines?.setBlock(block.material.uniforms, unit.id, block.grid);
    raised = { id: unit.id, km: 0 };
    terrain.uniforms.uHole.value = unit.id;
    localKmPerPx = 0;
    refreshZoomFloor();
    cancelLevel?.();
    const from = { lift: 0, dim: terrain.uniforms.uDim.value };
    const to = { lift: dims.lift, dim: 1 };
    cancelLevel = tween(from, to, immediate ? 0 : 450, ({ lift, dim }) => {
      if (block) block.setLift(lift);
      if (raised) raised.km = lift;
      terrain.uniforms.uBlockLift.value = lift;      // the plate draws the block's shadow
      terrain.uniforms.uDim.value = dim;
      invalidate();
    }, { easing: easeOutCubic });
    applyRelief(store.get('relief'), !immediate);
    cameraTouched = false;
    fit(!immediate);
    // Walls need the traced outline; the flight has already started (never block on the network).
    loadJson(`regions/outlines/${unit.slug}.json`).then((o) => {
      if (block && block.unit.id === unit.id) { block.setOutline(o.loops); invalidate(); }
    }).catch((err) => console.warn('outline skipped:', err));
    loadUnitPackage(unit);
  }

  /** The unit's hi-res rasters, on the same never-block-on-the-network terms as the walls. */
  async function loadUnitPackage(unit) {
    if (store.get('saveData')) return;
    pkgLoad?.abort();
    pkgLoad = new AbortController();
    const { signal } = pkgLoad;
    try {
      if (!stateIndex) stateIndex = await loadStateIndex(manifest);
      const entry = stateIndex?.units?.[unit.slug];
      if (!entry) return;
      const pkg = await loadStatePackage(manifest, entry, signal);
      if (signal.aborted || !block || block.unit.id !== unit.id) return;
      // The plate cuts its socket from the same field the block trims its rim with.
      const edge = block.setPackage(pkg, sizeKm);
      const tu = terrain.uniforms;
      tu.uStateEdge.value = edge.texture;
      tu.uStateRect.value.set(...edge.rect);
      tu.uStateEdgeRangeKm.value = edge.rangeKm;
      tu.uHasStateEdge.value = 1;
      localKmPerPx = entry.km_per_px;
      refreshZoomFloor();
      invalidate();
    } catch (err) {
      if (!signal.aborted) console.warn('state package skipped:', err);
    }
  }

  /** A block still sinking when another must go: end it now rather than leave it hanging. */
  function finishDrop() {
    if (!dropping) return;
    const d = dropping;
    dropping = null;
    d.cancel();
    d.done();
  }

  /**
   * Put the block back. `handover` is the switch from one state straight to another: the
   * outgoing block sinks on its own tween so the incoming one can cancel nothing of it,
   * the country stays dim, and the camera is left to the state being entered.
   */
  function exitState(animate, { handover = false } = {}) {
    const b = block;
    block = null;
    raised = null;
    pkgLoad?.abort();
    pkgLoad = null;
    localKmPerPx = 0;
    lines?.setBlock(null, -1);
    terrain.uniforms.uStateEdge.value = null;
    terrain.uniforms.uHasStateEdge.value = 0;
    if (b) {
      finishDrop();
      const done = () => { scene.remove(b.group); b.dispose(); if (!handover) terrain.uniforms.uHole.value = -1; invalidate(); };
      const from = { lift: b.material.uniforms.uLift.value, dim: terrain.uniforms.uDim.value };
      const to = handover ? { lift: 0, dim: from.dim } : { lift: 0, dim: 0 };
      const cancel = tween(from, to, animate ? 350 : 0, ({ lift, dim }) => {
        b.setLift(lift);
        // The shadow sinks with the block that casts it -- except on a handover, where
        // the incoming block is already rising and writing this uniform itself, and the
        // socket the shadow is drawn around (uHole) is already the new state's. Two
        // tweens writing it in the same frames would fight over it.
        if (!handover) terrain.uniforms.uBlockLift.value = lift;
        terrain.uniforms.uDim.value = dim;
        invalidate();
      }, { onDone: () => { dropping = null; done(); } });
      if (dropping === null) dropping = { block: b, cancel, done };
    } else if (!handover) {
      terrain.uniforms.uDim.value = 0;
      terrain.uniforms.uHole.value = -1;
      terrain.uniforms.uBlockLift.value = 0;
    }
    if (handover) return;
    cancelLevel?.();
    refreshZoomFloor();
    applyRelief(store.get('relief'), animate);
    cameraTouched = false;
    fit(animate);
  }

  store.subscribe('level', (lv, prev, meta) => {
    level = lv || { name: 'country' };
    publishBounds();
    if (!terrain) return;
    const immediate = meta.source === 'init';
    if (level.name === 'state') {
      const u = store.get('regions')?.byId?.[level.id];
      if (!u) { store.set('level', { name: 'country', id: null }); return; }
      // Switching states is a handover: the old block sinks while the new one rises.
      if (block) exitState(!immediate, { handover: true });
      enterState(u, immediate);
    } else {
      exitState(!immediate);
    }
  });

  // --- the tour (tour.js): every place on show, with its card, one flight after another
  const tour = createTour(store, {
    stops: () => points.list({ active: new Set(store.get('layers')?.active || []), drafts: !!store.get('drafts'), level, tour: true }),
    visit: ({ layer, item }, opts) => {
      store.set('item', { layer, id: item.id, data: item, categories: points.categories(layer) }, { source: 'tour' });
      return flyToItem(item, opts);
    },
    home: () => store.set('home', { t: performance.now() }),
  });

  // --- the idle sway (idle.js): the model turns gently while nobody is at the controls
  createIdle(store, {
    allowed: () => !!terrain && store.get('status') === 'ready' && !store.get('poster') && level.name === 'country'
      && !store.get('selection') && !store.get('item') && !store.get('tour')?.playing && !cancelFly,
  });

  function areaOf(id) {
    const u = store.get('regions')?.byId?.[id];
    return u ? u.area_km2 : Infinity;
  }

  /** A `lines` item under a screen point, within a few pixels of it. */
  function lineAt(sx, sy, px = 9) {
    if (!lines || !field) return null;
    const p = pick(sx, sy);
    return p ? lines.nearest(p.x, p.z, px * (store.get('camera').zoom / viewport.h)) : null;
  }

  // A gesture is starting: answer with the surface point it has hold of, so it can turn
  // the model about that rather than about the middle of the canvas (PLAN.md D13, F1).
  // The store calls subscribers synchronously, so `pivot` is filled in by the time the
  // gesture's own `store.set('grab', ...)` returns. `onModel` is false where the hand
  // landed on the sea or on the paper beside the model, and the gesture decides what
  // that is worth: a zoom is happy to pull towards open water, a turn is not.
  store.subscribe('grab', (g) => {
    if (!g) return;
    const cam = store.get('camera');
    if (!field) { store.set('pivot', { ...groundAnchor(cam, g.x, g.y, viewport), onModel: false }); return; }
    const hit = pickTerrain(cam, viewport, g.x, g.y, field, liftKm, raised);
    store.set('pivot', { point: [hit.x, hit.y, hit.z], sx: g.x, sy: g.y, onModel: !!hit.id });
  });

  /** A bead or a figurine under a screen point: they have no element of their own to click. */
  function markAt(sx, sy, px) {
    return marks?.nearest(project, sx, sy, px, new Set(store.get('layers')?.active || [])) || null;
  }

  store.subscribe('tap', (tap) => {
    if (!tap || !field) return;
    const coarse = tap.type === 'touch' || tap.type === 'pen';
    // A marker stands on the state, and a line sits on it, so they get the tap first.
    // A finger is forgiven more than a cursor for a marker, which is a thing with a
    // footprint; not for a line, which is a hair across a state the finger was more
    // probably aiming at. At 14 px the rivers took half the taps on the plains at the
    // whole-country view, and even at 4 px -- 33 km on a phone -- a quarter of them: a
    // river there is one pixel wide and the state is the thing to tap. So at the
    // country view a finger goes to the state, and a river's card is a zoom away (or
    // a cursor's, which is precise enough at any zoom).
    const zoom = store.get('camera').zoom;
    const linePx = !coarse ? 9 : zoom > 2500 ? 0 : 8;
    const hit = markAt(tap.x, tap.y, coarse ? 16 : 10) || (linePx > 0 && lineAt(tap.x, tap.y, linePx));
    if (hit) {
      store.set('item', { layer: hit.layer, id: hit.item.id, data: hit.item, categories: hit.categories, fields: hit.fields });
      return;
    }
    // An `areas` layer is a fill, so it is picked like the terrain rather than like a
    // marker: the tap already knows the ground point, and the layer's own raster says
    // which area is under it. It answers before a state does -- the visitor switched a
    // layer on to read it, and entering a state would hide what they tapped.
    const area = areaFill && pickArea(tap.x, tap.y);
    if (area) {
      // Marked, so the card opens where the finger is: a basin is half a subcontinent,
      // and framing it would throw away the view that was being read.
      store.set('item', { layer: areaFill.id, id: area.id, data: area, categories: areaFill.categories, fields: areaFill.fields },
                { source: 'tap' });
      return;
    }
    store.set('item', null);
    const idAt = (sx, sy) => pick(sx, sy).id;
    const id = tap.type === 'touch' || tap.type === 'pen' ? biasedPick(tap.x, tap.y, idAt, areaOf) : idAt(tap.x, tap.y);
    // A tap on a state is the way in, and a tap on the one already lifted is the way
    // back out (PLAN.md D4). Leaving is a Back, so the URL restores the selection.
    if (id && level.name === 'state' && level.id === id) {
      store.set('level', { name: 'country', id: null }, { source: 'deselect' });
      return;
    }
    store.set('selection', id || null);
    if (id) store.set('level', { name: 'state', id }, { source: 'ui' });
  });

  let hoverRaf = 0;
  store.subscribe('pointer', (ptr) => {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const p = store.get('pointer');
      const hit = p ? (markAt(p.x, p.y, 8) || lineAt(p.x, p.y)) : null;
      const was = store.get('hoverLine');
      if (hit?.item.id !== was?.id || hit?.layer !== was?.layer) {
        store.set('hoverLine', hit ? { layer: hit.layer, id: hit.item.id, name: hit.item.name } : null);
      }
      store.set('hover', p && field && !hit ? pick(p.x, p.y).id || null : null);
    });
  });

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); store.set('status', 'context-lost'); });
  canvas.addEventListener('webglcontextrestored', () => { store.set('status', 'ready'); invalidate(); });

  /**
   * The entrance (PLAN.md section 3, "The missing wow" 2). On a cold load of the home
   * view the model rises out of the page: the relief grows from flat while the camera
   * tips down from almost overhead to the home angle. It says in one and a half seconds
   * what the home view cannot say on its own -- that this is a thing with a shape, not a
   * picture of a country -- and it is the first frame anyone sees.
   *
   * Once, and only for a visitor who asked for nothing in particular (`linked` in the
   * store): a link to a state, a place or a camera is a request to arrive somewhere, and
   * making it wait through a flourish first would be rude. Reduced motion skips it, and
   * so does the poster render.
   */
  function rise() {
    if (reducedMotion() || store.get('poster')) return;
    const target = { ...store.get('camera') };
    const relief = store.get('relief');
    // Start overhead and flat. The fit was computed for the home angle, so the opening
    // frame is framed a little loosely; it is moving by the time anyone reads it.
    store.set('camera', { ...target, pitch: RISE.fromPitch }, { source: 'fit' });
    terrain.uniforms.uExag.value = 0;
    world?.setCurve({ exag: 0, gamma: terrain.uniforms.uGamma.value, hRef: terrain.uniforms.uHRef.value });
    flyTo(target, RISE.ms);
    // The rise counts as the camera being busy. It is not, in the sense cameraTouched
    // usually means -- nobody has moved it -- but leaving that false lets the shell's
    // first padding write refit mid-flight, and a fit keeps the angles it finds, so the
    // rise's own target was being replaced by one framed at 84 degrees and the model
    // never tipped down at all. It goes back to false when the rise is over, so a resize
    // still refits after that.
    cameraTouched = true;
    cancelRelief?.();
    const to = relief.on ? relief.amount : 0;
    cancelRelief = tween({ v: 0 }, { v: to }, RISE.ms, ({ v }) => {
      terrain.uniforms.uExag.value = v;
      world?.setCurve({ exag: v, gamma: terrain.uniforms.uGamma.value, hRef: terrain.uniforms.uHRef.value });
      invalidate();
    }, { easing: easeOutCubic, onDone: () => { cancelRelief = null; cameraTouched = false; } });
  }

  // --- loading: first-view tier first, finer tier in the background for capable devices
  async function start() {
    manifest = await loadManifest();
    const states = await loadStates(manifest);
    const byId = Object.fromEntries(states.units.map((u) => [u.id, u]));
    store.set('regions', { units: states.units, byId, bbox: unionBbox(states.units), hull: states.country?.hull, grid: manifest.grid });
    publishBounds();
    store.set('catalog', manifest.layers || []);
    if (!store.get('layers')) store.set('layers', { active: (manifest.layers || []).filter((l) => l.default_on).map((l) => l.id) });
    const first = await loadTier(manifest, FIRST_TIER);
    sizeKm = { w: manifest.grid.width_km, h: manifest.grid.height_km };
    countryKmPerPx = sizeKm.h / first.heights.height;
    refreshZoomFloor();
    terrain = createTerrain({ tierData: first, grid: quality.grid, sizeKm });
    field = createHeightfield(first, sizeKm, terrain.grid);
    tierIds = first;
    publishBounds();                      // the mask needs the raster, which only exists now
    scene.add(terrain.mesh);
    lines = createLines(scene, terrain.uniforms, terrain.grid);
    marks = createMarks(scene, terrain.uniforms, { grid: terrain.grid, loadRecipe: (name) => loadJson(`models/${name}.json`) });
    // The default layers are small and usually land before the first tier does, so they
    // were handed to points.js with no GPU to draw them yet: hand them over now.
    for (const id of points.loaded) {
      const data = points.get(id);
      if (data && drawnByGpu(data)) marks.setLayer(data).then(invalidate);
    }
    lines.setView(viewport.w, viewport.h, store.get('camera').zoom);
    loadActiveLayers();
    applySurroundings(!!store.get('surroundings'));
    applyBase(store.get('base'), false);
    if (store.get('graticule')) applyGraticule(true);
    loadJson('regions/outlines/india.json').then((o) => {
      countryWalls = createCountryWalls(o.loops, terrain.uniforms);
      countryWalls.visible = !store.get('surroundings');
      scene.add(countryWalls);
      invalidate();
    }).catch((err) => console.warn('country outline skipped:', err));
    labels.setUnits(states.units);
    applyRelief(store.get('relief'), false);
    const lv = store.get('level');
    let entrance = false;
    if (lv?.name === 'state' && byId[lv.id]) {
      level = lv;
      enterState(byId[lv.id], true);
    } else if (!cameraTouched) {
      // Not an unconditional fit: the layer files are fetched the moment the catalogue
      // lands, which is before the first tier is awaited, so an item named in the URL is
      // often already framed by the time this runs and framing the country again would
      // throw the visitor back out to it.
      fit(false);
      entrance = !store.get('linked');
    }
    if (entrance) rise();
    invalidate();
    store.set('status', 'ready');
    if (backdropWanted) { backdropWanted = false; loadBackdrop(); }
    if (quality.heightTier !== FIRST_TIER && manifest.tiers[quality.heightTier]) {
      loadTier(manifest, quality.heightTier)
        .then((t) => {
          terrain.setTier(t);
          field = createHeightfield(t, sizeKm, terrain.grid);
          countryKmPerPx = sizeKm.h / t.heights.height;
          refreshZoomFloor();
          invalidate();
        })
        .catch((err) => console.warn('finer tier skipped:', err));
    }
    return { manifest, quality };
  }

  store.subscribe('lang', () => { labels.invalidateText(); invalidate(); });

  /**
   * The graticule: furniture on the table, fetched the first time it is switched on. It is
   * 2 KB, but it is not on the first view either -- nothing the map opens with needs it.
   */
  function applyGraticule(on) {
    if (graticule) graticule.mesh.visible = !!on;
    else if (on) loadGraticule();
    invalidate();
  }

  function loadGraticule() {
    if (graticuleLoad) return;
    graticuleLoad = loadJson(manifest.graticule || 'graticule.json').then((data) => {
      if (!data?.lines?.length || graticule) return;
      graticule = createGraticule(data);
      graticule.mesh.visible = !!store.get('graticule');
      scene.add(graticule.mesh);
      invalidate();
    }).catch((err) => console.warn('graticule skipped:', err));
  }
  store.subscribe('graticule', applyGraticule);

  /**
   * Surroundings on (the default): sea and neighbours. Off: India alone as a cut-out with
   * walls. The wide backdrop is fetched after the first frame is on screen, never before:
   * it is scenery, and the first view's budget is spent on the model.
   */
  let backdropWanted = false;
  function applySurroundings(on) {
    if (!terrain) return;
    terrain.uniforms.uOnlyIndia.value = on ? 0 : 1;
    if (countryWalls) countryWalls.visible = !on;
    if (world) world.mesh.visible = on;
    else if (on) { if (store.get('status') === 'ready') loadBackdrop(); else backdropWanted = true; }
    invalidate();
  }

  /**
   * The land around India, fetched the first time it is asked for. It is never on the
   * first view: the map opens as a cut-out on the page, and only Surroundings wants it.
   */
  function loadBackdrop() {
    if (worldLoad || store.get('saveData')) return;
    worldLoad = loadWorld(manifest).then((data) => {
      if (!data || !terrain || world) return;
      world = createWorld({ data, terrain, grid: Math.round(quality.grid / 2) });
      world.mesh.visible = !!store.get('surroundings');
      world.setCurve({ exag: terrain.uniforms.uExag.value, gamma: terrain.uniforms.uGamma.value,
                       hRef: terrain.uniforms.uHRef.value });
      world.setPlain(terrain.uniforms.uPlain.value);      // it may arrive onto a plain page
      backdrop.add(world.mesh);
      invalidate();
    }).catch((err) => console.warn('backdrop skipped:', err));
  }
  store.subscribe('surroundings', applySurroundings);

  return {
    start, invalidate, flyTo, fit, pick, project, quality,
    get viewport() { return viewport; },
    get level() { return level; },
    // For checks from the console or a script through window.bd, as CLAUDE.md describes:
    // the uniforms are what a look at the shading has to be measured against.
    get terrain() { return terrain; },
    get marks() { return marks; },
    get world() { return world; },
    dispose() { choroLook?.dispose(); world?.dispose(); lines?.dispose(); marks?.dispose(); terrain?.dispose(); block?.dispose(); renderer.dispose(); },
  };
}
