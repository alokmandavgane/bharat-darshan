// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextStops, episodeList, stepEpisode } from '../src/engine/episodes.js';

const items = [
  { id: 'a', category: 'youth' }, { id: 'b', category: 'exile' }, { id: 'c', category: 'war' },
  { id: 'a2', category: 'war' },
];
const cats = (...ids) => ids.map((id) => ({ id }));

test('episodes come in the order the tour first reaches their group', () => {
  const plate = { tour: { stops: ['a', 'c', 'b', 'a2'] } };
  assert.deepEqual(episodeList(plate, items, [cats('exile', 'war', 'youth')]), ['youth', 'war', 'exile']);
});

test('a group the tour never visits keeps the page drawing everything', () => {
  const plate = { tour: { stops: ['a', 'b'] } };
  assert.deepEqual(episodeList(plate, items, [cats('youth', 'exile'), cats('youth', 'exile', 'ravana')]), []);
});

test('a page without a tour, or with one group, has no episodes', () => {
  assert.deepEqual(episodeList(null, items, []), []);
  assert.deepEqual(episodeList({ tour: { stops: ['a'] } }, items, [cats('youth')]), []);
});

test('an arrow end borrows the latest earlier visit to that place', () => {
  const at = (id, category, x) => ({ layer: 'stops', item: { id, category, x, z: 0 } });
  const hastinapura = [at('h-youth', 'youth', 0), at('h-dice', 'exile', 0.5), at('h-after', 'after', 0.2)];
  const order = ['youth', 'exile', 'karna', 'after'];
  const tourIndex = new Map([['h-youth', 0], ['h-dice', 5], ['h-after', 20]]);
  const got = contextStops([[0, 0], [400, 0]], hastinapura, tourIndex, order, 'karna');
  assert.deepEqual([...got], ['stops:h-dice']);
  // Before any earlier visit, the next one stands in.
  assert.deepEqual([...contextStops([[0, 0]], [hastinapura[2]], tourIndex, order, 'karna')], ['stops:h-after']);
});

test('an arrow end at one of the episode\'s own pins borrows nothing', () => {
  const c = [{ layer: 'stops', item: { id: 'x', category: 'youth', x: 0, z: 0 } }];
  assert.equal(contextStops([[0, 0]], c, new Map(), ['youth', 'war'], 'war', { ownPins: [[1, 1]] }).size, 0);
});

test('stepping wraps round, and from everything starts at either end', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(stepEpisode(order, 'c', 1), 'a');
  assert.equal(stepEpisode(order, 'a', -1), 'c');
  assert.equal(stepEpisode(order, null, 1), 'a');
  assert.equal(stepEpisode(order, null, -1), 'c');
});
