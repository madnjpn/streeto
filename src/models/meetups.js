import { all, get, run } from '../db.js';

/**
 * Meetups.
 *
 * privacy:
 *   open    - listed publicly, anyone can join instantly
 *   private - listed publicly, joining sends a request the host approves
 *   invite  - hidden; only invited members count as attendees
 *
 * Location can come from a street-name search or the device GPS - both
 * arrive here as lat/lng plus an optional place name.
 *
 * A "touge" meetup is a mountain run: instead of (or as well as) the
 * meeting spot it carries a route - a start (A) and a finish (B) - and
 * the length of that route in kilometres.
 */

const MEETUP_FIELDS = `
  m.*,
  u.username AS host_username, u.display_name AS host_display_name, u.avatar AS host_avatar,
  g.name AS group_name, g.slug AS group_slug,
  (SELECT COUNT(*) FROM meetup_attendees a WHERE a.meetup_id = m.id AND a.status IN ('going','invited')) AS going_count,
  (SELECT GROUP_CONCAT(u.avatar, ',') FROM meetup_attendees a JOIN users u ON u.id = a.user_id WHERE a.meetup_id = m.id AND a.status IN ('going','invited')) AS going_avatars,
  (SELECT COUNT(*) FROM meetup_attendees a WHERE a.meetup_id = m.id AND a.status = 'maybe') AS maybe_count,
  (SELECT COUNT(*) FROM meetup_attendees a WHERE a.meetup_id = m.id AND a.status = 'requested') AS request_count
`;

export const byId = (id) =>
  get(
    `SELECT ${MEETUP_FIELDS}
       FROM meetups m
       JOIN users u ON u.id = m.host_id
       LEFT JOIN groups g ON g.id = m.group_id
      WHERE m.id = ?`,
    id,
  );

