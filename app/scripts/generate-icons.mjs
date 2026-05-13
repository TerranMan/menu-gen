#!/usr/bin/env node
// Из legacy/toexe/menu.png → иконки PWA (192, 512, maskable-512).
// Запускается редко, при смене логотипа.

import sharp from 'sharp';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SRC = resolve(ROOT, 'legacy', 'toexe', 'menu.png');
const OUT = resolve(ROOT, 'app', 'public', 'icons');

if (!existsSync(SRC)) {
  console.error(`Не найден ${SRC}`);
  process.exit(1);
}
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

async function makeIcon(size, name, { maskable = false } = {}) {
  const padding = maskable ? Math.round(size * 0.12) : 0;
  const inner = size - padding * 2;
  const bg = maskable ? { r: 192, g: 57, b: 43, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };

  const resized = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: resized, top: padding, left: padding }])
    .png()
    .toFile(resolve(OUT, name));

  console.log(`${name}: ${size}x${size}${maskable ? ' (maskable, safe-area)' : ''}`);
}

await makeIcon(192, 'icon-192.png');
await makeIcon(512, 'icon-512.png');
await makeIcon(512, 'maskable-512.png', { maskable: true });
console.log('OK');
