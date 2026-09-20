// @ts-check
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

const SITE = process.env.SITE_URL || 'https://darshan.alokm.com';

/** Per-language head metadata; index.html holds the English values, the plugin swaps them. */
const META = {
  en: {
    title: 'Bharat Darshan · भारत दर्शन',
    description: "An interactive 3D map of India's geography and culture, in English and Hindi.",
    image: `${SITE}/share/og-en.jpg`,
    alt: 'A clay model of India with its states, on paper, titled Bharat Darshan',
    locale: 'en_IN',
    alternate: 'hi_IN',
  },
  hi: {
    title: 'भारत दर्शन · Bharat Darshan',
    description: 'भारत के भूगोल और संस्कृति का इंटरैक्टिव त्रिआयामी मानचित्र, हिन्दी और अंग्रेज़ी में।',
    image: `${SITE}/share/og-hi.jpg`,
    alt: 'कागज़ पर भारत का मिट्टी का मॉडल, राज्यों सहित, शीर्षक भारत दर्शन',
    locale: 'hi_IN',
    alternate: 'en_IN',
  },
};

function localiseHead(html, lang) {
  const en = META.en, m = META[lang];
  const swap = (a, b) => { if (a !== b) html = html.split(a).join(b); };
  html = html.replace('<html lang="en">', `<html lang="${lang}">`);
  swap(`<title>${en.title}</title>`, `<title>${m.title}</title>`);
  swap(`content="${en.title}"`, `content="${m.title}"`);
  swap(`content="${en.description}"`, `content="${m.description}"`);
  swap(`content="${en.image}"`, `content="${m.image}"`);
  swap(`content="${en.alt}"`, `content="${m.alt}"`);
  swap(`property="og:locale" content="${en.locale}"`, `property="og:locale" content="${m.locale}"`);
  swap(`property="og:locale:alternate" content="${en.alternate}"`, `property="og:locale:alternate" content="${m.alternate}"`);
  swap(`rel="canonical" href="${SITE}/en"`, `rel="canonical" href="${SITE}/${lang}"`);
  swap(`property="og:url" content="${SITE}/en"`, `property="og:url" content="${SITE}/${lang}"`);
  return html;
}

/**
 * Emits dist/en/index.html and dist/hi/index.html so `/hi` works on static hosting
 * without rewrites, each with its own title, description and share card. WhatsApp
 * and other link previews do not run JavaScript, so this has to happen at build time.
 */
function languageShells(langs = ['en', 'hi']) {
  return {
    name: 'bd-language-shells',
    apply: 'build',
    enforce: 'post',
    async writeBundle(options) {
      const dir = options.dir || 'dist';
      const html = await readFile(`${dir}/index.html`, 'utf8');
      for (const lang of langs) {
        await mkdir(`${dir}/${lang}`, { recursive: true });
        await writeFile(`${dir}/${lang}/index.html`, localiseHead(html, lang));
      }
    },
  };
}
export default defineConfig({
  plugins: [languageShells()],
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
