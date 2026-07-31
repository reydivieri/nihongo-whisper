import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main'
    }
  },
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.js'
        }
      },
      outDir: 'dist/preload'
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: 'dist/renderer'
    }
  }
});
