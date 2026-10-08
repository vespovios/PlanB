// Regenerates web logo and icons from the source artwork in branding/PLANB-LOGO.png.
// Usage: node scripts/brand-assets.mjs
import fs from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'branding/PLANB-LOGO.png';
// The filmstrip inside the source image (measured: dark-pixel bounds of the strip).
const STRIP = { left: 184, top: 217, width: 1507 - 184 + 1, height: 661 - 217 + 1 };
// Square crop around the final frame ("B" + chevron) for small icons.
const ICON = { left: 1507 - 444, top: 217, width: 445, height: 445 };
const OUT = 'src/client/public/brand';

fs.mkdirSync(OUT, { recursive: true });
const strip = () => sharp(SOURCE).extract(STRIP);
const icon = () => sharp(SOURCE).extract(ICON);

await strip().resize({ width: 960 }).webp({ quality: 86 }).toFile(`${OUT}/planb-logo.webp`);
await strip().resize({ width: 1200 }).png({ compressionLevel: 9 }).toFile('branding/planb-logo-strip.png');
for (const size of [32, 192, 512]) {
  await icon().resize(size, size).png().toFile(`${OUT}/icon-${size}.png`);
}
// Apple touch icon: iOS rounds the corners itself; keep the full square.
await icon().resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`);
console.log('brand assets written to', OUT);
