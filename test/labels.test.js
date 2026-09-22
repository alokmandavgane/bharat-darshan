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
