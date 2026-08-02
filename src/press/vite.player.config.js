import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Separate build for the exported game's player shell — deliberately its
 * OWN config (main vite.config.js explicitly does not apply singlefile;
 * the whole point of Cartridge Press is that a played/exported game and the
 * editor app are two different builds sharing only engine/ source). Output
 * lands in public/ so the MAIN app build picks it up automatically as a
 * static asset (Vite copies public/ into dist/ verbatim) — see the
 * package.json "build" script, which runs this config first.
 */
export default defineConfig({
  root: here,
  base: './',
  build: {
    target: 'es2022',
    outDir: path.resolve(here, '../../public'),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(here, 'player.html')
    }
  },
  plugins: [viteSingleFile()]
});
