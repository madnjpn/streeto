/**
 * Durable, in-process media queue.
 *
 * Uploads should not hold a request open while FFmpeg turns a phone video
 * into an H.264/AAC MP4. The upload stays on disk, a row is written to
 * media_jobs, and the response is allowed to finish. One worker processes
 * jobs in order; queued work survives a restart.
 */
import fs from 'node:fs';
import { run, get } from '../db.js';
import { transcodeVideo, makePoster } from './video-posters.js';
import { resolveUploadPath } from './upload-paths.js';

const MAX_ATTEMPTS = 3;
const TICK_MS = 1_500;

/* Every table/column that can point at the original upload. When the worker
   produces the MP4, those references move with it. */
const MEDIA_REFERENCES = [
  ['posts', 'media_path'],
  ['messages', 'media_path'],
  ['build_media', 'media_path'],
  ['builds', 'cover'],
  ['build_timeline', 'photo'],
  ['vehicles', 'photo'],
  ['parts', 'cover'],
  ['part_photos', 'media_path'],
  ['services', 'cover'],
];

let timer = null;
let running = false;

/** Add one video to the queue. Repeated uploads of the same path coalesce. */
export function enqueueVideo(sourcePath) {
  if (!sourcePath) return null;
  const existing = get(
    "SELECT id FROM media_jobs WHERE source_path = ? AND status IN ('queued','processing')",
    sourcePath,
  );
  if (existing) return existing.id;
  return run(
    "INSERT INTO media_jobs (kind, source_path, status) VALUES ('video', ?, 'queued')",
    sourcePath,
  ).lastInsertRowid;
}

function updateReferences(oldPath, newPath) {
  let changed = 0;
  for (const [table, column] of MEDIA_REFERENCES) {
    const info = run(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, newPath, oldPath);
    changed += info.changes || 0;
  }
  return changed;
}

async function processJob(job) {
  run(
    `UPDATE media_jobs
        SET status = 'processing', attempts = attempts + 1,
            started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), error = NULL
      WHERE id = ?`,
    job.id,
  );

  const source = resolveUploadPath(job.source_path);
  if (!source || !fs.existsSync(source)) {
    run(
      `UPDATE media_jobs
          SET status = 'failed', error = 'source file is gone',
              finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
      job.id,
    );
    return;
  }

  // Keep the original until the references have moved. transcodeVideo only
  // deletes it when keepOriginal is false.
  const result = await transcodeVideo(job.source_path, { keepOriginal: true });
  const moved = result.changed && result.path !== job.source_path;
  const alreadyMp4 = !result.changed && /\.mp4$/i.test(job.source_path);
  if (!moved && !alreadyMp4) {
    const attempts = job.attempts + 1;
    run(
      `UPDATE media_jobs
          SET status = ?, error = ?, finished_at = CASE WHEN ? >= ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END
        WHERE id = ?`,
      attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
      'ffmpeg did not produce an mp4',
      attempts,
      MAX_ATTEMPTS,
      job.id,
    );
    return;
  }

  const finalPath = result.path;
  if (moved) {
    const references = updateReferences(job.source_path, finalPath);
    if (!references) {
      // The route rejected the upload, or it belongs to a table this queue
      // does not know. Keep the MP4 and the original rather than risking
      // deleting the only copy of a live file.
      run(
        `UPDATE media_jobs
            SET status = 'skipped', error = 'no stored reference found',
                finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?`,
        job.id,
      );
      return;
    }
    fs.rmSync(source, { force: true });
  }

  await makePoster(finalPath);
  run(
    `UPDATE media_jobs
        SET status = 'done', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    job.id,
  );
}

async function tick() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const job = get(
        "SELECT * FROM media_jobs WHERE status = 'queued' ORDER BY id LIMIT 1",
      );
      if (!job) break;
      try {
        await processJob(job);
      } catch (error) {
        const attempts = job.attempts + 1;
        run(
          `UPDATE media_jobs
              SET status = ?, attempts = ?, error = ?,
                  finished_at = CASE WHEN ? >= ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END
            WHERE id = ?`,
          attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
          attempts,
          String(error?.message || error).slice(0, 500),
          attempts,
          MAX_ATTEMPTS,
          job.id,
        );
      }
    }
  } finally {
    running = false;
  }
}

/** Reset interrupted work and start the single worker for this process. */
export function startMediaQueue() {
  if (timer) return;
  run("UPDATE media_jobs SET status = 'queued' WHERE status = 'processing'");
  timer = setInterval(() => tick().catch(() => {}), TICK_MS);
  timer.unref?.();
  tick().catch(() => {});
}

export function mediaQueueStats() {
  return {
    queued: get("SELECT COUNT(*) AS n FROM media_jobs WHERE status = 'queued'")?.n ?? 0,
    processing: get("SELECT COUNT(*) AS n FROM media_jobs WHERE status = 'processing'")?.n ?? 0,
    failed: get("SELECT COUNT(*) AS n FROM media_jobs WHERE status = 'failed'")?.n ?? 0,
    done: get("SELECT COUNT(*) AS n FROM media_jobs WHERE status = 'done'")?.n ?? 0,
  };
}

export default { enqueueVideo, startMediaQueue, mediaQueueStats };
