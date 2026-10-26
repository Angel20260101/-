import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    // three.js 單獨切出來，劇情 JSON 走動態 import，首屏只載入需要的那一篇
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: { host: true },
});
