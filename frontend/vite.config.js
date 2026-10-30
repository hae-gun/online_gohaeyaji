import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build can be served from any CDN path
  base: './',
  server: { port: 5173, host: true },
  build: {
    outDir: 'dist',
    target: 'es2019',
    // three.js rarely changes, so keep it in its own long-cached chunk
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
    chunkSizeWarningLimit: 700,
  },
});
