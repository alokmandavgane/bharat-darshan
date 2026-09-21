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
  basis, clamp, clampCamera, clampTarget, DEFAULT_CAMERA, fitBounds, FLING, flingFrom, groundAnchor,
  groundPoint, groundShift, holdAnchor, kmPerPixel, lightDirection, LIMITS, orbitAbout, paddedCentre,
  project, TARGET_MARGIN, TARGET_MARGIN_VIEW, unwrapYaw, wrapYaw, zoomAbout,
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

// --- anchors (PLAN.md D13, F1): the point you grab is the point that stays

test('holdAnchor puts its point back where it was asked for, at any height', () => {
  const r = rng(6);
  for (const vp of VIEWPORTS) {
    for (const cam of cameras(r, 12)) {
      for (let i = 0; i < 6; i++) {
        const a = { point: [(r() - 0.5) * 3000, r() * 120, (r() - 0.5) * 3000], sx: (r() - 0.5) * vp.w, sy: (r() - 0.5) * vp.h };
        const [px, py] = project(holdAnchor(cam, a, vp), a.point, vp);
        close(px, a.sx, 1e-6, 'anchor x');
        close(py, a.sy, 1e-6, 'anchor y');
      }
    }
  }
});

test('a turn keeps the grabbed point under the hand, whatever its height', () => {
  const r = rng(7);
  for (const vp of VIEWPORTS) {
    for (const cam of cameras(r, 10)) {
      // grab a point on the terrain, not on the sea-level plane
      const sx = (r() - 0.5) * vp.w, sy = (r() - 0.5) * vp.h;
      const [gx, gz] = groundPoint(cam, sx, sy, vp);
      const held = { point: [gx, r() * 120, gz], sx, sy };
      let c = cam;
      for (let step = 0; step < 24; step++) {                 // a drag, one move at a time
        c = orbitAbout(c, c.yaw + 15, c.pitch + (r() - 0.5) * 6, held, vp);
        const [px, py] = project(c, held.point, vp);
        close(px, sx, 1e-6, `x after ${step + 1} moves`);
        close(py, sy, 1e-6, `y after ${step + 1} moves`);
      }
    }
  }
});

test('a zoom keeps the grabbed point under the hand', () => {
  const r = rng(8);
  const vp = { w: 1400, h: 900 };
  for (const cam of cameras(r, 10)) {
    const sx = (r() - 0.5) * vp.w, sy = (r() - 0.5) * vp.h;
    const [gx, gz] = groundPoint(cam, sx, sy, vp);
    const held = { point: [gx, 90, gz], sx, sy };             // a summit, not the sea
    let c = cam;
    for (let step = 0; step < 20; step++) {
      c = zoomAbout(c, 0.85, held, vp);
      const [px, py] = project(c, held.point, vp);
      close(px, sx, 1e-6, 'x while zooming in');
      close(py, sy, 1e-6, 'y while zooming in');
    }
  }
});

test('a sea-level pivot drifts high ground when the view tilts; a 3D one does not', () => {
  // Why the pivot has to carry a height. Turning about the vertical axis through a point
  // is unaffected by how high that point is, so yaw alone never showed this; tilting is
  // where it bites, because the screen offset of a height is y * cos(pitch) / kmPerPx.
  // At the default exaggeration the Himalaya sit ~96 km above the plane.
  const vp = { w: 1400, h: 900 };
  const cam = { ...DEFAULT_CAMERA, zoom: 1200 };
  const flat = groundAnchor(cam, 200, 100, vp);
  close(flat.point[1], 0, 0, 'a ground anchor is on the plane');
  const summit = [flat.point[0], 90, flat.point[2]];
  const was = project(cam, summit, vp);

  const old = orbitAbout(cam, cam.yaw, cam.pitch + 20, flat, vp);
  const [px, py] = project(old, summit, vp);
  const drift = Math.hypot(px - was[0], py - was[1]);
  assert.ok(drift > 15, `a sea-level pivot should visibly drift a summit, got ${drift} px`);

  const now = orbitAbout(cam, cam.yaw, cam.pitch + 20, { point: summit, sx: was[0], sy: was[1] }, vp);
  const [qx, qy] = project(now, summit, vp);
  close(Math.hypot(qx - was[0], qy - was[1]), 0, 1e-6, 'the summit stays put');
});

// --- yaw goes the whole way round (PLAN.md D2 amended, F3)

