// @ts-check
// Pointer gestures on the map canvas -> camera changes in the store. One finger drags
// the ground; two fingers pinch (zoom about the midpoint), twist (yaw) and drag
// vertically together (tilt). Mouse: left-drag slides the map, right-drag (or
// Ctrl/Alt-drag, which trackpads can manage) turns and tilts it, wheel zooms about the
// cursor, Q and E turn it. Double tap / click zooms in about the point. Touch: one
// finger pans, two rotate and pinch, because a phone has no second button and panning
// is what a finger on a map is for.
import {
  clamp, clampCamera, clampTarget, groundAnchor, groundShift, holdAnchor, LIMITS,
  orbitAbout, paddedCentre, zoomAbout,
} from '../engine/camera-math.js';

const TAP_SLOP = 8;         // px of travel that still counts as a tap
const TAP_MS = 350;
const DOUBLE_MS = 300;
const GIVE = 0.12;          // how far past the bounds a hand may stretch the view, x the view height

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

  /**
   * Every camera change a gesture makes goes through here, so the model cannot be
   * pushed off the table (PLAN.md F2). While a hand is down the bounds are springy --
   * the view can be stretched a little past them and the stretch never runs away -- and
   * `settle` eases it back when the hand comes off.
   */
  function write(next) {
    const c = clampCamera(next);
    const give = pointers.size ? GIVE * c.zoom : 0;
    store.set('camera', clampTarget(c, store.get('bounds'), viewport(), store.get('padding'), give),
              { source: 'gesture' });
  }

  /** The hands are off: if the view was stretched past its bounds, let it go back. */
  function settle() {
    const c = cam();
    const home = clampTarget(c, store.get('bounds'), viewport(), store.get('padding'), 0);
    if (home !== c) store.set('flyTo', { camera: home, ms: 280, id: performance.now() });
  }

  /**
   * What the hand has hold of (PLAN.md D13): ask the engine for the surface point under
   * a screen position and get back an anchor to hold there for the rest of the gesture.
   * The engine answers synchronously; before it is loaded, and if nothing is listening,
   * the sea-level plane stands in. The old pivot is cleared first so a silent engine
   * cannot hand this gesture the last one's.
   * @returns {{ point: number[], sx: number, sy: number, onModel?: boolean }}
   */
  function grabAt(sx, sy) {
    store.set('pivot', null);
    store.set('grab', { x: sx, y: sy, t: performance.now() });
    return store.get('pivot') || groundAnchor(cam(), sx, sy, viewport());
  }

  /**
   * The same, for a turn. Turning about the sea or about the paper beside the model is
   * turning about nothing, so a grab that misses falls back to the middle of what can
   * be seen -- the padded middle, not the canvas's, with a sheet or a panel open.
   */
  function turnAnchor(sx, sy) {
    const p = grabAt(sx, sy);
    if (p.onModel !== false) return p;
    const [cx, cy] = paddedCentre(viewport(), store.get('padding'));
    return grabAt(cx, cy);
  }

  /** The anchor the gesture in progress is holding, made when it began. */
  let held = null;

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
    if (pointers.size === 1) {
      // Which it is, is decided here and not revisited: letting go of Ctrl halfway
      // through a turn should not silently make it a pan. A mouse on the turn button
      // takes hold of what is under it; one finger only pans, which needs no anchor.
      const rec = pointers.get(e.pointerId);
      rec.turn = e.pointerType === 'mouse' && turning(e, e.button);
      held = rec.turn ? turnAnchor(p.x, p.y) : null;
    } else if (pointers.size === 2) {
      pinch = pinchState();
      held = turnAnchor(pinch.midX, pinch.midY);   // two fingers hold the point between them
    }
    e.preventDefault();
  }

  /** Mouse: the right button turns, and so does Ctrl or Alt for trackpads without one. */
  const turning = (e, button) => button === 2 || e.ctrlKey || e.altKey;

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
      if (rec.turn && held) {
        // The model follows the hand: drag right and it turns right, drag down and it
        // tips its far side towards you, as if a finger were on the table itself. It
        // turns about the point the button came down on, which stays under the cursor.
        const c = cam();
        write(orbitAbout(c, c.yaw + dx * 0.25, c.pitch - dy * 0.25, held, vp));
      } else {
        const c = cam();
        const [gx, gz] = groundShift(c, -dx, -dy, vp);
        write({ ...c, x: c.x + gx, z: c.z + gz });
      }
    } else if (pointers.size === 2 && pinch && held) {
      const now = pinchState();
      let c = cam();
      // Pinch to zoom, twist to turn, both fingers down the screen to tilt...
      if (pinch.dist > 20 && now.dist > 20) {
        c = { ...c, zoom: clamp(c.zoom * (pinch.dist / now.dist), LIMITS.zoom[0], LIMITS.zoom[1]) };
      }
      let dAng = now.angle - pinch.angle;
      if (dAng > Math.PI) dAng -= 2 * Math.PI; else if (dAng < -Math.PI) dAng += 2 * Math.PI;
      c = clampCamera({ ...c, yaw: c.yaw - (dAng * 180) / Math.PI, pitch: c.pitch + (now.midY - pinch.midY) * 0.2 });
      // ...and the whole gesture keeps the point it took hold of between the fingers,
      // wherever the fingers have carried it. That is the pan, and there is no separate
      // one: holding the anchor to the new midpoint is exactly what a pan means.
      write(holdAnchor(c, { ...held, sx: now.midX, sy: now.midY }, vp));
      pinch = now;
    }
  }

  function onUp(e) {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { held = null; settle(); }
    else if (pointers.size === 1) { pinch = null; held = null; resetOrigins(); }
    else if (pointers.size === 2) { pinch = pinchState(); held = turnAnchor(pinch.midX, pinch.midY); }
    const moved = Math.hypot(rec.x - rec.sx, rec.y - rec.sy);
    const dt = performance.now() - rec.t;
    if (pointers.size === 0 && moved < TAP_SLOP && dt < TAP_MS && rec.button === 0) {
      const now = performance.now();
      if (now - lastTap < DOUBLE_MS) {
        lastTap = 0;
        store.set('flyTo', { camera: zoomAbout(cam(), 0.5, grabAt(rec.x, rec.y), viewport()), ms: 500, id: now });
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
    // The surface under the cursor, not the sea-level plane under it: zooming in on a
    // Himalayan peak used to creep away by the height of the peak.
    write(zoomAbout(cam(), factor, grabAt(p.x, p.y), viewport()));
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
    const [cx, cy] = paddedCentre(viewport(), store.get('padding'));
    write(orbitAbout(c, c.yaw + (k === 'q' ? -15 : 15), c.pitch, turnAnchor(cx, cy), viewport()));
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
