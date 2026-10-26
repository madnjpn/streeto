import config from '../config.js';
import * as notifications from '../models/notifications.js';
import * as vehicles from '../models/vehicles.js';
import * as builds from '../models/builds.js';
import { lookupFines, isFinesAvailable } from './fines.js';
import { ptiState, georgiaDate, normalizePlate } from './pti.js';

/**
 * Garage alerts: fines and technical inspection.
 *
 * Fines are checked every 12 hours by default. A new fine is announced
 * immediately; while unpaid fines remain, the owner gets a reminder at
 * most once a day. PTI alerts are sent before the inspection date and
 * repeated daily once it has expired. Both use the normal notification
 * row (the bell) and the member's push channels.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from today in Georgia to an ISO date, or null. */
export function daysUntil(date, now = new Date()) {
  if (!date) return null;
  const target = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${georgiaDate(now)}T00:00:00Z`);
  if (!Number.isFinite(target) || !Number.isFinite(today)) return null;
  return Math.round((target - today) / DAY_MS);
}

/** A stable key for one fine across checks. */
function fineKey(fine) {
  const base = fine?.protocolId ?? fine?.protocolNo ?? fine?.documentNo ?? '';
  const clean = String(base).trim();
  if (clean) return clean;
  return [
    fine?.automobileNo || '',
    fine?.violationDate || '',
    fine?.amount || '',
  ].join(':');
}

/** The amount shown/charged for a fine, in tetri. */
function fineAmount(fine) {
  const due = Number(fine?.amountToPay);
  if (Number.isFinite(due) && due > 0) return due;
  const amount = Number(fine?.amount);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * Record a lookup result against a vehicle. Returns the fines that were
 * not in the database before this check.
 */
export function rememberFines(vehicleId, result, { now = new Date() } = {}) {
  const list = Array.isArray(result?.fines) ? result.fines : [];
  const seen = new Set(vehicles.fineKeys(vehicleId));
  const fresh = [];
  let amount = 0;

  for (const fine of list) {
    const key = fineKey(fine);
    if (!key) continue;
    const value = fineAmount(fine);
    amount += value;
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push({ ...fine, key, amount: value });
    }
    vehicles.rememberFine(vehicleId, {
      key,
      protocolNo: fine.protocolNo || fine.protocolId || null,
      amount: value,
    });
  }

  vehicles.setFinesSnapshot(vehicleId, {
    checkedAt: now.toISOString(),
    count: list.length,
    amount,
  });
  return { fresh, count: list.length, amount };
}

/** Create one bell/push alert for new or still-unpaid fines. */
function announceFines(vehicle, { fresh = [], total = 0, reminder = false } = {}) {
  const count = reminder ? total : fresh.length;
  if (!count) return null;
  const name = vehicle.name || vehicle.number_plate || 'your car';
  const plural = count === 1 ? '' : 's';
  const text = reminder
    ? `You still have {n} unpaid fine{plural} for {name}|${count}|${plural}|${name}`
    : `You have {n} new fine{plural} for {name}|${count}|${plural}|${name}`;
  return notifications.notify({
    userId: vehicle.user_id,
    type: 'fine',
    entityId: vehicle.id,
    url: '/garage/fines',
    text,
    category: 'garage',
  });
}

/**
 * Check every car with a plate. The lookup itself is serialised by
 * fines.js, so this can safely walk the garage one car at a time.
 */
export async function checkFinesForAllVehicles({ lookup = lookupFines, now = new Date() } = {}) {
  const rows = vehicles.listForFines();
  if (!rows.length) return { checked: 0, newFines: 0, notified: 0 };

  const groups = new Map();
  for (const vehicle of rows) {
    const plate = normalizePlate(vehicle.number_plate);
    if (!plate) continue;
    const passport = String(vehicle.technical_passport || '').trim().toUpperCase();
    const key = `${plate}|${passport}`;
    if (!groups.has(key)) groups.set(key, { plate, passport, vehicles: [] });
    groups.get(key).vehicles.push(vehicle);
  }

  let checked = 0;
  let newFines = 0;
  let notified = 0;
  const reminderMs = Math.max(1, Number(config.finesReminderHours) || 24) * 60 * 60 * 1000;
  for (const group of groups.values()) {
    let result;
    try {
      result = await lookup({ plate: group.plate, passport: group.passport || undefined });
    } catch (error) {
      console.warn('[garage] fines check failed for', group.plate, error?.message || error);
      continue;
    }
    checked += 1;
    for (const vehicle of group.vehicles) {
      const { fresh, count } = rememberFines(vehicle.id, result, { now });
      newFines += fresh.length;
      const last = Date.parse(vehicle.fines_reminded_at || '') || 0;
      const reminderDue = count > 0 && (!last || now.getTime() - last >= reminderMs);
      if (fresh.length || reminderDue) {
        const reminder = !fresh.length;
        if (announceFines(vehicle, { fresh, total: count, reminder })) {
          vehicles.setFinesRemindedAt(vehicle.id, now.toISOString());
          notified += 1;
        }
      }
    }
  }

  if (newFines || notified) {
    console.log(`[garage] ${newFines} new fine(s), ${notified} vehicle alert(s)`);
  }
  return { checked, newFines, notified };
}

/** The notification for a current PTI state, or null. */
function ptiAlert(row, now) {
  const state = ptiState(row, now);
  const name = row.name || row.number_plate || 'your car';
  if (state.status === 'expired') {
    return {
      type: 'pti_expired',
      key: `expired:${state.expiresAt || 'unknown'}`,
      repeat: true,
      text: `Technical inspection for {name} has expired|${name}`,
    };
  }
  if (state.status === 'valid' && state.expiresAt) {
    const left = daysUntil(state.expiresAt, now);
    if (left === null || left < 0 || left > Math.max(1, config.ptiAlertDays)) return null;
    if (left === 0) {
      return {
        type: 'pti_expiring',
        key: `expiring:${state.expiresAt}`,
        repeat: false,
        text: `Technical inspection for {name} expires today|${name}`,
      };
    }
    return {
      type: 'pti_expiring',
      key: `expiring:${state.expiresAt}`,
      repeat: false,
      text: `Technical inspection for {name} expires in {n} day{plural}|${left}|${left === 1 ? '' : 's'}|${name}`,
    };
  }
  return null;
}

/**
 * Read the stored inspection dates and send a bell/push alert when a car
 * enters the reminder window or its inspection lapses. The alert key is
 * stored with the car so the same expiry is only announced once; an
 * expired inspection is then repeated on the reminder interval.
 */
export function notifyPtiAlerts({ now = new Date() } = {}) {
  const rows = [
    ...vehicles.listPtiAlerts().map((row) => ({ ...row, kind: 'vehicle' })),
    ...builds.listPtiAlerts().map((row) => ({ ...row, kind: 'build' })),
  ];
  const seen = new Set();
  let sent = 0;
  const reminderMs = Math.max(1, Number(config.ptiReminderHours) || 24) * 60 * 60 * 1000;

  for (const row of rows) {
    const plate = normalizePlate(row.number_plate) || normalizePlate(row.pti_plate);
    if (!plate) continue;
    // A build linked to a vehicle is excluded already; this also catches
    // two rows for the same car under one owner.
    const dedupe = `${row.user_id}:${plate}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const alert = ptiAlert(row, now);
    const key = alert?.key || null;
    if (!key) {
      // Inspection renewed or data cleared - reset so the next expiry talks.
      if (row.pti_alert_key) {
        if (row.kind === 'build') {
          builds.setPtiAlertKey(row.id, null);
          builds.setPtiRemindedAt(row.id, null);
        } else {
          vehicles.setPtiAlertKey(row.id, null);
          vehicles.setPtiRemindedAt(row.id, null);
        }
      }
      continue;
    }

    const last = Date.parse(row.pti_reminded_at || '') || 0;
    const reminderDue = alert.repeat && (!last || now.getTime() - last >= reminderMs);
    if (row.pti_alert_key === key && !reminderDue) continue;

    notifications.notify({
      userId: row.user_id,
      type: alert.type,
      entityId: row.id,
      url: row.kind === 'build' ? `/builds/${row.id}` : '/garage/ride',
      text: alert.text,
      category: 'garage',
    });
    if (row.kind === 'build') {
      builds.setPtiAlertKey(row.id, key);
      builds.setPtiRemindedAt(row.id, now.toISOString());
    } else {
      vehicles.setPtiAlertKey(row.id, key);
      vehicles.setPtiRemindedAt(row.id, now.toISOString());
    }
    sent += 1;
  }

  if (sent) console.log(`[garage] sent ${sent} inspection alert(s)`);
  return sent;
}

/** One pass of both garage checks. */
export async function runGarageAlerts({ lookup, now } = {}) {
  const pti = notifyPtiAlerts({ now: now || new Date() });
  if (!isFinesAvailable()) {
    console.warn('[garage] fines check skipped - no Edge/Chrome browser found');
    return { pti, fines: null };
  }
  const fines = await checkFinesForAllVehicles({ lookup, now: now || new Date() });
  return { pti, fines };
}

/**
 * Start the 12-hour garage sweep. The first pass waits two minutes so a
 * restart does not compete with requests and the PTI refresh at boot.
 */
export function startGarageAlerts() {
  if (config.isTest || !config.garageAlerts) return null;

  const intervalMs = Math.max(1, Number(config.finesScanHours) || 12) * 60 * 60 * 1000;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runGarageAlerts()
      .catch((error) => console.warn('[garage] sweep failed:', error?.message || error))
      .finally(() => { running = false; });
  };

  const first = setTimeout(run, 2 * 60 * 1000);
  const timer = setInterval(run, intervalMs);
  first.unref?.();
  timer.unref?.();

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export default {
  daysUntil,
  rememberFines,
  checkFinesForAllVehicles,
  notifyPtiAlerts,
  runGarageAlerts,
  startGarageAlerts,
};
