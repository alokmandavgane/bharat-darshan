// @ts-check
// Pointer gestures on the map canvas -> camera changes in the store. One finger drags
// the ground; two fingers pinch (zoom about the midpoint), twist (yaw) and drag
// vertically together (tilt). Mouse: left-drag slides the map, right-drag (or
// Ctrl/Alt-drag, which trackpads can manage) turns and tilts it, wheel zooms about the
// cursor, Q and E turn it. Double tap / click zooms in about the point. Touch: one
// finger pans, two rotate and pinch, because a phone has no second button and panning
// is what a finger on a map is for.
import {
  clamp, clampCamera, clampTarget, FLING, flingFrom, groundAnchor, groundShift,
  holdAnchor, LIMITS, orbitAbout, paddedCentre, zoomAbout,
} from '../engine/camera-math.js';
import { reducedMotion } from '../engine/tween.js';

const TAP_SLOP = 8;         // px of travel that still counts as a tap
const TAP_MS = 350;
const DOUBLE_MS = 300;
const GIVE = 0.12;          // how far past the bounds a hand may stretch the view, x the view height
// What two fingers mean (F5). A gesture pans and pinches until it has travelled this
// far, then commits: both fingers moving the same way up or down the screen, by similar
// amounts, with the spread within TILT_SPREAD_PX and the angle within TILT_TWIST_DEG, is
// a tilt; anything else is the map.
const MODE_SLOP_PX = 12;
const TILT_SPREAD_PX = 24;
const TILT_TWIST_DEG = 7;
const TILT_MATCH = 0.5;     // the slower finger must travel at least this share of the faster
// How far the fingers must turn before a twist becomes a turn: an angle, and an arc each
// finger has swept, so fingers close together (where a few px of wobble is many degrees)
// do not start the map turning in the middle of a pinch.
const TWIST_LATCH_DEG = 12;
const TWIST_LATCH_PX = 20;
const TILT_PER_PX = 0.2;    // degrees of pitch per pixel the midpoint travels
const TURN_PER_PX = 0.25;   // degrees of yaw per pixel a turning drag travels
const VEL_SMOOTH = 0.72;    // how much of the previous velocity a sample keeps (F6)

