import { all, run } from '../db.js';

/** Remember (or reassign) one FCM installation token. */
export function upsert(userId, token, platform = 'android') {
  run(
    `INSERT INTO device_tokens (user_id, token, platform)
     VALUES (?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       platform = excluded.platform,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    userId,
    token,
    platform,
  );
}

export const remove = (token) => run('DELETE FROM device_tokens WHERE token = ?', token);

export const forUser = (userId) =>
  all('SELECT token, platform FROM device_tokens WHERE user_id = ?', userId);

export const allTokens = () => all('SELECT token FROM device_tokens');

/** Drop tokens Firebase says are no longer valid. */
export function removeMany(tokens) {
  if (!tokens.length) return;
  run(
    `DELETE FROM device_tokens WHERE token IN (${tokens.map(() => '?').join(',')})`,
    ...tokens,
  );
}

export default { upsert, remove, forUser, allTokens, removeMany };