test('yaw has no limits, and clampCamera brings it into one turn', () => {
  assert.equal(LIMITS.yaw, undefined, 'the yaw clamp is gone');
  for (const [given, want] of [[0, 0], [-12, -12], [180, 180], [-180, 180], [181, -179], [360, 0], [540, 180], [-725, -5]]) {
    close(wrapYaw(given), want, 1e-9, `wrapYaw(${given})`);
  }
  // south-up is reachable, which is the whole point
  close(clampCamera({ zoom: 1000, yaw: 168, pitch: 56 }).yaw, 168, 0, 'south-up survives the clamp');
  close(clampCamera({ zoom: 1000, yaw: 900, pitch: 56 }).yaw, 180, 0, 'and two and a half turns is half a turn');
});

test('a flight turns the short way, however the two angles are written', () => {
  for (const [from, to, want] of [
    [170, -170, 190],        // 20 degrees on, not 340 back
    [-170, 170, -190],
    [-12, 168, 168],         // home to south-up: half a turn either way, take it forwards
    [0, 90, 90],
    [179, -179, 181],
    [350, 10, 370],          // unwrapped inputs work too
  ]) {
    const got = unwrapYaw(from, to);
    close(got, want, 1e-9, `unwrapYaw(${from}, ${to})`);
    close(wrapYaw(got), wrapYaw(to), 1e-9, 'and it is still the same angle');
    assert.ok(Math.abs(got - from) <= 180 + 1e-9, `and never the long way: ${Math.abs(got - from)} degrees`);
  }
});

test('the maths holds all the way round, not just in the old +-40 window', () => {
  const vp = { w: 1400, h: 900 };
  const r = rng(11);
  for (let yaw = -180; yaw <= 180; yaw += 7.5) {
    const cam = { ...DEFAULT_CAMERA, yaw, zoom: 1500 };
    const sx = (r() - 0.5) * vp.w, sy = (r() - 0.5) * vp.h;
    const [gx, gz] = groundPoint(cam, sx, sy, vp);
    const [px, py] = project(cam, [gx, 0, gz], vp);
    close(px, sx, 1e-6, `round trip at yaw ${yaw}`);
    close(py, sy, 1e-6, `round trip at yaw ${yaw}`);
    // and a turn from here still holds what it grabbed
    const held = { point: [gx, 60, gz], sx, sy };
    const turned = orbitAbout(cam, yaw + 37, cam.pitch, held, vp);
    const [qx, qy] = project(turned, held.point, vp);
    close(Math.hypot(qx - sx, qy - sy), 0, 1e-6, `anchor held at yaw ${yaw}`);
  }
});

// --- momentum (PLAN.md F6)

test('a slow release is a stop, a fast one is a fling', () => {
  assert.equal(flingFrom(null), null, 'nothing to go on');
  assert.equal(flingFrom({ kind: 'pan', x: 0, y: 0 }), null, 'a hand at rest');
  assert.equal(flingFrom({ kind: 'pan', x: 0.05, y: 0.05 }), null, 'a careful placement, not a throw');
  assert.ok(flingFrom({ kind: 'pan', x: 1.5, y: 0 }), 'a flick');
  // right at the threshold, which is where an off-by-one would hide
  assert.equal(flingFrom({ kind: 'pan', x: FLING.minSpeed - 1e-9, y: 0 }), null, 'just under');
  assert.ok(flingFrom({ kind: 'pan', x: FLING.minSpeed, y: 0 }), 'just over');
  assert.equal(flingFrom({ kind: 'pan', x: NaN, y: 0 }), null, 'a velocity that is not a number');
});

test('a fling travels speed x tau, capped, and turning is damped harder', () => {
  const travel = (v) => Math.hypot(v.x, v.y) * FLING.tau;
  // a 240 px drag thrown at 3.3 px/ms: the glide adds about half as far again
  const pan = flingFrom({ kind: 'pan', x: -3.3, y: 0 });
  const added = travel(pan);
  assert.ok(added > 240 * 1.2 && added < 240 * 2.2, `${added.toFixed(0)} px after a 240 px drag`);
  // the same throw, turning: much less
  const turn = flingFrom({ kind: 'turn', x: 3.3, y: 0 });
  close(travel(turn) / added, FLING.turnScale, 1e-9, 'a turn is damped by turnScale');
  // and an absurd velocity is capped rather than launching the model
  const wild = flingFrom({ kind: 'pan', x: 400, y: 0 });
  close(Math.hypot(wild.x, wild.y), FLING.maxSpeed, 1e-9, 'capped');
  // the direction is kept whatever the scaling
  const d = flingFrom({ kind: 'pan', x: 3, y: -4 });
  close(Math.atan2(d.y, d.x), Math.atan2(-4, 3), 1e-12, 'direction kept');
});

