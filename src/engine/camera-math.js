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

export const LIMITS = { zoom: [180, 9500], yaw: [-40, 40], pitch: [25, 89] };

export function clampCamera(cam) {
  return {
    ...cam,
    zoom: clamp(cam.zoom, LIMITS.zoom[0], LIMITS.zoom[1]),
    yaw: clamp(cam.yaw, LIMITS.yaw[0], LIMITS.yaw[1]),
    pitch: clamp(cam.pitch, LIMITS.pitch[0], LIMITS.pitch[1]),
  };
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

/** Screen position (px from the viewport centre, y up) of a scene point. */
export function project(cam, point, viewport) {
  const k = kmPerPixel(cam, viewport);
  const { right, up } = basis(cam.yaw, cam.pitch);
  const px = point[0] - cam.x, py = point[1], pz = point[2] - cam.z;
  return [(px * right[0] + pz * right[2]) / k, (px * up[0] + py * up[1] + pz * up[2]) / k];
}

/**
 * Zoom about a screen point so the ground under it stays put.
 * @param {number} factor  new zoom = old zoom * factor (factor < 1 zooms in)
 */
export function zoomAbout(cam, factor, sxPx, syPx, viewport) {
  const newZoom = clamp(cam.zoom * factor, LIMITS.zoom[0], LIMITS.zoom[1]);
  const f = newZoom / cam.zoom;
  const [gx, gz] = groundPoint(cam, sxPx, syPx, viewport);
  return { ...cam, zoom: newZoom, x: gx + (cam.x - gx) * f, z: gz + (cam.z - gz) * f };
}

/**
 * Rotate the view about the ground point under a screen position (pivot), so that
 * point stays where it is on screen. `yaw`/`pitch` are the new absolute values.
 */
export function orbitAbout(cam, yaw, pitch, sxPx, syPx, viewport) {
  const [gx, gz] = groundPoint(cam, sxPx, syPx, viewport);
  const next = clampCamera({ ...cam, yaw, pitch });
  // Where would the pivot land with the new orientation if the target stayed? Shift back.
  const [px, py] = project(next, [gx, 0, gz], viewport);
  const [dx, dz] = groundShift(next, px - sxPx, py - syPx, viewport);
  return { ...next, x: next.x + dx, z: next.z + dz };
}

/**
 * The one framing primitive: the camera (same yaw/pitch) that shows a scene box
 * inside the viewport minus padding, centred in the remaining area.
 * @param {{x0?:number,z0?:number,x1?:number,z1?:number,points?:number[][],ymax?:number}} box
 *   a box, or `points` ([x, z] outline such as a convex hull) for a tighter fit of rotated views
 * @param {{w:number,h:number}} viewport
 * @param {{top:number,right:number,bottom:number,left:number}} pad in pixels
 */
export function fitBounds(cam, box, viewport, pad) {
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
  const zoom = clamp(k * viewport.h, LIMITS.zoom[0], LIMITS.zoom[1]);
  const kk = zoom / viewport.h;
  // Screen-km coordinates the target must have so the box centre sits at the padded centre.
  const a = (sx0 + sx1) / 2 - ((pad.left - pad.right) / 2) * kk;
  const b = ((sy0 + sy1) / 2 - ((pad.bottom - pad.top) / 2) * kk) / Math.sin(cam.pitch * DEG);
  return { ...cam, zoom, x: a * right[0] + b * forward[0], z: a * right[2] + b * forward[2] };
}
