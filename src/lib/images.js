/**
 * The picture pipeline.
 *
 * A photo taken on a phone is four thousand pixels wide and weighs a
 * megabyte; the wall shows it in a column of seven hundred. So every
 * upload is turned into a WebP that is no bigger than the place it is
 * shown, and a few smaller copies are written next to it. The browser
 * then asks for the copy that fits the screen it is on - a phone takes
 * the small one, a big screen takes the large one.
 *
 * The copies are remembered in `upload_variants`, so the page can offer
 * them with a plain `srcset`.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import config from '../config.js';
import { run, all } from '../db.js';
import { relativeUploadPath, resolveUploadPath } from './upload-paths.js';

/** The widths the smaller copies are made in. */
export const VARIANT_WIDTHS = [320, 640, 960];

/** How sharp the big copy is. */
const MAIN_QUALITY = 78;

/** How sharp the small copies are. */
const VARIANT_QUALITY = 74;

/* The list of copies, kept in memory for a moment - the pages ask for
   it on every image, and it barely changes. */
let cache = { at: 0, map: new Map() };
const CACHE_MS = 30_000;

function variantsMap() {
  if (Date.now() - cache.at > CACHE_MS) {
    const map = new Map();
    for (const row of all('SELECT source, width, path FROM upload_variants')) {
      if (!map.has(row.source)) map.set(row.source, []);
      map.get(row.source).push({ width: row.width, path: row.path });
    }
    for (const list of map.values()) list.sort((a, b) => a.width - b.width);
    cache = { at: Date.now(), map };
  }
  return cache.map;
}

/** Forget the cached list (after a new picture was written). */
export function forgetVariants() {
  cache = { at: 0, map: new Map() };
}

/**
 * The `srcset` for a picture: the small copies plus the original.
 *
 * Returns an empty string when the picture has no smaller copies, so
 * the tag can simply fall back to the plain `src`.
 */
export function srcsetFor(stored) {
  if (!stored) return '';
  const list = variantsMap().get(stored) || [];
  // One entry is only the original - there is nothing to choose from.
  if (list.length < 2) return '';
  return list.map((row) => `${config.uploadUrl}/${row.path} ${row.width}w`).join(', ');
}

/** The width of the big copy of a picture, if it is known. */
export function variantWidths(stored) {
  return (variantsMap().get(stored) || []).map((row) => row.width);
}

/**
 * Turn one uploaded picture into the WebP the site shows, plus the
 * smaller copies.
 *
 * @param {string} filePath  the file multer wrote
 * @param {number} max       the widest the picture may be
 * @returns {Promise<{path:string,width:number,height:number,variants:Array}>}
 */
export async function processImage(filePath, max = 1600) {
  const source = await sharp(filePath).rotate().toBuffer();

  const main = await sharp(source)
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: MAIN_QUALITY })
    .toBuffer({ resolveWithObject: true });

  const outPath = filePath.replace(/\.[^.]+$/, '.webp');
  await fs.promises.writeFile(outPath, main.data);
  if (outPath !== filePath) await fs.promises.rm(filePath, { force: true });

  const stored = relativeUploadPath(outPath);
  const variants = [];

  for (const width of VARIANT_WIDTHS) {
    if (width >= main.info.width) continue;
    const variantPath = outPath.replace(/\.webp$/i, `-${width}.webp`);
    const data = await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: VARIANT_QUALITY })
      .toBuffer();
    await fs.promises.writeFile(variantPath, data);
    variants.push({ width, path: relativeUploadPath(variantPath) });
  }

  // Remember the copies so the pages can offer them. The original is
  // listed too, so the browser knows how wide it is.
  run('DELETE FROM upload_variants WHERE source = ?', stored);
  for (const variant of variants) {
    run('INSERT OR REPLACE INTO upload_variants (source, width, path) VALUES (?, ?, ?)', stored, variant.width, variant.path);
  }
  run('INSERT OR REPLACE INTO upload_variants (source, width, path) VALUES (?, ?, ?)', stored, main.info.width, stored);
  forgetVariants();

  return {
    path: stored,
    width: main.info.width,
    height: main.info.height,
    variants,
  };
}

/** Remove the copies of a picture that is being deleted. */
export function forgetPicture(stored) {
  if (!stored) return;
  const list = variantsMap().get(stored) || [];
  for (const row of list) {
    // The original is the caller's business.
    if (row.path === stored) continue;
    const target = resolveUploadPath(row.path);
    if (target) fs.rmSync(target, { force: true });
  }
  run('DELETE FROM upload_variants WHERE source = ?', stored);
  forgetVariants();
}

export default { VARIANT_WIDTHS, processImage, srcsetFor, variantWidths, forgetVariants, forgetPicture };
