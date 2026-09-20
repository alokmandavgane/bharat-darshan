// @ts-check
// A tiny store: named slices, shallow merge on set, per-slice subscribers.
// Everything the engine and the UI share goes through here (PLAN.md section 4).

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * @param {Record<string, any>} initial
 */
export function createStore(initial) {
  const state = { ...initial };
  /** @type {Map<string, Set<Function>>} */
  const subs = new Map();

  function get(key) {
    return key === undefined ? state : state[key];
  }

  /**
   * Set a slice. Objects are shallow-merged into the existing object; anything else
   * replaces it. `meta` travels to subscribers (e.g. { source: 'gesture' }).
   */
  function set(key, patch, meta = {}) {
    const prev = state[key];
    const mergeable = patch && typeof patch === 'object' && !Array.isArray(patch)
      && prev && typeof prev === 'object' && !Array.isArray(prev);
    const next = mergeable ? { ...prev, ...patch } : patch;
    if (shallowEqual(prev, next)) return;
    state[key] = next;
    subs.get(key)?.forEach((fn) => fn(next, prev, meta));
    subs.get('*')?.forEach((fn) => fn(key, next, prev, meta));
  }

  /**
   * @param {string} key  slice name, or '*' for every change
   * @param {Function} fn
   * @param {{ immediate?: boolean }} [opts]  call once right away with the current value
   */
  function subscribe(key, fn, opts = {}) {
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(fn);
    if (opts.immediate && key !== '*') fn(state[key], undefined, { source: 'init' });
    return () => subs.get(key)?.delete(fn);
  }

  return { get, set, subscribe };
}
