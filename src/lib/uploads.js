import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import config from '../config.js';
import {
  SITE_FOLDERS,
  userFolder,
  ensureFolder,
  relativeUploadPath,
  resolveUploadPath,
  publicUploadUrl,
} from './upload-paths.js';
import { processImage, forgetPicture } from './images.js';
import { makePoster, removePoster } from './video-posters.js';

/** How wide a picture may be when nothing else is said. */
const DEFAULT_MAX = 1600;

/**
 * How wide a picture may be when the driver asks for the full size.
 *
 * The small copies are made either way, so the page itself stays fast -
 * this only keeps a sharp master for the lightbox.
 */
const HD_MAX = 2560;

/** The widest each kind of picture may be, in the place it is shown. */
export const IMAGE_SIZES = {
  avatar: 512,
  group: 1200,
  chat: 1280,
  vehicle: 1280,
  listing: 1600,
  wall: 1600,
  certificate: 1920,
};

/**
 * The folder a file from this request belongs in.
 *
 * A driver keeps their own pictures; the site keeps its own. A route
 * that uploads a site file (a partner logo, a font) says so by setting
 * `req.uploadFolder` before the upload runs.
 */
function folderFor(req) {
  const asked = String(req?.uploadFolder || '').trim();
  if (asked) return asked.replace(/^\/+|\/+$/g, '');
  if (req?.user?.id) return userFolder(req.user.id);
  return SITE_FOLDERS.misc;
}

/**
 * Middleware that optimizes uploaded images after multer writes them to disk.
 *
 * A photo from a phone is four thousand pixels wide; the site shows it
 * in a column of seven hundred. The picture is therefore turned into a
 * WebP that is no wider than the place it is shown (the route says how
 * wide that is), and smaller copies are written next to it so a phone
 * does not download the big one.
 */
export async function optimizeUpload(req, _res, next) {
  const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : (req.file ? [req.file] : []);
  const max = Number(req.uploadMax) || DEFAULT_MAX;
  for (const file of files) {
    if (!file || !file.path) continue;
    if (file.mimetype?.startsWith('video/')) {
      const rel = relativeUploadPath(file.path);
      if (rel) await makePoster(rel);
      continue;
    }
    if (!IMAGE_TYPES.has(file.mimetype) || file.mimetype === 'image/gif') continue;
    try {
      const done = await processImage(file.path, max);
      // The folder stays: the database keeps the path inside the upload
      // folder, so the file can always be found again.
      file.path = resolveUploadPath(done.path) || file.path;
      file.filename = done.path;
      file.mimetype = 'image/webp';
      file.originalname = file.originalname.replace(/\.[^.]+$/, '.webp');
    } catch {
      // keep original on failure
    }
  }
  next();
}

fs.mkdirSync(config.uploadDir, { recursive: true });

/** Extensions we are willing to write to disk, keyed by mime type. */
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
]);

const VIDEO_TYPES = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['video/x-matroska', '.mkv'],
  ['video/ogg', '.ogv'],
]);

const FONT_TYPES = new Map([
  ['font/woff', '.woff'],
  ['font/woff2', '.woff2'],
  ['font/ttf', '.ttf'],
  ['font/otf', '.otf'],
  ['font/sfnt', '.ttf'],
  ['font/collection', '.ttf'],
  ['application/font-woff', '.woff'],
  ['application/font-woff2', '.woff2'],
  ['application/x-font-woff', '.woff'],
  ['application/x-font-woff2', '.woff2'],
  ['application/x-font-ttf', '.ttf'],
  ['application/x-font-truetype', '.ttf'],
  ['application/x-font-otf', '.otf'],
  ['application/x-font-opentype', '.otf'],
  ['application/font-sfnt', '.ttf'],
]);

/**
 * Windows usually has no MIME type registered for `.ttf`/`.otf`, so
 * browsers send those parts as `application/octet-stream` (or with no
 * type at all). We therefore trust the file extension first and verify
 * the real content from its magic bytes once it lands on disk.
 */
const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf']);

