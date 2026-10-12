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
// Link-preview image (Open Graph, 1200×630): the full film-strip logo on white, as on the sign-in page.
const OG = { width: 1200, height: 630 };
const ogStrip = await strip().resize({ width: 1080 }).png().toBuffer();
const ogStripHeight = (await sharp(ogStrip).metadata()).height;
const tagline = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${OG.width}" height="80">
     <text x="50%" y="52" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="#5c6575">Plan episodes as timed scenes and shot checklists.</text>
   </svg>`,
);
const top = Math.round((OG.height - ogStripHeight - 110) / 2);
await sharp({ create: { ...OG, channels: 3, background: '#ffffff' } })
  .composite([
    { input: ogStrip, left: 60, top },
    { input: tagline, left: 0, top: top + ogStripHeight + 30 },
  ])
  // JPEG keeps it well under the ~300 KB some messengers (WhatsApp) accept for previews.
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(`${OUT}/og-image.jpg`);
console.log('brand assets written to', OUT);
