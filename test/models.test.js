// @ts-check
// Every recipe under content/models builds into a figurine (src/engine/models.js): a
// recipe the build accepts but the device cannot turn into a mesh would be a marker that
// never appears, so this runs each one through the same code the engine does. The peg
// and the bead are built the same way. Run `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { beadGeometry, buildModel, pegGeometry } from '../src/engine/models.js';

const dir = new URL('../content/models/', import.meta.url);
const recipes = readdirSync(dir).filter((n) => n.endsWith('.json'))
  .map((n) => JSON.parse(readFileSync(new URL(n, dir), 'utf8')));

test('every recipe builds into a flat-shaded, coloured geometry that stands on the ground', () => {
  assert.ok(recipes.length > 0);
  for (const recipe of recipes) {
    const { geometry, footprint, height } = buildModel(recipe);
    const pos = geometry.getAttribute('position');
    assert.ok(pos.count >= 3 && pos.count % 3 === 0, `${recipe.id}: whole triangles`);
    for (const k of ['normal', 'color', 'tint']) assert.ok(geometry.getAttribute(k), `${recipe.id}: has ${k}`);
    assert.ok(height > 4 && height < 40, `${recipe.id}: stands ${height.toFixed(1)} units tall`);
    assert.ok(footprint > 0, `${recipe.id}: has a footprint`);
    assert.ok(geometry.boundingBox.min.y > -1, `${recipe.id}: nothing below the ground`);
  }
});

test('the peg and the bead the engine makes for itself build too', () => {
  const peg = pegGeometry();
  assert.ok(peg.height > 10 && peg.height < 16);
  const bead = beadGeometry();
  assert.ok(Math.abs(bead.height - 2) < 0.01);
});
