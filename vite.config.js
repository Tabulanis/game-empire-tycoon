import { defineConfig } from 'vite';

// Phase 0: plain app build. The Cartridge Press (single-file export) gets its
// own config in src/press/ at Phase 3 — do not add singlefile here.
export default defineConfig({
  base: './',
  // host: true binds the dev server to the whole local network, so the
  // studio can be opened from a tablet/phone at http://<this-pc's-ip>:5173
  server: { port: 5173, open: true, host: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true
  }
});
