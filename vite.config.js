// @ts-check
import { defineConfig } from 'vite';

// Kept deliberately small (D7). Vite serves `index.html`, bundles `src/` and copies
// `public/` (which holds the pipeline's generated data under `public/data/`).
export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: false,
    // Data files are fetched at runtime by URL, never inlined.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // three.js in its own chunk so app changes do not invalidate the big one.
        manualChunks: { three: ['three'] },
      },
    },
  },
  server: {
    // `--host` in the scripts exposes the dev server on the LAN for phone testing.
    strictPort: false,
  },
});
