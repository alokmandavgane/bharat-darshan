// @ts-check
// The URL is the source of truth for view state (PLAN.md section 4):
//   /hi                         country view in Hindi
//   /en/atlas/monsoon           a plate: a page of the atlas, pushState
//   /en?state=goa               Goa selected (peek), replaceState: a tap is not a page
//   /en/state/kerala            the state view, pushState: Back leaves it
//   ...?layers=rivers,roads     the layers on show, when they are not the defaults
//   ...?item=rivers:ganga       a river, a peak, a place: whatever card is open
//   ...?month=10                the scrubber: only what falls in that month
//   ...?relief=18&cam=x,z,zoom,yaw,pitch   relief and, once the user has moved, the camera
//   ...?drafts=1                show unreviewed content (also on in dev builds)
// History API only.

export const LANGS = ['en', 'hi'];
export const DEFAULT_RELIEF = 12;

export function readUrl(loc = location) {
  const parts = loc.pathname.split('/').filter(Boolean);
  const lang = LANGS.includes(parts[0]) ? parts[0] : null;
  const rest = lang ? parts.slice(1) : parts;
  const q = new URLSearchParams(loc.search);
  const relief = q.has('relief') ? Number(q.get('relief')) : null;
  const camParts = (q.get('cam') || '').split(',').map(Number);
  const cam = camParts.length === 5 && camParts.every(Number.isFinite)
    ? { x: camParts[0], z: camParts[1], zoom: camParts[2], yaw: camParts[3], pitch: camParts[4] } : null;
  // `layers` absent means "whatever the catalogue says by default"; `none` means none.
  const layers = q.has('layers')
    ? (q.get('layers') === 'none' ? [] : q.get('layers').split(',').filter(Boolean))
    : null;
  const month = Number(q.get('month'));
  const item = (q.get('item') || '').split(':');
  return {
    lang, rest,
    // A state view can sit inside a plate: /en/atlas/rivers/state/kerala. The plate comes
    // first because it is the page and the state is a place on it.
    plate: rest[0] === 'atlas' && rest[1] ? rest[1] : null,
    view: (() => {
      const at = rest[0] === 'atlas' ? 2 : 0;
      return rest[at] === 'state' && rest[at + 1] ? rest[at + 1] : null;
    })(),
    state: q.get('state') || null,
    layers,
    item: item.length === 2 && item[0] && item[1] ? { layer: item[0], id: item[1] } : null,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
    relief: Number.isFinite(relief) ? relief : null,
    cam,
    drafts: q.get('drafts') === '1',
  };
}

const PASS_THROUGH = ['quality', 'poster'];

export function buildUrl({ lang, view = null, plate = null, state = null, layers = null, item = null,
                           month = null, relief, cam = null, drafts = false }) {
  // A state view is a page inside a plate, so a link can carry both: /en/atlas/rivers
  // becomes /en/atlas/rivers/state/kerala rather than losing the page it was opened from.
  const path = '/' + [lang, ...(plate ? ['atlas', plate] : []), ...(view ? ['state', view] : [])]
    .filter(Boolean).join('/');
  const q = new URLSearchParams();
  if (!view && state) q.set('state', state);
  if (layers) q.set('layers', layers.length ? layers.join(',') : 'none');
  if (item) q.set('item', `${item.layer}:${item.id}`);
  if (month) q.set('month', String(month));
  if (relief !== undefined && relief !== DEFAULT_RELIEF) q.set('relief', String(relief));
  if (cam) q.set('cam', [cam.x.toFixed(0), cam.z.toFixed(0), cam.zoom.toFixed(0), cam.yaw.toFixed(1), cam.pitch.toFixed(1)].join(','));
  if (drafts) q.set('drafts', '1');
  // The knobs that are not view state and are not ours to throw away: a forced quality
  // tier is how the model is tested on a device (CLAUDE.md), and the poster flag is how
  // the share images are rendered. Both are read straight from location.search by code
  // that runs after the first write of this URL, so dropping them here switched them off
  // the moment anything moved.
  for (const key of PASS_THROUGH) {
    const v = new URLSearchParams(location.search).get(key);
    if (v !== null) q.set(key, v);
  }
  // Commas and colons are legal in a query and read far better in a link people paste to
  // each other than %2C and %3A do; they come back through URLSearchParams unchanged.
  const s = q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
  return path + (s ? '?' + s : '');
}

