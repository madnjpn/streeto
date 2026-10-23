import config from '../config.js';
import * as vehicles from '../models/vehicles.js';
import * as builds from '../models/builds.js';
import { lookupPti, normalizePlate, ptiNeedsCheck } from './pti.js';

/**
 * Daily technical-inspection sweep.
 *
 * Adding a vehicle (or saving a build/plate) already checks pti.ge right
 * away. This background pass keeps every stored snapshot - for every member,
 * not just whoever happens to open My Ride - no older than
 * `PTI_REFRESH_HOURS` (24 by default).
 *
 * Lookups are grouped by plate so one car shared by a vehicle and a build is
 * fetched once, and they run a few at a time so a large garage does not open
 * hundreds of sockets at pti.ge in the same second.
 */

const BATCH = 3;

/** Plates that need a fresh lookup, with every row that should get the result. */
function collectStale(now) {
  const groups = new Map();
  const groupFor = (plate) => {
    if (!groups.has(plate)) {
      groups.set(plate, { plate, vehicleIds: new Set(), buildIds: new Set(), rows: [] });
    }
    return groups.get(plate);
  };

  const linked = new Map();
  for (const row of builds.listLinked()) {
    if (!linked.has(row.linked_vehicle_id)) linked.set(row.linked_vehicle_id, []);
    linked.get(row.linked_vehicle_id).push(row);
  }

  for (const vehicle of vehicles.listWithPlate()) {
    const plate = normalizePlate(vehicle.number_plate);
    if (!plate) continue;
    const group = groupFor(plate);
    group.vehicleIds.add(vehicle.id);
    group.rows.push(vehicle);
    for (const build of linked.get(vehicle.id) || []) {
      group.buildIds.add(build.id);
      group.rows.push(build);
    }
  }

  for (const build of builds.listWithPlate()) {
    const plate = normalizePlate(build.number_plate);
    if (!plate) continue;
    const group = groupFor(plate);
    group.buildIds.add(build.id);
    group.rows.push(build);
  }

  return [...groups.values()].filter((group) => group.rows.some((row) => ptiNeedsCheck(row, now)));
}

/**
 * Refresh every stale plate once. Returns a small summary; never throws for
 * an individual lookup (lookupPti stores `unknown` instead).
 */
export async function refreshStalePti({ now = Date.now() } = {}) {
  if (!config.ptiLookup) return { plates: 0, checked: 0 };

  const stale = collectStale(now);
  let checked = 0;

  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH);
    await Promise.all(batch.map(async (group) => {
      const result = await lookupPti(group.plate);
      if (!result) return;
      group.vehicleIds.forEach((id) => vehicles.setPti(id, result));
      group.buildIds.forEach((id) => builds.setPti(id, result));
      checked += 1;
    }));
  }

  if (checked) {
    console.log(`[pti] refreshed ${checked} of ${stale.length} due plate${stale.length === 1 ? '' : 's'}`);
  }
  return { plates: stale.length, checked };
}

/**
 * Start the daily sweep. The first pass runs shortly after boot so a restart
 * also picks up inspections that lapsed while the server was down; after
 * that it repeats every `PTI_SCAN_HOURS` (24 by default).
 * Returns a stop function (used by tests) or null when disabled.
 */
export function startPtiRefresh() {
  if (!config.ptiLookup || config.isTest) return null;

  const intervalMs = Math.max(1, Number(config.ptiScanHours) || 24) * 60 * 60 * 1000;
  const run = () => {
    refreshStalePti().catch((error) => {
      console.warn('[pti] daily sweep failed:', error?.message || error);
    });
  };

  const first = setTimeout(run, 45 * 1000);
  const timer = setInterval(run, intervalMs);
  first.unref?.();
  timer.unref?.();

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export default { refreshStalePti, startPtiRefresh };
