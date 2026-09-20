// @ts-check
// Interruptible tweens between plain objects of numbers, on requestAnimationFrame.

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {Record<string, number>} from
 * @param {Record<string, number>} to
 * @param {number} ms
 * @param {(v: Record<string, number>, t: number) => void} onUpdate
 * @param {{ easing?: (t: number) => number, onDone?: () => void }} [opts]
 * @returns {() => void} cancel
 */
export function tween(from, to, ms, onUpdate, opts = {}) {
  const easing = opts.easing || easeInOutCubic;
  if (ms <= 0 || reducedMotion()) {
    onUpdate({ ...from, ...to }, 1);
    opts.onDone?.();
    return () => {};
  }
  const keys = Object.keys(to);
  const start = performance.now();
  let raf = 0, cancelled = false;
  const step = (now) => {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / ms);
    const e = easing(t);
    const v = { ...from };
    for (const k of keys) v[k] = from[k] + (to[k] - from[k]) * e;
    onUpdate(v, t);
    if (t < 1) raf = requestAnimationFrame(step);
    else opts.onDone?.();
  };
  raf = requestAnimationFrame(step);
  return () => { cancelled = true; cancelAnimationFrame(raf); };
}
