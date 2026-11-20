import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// base = '/menu-gen/' для GitHub Pages, '/' для локального dev и Tauri.
const isPages = process.env.DEPLOY_TARGET === 'pages';

function serviceWorker() {
  const root = import.meta.dirname;
  const publicDir = resolve(root, 'public');
  const staticFiles = [
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/maskable-512.png',
  ];
  return {
    name: 'menu-gen-service-worker',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const worker = readFileSync(resolve(root, 'src/sw.js'), 'utf8');
        const hash = createHash('sha256').update(worker);
        const outputFiles = Object.keys(bundle).sort();
        for (const file of outputFiles) {
          const output = bundle[file];
          hash.update(file).update('\0').update(output.type === 'asset' ? output.source : output.code);
        }
        // Фото загружаются по мере использования. Их обновление тоже меняет версию кэша.
        const images = readdirSync(resolve(publicDir, 'images'))
          .filter((file) => file.endsWith('.webp')).sort();
        for (const file of [...staticFiles, ...images.map((file) => `images/${file}`)]) {
          hash.update(file).update('\0').update(readFileSync(resolve(publicDir, file)));
        }
        const version = hash.digest('hex').slice(0, 16);
        const precache = ['./', ...staticFiles, ...outputFiles.filter((file) => file !== 'index.html')];
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: `const CACHE_VERSION = ${JSON.stringify(version)};\nconst PRECACHE_FILES = ${JSON.stringify(precache)};\n${worker}`,
        });
      },
    },
  };
}

export default defineConfig({
  base: isPages ? '/menu-gen/' : '/',
  publicDir: 'public',
  plugins: [serviceWorker()],
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
