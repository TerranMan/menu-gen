import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base = '/menu-gen/' для GitHub Pages, '/' для локального dev и Tauri.
const isPages = process.env.DEPLOY_TARGET === 'pages';

export default defineConfig({
  base: isPages ? '/menu-gen/' : '/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    open: false,
    fs: {
      // Разрешить читать данные из app/data/ при dev (вне корня)
      allow: ['..', '.'],
    },
  },
  resolve: {
    alias: {
      '@src': resolve(import.meta.dirname, 'src'),
      '@data': resolve(import.meta.dirname, 'data'),
    },
  },
});
