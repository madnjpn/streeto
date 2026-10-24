/**
 * Generate Android launcher icons from one square source image.
 *
 *   node scripts/build-android-icons.mjs
 *   node scripts/build-android-icons.mjs path/to/icon.png
 *
 * The default source is android/icon-source.png. Replace that file and run
 * the script (or `npm run icons:android`) to refresh every density.
 *
 * Legacy launcher icons are square (48..192 px). Round icons are the same
 * artwork masked to a circle for API 24/25 launchers. Adaptive icons
 * (API 26+) use the full artwork as the 432x432 background layer and a
 * transparent foreground, matching the existing project layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const source = path.resolve(process.argv[2] || path.join(ROOT, 'android', 'icon-source.png'));

if (!fs.existsSync(source)) {
  console.error(`Source image not found: ${source}`);
  console.error('Put a square PNG at android/icon-source.png or pass a path.');
  process.exit(1);
}

const meta = await sharp(source).metadata();
if (!meta.width || !meta.height) {
  console.error('Could not read the source image.');
  process.exit(1);
}
if (meta.width !== meta.height) {
  console.warn(`Source is ${meta.width}x${meta.height}; it will be centre-cropped to a square.`);
}
if (Math.min(meta.width, meta.height) < 512) {
  console.warn('Source is smaller than 512x512; a larger source gives cleaner icons.');
}

const SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function write(file, pipeline) {
  await pipeline.png({ compressionLevel: 9 }).toFile(file);
  console.log(`  ${path.relative(ROOT, file)}`);
}

for (const [density, size] of Object.entries(SIZES)) {
  const dir = path.join(RES, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });

  await write(
    path.join(dir, 'ic_launcher.png'),
    sharp(source).resize(size, size, { fit: 'cover' }),
  );

  const circle = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>` +
      '</svg>',
  );
  await write(
    path.join(dir, 'ic_launcher_round.png'),
    sharp(source)
      .resize(size, size, { fit: 'cover' })
      .composite([{ input: circle, blend: 'dest-in' }]),
  );
}

await write(
  path.join(RES, 'drawable', 'ic_launcher_background.png'),
  sharp(source).resize(432, 432, { fit: 'cover' }),
);

await write(
  path.join(RES, 'drawable', 'ic_launcher_foreground.png'),
  sharp({
    create: {
      width: 432,
      height: 432,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }),
);

console.log(`\nLauncher icons generated from ${path.relative(ROOT, source)}`);
