// @ts-check
// The camera maths is pure, so it can be pinned down without a browser (PLAN.md
// section 3, F8). Run with `npm test`; node:test and node:assert are standard library,
// so this adds no dependency (D7).
//
// These cover the invariants the handling rests on: the screen <-> ground mapping is a
// bijection, a gesture that is supposed to hold a point on screen holds it, and a fit
// puts the whole box inside the padded viewport. Each later fix adds its own cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  basis, clamp, clampCamera, DEFAULT_CAMERA, fitBounds, groundPoint, groundShift,
  kmPerPixel, LIMITS, project,
} from '../src/engine/camera-math.js';

/** A deterministic generator, so a failure is always the same failure. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const VIEWPORTS = [
  { w: 390, h: 844 },      // a phone, portrait
  { w: 844, h: 390 },      // the same phone on its side
  { w: 1400, h: 900 },     // a laptop
];

/** Cameras across the whole allowed range, plus the home view. */
function cameras(r, n = 40) {
  const out = [{ ...DEFAULT_CAMERA }];
  for (let i = 0; i < n; i++) {
    out.push({
      x: (r() - 1500) * 2, z: (r() - 1500) * 2,
      zoom: LIMITS.zoom[0] + r() * (LIMITS.zoom[1] - LIMITS.zoom[0]),
      yaw: -180 + r() * 360,
      pitch: LIMITS.pitch[0] + r() * (LIMITS.pitch[1] - LIMITS.pitch[0]),
    });
  }
  return out;
}

