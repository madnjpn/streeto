import { exists } from '../db.js';
import { removeUpload } from './uploads.js';

/**
 * Upload files can be shared between features. A garage vehicle, for
 * example, borrows the cover photo of the build it is linked to, so the
 * same file name lives in both `vehicles.photo` and `builds.cover` (or
 * `build_media.media_path`).
 *
 * Deleting the row that happens to reference a file must therefore not
 * blindly wipe the file from disk - another feature may still point at
 * it. This helper answers "is this upload still in use anywhere?".
 */
const REFERENCES = [
  ['users', 'avatar'],
  ['groups', 'avatar'],
  ['posts', 'media_path'],
  ['messages', 'media_path'],
  ['builds', 'cover'],
  ['build_media', 'media_path'],
  ['parts', 'cover'],
  ['part_photos', 'media_path'],
  ['services', 'cover'],
  ['partners', 'logo_path'],
  ['vehicles', 'photo'],
];

/** True when any table still stores this upload file name. */
export function isUploadReferenced(filename) {
  if (!filename) return false;
  return REFERENCES.some(([table, column]) =>
    exists(`SELECT 1 FROM ${table} WHERE ${column} = ?`, filename));
}

/**
 * Delete an upload from disk unless another row still uses it. Call this
 * after removing the row(s) that owned the file, so the owner itself no
 * longer counts as a reference.
 */
export function removeUploadIfUnused(filename) {
  if (filename && !isUploadReferenced(filename)) removeUpload(filename);
}

export default { isUploadReferenced, removeUploadIfUnused };
