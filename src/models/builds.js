import { all, count, get, run } from '../db.js';
import { removeUploadIfUnused } from '../lib/media-refs.js';
import { CERTIFICATE_COLUMNS, certificateSpecs } from '../lib/certificate.js';
import {
  weekKey, weekToMonthKey, currentWeek, currentMonth, currentYear,
} from '../lib/periods.js';

/**
 * Builds: members upload their cars with photos, clips and a spec
 * sheet, then vote for the build of the week.
 *
 * The voting model is deliberately simple:
 *   - one vote per member per ISO week (the primary key enforces it)
 *   - the most-voted build of a *closed* week is Build of the Week
 *   - four weekly wins inside one calendar month -> Build of the Month
 *   - a build whose yearly win count beats the field's average ->
 *     Build of the Year
 *
 * Awards are derived, never hand-written: recomputeAwards() replays the
 * vote history and is safe to call on every request (it is idempotent).
 */

// Every build query needs the viewer's week to show the live tally, so
// :viewer and :week are always part of the parameter set.
export const BUILD_SELECT = `
  SELECT b.*,
         u.username, u.display_name, u.avatar,
         (SELECT COUNT(*) FROM build_media bm WHERE bm.build_id = b.id) AS media_count,
         (SELECT COUNT(*) FROM build_votes bv WHERE bv.build_id = b.id) AS vote_count,
         (SELECT COUNT(*) FROM build_votes bv WHERE bv.build_id = b.id AND bv.week = :week) AS week_votes,
         (SELECT COUNT(*) FROM build_watchers bw WHERE bw.build_id = b.id) AS watcher_count,
         EXISTS (SELECT 1 FROM build_votes bv WHERE bv.build_id = b.id AND bv.user_id = :viewer AND bv.week = :week) AS voted_this_week,
         EXISTS (SELECT 1 FROM build_watchers bw WHERE bw.build_id = b.id AND bw.user_id = :viewer) AS watching
    FROM builds b
    JOIN users u ON u.id = b.user_id
`;

/** Where clause per gallery scope. Params must match the SQL exactly. */
function scopeWhere(scope, { viewerId, userId }) {
  switch (scope) {
    case 'mine':
      return { where: 'b.user_id = :viewer', params: { viewer: viewerId } };
    case 'user':
      return {
        where: 'b.user_id = :user AND (b.visibility = \'public\' OR b.user_id = :viewer)',
        params: { user: userId || viewerId, viewer: viewerId },
      };
    case 'winners':
      return {
        where: `b.visibility = 'public'
                AND EXISTS (SELECT 1 FROM build_awards ba WHERE ba.build_id = b.id)`,
        params: {},
      };
    case 'sale':
      // Only public builds go on the market, even if a private one was
      // ticked "for sale" - the flag is kept, the listing is not shown.
      return { where: `b.visibility = 'public' AND b.for_sale = 1`, params: {} };
    case 'public':
    default:
      return { where: `b.visibility = 'public'`, params: {} };
  }
}