// --- the light stays with the viewer (PLAN.md F4)

test('the key light keeps its place on screen however far the model turns', () => {
  const r = rng(12);
  for (let i = 0; i < 40; i++) {
    const yaw = -180 + r() * 360;
    const [lx, lz] = lightDirection(yaw);
    // Project the light's ground direction onto the screen axes for this yaw: it must
    // always come from up and to the left, by the same amount.
    const { right, forward } = basis(yaw, 0);
    const alongRight = lx * right[0] + lz * right[2];
    const alongUp = lx * forward[0] + lz * forward[2];
    close(alongRight, -1, 1e-12, `screen x at yaw ${yaw}`);
    close(alongUp, 1, 1e-12, `screen y at yaw ${yaw}`);
    // and the horizontal length never changes, so the light's elevation is constant
    close(Math.hypot(lx, lz), Math.SQRT2, 1e-12, 'length');
  }
});

test('at yaw 0 the light is the north-west the look was designed around', () => {
  const [x, z] = lightDirection(0);
  close(x, -1, 1e-12, 'west');        // -x is west
  close(z, -1, 1e-12, 'north');       // -z is north
  // and a body-fixed light would not have done this: at south-up it points the other way
  const [sx, sz] = lightDirection(180);
  close(sx, 1, 1e-12, 'east at south-up');
  close(sz, 1, 1e-12, 'south at south-up');
});

// --- keeping the model on the table (PLAN.md F2)

test('clampTarget holds the middle of the view inside the bounds, with a margin', () => {
  const vp = { w: 1400, h: 900 };
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  const bounds = { boxes: [[-1000, -1200, 1000, 1200]], extent: [-1000, -1200, 1000, 1200] };
  const margin = (cam) => [
    Math.min(2000 * TARGET_MARGIN, cam.zoom * TARGET_MARGIN_VIEW),
    Math.min(2400 * TARGET_MARGIN, cam.zoom * TARGET_MARGIN_VIEW),
  ];
  const r = rng(9);
  for (const cam of cameras(r, 24)) {
    const c = clampTarget(cam, bounds, vp, pad);
    const [gx, gz] = groundPoint(c, 0, 0, vp);
    const [mx, mz] = margin(cam);
    assert.ok(gx >= bounds.extent[0] - mx - 1e-6 && gx <= bounds.extent[2] + mx + 1e-6, `x ${gx} held`);
    assert.ok(gz >= bounds.extent[1] - mz - 1e-6 && gz <= bounds.extent[3] + mz + 1e-6, `z ${gz} held`);
    close(c.zoom, cam.zoom, 0, 'the clamp only moves the target');
    close(c.yaw, cam.yaw, 0, 'the clamp only moves the target');
    close(c.pitch, cam.pitch, 0, 'the clamp only moves the target');
  }
});

test('clampTarget leaves a camera that is already looking at the model alone', () => {
  const vp = { w: 1400, h: 900 };
  const pad = { top: 104, right: 420, bottom: 36, left: 24 };
  const bounds = { boxes: [[-1600, -1700, 1600, 1700]], extent: [-1600, -1700, 1600, 1700] };
  // fit frames the box at the padded centre, so a fitted camera must never be moved
  const b = bounds.extent;
  const fitted = fitBounds({ ...DEFAULT_CAMERA }, { x0: b[0], z0: b[1], x1: b[2], z1: b[3] }, vp, pad);
  assert.equal(clampTarget(fitted, bounds, vp, pad), fitted, 'the same object back, untouched');
  assert.equal(clampTarget(fitted, null, vp, pad), fitted, 'no bounds, no clamp');
});

