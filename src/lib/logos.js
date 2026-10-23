/**
 * Partner logos.
 *
 * Every logo sits in the same frame on the partners wall, so a picture
 * that carries a lot of empty space around the actual mark would look
 * tiny - a 12189px wide banner trimmed to its wordmark, a logo padded
 * with a transparent border. sharp trims that space away, keeps the
 * file light, and reports the real size so the page can give the mark
 * the whole frame.
 *
 * A logo that was drawn on a white sheet (a photo, a scan, a PNG with
 * an opaque white background) keeps that sheet: the page shows it on a
 * light tile, so the mark stays readable instead of dissolving into the
 * dark page.
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';
import { SITE_FOLDERS, ensureFolder, relativeUploadPath } from './upload-paths.js';

/** Bigger than any frame on the page; small enough to stay quick. */
const MAX_WIDTH = 1600;

/**
 * How has to be shown?
 *
 * 0 - the mark floats on transparency: it sits straight on the dark frame
 * 1 - the mark was drawn on white paper: it gets a light tile
 * 2 - the mark was drawn on black paper: it gets a dark tile
 *
 * The picture is measured rather than guessed from the corners: a logo
 * can be trimmed so that its own dark shape sits in the corner while
 * the paper around it is still white.
 */
function plateFor({ data, info }) {
  const { width, height, channels } = info;
  const total = width * height;
  let transparent = 0;
  let light = 0;
  let visible = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * channels;
    const a = channels === 4 ? data[p + 3] : 255;
    if (a < 32) { transparent += 1; continue; }
    visible += 1;
    const lum = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
    if (lum > 195) light += 1;
  }
  if (!visible) return 0;
  if (transparent / total > 0.08) return 0;
  if (light / visible > 0.45) return 1;
  return 2;
}

/**
 * Clean one uploaded logo and write the result next to the uploads.
 *
 * @param {string} srcPath  the file multer just wrote
 * @returns {Promise<{file:string,width:number,height:number,plate:number}>}
 */
export async function prepareLogo(srcPath) {
  // The path inside the upload folder, so the row can point at it.
  const original = relativeUploadPath(srcPath);

  try {
    const meta = await sharp(srcPath).metadata();

    // Vector logos are kept as they are: there is no border to trim.
    if (meta.format === 'svg') {
      return {
        file: original,
        width: meta.width || 0,
        height: meta.height || 0,
        plate: 0,
      };
    }

    // The empty space around a mark is cut away, so the logo fills the
    // frame it is given on the wall.
    let sized = null;
    try {
      const trimmed = await sharp(srcPath)
        .trim({ threshold: 12 })
        .png()
        .toBuffer({ resolveWithObject: true });
      if (trimmed.info.width > 0 && trimmed.info.height > 0) {
        sized = await sharp(trimmed.data)
          .resize({ width: MAX_WIDTH, withoutEnlargement: true })
          .png({ compressionLevel: 9 })
          .toBuffer({ resolveWithObject: true });
      }
    } catch {
      // Some pictures cannot be trimmed (a photo with a gradient edge);
      // they are used as they are.
      sized = null;
    }
    if (!sized) {
      sized = await sharp(srcPath)
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
    }

    const raw = await sharp(sized.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const plate = plateFor(raw);

    const file = `${SITE_FOLDERS.partners}/partner-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.png`;
    const outPath = path.join(config.uploadDir, file);
    ensureFolder(SITE_FOLDERS.partners);
    await fs.promises.writeFile(outPath, sized.data);

    // The upload is only dropped once the new file is really there.
    const written = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
    if (!written) throw new Error('The logo could not be saved.');
    if (path.resolve(srcPath) !== path.resolve(outPath)) {
      await fs.promises.rm(srcPath, { force: true });
    }

    return { file, width: sized.info.width, height: sized.info.height, plate };
  } catch (error) {
    // A picture sharp cannot read is still a partner: the upload is kept
    // as it was sent, nothing is lost.
    return { file: original, width: 0, height: 0, plate: 0 };
  }
}

/**
 * The partner name, taken from the name of the logo file.
 *
 * "ambiance-media.png" becomes "ambiance media", and a file called
 * "logo.png" does not become a partner called "logo". The admin sees
 * the same name in the browser before the file is sent.
 */
export function nameFromLogoFile(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]+$/i, '');
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const trimmed = cleaned.replace(/\s+logo\s*(\d+)?$/i, '').trim();
  return (trimmed || cleaned || 'Partner').slice(0, 80);
}

/**
 * A web address for a partner, or nothing.
 *
 * The admin may leave it empty, but a half typed address should not
 * end up on the wall as a dead link. A bare domain gets the https://
 * the browser would have insisted on; an address that is not an address
 * at all is refused (null) so the admin can be told.
 */
export function cleanPartnerUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  if (!host || (!host.includes('.') && host !== 'localhost')) return null;
  return withScheme;
}

export default { prepareLogo, nameFromLogoFile, cleanPartnerUrl };
