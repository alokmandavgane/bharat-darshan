// @ts-check
// Every recipe under content/models builds into a figurine (src/engine/models.js): a
// recipe the build accepts but the device cannot turn into a mesh would be a marker that
// never appears, so this runs each one through the same code the engine does. The peg
// and the bead are built the same way. Run `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { beadGeometry, buildModel, coinGeometry, pegGeometry } from '../src/engine/models.js';

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

/**
 * Faces point outward. A LatheGeometry's winding follows the order of its profile, so a
 * profile written from the top down turns its surface inside out: with front-face culling
 * the shape vanishes and whatever is inside it shows instead. That is how the symbol
 * counter first came out -- a pale collar with no dome on it -- and nothing else catches
 * it, since the geometry is perfectly valid.
 */
function outwardness(geometry) {
  const pos = geometry.getAttribute('position');
  const box = geometry.boundingBox;
  const c = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
  let acc = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const p = [0, 1, 2].map((k) => [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)]);
    const u = [0, 1, 2].map((k) => p[1][k] - p[0][k]);
    const v = [0, 1, 2].map((k) => p[2][k] - p[0][k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const mid = [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3 - c[k]);
    acc += n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2];      // twice the area, times the outward lean
  }
  return acc;
}

test('every recipe is wound so its faces look outward', () => {
  for (const recipe of [...recipes, { id: 'coin', parts: null }]) {
    const built = recipe.parts ? buildModel(recipe) : coinGeometry();
    assert.ok(outwardness(built.geometry) > 0, `${recipe.id}: inside out`);
  }
});
