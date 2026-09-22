// @ts-check
// The scale bar (PLAN.md section 6, atlas furniture). The arithmetic is pure, and the
// property that matters is not a single number but that the bar is always a round
// distance, never longer than its box, and never so short it says nothing. Run `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kmPerPixel, LIMITS } from '../src/engine/camera-math.js';
import { scaleBar } from '../src/ui/scale.js';

const ROUND = /^[125]0*$/;   // 1, 2, 5, 10, 20, 50, 100... written out, this is the test

test('the bar is a round distance that fits the box', () => {
  const bar = scaleBar(2, 120);
  assert.deepEqual(bar, { km: 200, px: 100 });
  assert.deepEqual(scaleBar(11.25, 120), { km: 1000, px: 1000 / 11.25 });
  assert.deepEqual(scaleBar(0.213, 120), { km: 20, px: 20 / 0.213 });
});

test('over every zoom and viewport the app can be in, it stays round and inside', () => {
  const [lo, hi] = LIMITS.zoom;
  for (const h of [390, 630, 844, 900, 1180]) {
    for (let zoom = lo; zoom <= hi; zoom += 37) {
      for (const maxPx of [90, 120, 160]) {
        const { km, px } = scaleBar(kmPerPixel({ zoom }, { w: 1, h }), maxPx);
        assert.ok(km > 0, `nothing to draw at zoom ${zoom}, h ${h}`);
        assert.match(String(km), ROUND, `${km} km is not a round number`);
        assert.ok(px <= maxPx + 1e-9, `${px} px overflows ${maxPx}`);
        // A bar shorter than a third of its box reads as an accident rather than a scale.
        assert.ok(px > maxPx / 3, `only ${px.toFixed(0)} of ${maxPx} px used at zoom ${zoom}`);
      }
    }
  }
});

test('nonsense in, nothing out', () => {
  for (const args of [[0, 120], [-1, 120], [2, 0], [NaN, 120], [2, NaN]]) {
    assert.deepEqual(scaleBar(args[0], args[1]), { km: 0, px: 0 });
  }
});
