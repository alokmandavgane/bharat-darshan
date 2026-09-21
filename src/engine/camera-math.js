// @ts-check
// Pure camera maths shared by the engine (to place the three.js camera) and the UI
// (to turn gestures into camera changes). No three.js, no DOM.
//
// A camera is { x, z, zoom, yaw, pitch }: the ground point under the screen centre
// (scene km, x east, z south), the visible height in km, the turn about the vertical
// axis in degrees (0 = north up) and the elevation above the ground plane in degrees
// (90 = straight down). The camera is orthographic, so `zoom / viewportHeight` is the
// world size of one pixel everywhere on screen.

const DEG = Math.PI / 180;

// Yaw has no limits: the model turns the whole way round (D2 as amended, D13, F3). A
// model on a table that stops a third of the way is a broken turntable, and looking at
// the Himalaya from the north or at the peninsula from the south is the thing a 3D
// atlas can do that a printed one cannot. The compass is the way back to north.
export const LIMITS = { zoom: [180, 9500], pitch: [25, 89] };
export const DEFAULT_CAMERA = { x: 0, z: 0, zoom: 4200, yaw: -12, pitch: 56 };   // the home view's angles
// Absolute floors. The engine tightens them to what the loaded rasters can actually
// resolve (refreshZoomFloor in index.js), so the model never magnifies into mush.
export const ZOOM_MIN = { country: 180, state: 30 };
// Height texels per screen pixel allowed before detail reads as blur rather than relief.
export const MAX_MAGNIFY = 2.5;

/** The state view allows a much closer look than the country view. */
export function setZoomFloor(km) {
  LIMITS.zoom[0] = km;
}

export function clampCamera(cam) {
  return {
    ...cam,
    zoom: clamp(cam.zoom, LIMITS.zoom[0], LIMITS.zoom[1]),
    yaw: wrapYaw(cam.yaw),
    pitch: clamp(cam.pitch, LIMITS.pitch[0], LIMITS.pitch[1]),
  };
}

/** An angle in degrees brought into (-180, 180]. */
export function wrapYaw(yaw) {
  const y = (((yaw + 180) % 360) + 360) % 360 - 180;
  return y === -180 ? 180 : y;
}

/**
 * The same angle as `to`, written so that tweening from `from` takes the short way.
 * Without this a flight from 170 degrees home to -12 spins 342 the wrong way round;
 * `tween` interpolates plain numbers and should not have to know what an angle is.
 */
