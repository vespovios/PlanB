import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://127.0.0.1:${process.env.PLANB_PORT ?? 8787}`;

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true, sourcemap: true },
  server: {
    port: Number(process.env.PLANB_WEB_PORT ?? 5173),
    proxy: { '/api': { target: api, changeOrigin: false }, '/mcp': { target: api } },
  },
});
