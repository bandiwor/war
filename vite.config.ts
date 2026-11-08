import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Three.js dominates the bundle (~190 kB gzip). Stage 10 revisits splitting.
  build: { target: 'es2023', sourcemap: true, chunkSizeWarningLimit: 900 },
  server: {
    // Cross-origin isolation enables SharedArrayBuffer for worker pipelines (later stages).
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