const FONT_MIME_BY_EXT = {
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/** CSS `format()` value for a canonical font mime type. */
export const fontCssFormat = (mimetype) =>
  mimetype === 'font/woff2'
    ? 'woff2'
    : mimetype === 'font/woff'
      ? 'woff'
      : mimetype === 'font/ttf'
        ? 'truetype'
        : 'opentype';

const fontExt = (file) => path.extname(file.originalname || '').toLowerCase();

/** A font is accepted when either its mime type *or* its extension matches. */
const isFontFile = (file) => FONT_TYPES.has(file.mimetype) || FONT_EXTENSIONS.has(fontExt(file));

/**
 * Documents a driver can send in a chat. Windows and phones often send
 * a .pdf or a .txt with no useful mime type, so the extension is
 * trusted as well and the content is checked once it lands on disk.
 */
const DOC_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['application/x-pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/markdown', '.txt'],
]);

const DOC_EXTENSIONS = new Set(['.pdf', '.txt']);

const ALLOWED = new Map([...IMAGE_TYPES, ...VIDEO_TYPES, ...FONT_TYPES, ...DOC_TYPES]);

/** Which kind of media a mime type is, or null when rejected. */
export const mediaKind = (mimetype) => {
  if (IMAGE_TYPES.has(mimetype)) return 'photo';
  if (VIDEO_TYPES.has(mimetype)) return 'video';
  return null;
};

/** Is this a document (pdf, txt) rather than a photo or a video? */
export const isDocument = (file) => {
  if (!file) return false;
  if (DOC_TYPES.has(file.mimetype)) return true;
  return DOC_EXTENSIONS.has(path.extname(file.originalname || '').toLowerCase());
};

/**
 * The optimisation middleware for one kind of picture.
 *
 * The route says where the picture is shown, and the picture is made
 * no bigger than that place. A driver who asks for the full size
 * (HD) keeps a sharp master for the lightbox - the small copies are
 * still made, so the page itself stays quick.
 */
export const optimizeAs = (kind) => (req, res, next) => {
  const base = IMAGE_SIZES[kind] || DEFAULT_MAX;
  const asked = String(req.body?.quality || req.query?.quality || '').toLowerCase();
  req.uploadMax = asked === 'hd' ? Math.max(base, HD_MAX) : base;
  return optimizeUpload(req, res, next);
};

/**
 * Filenames are random, never derived from user input, so a crafted
 * name can't escape the upload directory or overwrite another file.
 *
 * The folder is decided by who owns the file: everything a driver
 * uploads goes into their own folder, and the site's own files (fonts,
 * partner logos) go into the site folder. A route that owns site files
 * can say so with `req.uploadFolder`.
 */
