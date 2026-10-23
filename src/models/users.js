import { all, get, run } from '../db.js';

/** Column list for anything that hands a user object to the views.
 *  Exported so middleware and models can never drift apart. */
export const PUBLIC_FIELDS = `id, username, email, display_name, avatar, bio, car, city, language, theme, currency, is_admin, is_provider, provider_name, mail_digest, mail_pti, created_at`;

export const findById = (id) => get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`, id);

export const findByUsername = (username) =>
  get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE username = ? COLLATE NOCASE`, String(username ?? ''));

/** Login accepts either the username or the email address. */
export const findByLogin = (login) =>
  get(
    `SELECT ${PUBLIC_FIELDS} FROM users
      WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE`,
    String(login ?? '').trim(),
    String(login ?? '').trim(),
  );

export const findWithHash = (login) =>
  get(
    `SELECT ${PUBLIC_FIELDS}, password_hash FROM users
      WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE`,
    String(login ?? '').trim(),
    String(login ?? '').trim(),
  );

export const usernameTaken = (username) =>
  Boolean(get('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', username));

export const emailTaken = (email) =>
  Boolean(get('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE', email));

/**
 * The forms and the validator speak snake_case, the model speaks camelCase.
 * Accept either spelling so a display name is never silently dropped.
 */
function pickDisplayName(camel, snake) {
  const value = camel ?? snake;
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

export function createUser({
  username,
  email,
  passwordHash,
  displayName,
  display_name,
  language = null,
  isProvider,
  is_provider,
  providerName = null,
}) {
  const info = run(
    `INSERT INTO users (username, email, password_hash, display_name, language, is_provider, provider_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    username,
    email,
    passwordHash,
    pickDisplayName(displayName, display_name),
    language,
    (isProvider || is_provider) ? 1 : 0,
    providerName || null,
  );
  return findById(info.lastInsertRowid);
}

export function updateProfile(userId, { displayName, display_name, bio, car, city, avatar }) {
  run(
    `UPDATE users
        SET display_name = ?, bio = ?, car = ?, city = ?,
            avatar = COALESCE(?, avatar)
      WHERE id = ?`,
    pickDisplayName(displayName, display_name),
    bio || null,
    car || null,
    city || null,
    avatar || null,
    userId,
  );
  return findById(userId);
}

/**
 * Which letters the member wants.
 *
 * The weekly digest and the inspection reminder are two different
 * things, so they are two different switches.
 */
export function setMailPrefs(userId, { digest, pti }) {
  run(
    'UPDATE users SET mail_digest = ?, mail_pti = ? WHERE id = ?',
    digest ? 1 : 0,
    pti ? 1 : 0,
    userId,
  );
  return findById(userId);
}

export function updatePassword(userId, passwordHash) {  run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, userId);
}

/** Remember the interface language a member last picked. */
export function setLanguage(userId, language) {
  run('UPDATE users SET language = ? WHERE id = ?', language || null, userId);
}

/** Remember the interface theme a member last picked. */
export function setTheme(userId, theme) {
  run('UPDATE users SET theme = ? WHERE id = ?', theme || null, userId);
}

/** Remember the currency a member wants to read prices in. */
export function setCurrency(userId, currency) {
  run('UPDATE users SET currency = ? WHERE id = ?', currency || null, userId);
}

/** Mark a member as a shop / specialist, with an optional trading name. */
export function setProvider(userId, { isProvider, providerName }) {
  if (isProvider) {
    // Only update provider_name if explicitly provided
    if (providerName !== undefined) {
      run(
        'UPDATE users SET is_provider = ?, provider_name = ? WHERE id = ?',
        isProvider ? 1 : 0,
        providerName || null,
        userId,
      );
    } else {
      // Keep existing provider_name, just toggle is_provider
      run(
        'UPDATE users SET is_provider = ? WHERE id = ?',
        isProvider ? 1 : 0,
        userId,
      );
    }
  } else {
    // When disabling, clear provider_name
    run(
      'UPDATE users SET is_provider = 0, provider_name = NULL WHERE id = ?',
      userId,
    );
  }
  return findById(userId);
}

/* ── admin role ─────────────────────────────────────────────────── */

export const adminCount = () => get('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').n;

/** How many members have flagged themselves as shops / specialists. */
export const providerCount = () => get('SELECT COUNT(*) AS n FROM users WHERE is_provider = 1').n;

export const isAdmin = (id) => Boolean(get('SELECT 1 AS x FROM users WHERE id = ? AND is_admin = 1', id));

/** The ids of every admin - used to tell the admins about pending work. */
export const adminIds = () => all('SELECT id FROM users WHERE is_admin = 1').map((row) => row.id);

/** Grant or revoke the admin flag. Returns the fresh user row. */
export function setAdmin(id, flag) {
  run('UPDATE users SET is_admin = ? WHERE id = ?', flag ? 1 : 0, id);
  return findById(id);
}

/** Admin console listing: everyone, newest first, optional filter. */
export function adminList({ q = '', limit = 200, offset = 0 } = {}) {
  const term = String(q ?? '').trim();
  const params = { limit, offset };
  let where = '1 = 1';
  if (term) {
    params.like = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where = `(username LIKE :like ESCAPE '\\' OR display_name LIKE :like ESCAPE '\\'
              OR email LIKE :like ESCAPE '\\' OR city LIKE :like ESCAPE '\\')`;
  }
  return all(
    `SELECT u.id, u.username, u.email, u.display_name, u.avatar, u.car, u.city,
            u.is_admin, u.created_at,
            (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.group_id IS NULL) AS post_count,
            (SELECT COUNT(*) FROM meetups m WHERE m.host_id = u.id) AS meetup_count,
            (SELECT COUNT(*) FROM builds b WHERE b.user_id = u.id) AS build_count
       FROM users u
      WHERE ${where}
      ORDER BY u.is_admin DESC, u.created_at DESC
      LIMIT :limit OFFSET :offset`,
    params,
  );
}

/** Delete a driver. Related rows disappear through ON DELETE CASCADE. */
export const removeUser = (id) => run('DELETE FROM users WHERE id = ?', id);

/** Media files a user owns, so their uploads can be cleaned off disk. */
export const uploadsFor = (id) =>
  all(
    `SELECT avatar AS path FROM users WHERE id = ? AND avatar IS NOT NULL
     UNION ALL SELECT media_path AS path FROM posts WHERE user_id = ? AND media_path IS NOT NULL
     UNION ALL SELECT cover AS path FROM builds WHERE user_id = ? AND cover IS NOT NULL
     UNION ALL SELECT media_path AS path FROM build_media WHERE user_id = ? AND media_path IS NOT NULL
     UNION ALL SELECT media_path AS path FROM part_photos WHERE user_id = ? AND media_path IS NOT NULL
     UNION ALL SELECT cover AS path FROM services WHERE user_id = ? AND cover IS NOT NULL
     UNION ALL SELECT media_path AS path FROM messages WHERE sender_id = ? AND media_path IS NOT NULL`,
    id,
    id,
    id,
    id,
    id,
    id,
    id,
  )
    .map((row) => row.path)
    .filter(Boolean);

/**
 * People search. Matches username, display name, city or car, ranked
 * so exact username matches float to the top.
 */
export function search(term, { excludeId = 0, limit = 30 } = {}) {
  const q = String(term ?? '').trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  return all(
    `SELECT u.id, u.username, u.display_name, u.avatar, u.car, u.city,
            (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.group_id IS NULL) AS post_count,
            (SELECT COUNT(*) FROM friendships f
              WHERE f.status = 'accepted' AND (f.requester_id = u.id OR f.addressee_id = u.id)) AS friend_count
       FROM users u
      WHERE u.id <> :me
        AND (u.username LIKE :like ESCAPE '\\'
             OR u.display_name LIKE :like ESCAPE '\\'
             OR u.city LIKE :like ESCAPE '\\'
             OR u.car LIKE :like ESCAPE '\\')
      ORDER BY (u.username = :exact) DESC, friend_count DESC, u.username ASC
      LIMIT :limit`,
    { me: excludeId, like, exact: q.replace(/^@/, ''), limit },
  );
}

/**
 * Everybody on the network, for the list view.
 *
 * The suggestions are only twelve people; the list is the whole
 * network, newest members first, so nobody is hidden behind a search
 * box they have to know the name for.
 */
export function directory({ excludeId = 0, limit = 60, offset = 0 } = {}) {
  return all(
    `SELECT u.id, u.username, u.display_name, u.avatar, u.car, u.city,
            (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.group_id IS NULL) AS post_count
       FROM users u
      WHERE u.id <> :me
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT :limit OFFSET :offset`,
    { me: excludeId, limit, offset },
  );
}

/** How many drivers the network has. */
export const directoryCount = (excludeId = 0) =>
  get('SELECT COUNT(*) AS n FROM users WHERE id <> ?', excludeId)?.n ?? 0;

/** People you are not friends with yet, for the "find your group" block. */
export function suggestions(userId, limit = 6) {  return all(
    `SELECT u.id, u.username, u.display_name, u.avatar, u.car, u.city,
            (SELECT COUNT(*) FROM friendships f
              WHERE f.status = 'accepted' AND (f.requester_id = u.id OR f.addressee_id = u.id)) AS friend_count
       FROM users u
      WHERE u.id <> :me
        AND NOT EXISTS (
          SELECT 1 FROM friendships f
           WHERE (f.requester_id = :me AND f.addressee_id = u.id)
              OR (f.requester_id = u.id AND f.addressee_id = :me)
        )
      ORDER BY friend_count DESC, u.created_at DESC
      LIMIT :limit`,
    { me: userId, limit },
  );
}

export function stats(userId) {
  return get(
    `SELECT
       (SELECT COUNT(*) FROM posts WHERE user_id = :id AND group_id IS NULL) AS posts,
       (SELECT COUNT(*) FROM groups WHERE owner_id = :id) AS groups_owned,
       (SELECT COUNT(*) FROM group_members WHERE user_id = :id AND status = 'active') AS groups_joined,
       (SELECT COUNT(*) FROM meetups WHERE host_id = :id) AS meetups_hosted,
       (SELECT COUNT(*) FROM parts WHERE user_id = :id) AS parts,
       (SELECT COUNT(*) FROM services WHERE user_id = :id) AS services
     `,
    { id: userId },
  );
}

export const recentMembers = (limit = 8) =>
  all(
    `SELECT id, username, display_name, avatar, car, city
       FROM users ORDER BY created_at DESC LIMIT ?`,
    limit,
  );

export default {
  findById, findByUsername, findByLogin, findWithHash, usernameTaken, emailTaken,
  createUser, updateProfile, updatePassword, setLanguage, setTheme, setCurrency, setProvider, search, suggestions, stats,
  recentMembers, adminCount, providerCount, isAdmin, adminIds, setAdmin, adminList, removeUser, uploadsFor,
};