export function feed({ scope = 'public', viewerId = 0, userId = 0, sort = 'new', limit = 18, offset = 0 } = {}) {
  const { where, params } = scopeWhere(scope, { viewerId, userId });
  const order =
    sort === 'top' ? 'vote_count DESC, b.created_at DESC, b.id DESC'
      : sort === 'week' ? 'week_votes DESC, vote_count DESC, b.created_at DESC'
        : 'b.created_at DESC, b.id DESC';

  return all(
    `${BUILD_SELECT} WHERE ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
    { ...params, viewer: params.viewer ?? viewerId, week: currentWeek(), limit, offset },
  );
}

export function countFor({ scope = 'public', viewerId = 0, userId = 0 } = {}) {
  const { where, params } = scopeWhere(scope, { viewerId, userId });
  return get(`SELECT COUNT(*) AS n FROM builds b WHERE ${where}`, params)?.n ?? 0;
}

export const byId = (id, viewerId = 0) =>
  get(`${BUILD_SELECT} WHERE b.id = :id`, { id, viewer: viewerId, week: currentWeek() });

export const media = (buildId) =>
  all('SELECT * FROM build_media WHERE build_id = ? ORDER BY position ASC, id ASC', buildId);

export const mediaById = (mediaId) => get('SELECT * FROM build_media WHERE id = ?', mediaId);

/* ── row writing ──────────────────────────────────────────────── */

// camelCase form/model keys -> snake_case columns. The certificate set is
// also the registration data a build can copy from a My Ride vehicle.
const BASE_COLUMNS = {
  title: 'title',
  make: 'make',
  model: 'model',
  year: 'year',
  engine: 'engine',
  drivetrain: 'drivetrain',
  transmission: 'transmission',
  powerHp: 'power_hp',
  torqueNm: 'torque_nm',
  weightKg: 'weight_kg',
  odometerKm: 'odometer_km',
  mods: 'mods',
  description: 'description',
  visibility: 'visibility',
  forSale: 'for_sale',
  price: 'price',
  currency: 'currency',
  priceNote: 'price_note',
  cover: 'cover',
  linkedVehicleId: 'linked_vehicle_id',
};

const BUILD_COLUMNS = { ...BASE_COLUMNS, ...CERTIFICATE_COLUMNS };

const writeValue = (key, value) => {
  if (key === 'forSale') return value ? 1 : 0;
  if (key === 'currency') return value || 'GEL';
  if (key === 'visibility') return value || 'public';
  return value ?? null;
};

export function createBuild(data) {
  const keys = Object.keys(BUILD_COLUMNS);
  const info = run(
    `INSERT INTO builds (user_id, ${keys.map((key) => BUILD_COLUMNS[key]).join(', ')})
     VALUES (?, ${keys.map(() => '?').join(', ')})`,
    data.userId,
    ...keys.map((key) => writeValue(key, data[key])),
  );
  return info.lastInsertRowid;
}

export function updateBuild(id, data) {
  const keys = Object.keys(BUILD_COLUMNS).filter((key) => key !== 'cover');
  const sets = keys.map((key) => `${BUILD_COLUMNS[key]} = ?`);
  sets.push('cover = COALESCE(?, cover)');
  run(
    `UPDATE builds
        SET ${sets.join(', ')},
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    ...keys.map((key) => writeValue(key, data[key])),
    data.cover ?? null,
    id,
  );
}

/** Build-shaped copy of a vehicle's registration certificate. The derived
 *  engine / hp / weight values keep the public spec sheet in step with the
 *  paper document. */
export function certificateToBuild(vehicle) {
  if (!vehicle) return {};
  const { engine, powerHp, weightKg } = certificateSpecs({
    engineCapacity: vehicle.engine_capacity,
    fuelType: vehicle.fuel_type,
    netPowerKw: vehicle.net_power_kw,
    unladenMass: vehicle.unladen_mass,
  });
  return {
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    powerHp,
    weightKg,
    numberPlate: vehicle.number_plate,
    technicalPassport: vehicle.technical_passport,
    registrationDate: vehicle.registration_date,
    ownerSurname: vehicle.owner_surname,
    ownerName: vehicle.owner_name,
    ownerAddress: vehicle.owner_address,
    ownerId: vehicle.owner_id,
    ownerOfVehicle: vehicle.owner_of_vehicle,
    expiryDate: vehicle.expiry_date,
    vehicleType: vehicle.vehicle_type,
    vin: vehicle.vin,
    maxLadenMass: vehicle.max_laden_mass,
    permissibleMass: vehicle.permissible_mass,
    unladenMass: vehicle.unladen_mass,
    engineCapacity: vehicle.engine_capacity,
    netPowerKw: vehicle.net_power_kw,
    fuelType: vehicle.fuel_type,
    engineNumber: vehicle.engine_number,
    powerWeightRatio: vehicle.power_weight_ratio,
    colour: vehicle.colour,
    seats: vehicle.seats,
    standingPlaces: vehicle.standing_places,
  };
}

/** Copy certificate fields into a build. Only fields the certificate
 *  actually provides are written, so a sparse certificate never blanks
 *  out values the owner typed by hand. */
