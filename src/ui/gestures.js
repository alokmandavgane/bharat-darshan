// @ts-check
// Pointer gestures on the map canvas -> camera changes in the store. One finger drags
// the ground; two fingers pinch (zoom about the midpoint), twist (yaw) and drag
// vertically together (tilt). Mouse: left-drag slides the map, right-drag (or
// Ctrl/Alt-drag, which trackpads can manage) turns and tilts it, wheel zooms about the
// cursor, Q and E turn it. Double tap / click zooms in about the point. Touch: one
// finger pans, two rotate and pinch, because a phone has no second button and panning
// is what a finger on a map is for.
import { clampCamera, groundShift, orbitAbout, zoomAbout } from '../engine/camera-math.js';

const TAP_SLOP = 8;         // px of travel that still counts as a tap
const TAP_MS = 350;
const DOUBLE_MS = 300;

/**
 * Taps land in the store as `tap` { x, y, type } and pointer moves (fine pointers, no
 * button held) as `pointer` { x, y, type }; the engine turns them into `selection` and
 * `hover`. Coordinates are px from the canvas centre, y up, like the camera maths.
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function attachGestures(canvas, store) {
  /** @type {Map<number, {x:number,y:number,sx:number,sy:number,t:number,type:string,button:number}>} */
  const pointers = new Map();
  let lastTap = 0;
  let pinch = null; // { dist, angle, midX, midY }

  const viewport = () => store.get('viewport');
  const cam = () => store.get('camera');
  const write = (next) => store.set('camera', clampCamera(next), { source: 'gesture' });

  // Screen coordinates relative to the canvas centre, y up.
  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: -(e.clientY - r.top - r.height / 2) };
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now(), type: e.pointerType, button: e.button });
    if (pointers.size === 2) pinch = pinchState();
    e.preventDefault();
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  function onMove(e) {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    const p = local(e);
    const dx = p.x - rec.x, dy = p.y - rec.y;
    rec.x = p.x; rec.y = p.y;
    const vp = viewport();
    if (pointers.size === 1) {
      // Mouse: the left button slides the map, which is what an atlas is read with, and
      // the right button (or Ctrl/Alt, for trackpads with no right-drag worth the name)
      // turns it. A finger pans, the same model as the left button.
      const orbit = rec.type === 'mouse' && (rec.button === 2 || e.ctrlKey || e.altKey);
      if (orbit) {
        // The model follows the hand: drag right and it turns right, drag down and it
        // tips its far side towards you, as if a finger were on the table itself.
        const c = cam();
        write(orbitAbout(c, c.yaw + dx * 0.25, c.pitch - dy * 0.25, 0, 0, vp));
      } else {
        const c = cam();
        const [gx, gz] = groundShift(c, -dx, -dy, vp);
        write({ ...c, x: c.x + gx, z: c.z + gz });
      }
    } else if (pointers.size === 2 && pinch) {
      const now = pinchState();
      let c = cam();
      // pan by the midpoint's movement
      const [gx, gz] = groundShift(c, -(now.midX - pinch.midX), -(now.midY - pinch.midY), vp);
      c = { ...c, x: c.x + gx, z: c.z + gz };
      // zoom about the midpoint
      if (pinch.dist > 20 && now.dist > 20) c = zoomAbout(c, pinch.dist / now.dist, now.midX, now.midY, vp);
      // twist -> yaw, vertical two-finger drag -> pitch
      let dAng = now.angle - pinch.angle;
      if (dAng > Math.PI) dAng -= 2 * Math.PI; else if (dAng < -Math.PI) dAng += 2 * Math.PI;
      const yaw = c.yaw - (dAng * 180) / Math.PI;
      const pitch = c.pitch + (now.midY - pinch.midY) * 0.2;
      c = orbitAbout(c, yaw, pitch, now.midX, now.midY, vp);
      write(c);
      pinch = now;
    }
  }

  function onUp(e) {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) pinch = null, resetOrigins();
    else if (pointers.size === 2) pinch = pinchState();
    const moved = Math.hypot(rec.x - rec.sx, rec.y - rec.sy);
    const dt = performance.now() - rec.t;
    if (pointers.size === 0 && moved < TAP_SLOP && dt < TAP_MS && rec.button === 0) {
      const now = performance.now();
      if (now - lastTap < DOUBLE_MS) {
        lastTap = 0;
        store.set('flyTo', { camera: zoomAbout(cam(), 0.5, rec.x, rec.y, viewport()), ms: 500, id: now });
      } else {
        lastTap = now;
        store.set('tap', { x: rec.x, y: rec.y, type: rec.type, t: now });
      }
    }
  }

  function resetOrigins() {
    for (const r of pointers.values()) { r.sx = r.x; r.sy = r.y; r.t = performance.now(); }
  }

  function onHover(e) {
    if (e.pointerType === 'touch' || pointers.size) return;
    const p = local(e);
    store.set('pointer', { x: p.x, y: p.y, type: e.pointerType });
  }

  function onLeave() {
    store.set('pointer', null);
  }

  function onWheel(e) {
    e.preventDefault();
    const p = local(e);
    // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels jump.
    const step = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    const factor = Math.exp((e.ctrlKey ? 0.01 : 0.0018) * step);
    write(zoomAbout(cam(), factor, p.x, p.y, viewport()));
  }

  // Q and E turn the model, for anyone who never finds the right button. They are the
  // only way to turn it from a keyboard, so they are on the window rather than the
  // canvas, which never has focus.
  function onKey(e) {
    const k = e.key.toLowerCase();
    if (k !== 'q' && k !== 'e') return;
    const el = /** @type {HTMLElement} */ (e.target);
    if (el?.closest('input, textarea, [contenteditable]')) return;   // someone is searching
    const c = cam();
    write(orbitAbout(c, c.yaw + (k === 'q' ? -15 : 15), c.pitch, 0, 0, viewport()));
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointermove', onHover);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey);
  // Old iOS fires its own pinch gesture events even with touch-action: none.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    canvas.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointermove', onHover);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
  };
}
