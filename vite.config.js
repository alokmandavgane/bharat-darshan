// @ts-check
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

const SITE = process.env.SITE_URL || 'https://darshan.alokm.com';
const NAME = { en: 'Bharat Darshan', hi: 'भारत दर्शन' };

/** Per-language head metadata; index.html holds the English values, the plugin swaps them. */
const META = {
  en: {
    title: 'Bharat Darshan · भारत दर्शन',
    description: "An interactive 3D map of India's geography and culture, in English and Hindi.",
    alt: 'A clay model of India with its states, on paper, titled Bharat Darshan',
    locale: 'en_IN',
    alternate: 'hi_IN',
  },
  hi: {
    title: 'भारत दर्शन · Bharat Darshan',
    description: 'भारत के भूगोल और संस्कृति का इंटरैक्टिव त्रिआयामी मानचित्र, हिन्दी और अंग्रेज़ी में।',
    alt: 'कागज़ पर भारत का मिट्टी का मॉडल, राज्यों सहित, शीर्षक भारत दर्शन',
    locale: 'hi_IN',
    alternate: 'en_IN',
  },
};

/** The share card for a page, if one has been rendered, else the language's own. */
function shareImage(lang, plateId, dir) {
  const name = plateId ? `og-${lang}-${plateId}.jpg` : `og-${lang}.jpg`;
  // A page whose card has not been rendered yet falls back to the language card rather
  // than pointing WhatsApp at a 404. Render them with tools/share-image.mjs.
  const found = existsSync(`${dir}/share/${name}`) ? name : `og-${lang}.jpg`;
  return `${SITE}/share/${found}`;
}

/**
 * Rewrites the head of the built index.html. The tags are replaced by name rather than by
 * their English text, so a page's metadata is set the same way the language's is and
 * neither depends on what index.html happens to say.
 */
function rewriteHead(html, m) {
  const meta = (attr, name, value) => {
    const re = new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`);
    if (!re.test(html)) throw new Error(`head: no ${attr} ${name} to rewrite`);
    html = html.replace(re, `$1${value}$2`);
  };
  const link = (rel, value, attr = 'href') => {
    const re = new RegExp(`(<link ${rel} ${attr}=")[^"]*(")`);
    if (!re.test(html)) throw new Error(`head: no link ${rel} to rewrite`);
    html = html.replace(re, `$1${value}$2`);
  };
  html = html.replace('<html lang="en">', `<html lang="${m.lang}">`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${m.title}</title>`);
  meta('name', 'description', m.description);
  meta('property', 'og:title', m.title);
  meta('property', 'og:description', m.description);
  meta('property', 'og:url', m.url);
  meta('property', 'og:image', m.image);
  meta('property', 'og:image:alt', m.alt);
  meta('property', 'og:locale', META[m.lang].locale);
  meta('property', 'og:locale:alternate', META[m.lang].alternate);
  meta('name', 'twitter:title', m.title);
  meta('name', 'twitter:description', m.description);
  meta('name', 'twitter:image', m.image);
  link('rel="canonical"', m.url);
  link('rel="alternate" hreflang="en"', m.alt_en);
  link('rel="alternate" hreflang="hi"', m.alt_hi);
  link('rel="alternate" hreflang="x-default"', m.alt_default);
  return html;
}

function languageMeta(lang, dir) {
  return {
    lang,
    ...META[lang],
    url: `${SITE}/${lang}`,
    image: shareImage(lang, null, dir),
    alt_en: `${SITE}/en`,
    alt_hi: `${SITE}/hi`,
    alt_default: `${SITE}/`,
  };
}

const DESC_MAX = 200;   // link previews cut around here; better a whole sentence than a cut one

/**
 * A page of the atlas, from its own JSON (PLAN.md D11): the title and the blurb it already
 * carries, and the card rendered for it. Adding a plate adds its share shells; no code here
 * knows any plate by name.
 */
function plateMeta(plate, lang, dir) {
  const title = plate.title[lang] || plate.title.en;
  const blurb = plate.blurb[lang] || plate.blurb.en;
  const description = blurb.length > DESC_MAX ? `${blurb.slice(0, DESC_MAX - 1).trimEnd()}…` : blurb;
  const alt = lang === 'hi'
    ? `कागज़ पर भारत का मिट्टी का मॉडल, जिस पर ${title} दिखाया गया है — भारत दर्शन एटलस का एक पृष्ठ`
    : `A clay model of India on paper showing ${title}, a page of the Bharat Darshan atlas`;
  return {
    lang,
    title: `${title} · ${NAME[lang]}`,
    description,
    alt,
    url: `${SITE}/${lang}/atlas/${plate.id}`,
    image: shareImage(lang, plate.id, dir),
    alt_en: `${SITE}/en/atlas/${plate.id}`,
    alt_hi: `${SITE}/hi/atlas/${plate.id}`,
    alt_default: `${SITE}/atlas/${plate.id}`,
  };
}

/**
 * Emits dist/en/index.html and dist/hi/index.html so `/hi` works on static hosting
 * without rewrites, plus dist/<lang>/atlas/<id>/index.html for every page of the atlas,
 * each with its own title, description and share card. WhatsApp and other link previews
 * do not run JavaScript, so this has to happen at build time. Deeper paths -- a state
 * inside a page -- fall back to the root shell, which the host serves for unknown paths.
 */
function shells(langs = ['en', 'hi']) {
  return {
    name: 'bd-shells',
    apply: 'build',
    enforce: 'post',
    async writeBundle(options) {
      const dir = options.dir || 'dist';
      const html = await readFile(`${dir}/index.html`, 'utf8');
      const write = async (path, meta) => {
        await mkdir(`${dir}/${path}`, { recursive: true });
        await writeFile(`${dir}/${path}/index.html`, rewriteHead(html, meta));
      };
      let plates = [];
      try {
        plates = JSON.parse(await readFile(`${dir}/data/plates.json`, 'utf8')).plates || [];
      } catch { /* no plates built yet: the language shells still go out */ }
      for (const lang of langs) {
        await write(lang, languageMeta(lang, dir));
        for (const plate of plates) await write(`${lang}/atlas/${plate.id}`, plateMeta(plate, lang, dir));
      }
      const cards = plates.filter((p) => existsSync(`${dir}/share/og-en-${p.id}.jpg`)).length;
      this.info(`shells: ${langs.length} languages x ${plates.length} pages`
        + `, ${cards}/${plates.length} with their own share card`);
    },
  };
}
export default defineConfig({
  plugins: [shells()],
  build: {
    target: 'es2020',
    sourcemap: false,
    // Data files are fetched at runtime by URL, never inlined.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // three.js in its own chunk so app changes do not invalidate the big one.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
        },
      },
    },
  },
  server: {
    // `--host` in the scripts exposes the dev server on the LAN for phone testing.
    strictPort: false,
  },
});
