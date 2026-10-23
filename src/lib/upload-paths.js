/**
 * Where the uploaded files live.
 *
 * The upload folder used to be one flat pile: a driver's avatar, a chat
 * photo, a partner logo and a font all sat next to each other with
 * random names. Nothing mixed now:
 *
 *   uploads/
 *     users/<user id>/    everything that driver uploaded
 *     site/partners/      the logos on the partners page
 *     site/fonts/         the fonts an admin installed
 *     site/misc/          anything the site owns that has no better home
 *
 * The database stores the path *inside* the upload folder
 * ("users/7/abc123.webp"), and the public address is the same string
 * after /uploads - so a file can always be found by reading its row.
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';

/** The folder a driver keeps their own files in. */
export const USERS = 'users';

/** The folder the site's own files live in. */
export const SITE = 'site';

/** Folders for the files the site itself owns. */
export const SITE_FOLDERS = {
  partners: `${SITE}/partners`,
  fonts: `${SITE}/fonts`,
  misc: `${SITE}/misc`,
};

/** The folder one driver's files belong in. */
export function userFolder(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return SITE_FOLDERS.misc;
  return `${USERS}/${id}`;
}

/** Create a folder inside the upload directory and return it. */
export function ensureFolder(folder) {
  const target = path.join(config.uploadDir, folder);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

/** Create a driver's own folder (called when an account is opened). */
export function ensureUserFolder(userId) {
  return ensureFolder(userFolder(userId));
}

/** Remove a driver's folder and everything in it. */
export function removeUserFolder(userId) {
  const target = path.join(config.uploadDir, userFolder(userId));
  fs.rmSync(target, { recursive: true, force: true });
}

/** The path of a file inside the upload folder, with forward slashes. */
export function relativeUploadPath(absolute) {
  return path.relative(config.uploadDir, absolute).split(path.sep).join('/');
}

/**
 * The absolute path of a stored file.
 *
 * The path comes out of the database, so it is checked: nothing may
 * point outside the upload folder.
 */
export function resolveUploadPath(stored) {
  if (!stored) return null;
  const root = path.resolve(config.uploadDir);
  const clean = String(stored).replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(root, clean);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/** The public address of a stored file. */
export function publicUploadUrl(stored) {
  if (!stored) return null;
  const clean = String(stored).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean) return null;
  const encoded = clean.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${config.uploadUrl}/${encoded}`;
}

/** The file name without its folders. */
export const uploadFileName = (stored) => String(stored || '').split('/').pop();

export default {
  USERS,
  SITE,
  SITE_FOLDERS,
  userFolder,
  ensureFolder,
  ensureUserFolder,
  removeUserFolder,
  relativeUploadPath,
  resolveUploadPath,
  publicUploadUrl,
  uploadFileName,
};
