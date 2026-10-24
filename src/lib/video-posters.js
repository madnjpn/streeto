import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import { resolveUploadPath } from './upload-paths.js';

const execFileAsync = promisify(execFile);

/** Video extensions the browser can attempt to play. */
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.ogv']);

/**
 * The bundled binary lives inside node_modules/ffmpeg-static, so the project
 * is self-contained after `npm install` and does not depend on a machine-wide
 * ffmpeg. FFMPEG_PATH is only an optional override.
 */
const FFMPEG = process.env.FFMPEG_PATH || ffmpegPath || 'ffmpeg';

const isVideo = (mediaPath) => VIDEO_EXT.has(path.extname(String(mediaPath || '')).toLowerCase());
const baseRel = (mediaPath) => String(mediaPath).replace(/\.[^.]+$/, '');

/** The relative poster path for a video, if one has been generated. */
export function posterFor(mediaPath) {
  if (!isVideo(mediaPath)) return '';
  const base = baseRel(mediaPath);
  for (const ext of ['.webp', '.jpg']) {
    const candidate = base + ext;
    const full = resolveUploadPath(candidate);
    try {
      if (full && fs.existsSync(full) && fs.statSync(full).size > 0) return candidate;
    } catch {
      /* try the next extension */
    }
  }
  return '';
}

/**
 * Convert a video to a browser-safe MP4: H.264 video, AAC audio, yuv420p,
 * fast-start and at most 720 px wide. iPhone HEVC/MOV and Android MKV files
 * become playable everywhere, and the feed file gets smaller.
 *
 * Returns { path, changed }. On failure the original path is returned.
 */
export async function transcodeVideo(mediaPath) {
  if (!isVideo(mediaPath)) return { path: mediaPath, changed: false };
  const input = resolveUploadPath(mediaPath);
  if (!input || !fs.existsSync(input)) return { path: mediaPath, changed: false };

  const outputRel = baseRel(mediaPath) + '.mp4';
  const output = resolveUploadPath(outputRel);
  if (!output) return { path: mediaPath, changed: false };

  const dir = path.dirname(output);
  const temp = path.join(
    dir,
    `.transcode-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.mp4`,
  );

  try {
    await execFileAsync(
      FFMPEG,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', input,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-sn',
        '-dn',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '24',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=720:-2',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-movflags', '+faststart',
        '-max_muxing_queue_size', '1024',
        temp,
      ],
      { timeout: 120_000 },
    );
    if (!fs.existsSync(temp) || fs.statSync(temp).size === 0) throw new Error('empty output');

    // Replace the original only after a complete, valid output exists.
    if (path.resolve(input) !== path.resolve(output)) fs.rmSync(input, { force: true });
    fs.rmSync(output, { force: true });
    fs.renameSync(temp, output);
    return { path: outputRel, changed: outputRel !== mediaPath };
  } catch (error) {
    fs.rmSync(temp, { force: true });
    console.warn('[video] could not transcode', mediaPath, '-', error.message.split('\n')[0]);
    return { path: mediaPath, changed: false };
  }
}

/** Extract a frame from the video and save a WebP poster next to it. */
export async function makePoster(mediaPath) {
  if (!isVideo(mediaPath)) return '';
  const video = resolveUploadPath(mediaPath);
  if (!video || !fs.existsSync(video)) return '';

  const base = baseRel(mediaPath);
  const posterRel = base + '.webp';
  const poster = resolveUploadPath(posterRel);
  if (!poster) return '';
  try {
    if (fs.existsSync(poster) && fs.statSync(poster).size > 0) return posterRel;
  } catch {
    /* fall through and regenerate */
  }

  const legacyRel = base + '.jpg';
  const legacy = resolveUploadPath(legacyRel);
  const dir = path.dirname(poster);
  const temp = path.join(
    dir,
    `.poster-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.jpg`,
  );

  for (const at of ['1', '0']) {
    try {
      await execFileAsync(
        FFMPEG,
        [
          '-hide_banner',
          '-loglevel', 'error',
          '-y',
          '-ss', at,
          '-i', video,
          '-frames:v', '1',
          '-vf', 'scale=720:-2',
          '-q:v', '3',
          temp,
        ],
        { timeout: 20_000 },
      );
      if (!fs.existsSync(temp) || fs.statSync(temp).size === 0) continue;

      await sharp(temp).webp({ quality: 80 }).toFile(poster);
      fs.rmSync(temp, { force: true });
      if (legacy && fs.existsSync(legacy)) fs.rmSync(legacy, { force: true });
      return posterRel;
    } catch {
      /* try the next position */
    }
  }

  fs.rmSync(temp, { force: true });
  return '';
}

/** Remove the poster(s) that belong to a deleted video. */
export function removePoster(mediaPath) {
  if (!isVideo(mediaPath)) return;
  const base = baseRel(mediaPath);
  for (const ext of ['.webp', '.jpg']) {
    const poster = resolveUploadPath(base + ext);
    if (poster) fs.rm(poster, { force: true }, () => {});
  }
}

export default { posterFor, makePoster, transcodeVideo, removePoster };
