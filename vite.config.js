// @ts-check
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

/**
 * Emits dist/en/index.html and dist/hi/index.html so `/hi` works on static hosting
 * without rewrites. The seed of the per-route shell plugin planned for share previews.
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
        await writeFile(`${dir}/${lang}/index.html`, html.replace('<html lang="en">', `<html lang="${lang}">`));
      }
    },
  };
}

// Kept deliberately small (D7). Vite serves `index.html`, bundles `src/` and copies
// `public/` (which holds the pipeline's generated data under `public/data/`).
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
