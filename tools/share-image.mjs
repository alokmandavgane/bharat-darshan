// Renders the share cards under public/share/ from the app itself, in poster mode
// (?poster=1: no chrome, a big title block, the camera framed beside it). One card per
// language -- og-en.jpg, og-hi.jpg -- and one per page of the atlas per language,
// og-<lang>-<plate>.jpg, which vite.config.js picks up for that page's Open Graph shell
// (PLAN.md D11: a page pasted into a chat should show that page).
//
// Run against a server:  npm run preview   then   node tools/share-image.mjs
// Needs Playwright with Chromium (global install, or `npx playwright`); it is a tool,
// not a project dependency. Set BASE to point at another server, SWIFTSHADER=1 on a
// machine without a GPU, FORCE=1 to redo cards that already exist, ONLY=<id> (or
// ONLY=langs) to do one page, LANGS=en to do one language.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';

const base = process.env.BASE || 'http://localhost:4173';
const langs = (process.env.LANGS || 'en,hi').split(',');
const only = process.env.ONLY || '';
const force = process.env.FORCE === '1';
const args = process.env.SWIFTSHADER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [];

/** Every card to render: the two language cards first, then a page's card per language. */
async function cards() {
  const out = [];
  for (const lang of langs) out.push({ lang, id: null, path: lang, file: `og-${lang}.jpg` });
  let plates = [];
  try {
    plates = JSON.parse(await readFile('public/data/plates.json', 'utf8')).plates || [];
  } catch { console.log('no public/data/plates.json: language cards only'); }
  for (const lang of langs) {
    for (const p of plates) {
      out.push({ lang, id: p.id, path: `${lang}/atlas/${p.id}`, file: `og-${lang}-${p.id}.jpg` });
    }
  }
  if (!only) return out;
  return out.filter((c) => (only === 'langs' ? !c.id : c.id === only));
}

const todo = await cards();
// DRY=1 says what would be rendered and stops: the list is worth seeing before spending
// twenty page loads on it, and it needs no browser.
if (process.env.DRY === '1') {
  for (const c of todo) {
    const have = existsSync(`public/share/${c.file}`);
    console.log(`${have && !force ? 'skip' : 'make'}  ${c.file.padEnd(28)} ${base}/${c.path}?poster=1`);
  }
  console.log(`${todo.length} card(s) in the list`);
  process.exit(0);
}

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright')); }
const browser = await chromium.launch({ args });
await mkdir('public/share', { recursive: true });
let made = 0, skipped = 0;
for (const card of todo) {
  const path = `public/share/${card.file}`;
  if (!force && existsSync(path)) { skipped += 1; continue; }
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/${card.path}?poster=1&quality=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.status === 'ready', null, { timeout: 90000 });
  // The page's own words have to be on the block before the shutter: a card that says
  // "Bharat Darshan" where the page's title belongs is the one mistake worth waiting for.
  if (card.id) {
    await page.waitForFunction((id) => document.body.dataset.posterPage === '1'
      && window.bd?.store.get('plate') === id, card.id, { timeout: 30000 });
  }
  await page.waitForTimeout(3000);           // finer tier, walls and tokens settle; the pop-in ends
  await page.screenshot({ path, type: 'jpeg', quality: 86, timeout: 120000 });
  console.log(`wrote ${path}`);
  made += 1;
  await page.close();
}
console.log(`${made} card(s) written, ${skipped} already there (FORCE=1 to redo them)`);
await browser.close();