export function unwrapYaw(from, to) {
  return from + wrapYaw(to - from);
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Camera basis vectors in scene space for a yaw/pitch (all unit length). */
export function basis(yaw, pitch) {
  const y = yaw * DEG, p = pitch * DEG;
  const sy = Math.sin(y), cy = Math.cos(y), sp = Math.sin(p), cp = Math.cos(p);
  return {
    toCam: [sy * cp, sp, cy * cp],          // target -> camera
    right: [cy, 0, -sy],                    // screen right, on the ground
    forward: [-sy, 0, -cy],                 // screen up, projected on the ground
    up: [-sp * sy, cp, -sp * cy],           // screen up, in space
  };
}

export function kmPerPixel(cam, viewport) {
  return cam.zoom / viewport.h;
}

/** Ground displacement (km) for a screen drag of (dx, dy) pixels, dy positive upwards. */
export function groundShift(cam, dxPx, dyPx, viewport) {
  const k = kmPerPixel(cam, viewport);
  const { right, forward } = basis(cam.yaw, cam.pitch);
  const along = (dyPx * k) / Math.sin(cam.pitch * DEG);
  return [dxPx * k * right[0] + along * forward[0], dxPx * k * right[2] + along * forward[2]];
}

/** Ground point (y = 0) under a screen position given relative to the viewport centre, y up. */
export function groundPoint(cam, sxPx, syPx, viewport) {
  const [dx, dz] = groundShift(cam, sxPx, syPx, viewport);
  return [cam.x + dx, cam.z + dz];
}

/**
 * The key light's ground direction for a camera yaw (PLAN.md F4). The light belongs to
 * the viewer's room rather than to the model: it comes from over the left shoulder, so
 * on screen it is always up and to the left, and turning the model is like turning a
 * thing under a lamp. That is also the cartographic rule -- light from the bottom of
 * the screen makes the eye read valleys as ridges -- and with yaw free to go the whole
 * way round, a lamp fixed to the model's north-west would light a south-up view from
 * below.
 *
 * It is `forward - right` in ground coordinates, which at yaw 0 is the north-west the
 * look was designed around. Its length is always sqrt(2), so the light's height above
 * the ground (the caller's y) means the same thing at every angle.
 */
export function lightDirection(yaw) {
  const { right, forward } = basis(yaw, 0);
  return [forward[0] - right[0], forward[2] - right[2]];
}

/** The middle of the area the header, panels and sheet leave visible. */
export function paddedCentre(viewport, pad) {
  return [(pad.left - pad.right) / 2, (pad.bottom - pad.top) / 2];
}

/** Screen position (px from the viewport centre, y up) of a scene point. */
export function project(cam, point, viewport) {
  const k = kmPerPixel(cam, viewport);
  const { right, up } = basis(cam.yaw, cam.pitch);
  const px = point[0] - cam.x, py = point[1], pz = point[2] - cam.z;
  return [(px * right[0] + pz * right[2]) / k, (px * up[0] + py * up[1] + pz * up[2]) / k];
}

// --- anchors: the one rule the handling rests on (PLAN.md D13)
//
// An anchor is a scene point and the screen position it must keep: the point the hand
// grabbed, where it was grabbed. Every turn, tilt and zoom is "change the angles or the
// scale, then put the anchor back", so whatever you have hold of does not move under
// your finger. The point is a full 3D one, because the surface is up to ~90 km above
// sea level at the default exaggeration and a pivot on the sea-level plane slides up
// and down the screen as the view tilts.

/** @typedef {{ point: number[], sx: number, sy: number }} Anchor */

/** An anchor on the sea-level plane: for a caller with no terrain to ask. */
export function groundAnchor(cam, sxPx, syPx, viewport) {
  const [x, z] = groundPoint(cam, sxPx, syPx, viewport);
  return { point: [x, 0, z], sx: sxPx, sy: syPx };
}

/**
 * Slide the target so the anchor's point projects to its screen position again.
 * Exact in one step: the camera is orthographic and the target only moves in the ground
 * plane, so shifting it moves everything on screen equally whatever its height.
 * @param {Anchor} anchor
 */
export function holdAnchor(cam, anchor, viewport) {
  const [px, py] = project(cam, anchor.point, viewport);
  const [dx, dz] = groundShift(cam, px - anchor.sx, py - anchor.sy, viewport);
  return { ...cam, x: cam.x + dx, z: cam.z + dz };
}

/**
 * Zoom, keeping the anchor where it is on screen.
 * @param {number} factor  new zoom = old zoom * factor (factor < 1 zooms in)
 * @param {Anchor} anchor
 */
export function zoomAbout(cam, factor, anchor, viewport) {
  const zoom = clamp(cam.zoom * factor, LIMITS.zoom[0], LIMITS.zoom[1]);
  return holdAnchor({ ...cam, zoom }, anchor, viewport);
}

/**
 * Turn and tilt to new absolute angles, keeping the anchor where it is on screen.
 * @param {Anchor} anchor
 */
export function orbitAbout(cam, yaw, pitch, anchor, viewport) {
  return holdAnchor(clampCamera({ ...cam, yaw, pitch }), anchor, viewport);
}

// How far outside its own bounds the middle of the view may sit. Enough that the edge
// of the model can be brought past the middle of the screen and looked at with some
// room around it, and no more: a fifth of the bounds is 570 km of empty paper on a
// country 2,900 km wide, which is a whole screen of nothing at any close zoom. So it is
// the smaller of a fifth of the bounds and a third of the view height, which is about a
// fifth of the screen at every zoom.
export const TARGET_MARGIN = 0.2;
export const TARGET_MARGIN_VIEW = 0.15;

/** Clamp to [lo, hi], or with `give` km of springy overshoot that never runs away. */
function soft(v, lo, hi, give) {
  if (v >= lo && v <= hi) return v;
  const over = v < lo ? lo - v : v - hi;
  const past = give > 0 ? give * (1 - Math.exp(-over / give)) : 0;
  return v < lo ? lo - past : hi + past;
}

/**
 * The nearest point of an axis-aligned box, and how far away it is. A point inside is
 * its own nearest point, at zero.
 */
function nearestInBox(px, pz, [x0, z0, x1, z1]) {
  const qx = clamp(px, x0, x1), qz = clamp(pz, z0, z1);
  return [qx, qz, Math.hypot(qx - px, qz - pz)];
}

/**
 * Keep the model on the table. `clampCamera` holds the zoom and the angles and says
 * nothing about where the camera is looking, so a few drags could carry the view
 * thousands of km off the model with nothing but the compass to bring it back. The
 * ground point under the middle of what can be seen has to stay within `margin` of one
 * of the level's boxes.
 *
 * Several boxes, rather than one around the lot, because India is not a rectangle and
 * neither is its convex hull any better: one box has corners in Afghanistan and in the
 * ocean south-east of Sri Lanka, and a hull spans the 1,200 km of the Bay of Bengal
 * between the mainland and the Andamans. Both leave the view parked on open water with
 * nothing on screen. The units' own boxes describe the country closely enough, and the
 * far island groups become places you reach by naming them rather than by dragging
 * across an empty sea -- which is how an atlas is read anyway.
 *
 * @param {{ boxes: number[][], extent: number[] } | null} bounds
 *   the level's parts and the box around them all, in scene km; null leaves the camera alone
 * @param {number} give  km of springy overshoot to allow, for a gesture in progress
 */
export function clampTarget(cam, bounds, viewport, pad, give = 0) {
  if (!bounds?.boxes?.length) return cam;
  const [cx, cy] = paddedCentre(viewport, pad);
  const [gx, gz] = groundPoint(cam, cx, cy, viewport);
  // The margin is the smaller of a fraction of the whole model and a fraction of the
  // view, so it is about a fifth of the screen whatever the zoom.
  const [x0, z0, x1, z1] = bounds.extent;
  const margin = Math.min((x1 - x0) * TARGET_MARGIN, (z1 - z0) * TARGET_MARGIN, cam.zoom * TARGET_MARGIN_VIEW);
  let nx = gx, nz = gz, best = Infinity;
  for (const box of bounds.boxes) {
    const [qx, qz, d] = nearestInBox(gx, gz, box);
    if (d < best) { best = d; nx = qx; nz = qz; }
    if (d === 0) return cam;                               // inside one of them: nothing to do
  }
  const allow = soft(best, 0, margin, give);
  if (best <= allow) return cam;
  const f = allow / best;
  const tx = nx + (gx - nx) * f, tz = nz + (gz - nz) * f;
  return { ...cam, x: cam.x + (tx - gx), z: cam.z + (tz - gz) };
}

/**
 * The one framing primitive: the camera (same yaw/pitch) that shows a scene box
 * inside the viewport minus padding, centred in the remaining area.
 * @param {{x0?:number,z0?:number,x1?:number,z1?:number,points?:number[][],ymax?:number}} box
 *   a box, or `points` ([x, z] outline such as a convex hull) for a tighter fit of rotated views
 * @param {{w:number,h:number}} viewport
 * @param {{top:number,right:number,bottom:number,left:number}} pad in pixels
 */
export function fitBounds(cam, box, viewport, pad, opts = {}) {
  const { right, up, forward } = basis(cam.yaw, cam.pitch);
  const ymax = box.ymax ?? 0;
  const pts = box.points || [[box.x0, box.z0], [box.x0, box.z1], [box.x1, box.z0], [box.x1, box.z1]];
  let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
  for (const [x, z] of pts) for (const y of [0, ymax]) {
    const sx = x * right[0] + z * right[2];
    const sy = x * up[0] + y * up[1] + z * up[2];
    sx0 = Math.min(sx0, sx); sx1 = Math.max(sx1, sx); sy0 = Math.min(sy0, sy); sy1 = Math.max(sy1, sy);
  }
  const availW = Math.max(40, viewport.w - pad.left - pad.right);
  const availH = Math.max(40, viewport.h - pad.top - pad.bottom);
  const k = Math.max((sx1 - sx0) / availW, (sy1 - sy0) / availH);
  const zoom = clamp(Math.max(k * viewport.h, opts.minZoom || 0), LIMITS.zoom[0], LIMITS.zoom[1]);
  const kk = zoom / viewport.h;
  // Screen-km coordinates the target must have so the box centre sits at the padded centre.
  const a = (sx0 + sx1) / 2 - ((pad.left - pad.right) / 2) * kk;
  const b = ((sy0 + sy1) / 2 - ((pad.bottom - pad.top) / 2) * kk) / Math.sin(cam.pitch * DEG);
  return { ...cam, zoom, x: a * right[0] + b * forward[0], z: a * right[2] + b * forward[2] };
}
