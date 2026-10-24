import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

/** The relative poster path for a video, if one has been generated. */
export function posterFor(mediaPath) {
  if (!isVideo(mediaPath)) return '';
  const posterPath = String(mediaPath).replace(/\.[^.]+$/, '.jpg');
  const full = resolveUploadPath(posterPath);
  try {
    return full && fs.existsSync(full) && fs.statSync(full).size > 0 ? posterPath : '';
  } catch {
    return '';
  }
}

/** Extract a frame from the video and save it next to it as a JPEG. */
export async function makePoster(mediaPath) {
  if (!isVideo(mediaPath)) return '';
  const video = resolveUploadPath(mediaPath);
  if (!video || !fs.existsSync(video)) return '';

  const posterPath = String(mediaPath).replace(/\.[^.]+$/, '.jpg');
  const poster = resolveUploadPath(posterPath);
  if (!poster) return '';
  try {
    if (fs.existsSync(poster) && fs.statSync(poster).size > 0) return posterPath;
  } catch {
    /* fall through and try to regenerate */
  }

  // 1 s in is usually past a fade-in; 0 is the fallback for very short clips.
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
          poster,
        ],
        { timeout: 20_000 },
      );
      if (fs.existsSync(poster) && fs.statSync(poster).size > 0) return posterPath;
    } catch {
      /* try the next position / leave the video without a poster */
    }
  }
  return '';
}

/** Remove the poster that belongs to a deleted video. */
export function removePoster(mediaPath) {
  if (!isVideo(mediaPath)) return;
  const poster = resolveUploadPath(String(mediaPath).replace(/\.[^.]+$/, '.jpg'));
  if (!poster) return;
  fs.rm(poster, { force: true }, () => {});
}

export default { posterFor, makePoster, removePoster };
