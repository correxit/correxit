import { chromium } from '@playwright/test';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'style/brand/correxit-mark-on-dark.svg');
const output = resolve(root, 'style/brand/correxit-github-avatar.png');
const size = 500;
const view = 256;
const limit = 1024 * 1024;
const center = 128;
const radius = 125;
const ring = 4;
const left = 45;
const top = 45;
const width = 188;
const height = 166;
const clearance = 1;
const padding = 5;
const fitted = ((radius - ring / 2 - clearance) * Math.SQRT2) / width;
const scale = fitted - (2 * padding * view) / (size * height);
const x = center - (left + width / 2) * scale;
const y = center - (top + height / 2) * scale;

const mark = await readFile(source, 'utf8');
const badge = mark.replace(
  '  <g fill="none"',
  `  <defs>\n    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">\n      <feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#001c33" flood-opacity="0.55"/>\n    </filter>\n  </defs>\n  <circle cx="${center}" cy="${center}" r="${radius}" fill="#003660" stroke="#f4f7f9" stroke-width="${ring}"/>\n  <g transform="translate(${x} ${y}) scale(${scale})" fill="none" filter="url(#shadow)"`
);

if (badge === mark) {
  throw new Error('Could not insert the GitHub avatar badge');
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: size, height: size }
  });

  await page.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          html, body {
            width: ${size}px;
            height: ${size}px;
            margin: 0;
            overflow: hidden;
            background: transparent;
          }

          svg {
            display: block;
            width: ${size}px;
            height: ${size}px;
          }
        </style>
      </head>
      <body>${badge}</body>
    </html>`);

  const png = await page.screenshot({
    animations: 'disabled',
    omitBackground: true,
    type: 'png'
  });
  const dimensions = [png.readUInt32BE(16), png.readUInt32BE(20)];
  const alpha = await page.evaluate(
    async ({ image, size }) => {
      const source = new Image();
      source.src = `data:image/png;base64,${image}`;
      await source.decode();

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      context.drawImage(source, 0, 0);

      return [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
        [Math.floor(size / 2), Math.floor(size / 2)]
      ].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
    },
    { image: png.toString('base64'), size }
  );

  if (dimensions.some(dimension => dimension !== size)) {
    throw new Error(
      `Expected ${size}x${size}, received ${dimensions.join('x')}`
    );
  }

  if (png.length >= limit) {
    throw new Error(
      `Expected an image below 1 MB, received ${png.length} bytes`
    );
  }

  if (alpha.slice(0, 4).some(channel => channel !== 0) || alpha[4] !== 255) {
    throw new Error(`Unexpected transparency samples: ${alpha.join(', ')}`);
  }

  await writeFile(output, png);
  const artifact = await stat(output);
  console.log(
    `Rendered style/brand/correxit-github-avatar.png (${size}x${size}, ${artifact.size} bytes)`
  );
} finally {
  await browser.close();
}