/**
 * Taps land in the store as `tap` { x, y, type } and pointer moves (fine pointers, no
 * button held) as `pointer` { x, y, type }; the engine turns them into `selection` and
 * `hover`. Coordinates are px from the canvas centre, y up, like the camera maths.
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function attachGestures(canvas, store) {
  /** @type {Map<number, {x:number,y:number,sx:number,sy:number,t:number,type:string,button:number,travel:number,multi:boolean}>} */
  const pointers = new Map();
  let lastTap = 0;
  let pinch = null; // { dist, angle, midX, midY }: the two fingers, last move
  let two = null;   // { mode, twist, start }: what this two-finger gesture turned out to mean

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
  /** A smoothed screen velocity, px per ms, so a release can carry on (F6). */
  let vel = null;      // { kind: 'pan' | 'turn', x, y, t }
  let glideRaf = 0;

  /** Note how fast the hand is moving, for the glide after it lets go. */
  function track(kind, dx, dy) {
    const now = performance.now();
    const dt = clamp(now - (vel?.t ?? now - 16), 1, 64);
    const keep = vel?.kind === kind ? VEL_SMOOTH : 0;
    vel = { kind, t: now, x: vel ? vel.x * keep + (dx / dt) * (1 - keep) : dx / dt,
            y: vel ? vel.y * keep + (dy / dt) * (1 - keep) : dy / dt };
  }

  function stopGlide() {
    if (glideRaf) cancelAnimationFrame(glideRaf);
    glideRaf = 0;
  }

  /**
   * Carry the release on and let it die away (PLAN.md F6). A drag that stops dead the
   * instant the finger lifts is a picture being repositioned; one that coasts is an
   * object that was pushed. It only runs while something moves, so render-on-demand
   * still holds, and `write` clamps it with no give, so it comes to rest at the edge of
   * the bounds instead of sailing past them.
   */
  function glide(anchor) {
    stopGlide();
    const start = reducedMotion() ? null : flingFrom(vel);
    if (!start) { settle(); return; }
    const { kind } = start;
    let vx = start.x, vy = start.y;
    let last = performance.now();
    let spent = 0;
    const step = (now) => {
      const dt = clamp(now - last, 1, 48);
      last = now;
      spent += dt;
      const dx = vx * dt, dy = vy * dt;
      const decay = Math.exp(-dt / FLING.tau);
      vx *= decay; vy *= decay;
      const c = cam();
      if (kind === 'turn' && anchor) write(orbitAbout(c, c.yaw + dx * TURN_PER_PX, c.pitch - dy * TURN_PER_PX, anchor, viewport()));
      else {
        const [gx, gz] = groundShift(c, -dx, -dy, viewport());
        write({ ...c, x: c.x + gx, z: c.z + gz });
      }
      if (spent > FLING.maxMs || Math.hypot(vx, vy) < FLING.minSpeed) { glideRaf = 0; settle(); return; }
      glideRaf = requestAnimationFrame(step);
    };
    glideRaf = requestAnimationFrame(step);
  }

  // Screen coordinates relative to the canvas centre, y up.
  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: -(e.clientY - r.top - r.height / 2) };
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    stopGlide();                       // a hand on the model stops it dead
    vel = null;
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now(), type: e.pointerType, button: e.button,
      travel: 0, multi: pointers.size > 0 });
    // A second finger makes the whole gesture two-fingered, for every finger in it: the
    // one that lifts last after a pinch or a twist is not tapping.
    if (pointers.size > 1) for (const r of pointers.values()) r.multi = true;
    if (pointers.size === 1) {
      // Which it is, is decided here and not revisited: letting go of Ctrl halfway
      // through a turn should not silently make it a pan. A mouse on the turn button
      // takes hold of what is under it; one finger only pans, which needs no anchor.
      const rec = pointers.get(e.pointerId);
      rec.turn = e.pointerType === 'mouse' && turning(e, e.button);
      held = rec.turn ? turnAnchor(p.x, p.y) : null;
    } else if (pointers.size === 2) {
      pinch = pinchState();
      two = { mode: 'undecided', twist: false, start: { ...pinch } };
      held = turnAnchor(pinch.midX, pinch.midY);   // two fingers hold the point between them
    }
    e.preventDefault();
  }

  /** Mouse: the right button turns, and so does Ctrl or Alt for trackpads without one. */
  const turning = (e, button) => button === 2 || e.ctrlKey || e.altKey;

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2,
             ay: a.y, by: b.y };
  }

  function onMove(e) {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    const p = local(e);
    const dx = p.x - rec.x, dy = p.y - rec.y;
    rec.x = p.x; rec.y = p.y;
    rec.travel += Math.hypot(dx, dy);
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
        track('turn', dx, dy);
        write(orbitAbout(c, c.yaw + dx * TURN_PER_PX, c.pitch - dy * TURN_PER_PX, held, vp));
      } else {
        const c = cam();
        track('pan', dx, dy);
        const [gx, gz] = groundShift(c, -dx, -dy, vp);
        write({ ...c, x: c.x + gx, z: c.z + gz });
      }
    } else if (pointers.size === 2 && pinch && held && two) {
      const now = pinchState();
      decideTwoFinger(now);
      let c = cam();
      if (two.mode === 'tilt') {
        // Tilting and nothing else: the fingers are travelling together, so the point
        // they took hold of stays where it was on screen rather than following them.
        write(orbitAbout(c, c.yaw, c.pitch + (now.midY - pinch.midY) * TILT_PER_PX, held, vp));
      } else {
        // Pinch to zoom; twist to turn, but only once it has latched.
        // An undecided gesture pinches too, so a pinch answers at once; a tilt barely
        // changes the spread, so what it zooms before it commits is nothing to see.
        if (pinch.dist > 20 && now.dist > 20) {
          c = { ...c, zoom: clamp(c.zoom * (pinch.dist / now.dist), LIMITS.zoom[0], LIMITS.zoom[1]) };
        }
        if (two.twist) c = clampCamera({ ...c, yaw: c.yaw - (deltaAngle(now.angle, pinch.angle) * 180) / Math.PI });
        // And the gesture keeps the point it took hold of between the fingers, wherever
        // the fingers have carried it. That is the pan, and there is no separate one:
        // holding the anchor to the new midpoint is exactly what a pan means.
        track('pan', now.midX - pinch.midX, now.midY - pinch.midY);
        write(holdAnchor(c, { ...held, sx: now.midX, sy: now.midY }, vp));
      }
      pinch = now;
    }
  }

  /** The signed difference between two angles, in radians, brought into (-pi, pi]. */
  function deltaAngle(a, b) {
    let d = a - b;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  /**
   * What are those two fingers asking for (PLAN.md F5)? Everything at once was the old
   * answer: each move applied pan, zoom, twist and tilt together, with the midpoint's
   * vertical travel feeding both the pan and the pitch. So a two-finger drag panned and
   * tilted at the same time, and an ordinary pinch whose fingers drifted wobbled the
   * yaw and the pitch.
   *
   * Now a gesture starts undecided -- panning, which is harmless and is what a hand
   * expects to happen at once -- and commits after a few pixels of travel. Fingers
   * moving together, mostly up or down the screen, with the spread and the angle between
   * them barely changing, mean tilt and nothing else. Anything else is the map: pinch and
   * pan, with twist joining only once the angle has really moved, and latching there.
   * The mode holds until a finger lifts.
   */
  function decideTwoFinger(now) {
    const turnedRad = Math.abs(deltaAngle(now.angle, two.start.angle));
    const turned = (turnedRad * 180) / Math.PI;
    const twisted = turned > TWIST_LATCH_DEG && turnedRad * now.dist / 2 > TWIST_LATCH_PX;
    if (two.mode !== 'undecided') {
      if (two.mode === 'map' && !two.twist && twisted) two.twist = true;
      return;
    }
    const spread = Math.abs(now.dist - two.start.dist);
    const dx = now.midX - two.start.midX, dy = now.midY - two.start.midY;
    if (Math.max(spread, Math.hypot(dx, dy)) < MODE_SLOP_PX && !twisted) return;
    // Each finger's own vertical travel: a tilt moves both the same way by much the same
    // amount. A pinch with one finger still (or both moving apart) also moves the
    // midpoint up or down, and used to be taken for a tilt, which then shut out the zoom.
    const da = now.ay - two.start.ay, db = now.by - two.start.by;
    const matched = da * db > 0 && Math.min(Math.abs(da), Math.abs(db)) >= TILT_MATCH * Math.max(Math.abs(da), Math.abs(db));
    const together = matched && spread < TILT_SPREAD_PX && turned < TILT_TWIST_DEG;
    two.mode = together && Math.abs(dy) > Math.abs(dx) * 1.5 ? 'tilt' : 'map';
    if (two.mode === 'map' && twisted) two.twist = true;
  }

  function onUp(e) {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    pointers.delete(e.pointerId);
    // A finger lifting ends the two-finger gesture and whatever it had decided to be;
    // if two are still down, what is left is a new one, undecided again.
    if (pointers.size === 0) { const a = held; held = null; two = null; glide(a); }
    else if (pointers.size === 1) { pinch = null; two = null; held = null; vel = null; resetOrigins(); }
    else if (pointers.size === 2) {
      pinch = pinchState();
      two = { mode: 'undecided', twist: false, start: { ...pinch } };
      held = turnAnchor(pinch.midX, pinch.midY);
    }
    // A tap is one finger that went down and came up without going anywhere: the
    // distance it *travelled*, not how far it ended from where it began, since a pan
    // that wanders back is not a tap either. And never the last finger of a two-finger
    // gesture: `resetOrigins` restarts the survivor's origin when its partner lifts, and
    // that made every pinch and twist ending within a third of a second select a state.
    const dt = performance.now() - rec.t;
    if (pointers.size === 0 && !rec.multi && rec.travel < TAP_SLOP && dt < TAP_MS && rec.button === 0) {
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
    stopGlide();
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
    stopGlide();
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
    stopGlide();
  };
}
