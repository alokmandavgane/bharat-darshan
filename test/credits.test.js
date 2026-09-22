// @ts-check
// The source registry's runtime half (PLAN.md section 5, "Source registry"). Resolution is
// pure, so it can be pinned down here; and since the registry that ships is a plain JSON
// file, the same tests run against the real one, which is what catches a layer citing an
// id nobody has declared. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { citation, citeLabel, creditList, hostOf, sourceList } from '../src/ui/credits.js';

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

const REG = {
  base: ['ne', 'font'],
  licences: {
    'public-domain': { title: { en: 'Public domain', hi: 'सार्वजनिक डोमेन' }, url: '', attribution: false, redistribute: true },
    ofl: { title: { en: 'OFL 1.1', hi: 'ओएफएल 1.1' }, url: 'https://openfontlicense.org/', attribution: true, redistribute: true },
  },
  sources: {
    census: {
      title: { en: 'Census of India 2011', hi: 'भारत की जनगणना 2011' },
      publisher: { en: 'Registrar General', hi: 'महापंजीयक' },
      url: 'https://censusindia.gov.in/', use: 'facts', vintage: '2011', retrieved: '2026-09',
    },
    ne: {
      title: { en: 'Natural Earth', hi: 'नैचुरल अर्थ' },
      publisher: { en: 'Natural Earth', hi: 'नैचुरल अर्थ' },
      url: 'https://www.naturalearthdata.com/', use: 'data', licence: 'public-domain', retrieved: '2026-09',
      note: { en: 'Centrelines.', hi: 'मध्यरेखाएँ।' },
    },
    font: {
      title: { en: 'Yatra One', hi: 'यात्रा वन' },
      publisher: { en: 'Catherine Leigh Schmidt', hi: 'कैथरीन ली श्मिट' },
      url: 'https://fonts.google.com/', use: 'software', licence: 'ofl', retrieved: '2026-09',
    },
  },
};

test('an id resolves to its title, its link and its year', () => {
  const c = citation(REG, 'census', 'en');
  assert.deepEqual(c, { id: 'census', title: 'Census of India 2011', url: 'https://censusindia.gov.in/', vintage: '2011' });
  // The title already names the year, so it is not said twice.
  assert.equal(citeLabel(c), 'Census of India 2011');
  assert.equal(citeLabel({ ...c, title: 'Normal rainfall', vintage: '1991-2020' }), 'Normal rainfall, 1991-2020');
  assert.equal(citeLabel(citation(REG, 'ne', 'en')), 'Natural Earth');   // no vintage, no comma
  assert.equal(citation(REG, 'census', 'hi').title, 'भारत की जनगणना 2011');
});

test('a plain URL is still a citation, labelled by its host', () => {
  const c = citation(REG, 'https://www.iers.org/IERS/EN/Publications', 'en');
  assert.equal(c.title, 'iers.org');
  assert.equal(c.url, 'https://www.iers.org/IERS/EN/Publications');
  assert.equal(hostOf('https://en.wikipedia.org/wiki/Ganges'), 'en.wikipedia.org');
});

test('an id the registry has not got is dropped, not shown', () => {
  // The build refuses these, so one here means a stale data file; an id is not a credit.
  assert.equal(citation(REG, 'worldclim', 'en'), null);
  assert.equal(citation(null, 'census', 'en'), null);
  assert.deepEqual(sourceList(REG, ['census', 'nope'], 'en').map((c) => c.id), ['census']);
});

test('a source line keeps the cited order, says each source once, and can be cut short', () => {
  const ids = (max) => sourceList(REG, ['ne', 'census', 'ne', 'font'], 'en', max).map((c) => c.id);
  assert.deepEqual(ids(0), ['ne', 'census', 'font']);
  assert.deepEqual(ids(2), ['ne', 'census']);
  assert.deepEqual(sourceList(REG, [], 'en'), []);
  assert.deepEqual(sourceList(REG, null, 'en'), []);
});

test('the credits lead with what makes the model, then everything else', () => {
  const lines = creditList(REG, 'en');
  assert.deepEqual(lines.map((c) => c.id), ['ne', 'font', 'census']);
  assert.deepEqual(lines.filter((c) => c.base).map((c) => c.id), ['ne', 'font']);
  assert.equal(lines[0].licence.title, 'Public domain');
  assert.equal(lines[0].note, 'Centrelines.');
  assert.equal(lines[2].licence, null);                       // facts need a URL, not a licence
  assert.equal(lines[0].publisher, '');                       // Natural Earth by Natural Earth: once is enough
  assert.equal(lines[2].publisher, 'Registrar General');
  assert.equal(creditList(REG, 'hi')[1].publisher, 'कैथरीन ली श्मिट');
  assert.deepEqual(creditList(null, 'en'), []);
});

// --- the registry that actually ships

test('every source the atlas ships is complete, in both languages', () => {
  const reg = read('../public/data/sources.json');
  const lines = creditList(reg, 'en');
  assert.ok(lines.length >= 10, `only ${lines.length} sources`);
  for (const lang of ['en', 'hi']) {
    for (const c of creditList(reg, lang)) {
      assert.ok(c.title, `${c.id}: no title in ${lang}`);
      assert.match(c.url, /^https?:\/\//, `${c.id}: no URL`);
      const s = reg.sources[c.id];
      // The line may leave the publisher out when it repeats the title, but the registry
      // still has to name one, in both languages.
      assert.ok(s.publisher?.[lang], `${c.id}: no publisher in ${lang}`);
      assert.notEqual(s.use, 'blocked', `${c.id}: a blocked source shipped`);
      if (s.use === 'data' || s.use === 'software') {
        assert.ok(c.licence?.title, `${c.id}: ships bytes with no licence named`);
        assert.equal(reg.licences[s.licence].redistribute, true, `${c.id}: licence forbids redistribution`);
      }
    }
  }
  assert.notEqual(creditList(reg, 'hi')[0].title, creditList(reg, 'en')[0].title);
});

test('every layer and every page resolves all the sources it cites', () => {
  const reg = read('../public/data/sources.json');
  for (const layer of read('../public/data/manifest.json').layers) {
    const cites = layer.sources || [];
    assert.ok(cites.length, `layer ${layer.id} cites nothing`);
    assert.equal(sourceList(reg, cites, 'en').length, cites.length,
      `layer ${layer.id}: ${cites.filter((c) => !citation(reg, c, 'en')).join(', ')} does not resolve`);
  }
  for (const plate of read('../public/data/plates.json').plates) {
    const cites = plate.sources || [];
    assert.ok(cites.length, `plate ${plate.id} cites nothing`);
    assert.equal(sourceList(reg, cites, 'en').length, cites.length, `plate ${plate.id}: a source does not resolve`);
  }
});
