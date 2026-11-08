import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2023', sourcemap: true },
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