export function applyCertificate(buildId, fields) {
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(CERTIFICATE_COLUMNS)) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (!sets.length) return false;
  params.push(buildId);
  run(
    `UPDATE builds SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ...params,
  );
  return true;
}

/** Remember which My Ride vehicle a build was linked to. */
export function setLinkedVehicle(buildId, vehicleId) {
  run(
    `UPDATE builds
        SET linked_vehicle_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    vehicleId ?? null,
    buildId,
  );
}

/** Store the odometer reading (used when My Ride changes it). */
export function setOdometer(buildId, km) {
  run(
    `UPDATE builds
        SET odometer_km = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    Number.isFinite(Number(km)) ? Number(km) : null,
    buildId,
  );
}

/** Every build that carries a plate, for the daily inspection sweep. */
export const listWithPlate = () =>
  all(`SELECT * FROM builds
        WHERE number_plate IS NOT NULL AND TRIM(number_plate) <> ''`);

/** Builds linked to a My Ride vehicle (even when the build has no plate). */
export const listLinked = () =>
  all(`SELECT id, linked_vehicle_id, number_plate, pti_status, pti_plate, pti_checked_at
         FROM builds
        WHERE linked_vehicle_id IS NOT NULL`);

/** Standalone builds with a plate or a stored inspection result. */
export const listPtiAlerts = () =>
  all(`SELECT id, user_id, title AS name, number_plate, linked_vehicle_id,
              pti_status, pti_plate, pti_expires_at, pti_alert_key, pti_reminded_at
         FROM builds
        WHERE linked_vehicle_id IS NULL
          AND ((number_plate IS NOT NULL AND TRIM(number_plate) <> '')
            OR pti_expires_at IS NOT NULL
            OR pti_status IS NOT NULL)`);

/** Remember which inspection alert has already been sent for a build. */
export const setPtiAlertKey = (buildId, key) =>
  run('UPDATE builds SET pti_alert_key = ? WHERE id = ?', key || null, buildId);

/** Remember when the owner was last reminded about an expired inspection. */
export const setPtiRemindedAt = (buildId, at) =>
  run('UPDATE builds SET pti_reminded_at = ? WHERE id = ?', at || null, buildId);

/** Store the latest pti.ge snapshot for a build. */
export function setPti(buildId, result) {
  const status = ['valid', 'expired', 'unknown'].includes(result?.status) ? result.status : null;
  run(
    `UPDATE builds
        SET pti_status = ?, pti_plate = ?, pti_inspected_at = ?, pti_expires_at = ?,
            pti_checked_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    status,
    result?.plate ?? null,
    result?.inspectedAt ?? null,
    result?.expiresAt ?? null,
    result?.checkedAt ?? null,
    buildId,
  );
}

/** Delete a build plus every file it owns. Owner or a site admin. */
export function removeBuild(id, viewerId, { asModerator = false } = {}) {
  const build = get('SELECT id, user_id FROM builds WHERE id = ?', id);
  if (!build || (build.user_id !== viewerId && !asModerator)) return false;
  const files = all('SELECT media_path FROM build_media WHERE build_id = ?', id).map((r) => r.media_path);
  run('DELETE FROM builds WHERE id = ?', id);
  // Photos can be shared (a garage vehicle may use this build's cover),
  // so only delete files nothing else points at any more.
  files.forEach((file) => removeUploadIfUnused(file));
  return true;
}

