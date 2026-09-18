import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

/**
 * `D4IDE_RENDERER_ONLY=1` serves only the React UI, in a plain browser.
 *
 * The app's real shell is Electron, and `pnpm dev` therefore also opens an
 * Electron window. That is right for development, but wrong when the interface
 * only needs to be looked at — a design review, a screenshot, or a browser-based
 * preview pane. The renderer already tolerates a missing `window.electronAPI`
 * (every bridge call is guarded), so it renders its layout with empty data.
 */
const rendererOnly = process.env.D4IDE_RENDERER_ONLY === '1';

const electronPlugins = [
  electron([
    {
      entry: 'src/main/index.ts',
      vite: {
        build: {
          outDir: 'dist-electron/main',
          rollupOptions: {
            // Kept external so they are required from node_modules at runtime:
            // the native modules cannot be bundled, and playwright-core ships
            // optional peer imports (kerberos, zstd…) that must not be resolved
            // by the bundler.
            external: ['electron', 'better-sqlite3', 'node-pty', 'chokidar', 'playwright-core']
          }
        }
      }
    },
    {
      entry: 'src/preload/index.ts',
      onstart(options) {
        options.reload();
      },
      vite: {
        build: {
          outDir: 'dist-electron/preload'
        }
      }
    }
  ]),
  renderer()
];

export default defineConfig({
  plugins: [react(), ...(rendererOnly ? [] : electronPlugins)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main')
    }
  },
  server: {
    port: 5173,
    watch: {
      // The dev server was watching the output it does not serve, and every
      // `pnpm dist` or scratch write therefore triggered a full page reload that
      // threw away the open session, the terminal and the unsaved buffers. Vite
      // only ever serves the renderer, so nothing outside it should be watched.
      ignored: [
        '**/release/**',
        '**/dist/**',
        '**/dist-electron/**',
        '**/.freebuff/**',
        '**/logs/**',
        '**/coverage/**'
      ]
    }
  }
});