const close = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tolerance ${tol})`);

test('basis vectors are orthonormal, and right/forward lie on the ground', () => {
  const r = rng(2);
  for (const cam of cameras(r)) {
    const { toCam, right, forward, up } = basis(cam.yaw, cam.pitch);
    for (const [name, v] of [['toCam', toCam], ['right', right], ['forward', forward], ['up', up]]) {
      close(Math.hypot(v[0], v[1], v[2]), 1, 1e-12, `${name} is unit length`);
    }
    close(right[1], 0, 1e-12, 'right is horizontal');
    close(forward[1], 0, 1e-12, 'forward is horizontal');
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    close(dot(right, up), 0, 1e-12, 'right is perpendicular to up');
    close(dot(right, toCam), 0, 1e-12, 'right is perpendicular to the view');
    close(dot(up, toCam), 0, 1e-12, 'up is perpendicular to the view');
  }
});

test('the ground point under a screen position projects back to it', () => {
  const r = rng(3);
  for (const vp of VIEWPORTS) {
    for (const cam of cameras(r, 12)) {
      for (let i = 0; i < 8; i++) {
        const sx = (r() - 0.5) * vp.w, sy = (r() - 0.5) * vp.h;
        const [gx, gz] = groundPoint(cam, sx, sy, vp);
        const [px, py] = project(cam, [gx, 0, gz], vp);
        close(px, sx, 1e-6, 'x round trip');
        close(py, sy, 1e-6, 'y round trip');
      }
    }
  }
});

test('a ground shift is exactly the screen delta that asked for it, at any height', () => {
  // Moving the camera target shifts everything on screen equally, whatever its height:
  // the camera is orthographic, and the target only slides in the ground plane. This is
  // what lets a pivot be held in one step rather than iterated.
  const r = rng(4);
  for (const vp of VIEWPORTS) {
    for (const cam of cameras(r, 12)) {
      for (let i = 0; i < 8; i++) {
        const dxPx = (r() - 0.5) * vp.w, dyPx = (r() - 0.5) * vp.h;
        const [dx, dz] = groundShift(cam, dxPx, dyPx, vp);
        const y = r() * 120;                                  // up to the highest relief
        const before = project(cam, [100, y, -250], vp);
        const after = project({ ...cam, x: cam.x - dx, z: cam.z - dz }, [100, y, -250], vp);
        close(after[0] - before[0], dxPx, 1e-6, 'screen dx');
        close(after[1] - before[1], dyPx, 1e-6, 'screen dy');
      }
    }
  }
});

test('one screen pixel is the same number of km everywhere', () => {
  const vp = { w: 1000, h: 800 };
  const cam = { ...DEFAULT_CAMERA, zoom: 4000 };
  close(kmPerPixel(cam, vp), 5, 1e-12, 'km per pixel');
  // 100 px across the screen is 500 km across the ground, in whichever compass
  // direction the current yaw points "screen right".
  const [ax, az] = groundPoint(cam, 0, 0, vp);
  const [bx, bz] = groundPoint(cam, 100, 0, vp);
  close(Math.hypot(bx - ax, bz - az), 500, 1e-9, '100 px across is 500 km');
});

test('clampCamera holds the limits and leaves a camera inside them alone', () => {
  const inside = { x: 10, z: -20, zoom: 2000, yaw: 5, pitch: 50 };
  assert.deepEqual(clampCamera(inside), inside);
  const out = clampCamera({ x: 0, z: 0, zoom: 1e9, yaw: 0, pitch: 200 });
  close(out.zoom, LIMITS.zoom[1], 0, 'zoom clamped');
  close(out.pitch, LIMITS.pitch[1], 0, 'pitch clamped');
  close(clampCamera({ ...inside, pitch: -90 }).pitch, LIMITS.pitch[0], 0, 'pitch floored');
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});

test('fitBounds puts the whole box inside the padded viewport, and fills one axis', () => {
  const r = rng(5);
  // Each padding with a viewport it is actually used on: the wide layout's side panel
  // would leave a negative-width box on a phone, which is not a case the app can reach.
  const cases = [
    [{ w: 1400, h: 900 }, { top: 104, right: 420, bottom: 36, left: 24 }],   // wide, panel
    [{ w: 390, h: 844 }, { top: 60, right: 8, bottom: 300, left: 8 }],       // phone, sheet open
    [{ w: 844, h: 390 }, { top: 56, right: 8, bottom: 120, left: 8 }],       // phone on its side
    ...VIEWPORTS.map((vp) => [vp, { top: 0, right: 0, bottom: 0, left: 0 }]),
  ];
  for (const [vp, pad] of cases) {
    for (const cam of cameras(r, 8)) {
      const box = { x0: -900, z0: -1400, x1: 1100, z1: 1600, ymax: 90 };
      const fitted = fitBounds(cam, box, vp, pad);
      assert.ok(fitted.zoom >= LIMITS.zoom[0] && fitted.zoom <= LIMITS.zoom[1], 'zoom in range');
      close(fitted.yaw, cam.yaw, 1e-12, 'fit keeps the angles');
      close(fitted.pitch, cam.pitch, 1e-12, 'fit keeps the angles');
      // Every corner of the box, at both heights, lands inside the padded area.
      const l = -vp.w / 2 + pad.left, rt = vp.w / 2 - pad.right;
      const b = -vp.h / 2 + pad.bottom, t = vp.h / 2 - pad.top;
      let maxX = -Infinity, maxY = -Infinity;
      for (const x of [box.x0, box.x1]) for (const z of [box.z0, box.z1]) for (const y of [0, box.ymax]) {
        const [sx, sy] = project(fitted, [x, y, z], vp);
        assert.ok(sx >= l - 0.01 && sx <= rt + 0.01, `x ${sx} inside [${l}, ${rt}]`);
        assert.ok(sy >= b - 0.01 && sy <= t + 0.01, `y ${sy} inside [${b}, ${t}]`);
        maxX = Math.max(maxX, Math.abs(sx - (l + rt) / 2));
        maxY = Math.max(maxY, Math.abs(sy - (b + t) / 2));
      }
      // and it is not needlessly far out: one axis is filled to the padding.
      const tight = Math.max(maxX / ((rt - l) / 2), maxY / ((t - b) / 2));
      if (fitted.zoom > LIMITS.zoom[0] + 1) close(tight, 1, 1e-3, 'one axis is filled');
    }
  }
});

test('fitBounds fits a hull more tightly than the box around it', () => {
  const vp = { w: 900, h: 1200 };
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  const cam = { ...DEFAULT_CAMERA };
  // A diamond: its bounding box has twice the area, so a turned view should fit closer.
  const points = [[0, -1000], [1000, 0], [0, 1000], [-1000, 0]];
  const hull = fitBounds(cam, { points }, vp, pad);
  const box = fitBounds(cam, { x0: -1000, z0: -1000, x1: 1000, z1: 1000 }, vp, pad);
  assert.ok(hull.zoom < box.zoom, `hull ${hull.zoom} should be closer than box ${box.zoom}`);
});
