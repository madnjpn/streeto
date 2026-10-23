/**
 * Input validation. Every rule lives here so the register form, the
 * profile editor and the API endpoints all enforce the same thing.
 *
 *  - username : 3-20 characters, letters / digits / underscore only.
 *               No symbols, spaces, dots or dashes (per spec).
 *  - password : at least 8 characters, must mix a letter and a digit,
 *               must not contain whitespace-only content, max 128.
 *  - email    : normal shape check, max 254 characters.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const USERNAME_RE = /^[A-Za-z0-9_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** Reserved words that would collide with routes. */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'api', 'static',
  'uploads', 'login', 'logout', 'register', 'signup', 'signin', 'settings', 'me',
  'profile', 'friends', 'chat', 'groups', 'meetups', 'search', 'wall', 'feed',
  'notifications', 'about', 'null', 'undefined', 'streeto', 'moderator',
]);

export function checkUsername(value) {
  const username = String(value ?? '').trim();
  if (!username) return { ok: false, error: 'Username is required.' };
  if (username.length < USERNAME_MIN) {
    return { ok: false, error: `Username must be at least ${USERNAME_MIN} characters.` };
  }
  if (username.length > USERNAME_MAX) {
    return { ok: false, error: `Username must be at most ${USERNAME_MAX} characters.` };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error: 'Username may only contain letters, numbers and underscores - no symbols.',
    };
  }
  if (/^[0-9_]+$/.test(username)) {
    return { ok: false, error: 'Username must contain at least one letter.' };
  }
  if (RESERVED.has(username.toLowerCase())) {
    return { ok: false, error: 'That username is reserved. Pick another one.' };
  }
  return { ok: true, value: username };
}

export function checkPassword(value, { username } = {}) {
  const password = String(value ?? '');
  if (!password) return { ok: false, error: 'Password is required.' };
  if (password.length < PASSWORD_MIN) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN} characters long.` };
  }
  if (password.length > PASSWORD_MAX) {
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX} characters long.` };
  }
  if (!/[A-Za-z]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one number.' };
  }
  if (username && password.toLowerCase().includes(String(username).toLowerCase())) {
    return { ok: false, error: 'Password must not contain your username.' };
  }
  return { ok: true, value: password };
}

/** Rough 0-4 strength score, used to drive the meter in the UI. */
export function passwordScore(password = '') {
  let score = 0;
  if (password.length >= PASSWORD_MIN) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}

export function checkEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Email is required.' };
  if (email.length > 254) return { ok: false, error: 'Email is too long.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  return { ok: true, value: email };
}

/** Validate everything needed to create an account. */
export function validateRegistration(input) {
  const errors = {};
  const username = String(input.username ?? '').trim();
  const email = String(input.email ?? '').trim();
  const password = String(input.password ?? '');
  const confirm = String(input.confirm ?? input.password2 ?? '');

  const u = checkUsername(username);
  if (!u.ok) errors.username = u.error;

  const e = checkEmail(email);
  if (!e.ok) errors.email = e.error;

  const p = checkPassword(password, { username: u.ok ? u.value : undefined });
  if (!p.ok) errors.password = p.error;

  if (confirm !== password) errors.confirm = 'Passwords do not match.';

  const displayName = String(input.display_name ?? '').trim().slice(0, 40);

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values: {
      username: u.ok ? u.value : username,
      email: e.ok ? e.value : email,
      display_name: displayName || null,
      // Ticking this means "I want to provide services", which lets the
      // member claim a listing. The provider name itself is always taken
      // from the listing they verified.
      is_provider: input.is_provider === '1' || input.is_provider === 1 || input.is_provider === true,
    },
  };
}

/** Sanitise a free-text field: trim, collapse newlines, cap length. */
export function cleanText(value, max = 5000) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length <= max) return text;
  return text.slice(0, max);
}

/** Slugify a group name into a URL-safe identifier. */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Validate a latitude/longitude pair coming from a form. */
export function checkCoords(lat, lng) {
  const la = lat === '' || lat == null ? null : Number(lat);
  const ln = lng === '' || lng == null ? null : Number(lng);
  if (la === null || ln === null) return { ok: false, lat: null, lng: null };
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return { ok: false, lat: null, lng: null };
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return { ok: false, lat: null, lng: null };
  return { ok: true, lat: la, lng: ln };
}

/**
 * The zoom level of the map at the moment the spot was picked. Saving it
 * means the shared map opens at the same zoom the picker was left at.
 */
export function checkZoom(value) {
  if (value === '' || value === undefined || value === null) return null;
  const z = Number(value);
  if (!Number.isFinite(z) || z < 0 || z > 22) return null;
  return Math.round(z * 10) / 10;
}

export const isEmailLike = (value) => EMAIL_RE.test(String(value ?? ''));