export function createMeetup({
  hostId, title, description = null, placeName = null, address = null,
  lat = null, lng = null, zoom = null, startsAt, privacy = 'open', capacity = null, groupId = null,
  category = 'meetup', entryFee = null,
  routeStartLat = null, routeStartLng = null, routeStartName = null,
  routeEndLat = null, routeEndLng = null, routeEndName = null, routeDistanceKm = null,
  routeView = null,
}) {
  const info = run(
    `INSERT INTO meetups
       (host_id, group_id, title, description, place_name, address, lat, lng, zoom, starts_at, privacy, capacity, category, entry_fee,
        route_start_lat, route_start_lng, route_start_name, route_end_lat, route_end_lng, route_end_name, route_distance_km, route_view)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    hostId,
    groupId,
    title,
    description,
    placeName,
    address,
    lat,
    lng,
    zoom,
    startsAt,
    privacy,
    capacity,
    category,
    entryFee,
    routeStartLat,
    routeStartLng,
    routeStartName,
    routeEndLat,
    routeEndLng,
    routeEndName,
    routeDistanceKm,
    routeView,
  );
  // The host is automatically going.
  run(`INSERT INTO meetup_attendees (meetup_id, user_id, status) VALUES (?, ?, 'going')`, info.lastInsertRowid, hostId);
  return byId(info.lastInsertRowid);
}

export const remove = (id) => run('DELETE FROM meetups WHERE id = ?', id);

/**
 * Meetup list.
 *   scope: upcoming | past | mine | going | group | nearby
 * `fromLat`/`fromLng` enable the nearby sort.
 */
export function list({ scope = 'upcoming', viewerId = 0, groupId = 0, q = '', limit = 30, offset = 0 }) {
  const params = { me: viewerId, limit, offset };
  let where = '1 = 1';
  let order = 'm.starts_at ASC';

  switch (scope) {
    case 'past':
      where = "m.starts_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')";
      order = 'm.starts_at DESC';
      break;
    case 'mine':
      params.user = viewerId;
      where = 'm.host_id = :user';
      order = 'm.starts_at DESC';
      break;
    case 'going':
      where = `m.id IN (SELECT meetup_id FROM meetup_attendees WHERE user_id = :me AND status IN ('going','invited'))`;
      break;
    case 'group':
      params.group = groupId;
      where = 'm.group_id = :group';
      break;
    case 'upcoming':
    default:
      // Timestamps are fixed-width ISO strings, so a plain string
      // comparison is also a chronological one.
      where = "m.starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')";
      break;
  }

  // Invite-only meetups stay invisible unless you are the host or invited.
  where += ` AND (m.privacy <> 'invite' OR m.host_id = :me OR m.id IN (
              SELECT meetup_id FROM meetup_attendees WHERE user_id = :me))`;

  if (q) {
    params.like = `%${String(q).replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where += ` AND (m.title LIKE :like ESCAPE '\\' OR m.place_name LIKE :like ESCAPE '\\'
                    OR m.description LIKE :like ESCAPE '\\')`;
  }

  return all(
    `SELECT ${MEETUP_FIELDS}
       FROM meetups m
       JOIN users u ON u.id = m.host_id
       LEFT JOIN groups g ON g.id = m.group_id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT :limit OFFSET :offset`,
    params,
  );
}

export const countFor = ({ scope = 'upcoming', viewerId = 0, groupId = 0 }) => {
  const params = { me: viewerId };
  let where = "m.starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  if (scope === 'past') where = "m.starts_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  if (scope === 'mine') {
    params.user = viewerId;
    where = 'm.host_id = :user';
  }
  if (scope === 'going') {
    where = `m.id IN (SELECT meetup_id FROM meetup_attendees WHERE user_id = :me AND status IN ('going','invited'))`;
  }
  if (scope === 'group') {
    params.group = groupId;
    where = 'm.group_id = :group';
  }
  where += ` AND (m.privacy <> 'invite' OR m.host_id = :me OR m.id IN (
              SELECT meetup_id FROM meetup_attendees WHERE user_id = :me))`;
  return get(`SELECT COUNT(*) AS n FROM meetups m WHERE ${where}`, params).n;
};

/**
 * The badge a driver wears on the guest list: the car on their profile
 * when they have typed one, otherwise the newest public car in their
 * garage as "1998 BMW 316 I".
 */
function carLabel(row) {
  const own = String(row.car || '').trim();
  if (own) return own;
  const spec = [row.vehicle_year, [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' ')
    .trim();
  return spec || String(row.vehicle_name || '').trim() || null;
}

export const attendees = (meetupId, statuses = ['going', 'maybe', 'invited', 'requested']) => {
  const marks = statuses.map(() => '?').join(', ');
  const rows = all(
    `SELECT a.status, a.created_at, u.id, u.username, u.display_name, u.avatar, u.car, u.city,
            cv.name AS vehicle_name, cv.make AS vehicle_make, cv.model AS vehicle_model, cv.year AS vehicle_year
       FROM meetup_attendees a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN (
         SELECT user_id, name, make, model, year
           FROM (
             SELECT v.user_id, v.name, v.make, v.model, v.year,
                    ROW_NUMBER() OVER (PARTITION BY v.user_id ORDER BY v.created_at DESC) AS rn
               FROM vehicles v
              WHERE v.visibility = 'public'
           )
          WHERE rn = 1
       ) cv ON cv.user_id = u.id
      WHERE a.meetup_id = ? AND a.status IN (${marks})
      ORDER BY CASE a.status WHEN 'going' THEN 0 WHEN 'invited' THEN 1 WHEN 'maybe' THEN 2
                             WHEN 'requested' THEN 3 ELSE 4 END,
               u.username COLLATE NOCASE`,
    meetupId,
    ...statuses,
  );
  return rows.map((row) => ({ ...row, car_label: carLabel(row) }));
};

export const attendeeStatus = (meetupId, userId) =>
  get('SELECT status FROM meetup_attendees WHERE meetup_id = ? AND user_id = ?', meetupId, userId)?.status ?? null;

export function setStatus(meetupId, userId, status) {
  run(
    `INSERT INTO meetup_attendees (meetup_id, user_id, status) VALUES (?, ?, ?)
     ON CONFLICT(meetup_id, user_id) DO UPDATE SET status = excluded.status`,
    meetupId,
    userId,
    status,
  );
  return status;
}

export const removeAttendee = (meetupId, userId) =>
  run('DELETE FROM meetup_attendees WHERE meetup_id = ? AND user_id = ?', meetupId, userId);

/**
 * What does the "join" button do for this viewer?
 * Returns { action: 'join'|'request'|'accept'|'leave'|'none', label, status }
 */
export function joinability(meetup, viewerId) {
  if (!viewerId) return { action: 'none', label: 'Log in to join' };
  if (meetup.host_id === viewerId) return { action: 'none', label: 'You are hosting' };

  const status = attendeeStatus(meetup.id, viewerId);
  const full = meetup.capacity != null && meetup.going_count >= meetup.capacity;

  if (status === 'going') return { action: 'leave', label: 'Leave meetup', status };
  if (status === 'maybe') return { action: 'leave', label: 'Remove my maybe', status };
  if (status === 'requested') return { action: 'none', label: 'Request pending', status };
  if (status === 'invited') return { action: 'join', label: 'Accept invite', status };

  if (full) return { action: 'none', label: 'Meetup is full', status };
  if (meetup.privacy === 'invite') return { action: 'none', label: 'Invite only', status };
  if (meetup.privacy === 'private') return { action: 'request', label: 'Request to join', status };
  return { action: 'join', label: 'Join meetup', status };
}

/** Can this viewer open the meetup detail page? */
export function canView(meetup, viewerId) {
  if (!meetup) return false;
  if (meetup.privacy !== 'invite') return true;
  if (viewerId && meetup.host_id === viewerId) return true;
  if (!viewerId) return false;
  return ['going', 'maybe', 'invited'].includes(attendeeStatus(meetup.id, viewerId));
}

export default {
  byId, createMeetup, remove, list, countFor, attendees, attendeeStatus, setStatus,
  removeAttendee, joinability, canView,
};
