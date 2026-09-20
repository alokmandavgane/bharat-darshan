// @ts-check
// The URL is the source of truth for view state (PLAN.md section 4):
//   /hi                         country view in Hindi
//   /en?state=goa               Goa selected (peek), replaceState: a tap is not a page
//   /en/state/kerala            the state view, pushState: Back leaves it
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
  return {
    lang, rest,
    view: rest[0] === 'state' && rest[1] ? rest[1] : null,
    state: q.get('state') || null,
    relief: Number.isFinite(relief) ? relief : null,
    cam,
    drafts: q.get('drafts') === '1',
  };
}

export function buildUrl({ lang, view = null, state = null, relief, cam = null, drafts = false }) {
  const path = '/' + [lang, ...(view ? ['state', view] : [])].filter(Boolean).join('/');
  const q = new URLSearchParams();
  if (!view && state) q.set('state', state);
  if (relief !== undefined && relief !== DEFAULT_RELIEF) q.set('relief', String(relief));
  if (cam) q.set('cam', [cam.x.toFixed(0), cam.z.toFixed(0), cam.zoom.toFixed(0), cam.yaw.toFixed(1), cam.pitch.toFixed(1)].join(','));
  if (drafts) q.set('drafts', '1');
  const s = q.toString();
  return path + (s ? '?' + s : '');
}

/** Keep the URL in step with the store, and the store with back/forward. */
export function syncUrl(store) {
  const slugOf = (id) => (id ? store.get('regions')?.byId?.[id]?.slug : null);
  const idOf = (slug) => (slug ? store.get('regions')?.units?.find((u) => u.slug === slug)?.id ?? null : null);
  let camTouched = false;
  let camTimer = 0;
  let applying = false;         // while applying a popstate, do not write back

  const current = () => {
    const level = store.get('level');
    const relief = store.get('relief');
    return buildUrl({
      lang: store.get('lang'),
      view: level?.name === 'state' ? slugOf(level.id) : null,
      state: slugOf(store.get('selection')),
      relief: relief.on ? relief.amount : 0,
      cam: camTouched ? store.get('camera') : null,
      drafts: !!store.get('drafts') && !import.meta.env.DEV,
    });
  };

  const write = (push = false) => {
    if (applying) return;
    const url = current();
    if (url === location.pathname + location.search) return;
    if (push) history.pushState({ bdLevel: true }, '', url);
    else history.replaceState(history.state, '', url);
  };

  store.subscribe('lang', () => write());
  store.subscribe('relief', () => write());
  store.subscribe('selection', () => write());
  store.subscribe('level', (lv, prev, meta) => {
    if (meta.source === 'popstate' || meta.source === 'init') return;
    if (lv?.name === 'state' && prev?.name !== 'state') write(true);
    else if (lv?.name !== 'state' && history.state?.bdLevel) { applying = true; history.back(); applying = false; }
    else write();
  });
  store.subscribe('camera', (_, __, meta) => {
    if (meta.source === 'gesture' || meta.source === 'url') camTouched = true;
    if (meta.source === 'tween' && store.get('flyTo')) camTouched = true;
    if (!camTouched) return;
    clearTimeout(camTimer);
    camTimer = setTimeout(() => write(), 300);
  });

  window.addEventListener('popstate', () => {
    const u = readUrl();
    applying = true;
    if (u.lang) store.set('lang', u.lang);
    const viewId = idOf(u.view);
    store.set('level', viewId ? { name: 'state', id: viewId } : { name: 'country', id: null }, { source: 'popstate' });
    store.set('selection', viewId || idOf(u.state));
    applying = false;
  });
  write();
}
