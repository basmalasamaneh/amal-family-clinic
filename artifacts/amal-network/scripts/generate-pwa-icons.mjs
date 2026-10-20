import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';

const out = new URL('../public/icons/', import.meta.url);
await mkdir(out, { recursive: true });
const mark = await readFile(new URL('../../../attached_assets/amal-logo-mark_1792331418652.svg', import.meta.url));
for (const size of [192, 512]) {
  await sharp(mark).resize(size, size).png().toFile(new URL(`amal-${size}.png`, out).pathname);
}
// The entire approved mark fits inside the central circle of diameter 80%:
// 280 * sqrt(2) < 512 * .8. Do not crop/redraw the approved mark.
await sharp({
  create: { width: 512, height: 512, channels: 4, background: '#0B5F69' },
}).composite([{ input: await sharp(mark).resize(280, 280).png().toBuffer(), gravity: 'centre' }])
  .png().toFile(new URL('amal-maskable-512.png', out).pathname);
await sharp(mark).resize(180, 180).flatten({ background: '#0B5F69' }).png()
  .toFile(new URL('apple-touch-icon.png', out).pathname);
