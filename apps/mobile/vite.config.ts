import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the local Fastify API so the mobile web app
// can use same-origin relative URLs (mirrors the Capacitor production setup).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
});
