import { all, get, run, tx } from '../db.js';

/**
 * Underground nights.
 *
 * Underground is deliberately closed: the host creates a night, drivers ask
 * to join with the car/bike they will bring, and only the host's approval
 * unlocks the location, the map and race mode. Hosts are anonymous on the
 * public card; the approval card is the only place the host sees the
 * applicant's car and username.
 */

const EVENT_SELECT = `
  e.*,
  u.username AS host_username,
  u.display_name AS host_display_name,
  u.avatar AS host_avatar,
  (SELECT COUNT(*) FROM underground_requests r
     WHERE r.event_id = e.id AND r.status = 'approved') AS approved_count,
  (SELECT COUNT(*) FROM underground_requests r
     WHERE r.event_id = e.id AND r.status = 'requested') AS request_count
`;

export const byId = (id) =>
  get(
    `SELECT ${EVENT_SELECT}
       FROM underground_events e
       JOIN users u ON u.id = e.host_id
      WHERE e.id = ? AND e.deleted_at IS NULL`,
    id,
  );

export const listEvents = ({ limit = 60 } = {}) =>
  all(
    `SELECT ${EVENT_SELECT}
       FROM underground_events e
       JOIN users u ON u.id = e.host_id
      WHERE e.status <> 'cancelled' AND e.deleted_at IS NULL
      ORDER BY CASE e.status WHEN 'open' THEN 0 ELSE 1 END,
               e.starts_at DESC
      LIMIT ?`,
    limit,
  );

