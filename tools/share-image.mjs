// Renders the share cards public/share/og-en.jpg and og-hi.jpg from the app itself, in
// poster mode (?poster=1: no chrome, a big title block, the camera framed beside it).
// Run against a server:  npm run preview   then   node tools/share-image.mjs
// Needs Playwright with Chromium (global install, or `npx playwright`); it is a tool,
// not a project dependency. Set BASE to point at another server, SWIFTSHADER=1 on a
// machine without a GPU.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright')); }

const base = process.env.BASE || 'http://localhost:4173';
const args = process.env.SWIFTSHADER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [];
const browser = await chromium.launch({ args });
await mkdir('public/share', { recursive: true });
for (const lang of ['en', 'hi']) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/${lang}?poster=1&quality=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.status === 'ready', null, { timeout: 90000 });
  await page.waitForTimeout(3000);           // finer tier, walls and tokens settle; the pop-in ends
  await page.screenshot({ path: `public/share/og-${lang}.jpg`, type: 'jpeg', quality: 86, timeout: 120000 });
  console.log(`wrote public/share/og-${lang}.jpg`);
  await page.close();
}
await browser.close();