export function addMedia({ buildId, userId, mediaType, mediaPath, caption = null, position = 0 }) {
  run(
    `INSERT INTO build_media (build_id, user_id, media_type, media_path, caption, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
    buildId,
    userId,
    mediaType,
    mediaPath,
    caption,
    position,
  );
  return media(buildId);
}

export function removeMedia(mediaId, viewerId) {
  const item = get('SELECT id, build_id, user_id, media_path FROM build_media WHERE id = ?', mediaId);
  if (!item || item.user_id !== viewerId) return false;
  run('DELETE FROM build_media WHERE id = ?', mediaId);
  removeUploadIfUnused(item.media_path);
  return true;
}

/* ── voting ───────────────────────────────────────────────────── */

/** Vote for a build this week. Re-voting for it withdraws the vote. */
export function vote(buildId, userId, week = currentWeek()) {
  const existing = get('SELECT build_id FROM build_votes WHERE user_id = ? AND week = ?', userId, week);
  if (existing && existing.build_id === buildId) {
    run('DELETE FROM build_votes WHERE user_id = ? AND week = ?', userId, week);
    return { voted: false, moved: false };
  }
  const moved = Boolean(existing);
  run(
    `INSERT INTO build_votes (build_id, user_id, week) VALUES (?, ?, ?)
     ON CONFLICT (user_id, week) DO UPDATE SET build_id = excluded.build_id`,
    buildId,
    userId,
    week,
  );
  return { voted: true, moved };
}

export const myVote = (userId, week = currentWeek()) =>
  get(
    `SELECT bv.build_id, b.title
       FROM build_votes bv JOIN builds b ON b.id = bv.build_id
      WHERE bv.user_id = ? AND bv.week = ?`,
    userId,
    week,
  ) ?? null;

/* ── watching a build ─────────────────────────────────────────── */

/**
 * Follow / unfollow a build. A watcher is pinged the day the car goes
 * up for sale, so anyone can keep an eye on the car they want without
 * checking back. Returns true when the build is now being watched.
 */
export function toggleWatch(buildId, userId) {
  const existing = get(
    'SELECT 1 AS x FROM build_watchers WHERE build_id = ? AND user_id = ?',
    buildId,
    userId,
  );
  if (existing) {
    run('DELETE FROM build_watchers WHERE build_id = ? AND user_id = ?', buildId, userId);
    return false;
  }
  run('INSERT INTO build_watchers (build_id, user_id) VALUES (?, ?)', buildId, userId);
  return true;
}

export const isWatching = (buildId, userId) =>
  Boolean(get('SELECT 1 AS x FROM build_watchers WHERE build_id = ? AND user_id = ?', buildId, userId));

/** Who to ping: everyone following the build except the owner. */
export const watchers = (buildId, excludeUserId = 0) =>
  all(
    'SELECT user_id FROM build_watchers WHERE build_id = ? AND user_id <> ?',
    buildId,
    excludeUserId,
  );

/** Live standings for the current (still open) week. */
export const leaderboard = (week = currentWeek(), limit = 10) =>
  all(
    `SELECT b.id, b.title, b.cover, b.make, b.model, b.user_id,
            u.username, u.display_name, u.avatar,
            COUNT(*) AS votes
       FROM build_votes bv
       JOIN builds b ON b.id = bv.build_id
       JOIN users u ON u.id = b.user_id
      WHERE bv.week = :week AND b.visibility = 'public'
      GROUP BY bv.build_id
      ORDER BY votes DESC, b.id ASC
      LIMIT :limit`,
    { week, limit },
  );

export const awardsFor = (buildId) =>
  all(`SELECT * FROM build_awards WHERE build_id = ? ORDER BY period DESC`, buildId);

/** Most recent winners of a kind, newest period first. */
export const recentAwards = (kind, limit = 3) =>
  all(
    `SELECT ba.*, b.title, b.cover, b.make, b.model,
            u.username, u.display_name, u.avatar
       FROM build_awards ba
       JOIN builds b ON b.id = ba.build_id
       JOIN users u ON u.id = b.user_id
      WHERE ba.kind = :kind AND b.visibility = 'public'
      ORDER BY ba.period DESC
      LIMIT :limit`,
    { kind, limit },
  );

export const awardFor = (kind, period) =>
  get(
    `SELECT ba.*, b.title, b.cover, b.user_id, u.username, u.display_name, u.avatar
       FROM build_awards ba
       JOIN builds b ON b.id = ba.build_id
       JOIN users u ON u.id = b.user_id
      WHERE ba.kind = ? AND ba.period = ?`,
    kind,
    period,
  ) ?? null;

/* ── award computation ────────────────────────────────────────── */

const upsertAward = (buildId, kind, period, votes) => {
  const existing = get('SELECT build_id, votes FROM build_awards WHERE kind = ? AND period = ?', kind, period);
  if (existing && existing.build_id === buildId && existing.votes === votes) return;
  run(
    `INSERT INTO build_awards (build_id, kind, period, votes) VALUES (?, ?, ?, ?)
     ON CONFLICT (kind, period) DO UPDATE SET build_id = excluded.build_id, votes = excluded.votes`,
    buildId,
    kind,
    period,
    votes,
  );
};

/**
 * Replay the vote history into build_awards. Only *closed* periods are
 * decided, so the week currently being voted on stays open. Idempotent.
 */
export function recomputeAwards(now = new Date()) {
  const curWeek = weekKey(now);
  const curMonth = currentMonth();
  const curYear = currentYear();

  // 1. Weekly winners: the most-voted build of every finished week.
  const weeks = all('SELECT DISTINCT week FROM build_votes')
    .map((row) => row.week)
    .filter((week) => week < curWeek)
    .sort();

  for (const week of weeks) {
    const winner = get(
      `SELECT build_id, COUNT(*) AS votes
         FROM build_votes
        WHERE week = ?
        GROUP BY build_id
        ORDER BY votes DESC, build_id ASC
        LIMIT 1`,
      week,
    );
    if (winner) upsertAward(winner.build_id, 'week', week, winner.votes);
  }

  // 2. Monthly winners: four weekly wins in one calendar month.
  const monthWins = new Map(); // month -> Map(buildId -> wins)
  for (const row of all(`SELECT build_id, period FROM build_awards WHERE kind = 'week'`)) {
    const month = weekToMonthKey(row.period);
    if (!month || month >= curMonth) continue;
    if (!monthWins.has(month)) monthWins.set(month, new Map());
    const perBuild = monthWins.get(month);
    perBuild.set(row.build_id, (perBuild.get(row.build_id) ?? 0) + 1);
  }
  for (const [month, perBuild] of [...monthWins.entries()].sort()) {
    const best = [...perBuild.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (best && best[1] >= 4) upsertAward(best[0], 'month', month, best[1]);
  }

  // 3. Yearly winner: beats the average win count of the rest of the field.
  const yearWins = new Map(); // year -> Map(buildId -> wins)
  for (const row of all(`SELECT build_id, period FROM build_awards WHERE kind = 'week'`)) {
    const year = String(row.period).slice(0, 4);
    if (year >= curYear) continue;
    if (!yearWins.has(year)) yearWins.set(year, new Map());
    const perBuild = yearWins.get(year);
    perBuild.set(row.build_id, (perBuild.get(row.build_id) ?? 0) + 1);
  }
  for (const [year, perBuild] of [...yearWins.entries()].sort()) {
    const entries = [...perBuild.entries()];
    if (entries.length < 2) {
      // Only one build ever won a week: it did not beat an average.
      continue;
    }
    const average = entries.reduce((sum, [, wins]) => sum + wins, 0) / entries.length;
    const best = entries
      .filter(([, wins]) => wins > average)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (best) upsertAward(best[0], 'year', year, best[1]);
  }
}

/** Everything the leaderboards page needs, in one shot. */
export function hallOfFame() {
  return {
    week: awardFor('week', currentWeek()) ?? recentAwards('week', 1)[0] ?? null,
    month: recentAwards('month', 1)[0] ?? null,
    year: recentAwards('year', 1)[0] ?? null,
  };
}

export const countByUser = (userId) =>
  count('builds', 'user_id = ?', userId);

export default {
  BUILD_SELECT, feed, countFor, byId, media, mediaById, createBuild, updateBuild,
  certificateToBuild, applyCertificate, setLinkedVehicle, setOdometer,
  listWithPlate, listLinked,
  listPtiAlerts, setPtiAlertKey, setPtiRemindedAt,
  removeBuild, addMedia, removeMedia, vote, myVote, toggleWatch, isWatching, watchers,
  leaderboard, awardsFor,
  recentAwards, awardFor, recomputeAwards, hallOfFame, countByUser,
};