test('clampTarget measures from the padded middle, not the canvas middle', () => {
  // With a panel over the right of the screen, the model should be allowed to sit in
  // the space that is left, not be dragged under the panel to satisfy the clamp.
  const vp = { w: 1400, h: 900 };
  const bounds = { boxes: [[-500, -500, 500, 500]], extent: [-500, -500, 500, 500] };
  const bare = { top: 0, right: 0, bottom: 0, left: 0 };
  const panel = { top: 0, right: 600, bottom: 0, left: 0 };
  const cam = { ...DEFAULT_CAMERA, zoom: 1000, x: 900, z: 0 };
  const a = clampTarget(cam, bounds, vp, bare);
  const b = clampTarget(cam, bounds, vp, panel);
  assert.notEqual(a.x, b.x, 'the padding changes where the limit falls');
  // each holds its own centre
  for (const [c, pad] of [[a, bare], [b, panel]]) {
    const [cx, cy] = paddedCentre(vp, pad);
    const [gx] = groundPoint(c, cx, cy, vp);
    assert.ok(gx <= bounds.extent[2] + Math.min(1000 * TARGET_MARGIN, cam.zoom * TARGET_MARGIN_VIEW) + 1e-6, `held its own centre: ${gx}`);
  }
});

test('several boxes keep the view off the emptiness one box around them allows', () => {
  // Two parts with a gap between them, as the mainland and the Andamans have. One box
  // around both lets the view sit in the middle of the gap -- 1,200 km of Bay of Bengal
  // with nothing on screen -- and so does their convex hull. Their own boxes do not.
  const vp = { w: 1400, h: 900 };
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  const mainland = [-1000, -1000, 0, 1000];
  const island = [1100, 200, 1200, 500];
  const extent = [-1000, -1000, 1200, 1000];
  const margin = Math.min(2200 * TARGET_MARGIN, 2000 * TARGET_MARGIN, 1000 * TARGET_MARGIN_VIEW);
  const at = (x, z) => ({ ...DEFAULT_CAMERA, zoom: 1000, yaw: 0, pitch: 90, x, z });

  // the middle of the gap: one box says yes, the parts say no
  const gap = at(550, 0);
  assert.equal(clampTarget(gap, { boxes: [extent], extent }, vp, pad), gap, 'one box allows the gap');
  const pulled = clampTarget(gap, { boxes: [mainland, island], extent }, vp, pad);
  assert.notEqual(pulled, gap, 'the parts do not');
  close(groundPoint(pulled, 0, 0, vp)[0], margin, 1e-6, 'pulled back to a margin off the mainland');

  // and the island is still a place you can be, once you are there
  const there = at(1150, 350);
  assert.equal(clampTarget(there, { boxes: [mainland, island], extent }, vp, pad), there, 'inside the island');
  // just off its coast is fine too
  const nearby = at(1200 + margin / 2, 350);
  assert.equal(clampTarget(nearby, { boxes: [mainland, island], extent }, vp, pad), nearby, 'within the margin');
});

test('give lets a gesture stretch past the bounds, but never run away', () => {
  const vp = { w: 1400, h: 900 };
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  const bounds = { boxes: [[-1000, -1000, 1000, 1000]], extent: [-1000, -1000, 1000, 1000] };
  const give = 150;
  // zoom 1000: a third of the view (300 km) is less than a fifth of the bounds (400 km)
  const limit = 1000 + Math.min(2000 * TARGET_MARGIN, 1000 * TARGET_MARGIN_VIEW);
  let last = -Infinity;
  for (const x of [1300, 1500, 2000, 5000, 50000]) {
    const c = clampTarget({ ...DEFAULT_CAMERA, zoom: 1000, yaw: 0, pitch: 90, x, z: 0 }, bounds, vp, pad, give);
    const [gx] = groundPoint(c, 0, 0, vp);
    assert.ok(gx > last - 1e-9, `stretching further goes further: ${gx} after ${last}`);
    assert.ok(gx < limit + give + 1e-6, `and never past the give: ${gx}`);
    last = gx;
  }
  // and with no give it is a hard stop
  const hard = clampTarget({ ...DEFAULT_CAMERA, zoom: 1000, yaw: 0, pitch: 90, x: 50000, z: 0 }, bounds, vp, pad, 0);
  close(groundPoint(hard, 0, 0, vp)[0], limit, 1e-6, 'no give, no overshoot');
});

test('paddedCentre is the middle of what the panels leave visible', () => {
  const vp = { w: 1400, h: 900 };
  assert.deepEqual(paddedCentre(vp, { top: 0, right: 0, bottom: 0, left: 0 }), [0, 0]);
  // a side panel on the right pushes the visible middle left; a sheet at the bottom, up
  assert.deepEqual(paddedCentre(vp, { top: 104, right: 420, bottom: 36, left: 24 }), [-198, -34]);
  assert.deepEqual(paddedCentre(vp, { top: 60, right: 8, bottom: 300, left: 8 }), [0, 120]);
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
