import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

const root = resolve(__dirname, 'src');

export default defineConfig({
  root,
  publicDir: resolve(__dirname, 'public'),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'copy-manifest',
      closeBundle() {
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json'),
        );
      },
    },
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
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup/index.html'),
        'popup/mini': resolve(root, 'popup/mini.html'),
        background: resolve(root, 'background.ts'),
        'content-scripts/linear': resolve(root, 'content-scripts/linear.ts'),
        'content-scripts/github': resolve(root, 'content-scripts/github.ts'),
        'content-scripts/sentry': resolve(root, 'content-scripts/sentry.ts'),
        'content-scripts/selection': resolve(root, 'content-scripts/selection.ts'),
        'content-scripts/break-overlay': resolve(root, 'content-scripts/break-overlay.ts'),
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
