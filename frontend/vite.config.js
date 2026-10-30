import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build can be served from any CDN path
  base: './',
  // dev server listens on this Mac only. Known Vite 5 dev-server advisories (fixed only in Vite 6.4.4+)
  // need network access to the dev server, so keep it off the LAN. Use `npm run dev -- --host`
  // only when you need to open it from a phone, and stop it afterwards.
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    target: 'es2019',
    // three.js rarely changes, so keep it in its own long-cached chunk
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
    chunkSizeWarningLimit: 700,
  },
});
