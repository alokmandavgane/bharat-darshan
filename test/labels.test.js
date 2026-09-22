// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakAt } from '../src/engine/labels.js';

test('a two-word name breaks at its space', () => {
  assert.equal(breakAt('Madhya Pradesh'), 6);
  assert.equal(breakAt('मध्य प्रदेश'), 4);
});

test('a longer name breaks at the space nearest the middle', () => {
  const name = 'Andaman and Nicobar Islands';
  assert.equal(name.slice(0, breakAt(name)), 'Andaman and');
});

test('a one-word name does not break', () => {
  assert.equal(breakAt('Rajasthan'), -1);
});

test('names are full size at the desktop home fit and shrink towards the zoom ceiling', async () => {
  const { labelScale } = await import('../src/engine/labels.js');
  assert.equal(labelScale(4200), 1);
  assert.ok(labelScale(7000) < 1 && labelScale(7000) > labelScale(9500));
  assert.equal(labelScale(9500), 0.7);
});
