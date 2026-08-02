import { defineConfig } from 'vite';

// Phase 0: plain app build. The Cartridge Press (single-file export) gets its
// own config in src/press/ at Phase 3 — do not add singlefile here.
export default defineConfig({
  base: './',
  server: { port: 5173, open: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true
  }
});