export function createEvent({
  hostId,
  title,
  description = null,
  type,
  startsAt,
  meetName = null,
  meetLat,
  meetLng,
  zoom = null,
  routeStartLat = null,
  routeStartLng = null,
  routeStartName = null,
  routeEndLat = null,
  routeEndLng = null,
  routeEndName = null,
  routeDistanceKm = null,
  hostCar = null,
  hostPhoto = null,
}) {
  const info = run(
    `INSERT INTO underground_events
       (host_id, title, description, type, starts_at, meet_name, meet_lat, meet_lng, zoom,
        route_start_lat, route_start_lng, route_start_name,
        route_end_lat, route_end_lng, route_end_name, route_distance_km)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    hostId,
    title,
    description,
    type,
    startsAt,
    meetName,
    meetLat,
    meetLng,
    zoom,
    routeStartLat,
    routeStartLng,
    routeStartName,
    routeEndLat,
    routeEndLng,
    routeEndName,
    routeDistanceKm,
  );
  // The host is always approved. There is nobody to approve them.
  run(
    `INSERT INTO underground_requests (event_id, user_id, car_model, car_photo, status, decided_at)
     VALUES (?, ?, ?, ?, 'approved', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    info.lastInsertRowid,
    hostId,
    hostCar,
    hostPhoto,
  );
  return byId(info.lastInsertRowid);
}

export const requestFor = (eventId, userId) =>
  get(
    `SELECT * FROM underground_requests WHERE event_id = ? AND user_id = ?`,
    eventId,
    userId,
  );

export const isApproved = (eventId, userId) =>
  Boolean(
    userId && get(
      `SELECT 1 AS x FROM underground_requests
        WHERE event_id = ? AND user_id = ? AND status = 'approved'`,
      eventId,
      userId,
    ),
  );

export function requestJoin(eventId, userId, { carModel = null, carPhoto = null } = {}) {
  const existing = requestFor(eventId, userId);
  if (existing?.status === 'approved') return existing;
  if (existing) {
    run(
      `UPDATE underground_requests
          SET car_model = ?, car_photo = ?, status = 'requested',
              created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), decided_at = NULL
        WHERE id = ?`,
      carModel,
      carPhoto,
      existing.id,
    );
  } else {
    run(
      `INSERT INTO underground_requests (event_id, user_id, car_model, car_photo)
       VALUES (?, ?, ?, ?)`,
      eventId,
      userId,
      carModel,
      carPhoto,
    );
  }
  return requestFor(eventId, userId);
}

export const requests = (eventId) =>
  all(
    `SELECT r.*, u.username, u.display_name, u.avatar, u.car
       FROM underground_requests r
       JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ?
      ORDER BY CASE r.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
               r.created_at ASC`,
    eventId,
  );

export const pendingRequests = (eventId) =>
  all(
    `SELECT r.*, u.username, u.display_name, u.avatar, u.car
       FROM underground_requests r
       JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ? AND r.status = 'requested'
      ORDER BY r.created_at ASC`,
    eventId,
  );

export function decideRequest(eventId, userId, status) {
  if (!['approved', 'rejected'].includes(status)) return null;
  run(
    `UPDATE underground_requests
        SET status = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE event_id = ? AND user_id = ?`,
    status,
    eventId,
    userId,
  );
  return requestFor(eventId, userId);
}

export const participants = (eventId) =>
  all(
    `SELECT r.user_id, r.car_model, r.car_photo, u.username, u.display_name, u.avatar,
            u.email, u.language, p.lat, p.lng, p.speed, p.heading, p.updated_at
       FROM underground_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN underground_positions p
         ON p.event_id = r.event_id AND p.user_id = r.user_id
      WHERE r.event_id = ? AND r.status = 'approved'
      ORDER BY r.user_id`,
    eventId,
  );

export const livePositions = (eventId) =>
  all(
    `SELECT r.user_id, u.username, u.display_name, u.avatar,
            p.lat, p.lng, p.speed, p.heading, p.updated_at
       FROM underground_positions p
       JOIN underground_requests r
         ON r.event_id = p.event_id AND r.user_id = p.user_id AND r.status = 'approved'
       JOIN users u ON u.id = p.user_id
      WHERE p.event_id = ?
      ORDER BY p.updated_at DESC`,
    eventId,
  );

export function savePosition(eventId, userId, { lat, lng, speed = null, heading = null }) {
  run(
    `INSERT INTO underground_positions (event_id, user_id, lat, lng, speed, heading, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(event_id, user_id) DO UPDATE SET
       lat = excluded.lat,
       lng = excluded.lng,
       speed = excluded.speed,
       heading = excluded.heading,
       updated_at = excluded.updated_at`,
    eventId,
    userId,
    lat,
    lng,
    speed,
    heading,
  );
}

export function saveRun({
  eventId,
  userId,
  mode,
  startedAt,
  finishedAt,
  topSpeed,
  avgSpeed,
  distanceKm,
  acceleration,
  durationS,
  track,
}) {
  const info = run(
    `INSERT INTO underground_runs
       (event_id, user_id, mode, started_at, finished_at, top_speed, avg_speed,
        distance_km, acceleration, duration_s, track_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId,
    userId,
    mode,
    startedAt,
    finishedAt,
    topSpeed,
    avgSpeed,
    distanceKm,
    acceleration,
    durationS,
    JSON.stringify(track || []),
  );
  return get('SELECT * FROM underground_runs WHERE id = ?', info.lastInsertRowid);
}

/** The newest run for compatibility. */
export const runFor = (eventId, userId) =>
  get(
    `SELECT * FROM underground_runs WHERE event_id = ? AND user_id = ?
      ORDER BY finished_at DESC, id DESC LIMIT 1`,
    eventId,
    userId,
  );

/** Every run one driver recorded at one event, newest first. */
export const runsForUserEvent = (eventId, userId) =>
  all(
    `SELECT * FROM underground_runs WHERE event_id = ? AND user_id = ?
      ORDER BY finished_at DESC, id DESC`,
    eventId,
    userId,
  );

/** Delete one driver's run summary. The event and everyone else stay. */
export const removeRun = (runId, userId) =>
  run('DELETE FROM underground_runs WHERE id = ? AND user_id = ?', runId, userId);

export const runsForEvent = (eventId) =>
  all(
    `SELECT r.*, u.username, u.display_name, u.avatar
       FROM underground_runs r
       JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ?
      ORDER BY r.finished_at ASC`,
    eventId,
  );

export const runsForUser = (userId) =>
  all(
    `SELECT r.*, e.title, e.type, e.starts_at, e.status, e.deleted_at, e.meet_name,
            e.meet_lat, e.meet_lng,
            e.route_start_lat, e.route_start_lng, e.route_end_lat, e.route_end_lng
       FROM underground_runs r
       JOIN underground_events e ON e.id = r.event_id
      WHERE r.user_id = ?
        AND (e.status = 'finished' OR e.deleted_at IS NOT NULL)
      ORDER BY r.finished_at DESC`,
    userId,
  );

export const finishEvent = (eventId) =>
  run(
    `UPDATE underground_events
        SET status = 'finished',
            finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND status <> 'finished'`,
    eventId,
  );

export const markSummarySent = (eventId, userId) =>
  run(
    `UPDATE underground_runs
        SET summary_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE event_id = ? AND user_id = ?`,
    eventId,
    userId,
  );

export const cancelEvent = (eventId) =>
  run(
    `UPDATE underground_events SET status = 'cancelled'
      WHERE id = ? AND status = 'open'`,
    eventId,
  );

/**
 * Delete a night from the network without destroying participant stats.
 * Meetup details, requests and live positions go away; the event row is
 * archived and its saved runs stay available in My Underground.
 */
export const removeEvent = (eventId) => tx(() => {
  run('DELETE FROM underground_positions WHERE event_id = ?', eventId);
  run('DELETE FROM underground_requests WHERE event_id = ?', eventId);
  return run(
    `UPDATE underground_events
        SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND deleted_at IS NULL`,
    eventId,
  );
});

export default {
  byId,
  listEvents,
  createEvent,
  requestFor,
  isApproved,
  requestJoin,
  requests,
  pendingRequests,
  decideRequest,
  participants,
  livePositions,
  savePosition,
  saveRun,
  runFor,
  runsForUserEvent,
  removeRun,
  runsForEvent,
  runsForUser,
  finishEvent,
  markSummarySent,
  cancelEvent,
  removeEvent,
};
