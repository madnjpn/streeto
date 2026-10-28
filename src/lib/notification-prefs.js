/**
 * Notification categories and per-member push preferences.
 *
 * The in-app activity feed is never filtered by these settings - a member
 * can always open the bell and catch up. These preferences only decide
 * whether a category may interrupt them on a phone or browser.
 */
import { get } from '../db.js';

export const NOTIFICATION_CATEGORIES = Object.freeze({
  messages: ['chat_mention'],
  social: ['friend_request', 'friend_accept', 'like', 'comment', 'comment_reaction'],
  groups: ['group_request', 'group_invite', 'group_approved'],
  meetups: [
    'meetup_new', 'meetup_request', 'meetup_join', 'meetup_invite',
    'meetup_approved', 'meetup_cancelled',
  ],
  underground: [
    'underground_event', 'underground_host', 'underground_request',
    'underground_approved', 'underground_rejected', 'underground_finished',
    'underground_summary', 'underground_cancelled',
  ],
  builds: ['build_sale', 'build_update', 'build_photo', 'build_vote'],
  services: ['service_claim', 'service_claim_approved', 'service_claim_rejected'],
  garage: ['fine', 'pti_expiring', 'pti_expired'],
});

export const NOTIFICATION_CATEGORY_KEYS = Object.keys(NOTIFICATION_CATEGORIES);

const TYPE_TO_CATEGORY = new Map(
  Object.entries(NOTIFICATION_CATEGORIES).flatMap(([category, types]) =>
    types.map((type) => [type, category]),
  ),
);

/** The category a notification type belongs to. */
export function categoryForType(type) {
  return TYPE_TO_CATEGORY.get(String(type || '')) || 'social';
}

/** All categories on by default; malformed stored JSON also means all on. */
export function normalizePrefs(raw) {
  let parsed = {};
  if (raw && typeof raw === 'object') parsed = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  const prefs = {};
  for (const key of NOTIFICATION_CATEGORY_KEYS) prefs[key] = parsed[key] !== false;
  return prefs;
}

export function prefsForUser(userId) {
  const row = get('SELECT notify_prefs FROM users WHERE id = ?', userId);
  return normalizePrefs(row?.notify_prefs);
}

export function pushAllowed(userId, category) {
  if (!category) return true;
  const prefs = prefsForUser(userId);
  return prefs[category] !== false;
}

export default {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  categoryForType,
  normalizePrefs,
  prefsForUser,
  pushAllowed,
};
