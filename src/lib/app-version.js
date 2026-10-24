import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Version information for the web app and the Android shell.
 *
 * The Android version is read from the Gradle file (the source of truth for
 * the build) and paired with the APK actually being served, so the update
 * check can hand the client a SHA-256 to verify. Both files are read with a
 * small cache keyed by their modification time, which means a freshly copied
 * APK is picked up without restarting the server.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const APK = path.join(ROOT, 'public', 'downloads', 'STREETO-android.apk');
const APK_URL = '/downloads/STREETO-android.apk';

let pkg = { version: '0.0.0' };
try {
  pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
} catch {
  /* keep the fallback version */
}

/** The running web version, shown in the footer and settings. */
export const webVersion = String(pkg.version || '0.0.0');

let gradleCache = { key: '', value: { versionCode: 0, versionName: '' } };

function readGradle() {
  let stat;
  try {
    stat = fs.statSync(GRADLE);
  } catch {
    return gradleCache.value;
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (gradleCache.key === key) return gradleCache.value;

  let source = '';
  try {
    source = fs.readFileSync(GRADLE, 'utf8');
  } catch {
    return gradleCache.value;
  }
  const versionCode = Number((source.match(/versionCode\s*=\s*(\d+)/) || [])[1] || 0);
  const versionName = (source.match(/versionName\s*=\s*"([^"]+)"/) || [])[1] || '';
  gradleCache = { key, value: { versionCode, versionName } };
  return gradleCache.value;
}

let apkCache = { key: '', value: null };

/** Metadata about the Android release currently served by the site. */
export function androidVersion() {
  const gradle = readGradle();

  let size = 0;
  let mtime = 0;
  try {
    const stat = fs.statSync(APK);
    size = stat.size;
    mtime = stat.mtimeMs;
  } catch {
    /* no APK on a development checkout */
  }

  const key = `${gradle.versionCode}:${gradle.versionName}:${size}:${mtime}`;
  if (apkCache.key === key && apkCache.value) return apkCache.value;

  let sha256 = '';
  if (size > 0) {
    try {
      sha256 = crypto.createHash('sha256').update(fs.readFileSync(APK)).digest('hex');
    } catch {
      sha256 = '';
    }
  }

  apkCache = {
    key,
    value: {
      versionCode: gradle.versionCode,
      versionName: gradle.versionName,
      url: APK_URL,
      size,
      sha256,
      available: size > 0 && sha256.length === 64,
    },
  };
  return apkCache.value;
}

export default { webVersion, androidVersion };
