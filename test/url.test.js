// @ts-check
// The routes under a base path: the same build serves darshan.alokm.com/hi/state/kerala at
// a domain's root and apps.alokm.com/darshan/hi/state/kerala under a path of one, so the
// base must come off when a URL is read and go back on when one is written.
// Run `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, buildUrl, readUrl } from '../src/state/url.js';

// buildUrl keeps ?quality and ?poster from the address bar, which node does not have.
globalThis.location = /** @type {any} */ ({ pathname: '/', search: '' });

const at = (pathname, search = '') => /** @type {any} */ ({ pathname, search });

test('outside Vite the base is the root', () => {
  assert.equal(BASE, '/');
});

test('at the root, routes read as before', () => {
  const u = readUrl(at('/hi/atlas/rivers/state/kerala', '?item=rivers:ganga'), '/');
  assert.equal(u.lang, 'hi');
  assert.equal(u.plate, 'rivers');
  assert.equal(u.view, 'kerala');
  assert.deepEqual(u.item, { layer: 'rivers', id: 'ganga' });
});

test('under a base, the base is not part of the route', () => {
  const u = readUrl(at('/darshan/en/state/kerala'), '/darshan/');
  assert.equal(u.lang, 'en');
  assert.equal(u.view, 'kerala');
  assert.deepEqual(u.rest, ['state', 'kerala']);
  for (const path of ['/darshan/', '/darshan']) {
    const home = readUrl(at(path), '/darshan/');
    assert.equal(home.lang, null);
    assert.deepEqual(home.rest, []);
  }
});

test('a path that only starts like the base is not under it', () => {
  assert.deepEqual(readUrl(at('/darshanx/en'), '/darshan/').rest, ['darshanx', 'en']);
});

test('written URLs carry the base, and read back to the same view', () => {
  const view = { lang: 'hi', plate: 'rivers', view: 'kerala', relief: 12 };
  assert.equal(buildUrl(view, '/'), '/hi/atlas/rivers/state/kerala');
  const url = buildUrl(view, '/darshan/');
  assert.equal(url, '/darshan/hi/atlas/rivers/state/kerala');
  const back = readUrl(at(url), '/darshan/');
  assert.deepEqual([back.lang, back.plate, back.view], ['hi', 'rivers', 'kerala']);
  assert.equal(buildUrl({ lang: 'en', state: 'goa' }, '/darshan/'), '/darshan/en?state=goa');
  assert.equal(buildUrl({ lang: null }, '/darshan/'), '/darshan/');
});
