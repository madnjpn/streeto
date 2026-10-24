/**
 * Generate JPEG posters for every video already in the uploads folder.
 *
 *   npm run posters
 *
 * The ffmpeg binary comes from the project's ffmpeg-static dependency, so no
 * machine-wide ffmpeg is needed. Set FFMPEG_PATH to override it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env.production'));
} catch {
  /* development / no production file */
}

const { default: config } = await import('../src/config.js');
const { makePoster } = await import('../src/lib/video-posters.js');

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.ogv']);

function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

const videos = walk(config.uploadDir);
let created = 0;
for (const video of videos) {
  const rel = path.relative(config.uploadDir, video).replaceAll(path.sep, '/');
  const poster = await makePoster(rel);
  if (poster) created += 1;
  console.log(`${poster ? 'poster' : 'no   '}  ${rel}`);
}

console.log(`\n${created}/${videos.length} videos now have a poster.`);
