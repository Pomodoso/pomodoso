import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const root = resolve(__dirname, 'src');

export default defineConfig({
  root,
  envDir: __dirname,
  publicDir: resolve(__dirname, 'public'),
  plugins: [
    react(),
    tailwindcss(),
    (() => {
      // A local web app (VITE_WEB_URL, e.g. http://localhost:5180) is added to
      // externally_connectable for that build only; the store build keeps
      // pomodoso.com alone.
      let webUrl: string | undefined;
      let outDir = resolve(__dirname, 'dist');
      return {
        name: 'copy-manifest',
        configResolved(config) {
          webUrl = config.env.VITE_WEB_URL as string | undefined;
          outDir = config.build.outDir;
        },
        closeBundle() {
          const manifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'));
          const matches: string[] = manifest.externally_connectable.matches;
          const extra = webUrl ? `${new URL(webUrl).origin}/*` : null;
          if (extra && !matches.includes(extra)) matches.push(extra);
          writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        },
      };
    })(),
    {
      // Wrap content scripts in IIFEs so their minified top-level vars
      // don't collide when Chrome loads multiple scripts in the same global scope.
      name: 'iife-content-scripts',
      generateBundle(_, bundle) {
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (fileName.startsWith('content-scripts/') && chunk.type === 'chunk') {
            chunk.code = `(function(){\n${chunk.code}\n})();`;
          }
        }
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // Vite emits <link rel="modulepreload" crossorigin> for every shared
    // chunk. Chrome rejects each one under a chrome-extension:// origin —
    // "cross-world extension resource mismatch" — and lists them all as
    // errors on the extension's own page. Nothing breaks: the hints are
    // discarded and the modules still load through the import graph. But
    // a page of red on a freshly installed extension is its own problem.
    //
    // The hint buys nothing here anyway. It exists to start fetches earlier
    // over a network; these files are already on disk.
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup/index.html'),
        'popup/mini': resolve(root, 'popup/mini.html'),
        'report/index': resolve(root, 'report/index.html'),
        background: resolve(root, 'background.ts'),
        'content-scripts/linear': resolve(root, 'content-scripts/linear.ts'),
        'content-scripts/github': resolve(root, 'content-scripts/github.ts'),
        'content-scripts/sentry': resolve(root, 'content-scripts/sentry.ts'),
        'content-scripts/selection': resolve(root, 'content-scripts/selection.ts'),
        'content-scripts/break-overlay': resolve(root, 'content-scripts/break-overlay.ts'),
        'content-scripts/arxiv': resolve(root, 'content-scripts/arxiv.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js';
          if (chunk.name.startsWith('content-scripts/')) return `${chunk.name}.js`;
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