/** Keep the URL in step with the store, and the store with back/forward. */
export function syncUrl(store) {
  const slugOf = (id) => (id ? store.get('regions')?.byId?.[id]?.slug : null);
  const idOf = (slug) => (slug ? store.get('regions')?.units?.find((u) => u.slug === slug)?.id ?? null : null);
  let camTouched = false;
  let userFlight = false;       // a flight the visitor asked for (double tap) counts as moving the camera
  let camTimer = 0;
  let applying = false;         // while applying a popstate, do not write back
  let pendingBack = null;       // 'restore' | 'clear': what the popstate of our own history.back() should do
  const draftsFromUrl = readUrl().drafts;   // only echo ?drafts=1 when the visitor asked for it

  /** What a page asks to be on: the plate's layers, or the catalogue's own defaults. */
  const baselineLayers = (plateId) => {
    const plate = plateId ? (store.get('plates')?.plates || []).find((p) => p.id === plateId) : null;
    if (plate) return [...plate.layers];
    return (store.get('catalog') || []).filter((l) => l.default_on).map((l) => l.id);
  };

  /** ...and the relief it asks for. */
  const baselineRelief = (plateId) => {
    const plate = plateId ? (store.get('plates')?.plates || []).find((p) => p.id === plateId) : null;
    return plate && plate.relief !== undefined ? plate.relief : DEFAULT_RELIEF;
  };

  /** The plate on show, as the file describes it, or null. */
  const openPlate = () => {
    const id = store.get('plate');
    return id ? (store.get('plates')?.plates || []).find((p) => p.id === id) || null : null;
  };

  /**
   * The layers on show, or null while they are still what the page asked for. A plate is
   * a preset, so `/en/atlas/people` already says which layers are on: spelling them out
   * again would make every link to a page twice as long and no more exact. Off a plate
   * the baseline is the catalogue's own defaults, as before.
   */
  const layersParam = () => {
    const active = store.get('layers')?.active;
    const catalog = store.get('catalog') || [];
    if (!active || !catalog.length) return null;
    const plate = openPlate();
    const baseline = plate ? plate.layers : catalog.filter((l) => l.default_on).map((l) => l.id);
    const same = active.length === baseline.length && baseline.every((id) => active.includes(id));
    return same ? null : active;
  };

  /** The relief, unless it is what the page asked for (or the default, off a page). */
  const reliefParam = () => {
    const relief = store.get('relief');
    const now = relief.on ? relief.amount : 0;
    const plate = openPlate();
    const baseline = plate && plate.relief !== undefined ? plate.relief : DEFAULT_RELIEF;
    return now === baseline ? undefined : now;
  };

  const current = () => {
    const level = store.get('level');
    const item = store.get('item');
    return buildUrl({
      lang: store.get('lang'),
      plate: store.get('plate') || null,
      view: level?.name === 'state' ? slugOf(level.id) : null,
      state: slugOf(store.get('selection')),
      layers: layersParam(),
      item: item?.layer && item?.id ? { layer: item.layer, id: item.id } : null,
      month: store.get('month') || null,
      relief: reliefParam(),
      cam: camTouched ? store.get('camera') : null,
      drafts: draftsFromUrl && !!store.get('drafts'),
    });
  };

  const write = (push = false) => {
    if (applying || pendingBack) return;
    const url = current();
    if (url === location.pathname + location.search) return;
    if (push) history.pushState({ bdLevel: true }, '', url);
    else history.replaceState(history.state, '', url);
  };

  store.subscribe('lang', () => write());
  store.subscribe('relief', () => write());
  store.subscribe('selection', () => write());
  // A layer switch and an open card are both "what is on show", not a page of their own,
  // so they replace the entry rather than pushing one: Back still leaves the state view.
  store.subscribe('layers', () => write());
  store.subscribe('catalog', () => write());
  store.subscribe('plates', () => write());
  store.subscribe('item', () => write());
  store.subscribe('month', () => write());
  // Opening a plate is turning a page: it pushes, so Back goes to the one before.
  store.subscribe('plate', (_, __, meta) => { if (meta.source !== 'popstate') write(true); });
  store.subscribe('level', (lv, prev, meta) => {
    if (meta.source === 'popstate') return;
    // A level restored from the URL must still be written back: `selection` is set first
    // and would otherwise leave a /state/<slug> link rewritten as its ?state= peek form.
    if (meta.source === 'init') return write();
    if (lv?.name === 'state' && prev?.name !== 'state') write(true);
    else if (lv?.name !== 'state' && history.state?.bdLevel) {
      // Leaving the state view is a Back: the entry before it holds the selection, unless
      // the compass (home) is clearing everything, or the visitor tapped the lifted state
      // to put it down, which is a deselection and should leave nothing chosen.
      pendingBack = meta.source === 'home' || meta.source === 'deselect' ? 'clear' : 'restore';
      history.back();
    } else write();
  });
  store.subscribe('flyTo', (req) => { userFlight = !!req; });
  store.subscribe('camera', (_, __, meta) => {
    if (meta.source === 'gesture' || meta.source === 'url') camTouched = true;
    if (meta.source === 'tween' && userFlight) camTouched = true;
    if (!camTouched) return;
    clearTimeout(camTimer);
    camTimer = setTimeout(() => write(), 300);
  });
  store.subscribe('home', () => {
    camTouched = false;
    userFlight = false;
    clearTimeout(camTimer);
    write();
  });

  window.addEventListener('popstate', () => {
    const u = readUrl();
    const clear = pendingBack === 'clear';
    pendingBack = null;
    applying = true;
    if (u.lang) store.set('lang', u.lang);
    store.set('plate', u.plate, { source: 'popstate' });
    // A URL with no ?layers is not "leave them as they are": it is "whatever this page
    // asks for", which is the plate's set on a plate and the catalogue's defaults off
    // one. Without this, going back out of a page left the page's layers drawn on the
    // contents and the tidy /en link came back as /en?layers=...
    store.set('layers', { active: u.layers || baselineLayers(u.plate) });
    // ...and the same for relief, which a page also sets.
    const relief = u.relief !== null ? u.relief : baselineRelief(u.plate);
    store.set('relief', { on: relief > 0, amount: relief > 0 ? relief : DEFAULT_RELIEF }, { animate: true });
    store.set('month', u.month);
    store.set('item', u.item);
    const viewId = idOf(u.view);
    store.set('level', viewId ? { name: 'state', id: viewId } : { name: 'country', id: null }, { source: 'popstate' });
    store.set('selection', clear ? null : viewId || idOf(u.state));
    applying = false;
    write();
  });
  write();
}
