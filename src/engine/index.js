// @ts-check
// The engine: a three.js scene behind a small API. It touches nothing in the DOM but its
// canvas, and talks to the UI only through the store (PLAN.md section 4).
import { Color, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { blockDimensions, createBlock, createCountryWalls } from './block.js';
import { basis, DEFAULT_CAMERA, fitBounds, MAX_MAGNIFY, setZoomFloor, ZOOM_MIN } from './camera-math.js';
import { loadJson, loadManifest, loadStatePackage, loadStateIndex, loadStates, loadTier, unionBbox } from './data.js';
import { createIdle } from './idle.js';
import { createLabels } from './labels.js';
import { loadPack } from './pack.js';
import { biasedPick, createHeightfield, pickTerrain, projectGround } from './picking.js';
import { createPoints } from './points.js';
import { pickQuality } from './quality.js';
import { createTerrain, CURVE } from './terrain.js';
import { byteTexture } from './textures.js';
import { createTour } from './tour.js';
import { easeOutCubic, tween } from './tween.js';

const CAMERA_DISTANCE = 7000;   // km; anywhere outside the model works for an orthographic camera
const FIRST_TIER = '1024';      // always first: it is the first-view budget (PLAN.md section 8)
const STATE_EXAG = 0.6;         // relief eases down when a state is lifted out (PLAN.md section 6)
const FOCUS_MIN_ZOOM = 1200;    // km of view height: a "focus" from the list keeps country context
const ITEM_ZOOM = 700;          // km of view height when flying to a place at country level

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
  const scene = new Scene();
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
  let raised = null;           // { id, km }: the block, for picking and projecting
  let fineIds = null;          // 2048-tier ids for the block when the tier on screen is coarser
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
      store.set('item', data ? { layer, id, data, categories: points.categories(layer) } : null);
    },
  });

  // --- render on demand: nothing draws unless something changed
  function invalidate() {
    if (needsRender) return;
    needsRender = true;
    requestAnimationFrame(render);
  }

  function render() {
    needsRender = false;
    if (!terrain) return;
    applyCamera();
    renderer.render(scene, camera);
    // markers first (they are interactive), then labels keep clear of them
    const taken = points.update({ project, level, viewport, camera: store.get('camera'), active: new Set(store.get('layers')?.active || []),
      selected: store.get('item'), lang: store.get('lang'), drafts: !!store.get('drafts') });
    labels.update({ project, level, viewport, camera: store.get('camera'), regions: store.get('regions'),
      selection: store.get('selection'), hover: store.get('hover'), lang: store.get('lang'), avoid: taken });
  }

  // --- layers (data, never ids): load a layer's file the first time it is switched on
  const loading = new Set();
  store.subscribe('layers', (ls) => {
    for (const id of ls?.active || []) {
      if (points.loaded.includes(id) || loading.has(id)) continue;
      const entry = manifest?.layers?.find((l) => l.id === id);
      if (!entry || entry.type !== 'points') continue;
      loading.add(id);
      loadJson(entry.path).then((data) => { points.setLayer(data); invalidate(); tour.refresh(); })
        .catch((err) => console.warn(`layer ${id} skipped:`, err)).finally(() => loading.delete(id));
    }
    invalidate();
  });

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
    invalidate();
    if (!sel || meta.source === 'tour') return;
    const item = points.find(sel.layer, sel.id);
    if (item) flyToItem(item);
  });

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
  }

  /**
   * Keep the closest zoom to what the loaded heightmap can resolve. The country tier is
   * about 1.7 km per texel, so the old fixed 180 km floor magnified it more than eight
   * times; the state view's 30 km floor magnified it fifty. A package is five times
   * finer, and this floor moves with it instead of staying a constant.
   */
  function refreshZoomFloor() {
    const kmPerPx = block && localKmPerPx ? localKmPerPx : countryKmPerPx;
    const hard = block ? ZOOM_MIN.state : ZOOM_MIN.country;
    if (!kmPerPx) return setZoomFloor(hard);
    setZoomFloor(Math.max(hard, kmPerPx * viewport.h / MAX_MAGNIFY));
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
    cancelFly = tween(from, target, ms, (v) => store.set('camera', v, { source: 'tween' }), {
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

  /** The compass: everything cleared by the UI, the country framed again from the default angles. */
  store.subscribe('home', (req) => {
    if (!req || !terrain) return;
    cameraTouched = false;
    fit(true, { home: true });
  });

  /** A gentle move to a unit picked from the list: fit it, but keep country context. */
  store.subscribe('focus', (req) => {
    const u = req && store.get('regions')?.byId?.[req.id];
    if (!u || level.name !== 'country') return;
    cameraTouched = true;
    const [x0, z0, x1, z1] = u.bbox;
    flyTo(fitBounds(store.get('camera'), { x0, z0, x1, z1, ymax: 40 }, viewport, store.get('padding'), { minZoom: FOCUS_MIN_ZOOM }), 700);
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
    if (!animate) { u.value = target; invalidate(); return; }
    cancelRelief = tween({ v: u.value }, { v: target }, 650, ({ v }) => { u.value = v; invalidate(); });
  }
  store.subscribe('relief', (r, _, meta) => applyRelief(r, !!meta.animate));
  store.subscribe('selection', (id) => { if (terrain) { terrain.uniforms.uSelected.value = id ?? -1; invalidate(); } });
  store.subscribe('hover', (id) => { if (terrain) { terrain.uniforms.uHover.value = id ?? -1; invalidate(); } });

  // --- picking: taps become selections, pointer moves become hovers
  const liftKm = (hM) => (hM <= 0 ? 0 : terrain.uniforms.uExag.value * Math.pow(hM / CURVE.hRef, CURVE.gamma) * CURVE.hRef * 0.001);

  /** Terrain hit under a screen point (px from the viewport centre, y up), or null before load. */
  function pick(sx, sy) {
    if (!field) return null;
    return pickTerrain(store.get('camera'), viewport, sx, sy, field, liftKm, raised);
  }

  /** Screen position (px from the viewport centre, y up) of a ground point [x, z] on the terrain. */
  function project(point) {
    if (!field) return null;
    return projectGround(store.get('camera'), viewport, point[0], point[1], field, liftKm, raised);
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
      block.setPackage(pkg, sizeKm);
      localKmPerPx = entry.km_per_px;
      refreshZoomFloor();
      invalidate();
    } catch (err) {
      if (!signal.aborted) console.warn('state package skipped:', err);
    }
  }

  function exitState(animate) {
    const b = block;
    block = null;
    raised = null;
    pkgLoad?.abort();
    pkgLoad = null;
    localKmPerPx = 0;
    cancelLevel?.();
    if (b) {
      const done = () => { scene.remove(b.group); b.dispose(); terrain.uniforms.uHole.value = -1; invalidate(); };
      cancelLevel = tween({ lift: b.material.uniforms.uLift.value, dim: terrain.uniforms.uDim.value }, { lift: 0, dim: 0 },
        animate ? 350 : 0, ({ lift, dim }) => { b.setLift(lift); terrain.uniforms.uDim.value = dim; invalidate(); }, { onDone: done });
    } else {
      terrain.uniforms.uDim.value = 0;
      terrain.uniforms.uHole.value = -1;
    }
    refreshZoomFloor();
    applyRelief(store.get('relief'), animate);
    cameraTouched = false;
    fit(animate);
  }

  store.subscribe('level', (lv, prev, meta) => {
    level = lv || { name: 'country' };
    if (!terrain) return;
    const immediate = meta.source === 'init';
    if (level.name === 'state') {
      const u = store.get('regions')?.byId?.[level.id];
      if (!u) { store.set('level', { name: 'country', id: null }); return; }
      if (block) { exitState(false); }
      enterState(u, immediate);
    } else {
      exitState(!immediate);
    }
  });

  // --- the tour (tour.js): every place on show, with its card, one flight after another
  const tour = createTour(store, {
    stops: () => points.list({ active: new Set(store.get('layers')?.active || []), drafts: !!store.get('drafts'), level }),
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

  store.subscribe('tap', (tap) => {
    if (!tap || !field) return;
    const idAt = (sx, sy) => pick(sx, sy).id;
    const id = tap.type === 'touch' || tap.type === 'pen' ? biasedPick(tap.x, tap.y, idAt, areaOf) : idAt(tap.x, tap.y);
    store.set('selection', id || null);
  });

  let hoverRaf = 0;
  store.subscribe('pointer', (ptr) => {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const p = store.get('pointer');
      store.set('hover', p && field ? pick(p.x, p.y).id || null : null);
    });
  });

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); store.set('status', 'context-lost'); });
  canvas.addEventListener('webglcontextrestored', () => { store.set('status', 'ready'); invalidate(); });

  // --- loading: first-view tier first, finer tier in the background for capable devices
  async function start() {
    manifest = await loadManifest();
    const states = await loadStates(manifest);
    const byId = Object.fromEntries(states.units.map((u) => [u.id, u]));
    store.set('regions', { units: states.units, byId, bbox: unionBbox(states.units), hull: states.country?.hull, grid: manifest.grid });
    store.set('catalog', manifest.layers || []);
    if (!store.get('layers')) store.set('layers', { active: (manifest.layers || []).filter((l) => l.default_on).map((l) => l.id) });
    const first = await loadTier(manifest, FIRST_TIER);
    sizeKm = { w: manifest.grid.width_km, h: manifest.grid.height_km };
    countryKmPerPx = sizeKm.h / first.heights.height;
    refreshZoomFloor();
    terrain = createTerrain({ tierData: first, grid: quality.grid, sizeKm });
    field = createHeightfield(first, sizeKm, terrain.grid);
    scene.add(terrain.mesh);
    applySurroundings(!!store.get('surroundings'));
    loadJson('regions/outlines/india.json').then((o) => {
      countryWalls = createCountryWalls(o.loops, terrain.uniforms);
      countryWalls.visible = !store.get('surroundings');
      scene.add(countryWalls);
      invalidate();
    }).catch((err) => console.warn('country outline skipped:', err));
    labels.setUnits(states.units);
    applyRelief(store.get('relief'), false);
    const lv = store.get('level');
    if (lv?.name === 'state' && byId[lv.id]) {
      level = lv;
      enterState(byId[lv.id], true);
    } else {
      fit(false);
    }
    invalidate();
    store.set('status', 'ready');
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

  /** Surroundings on: sea and neighbours as before. Off (default): India alone as a cut-out with walls. */
  function applySurroundings(on) {
    if (!terrain) return;
    terrain.uniforms.uOnlyIndia.value = on ? 0 : 1;
    if (countryWalls) countryWalls.visible = !on;
    invalidate();
  }
  store.subscribe('surroundings', applySurroundings);

  return {
    start, invalidate, flyTo, fit, pick, project, quality,
    get viewport() { return viewport; },
    get level() { return level; },
    dispose() { terrain?.dispose(); block?.dispose(); renderer.dispose(); },
  };
}
