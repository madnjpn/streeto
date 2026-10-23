import { all, get, run } from '../db.js';

export function subscribe(userId, endpoint, p256dh, auth) {
  run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    userId, endpoint, p256dh, auth,
  );
}

export function unsubscribe(endpoint) {
  run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
}

export const forUser = (userId) =>
  all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);

export const allSubs = () => all('SELECT * FROM push_subscriptions');

export default { subscribe, unsubscribe, forUser, allSubs };