const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, config.uploadDir);
  },
  filename(req, file, callback) {
    const ext = ALLOWED.get(file.mimetype) || (isDocument(file) ? path.extname(file.originalname || '').toLowerCase() : '.bin');
    if (!/^\.[a-z0-9]{1,6}$/i.test(ext)) ext = '.bin';
    const folder = folderFor(req);
    ensureFolder(folder);
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${ext}`;
    // The path inside the upload folder is what the database keeps.
    callback(null, `${folder}/${name}`);
  },
});

const fileFilter = (_req, file, callback) => {
  if (!ALLOWED.has(file.mimetype) && !isDocument(file)) {
    const error = new Error(`Unsupported file type: ${file.mimetype}`);
    error.code = 'UNSUPPORTED_MEDIA_TYPE';
    error.status = 400;
    return callback(error);
  }
  return callback(null, true);
};

const base = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxUploadMb * 1024 * 1024,
    files: 4,
    fields: 60,
    fieldSize: 1024 * 64,
  },
});

/** Composer for the wall: one photo or one video. */
export const postUpload = base.single('media');

/** Profile avatar. */
export const avatarUpload = base.single('avatar');

/** Chat attachment. */
export const chatUpload = base.single('media');

/** Group cover image. */
export const groupUpload = base.single('avatar');

/**
 * Build galleries take several files at once, so they get their own
 * multer instance with a higher file cap (same storage + filter).
 */
const multi = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxUploadMb * 1024 * 1024,
    files: 8,
    fields: 120,
    fieldSize: 1024 * 64,
  },
});

export const buildUpload = multi.array('media', 8);

/** Parts marketplace: up to six photos per listing. */
export const partUpload = multi.array('media', 6);

/** Service listing: a single cover image. */
export const serviceUpload = base.single('cover');

/** OCR certificate image upload. */
export const ocrUpload = base.single('image');
export const vehicleUpload = base.single('photo');

/** One picture for a build timeline entry. */
export const timelineUpload = base.single('photo');

/** Fonts get their own storage so the extension is right even when the
 *  browser fails to send a font mime type. They belong to the site. */
const fontStorage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, config.uploadDir);
  },
  filename(_req, file, callback) {
    const ext = fontExt(file);
    const safeExt = FONT_EXTENSIONS.has(ext) ? ext : FONT_TYPES.get(file.mimetype) || '.ttf';
    ensureFolder(SITE_FOLDERS.fonts);
    callback(null, `${SITE_FOLDERS.fonts}/${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${safeExt}`);
  },
});

/** Font upload multer instance. */
const font = multer({
  storage: fontStorage,
  fileFilter: (_req, file, callback) => {
    if (!isFontFile(file)) {
      const error = new Error(`Unsupported font type: ${file.originalname || file.mimetype}`);
      error.code = 'UNSUPPORTED_MEDIA_TYPE';
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max for fonts
    files: 1,
  },
});

/**
 * Font file signatures (first four bytes). Used after multer has written
 * the file so a renamed image or script can never pass as a font, which
 * matters because the mime type browsers send is unreliable.
 */
const FONT_SIGNATURES = new Map([
  ['00010000', 'font/ttf'], // TrueType
  ['74727565', 'font/ttf'], // 'true'
  ['74746366', 'font/ttf'], // 'ttcf' TrueType collection
  ['4f54544f', 'font/otf'], // 'OTTO' OpenType
  ['774f4646', 'font/woff'], // 'wOFF'
  ['774f4632', 'font/woff2'], // 'wOF2'
]);

/** Font upload middleware. */
export const fontUpload = font.single('font');

/** Partners: logo upload (image only, max 2MB). The wall belongs to
 *  the site, so the logos live in the site folder. */
const partnerStorage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, config.uploadDir);
  },
  filename(_req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext) ? ext : '.png';
    ensureFolder(SITE_FOLDERS.partners);
    callback(null, `${SITE_FOLDERS.partners}/partner-${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${safeExt}`);
  },
});

const partner = multer({
  storage: partnerStorage,
  fileFilter: (_req, file, callback) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.mimetype)) {
      const error = new Error('Only PNG, JPEG, WebP or SVG images are allowed for partner logos.');
      error.code = 'UNSUPPORTED_MEDIA_TYPE';
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

export const partnerUpload = partner.single('logo');

/**
 * Verify a just-written font by its magic bytes. Any file that is not a
 * real font is removed again and reported as a bad request.
 */
export function validateFont(req, _res, next) {
  const file = req.file;
  if (!file || !file.path) return next();

  let header = '';
  let fd;
  try {
    fd = fs.openSync(file.path, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    header = buf.toString('hex');
  } catch {
    header = '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  const mimetype = FONT_SIGNATURES.get(header);
  if (!mimetype) {
    fs.rm(file.path, { force: true }, () => {});
    const error = new Error('That file does not look like a font. Use a .woff, .woff2, .ttf or .otf file.');
    error.code = 'UNSUPPORTED_MEDIA_TYPE';
    error.status = 400;
    return next(error);
  }

  // Normalise so the @font-face CSS can pick the right format().
  file.mimetype = mimetype;
  return next();
}

/** Absolute path on disk for a stored file path. */
export const uploadPath = (filename) => resolveUploadPath(filename);

/** Public URL for a stored file path. */
export const uploadUrl = (filename) => publicUploadUrl(filename);

/** Delete a stored file, ignoring the case where it is already gone. */
export function removeUpload(filename) {
  if (!filename) return;
  const target = resolveUploadPath(filename);
  // Guard against anything that resolves outside the upload directory.
  if (!target) return;
  // The smaller copies go with it.
  forgetPicture(filename);
  removePoster(filename);
  fs.rm(target, { force: true }, () => {});
}

/** Human readable file size. */
export function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export const acceptAttribute = [...ALLOWED.keys()].join(',');

export default { postUpload, avatarUpload, chatUpload, groupUpload, buildUpload, partUpload, serviceUpload, fontUpload, validateFont, removeUpload, uploadUrl };
