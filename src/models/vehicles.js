import { all, get, run } from '../db.js';
import { CERTIFICATE_COLUMNS } from '../lib/certificate.js';

export const create = ({ userId, name, make, model, year, engine, drivetrain, transmission, powerHp, torqueNm, weightKg, mods, description, visibility, photo, numberPlate, technicalPassport, currentMileage, oilChangeMileage, oilChangeInterval, linkedBuildId }) => {
  const result = run(
    `INSERT INTO vehicles (user_id, name, make, model, year, engine, drivetrain, transmission, power_hp, torque_nm, weight_kg, mods, description, visibility, photo, number_plate, technical_passport, current_mileage, oil_change_mileage, oil_change_interval, linked_build_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, name, make || null, model || null, year || null, engine || null, drivetrain || null, transmission || null, powerHp || null, torqueNm || null, weightKg || null, mods || null, description || null, visibility || 'public', photo || null, numberPlate || null, technicalPassport || null, currentMileage || 0, oilChangeMileage || null, oilChangeInterval || 5000, linkedBuildId || null,
  );
  return result.lastInsertRowid;
};

export const findById = (id) => get('SELECT * FROM vehicles WHERE id = ?', id);

export const listByUser = (userId) => all('SELECT * FROM vehicles WHERE user_id = ? ORDER BY created_at DESC', userId);

/** Every vehicle that carries a plate, for the daily inspection sweep. */
export const listWithPlate = () =>
  all(`SELECT * FROM vehicles
        WHERE number_plate IS NOT NULL AND TRIM(number_plate) <> ''`);

export const update = (id, fields) => {
  const sets = [];
  const params = [];
  for (const [key, val] of Object.entries(fields)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    sets.push(`${col} = ?`);
    params.push(val);
  }
  params.push(id);
  run(`UPDATE vehicles SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...params);
};

/** Copy certificate fields from a linked build. Non-empty values win, so a
 *  sparse build cannot wipe details the vehicle still holds. */
export function applyCertificate(vehicleId, fields) {
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(CERTIFICATE_COLUMNS)) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (!sets.length) return false;
  params.push(vehicleId);
  run(
    `UPDATE vehicles SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    ...params,
  );
  return true;
}

/** Store the latest pti.ge snapshot for a vehicle. */
export function setPti(vehicleId, result) {
  const status = ['valid', 'expired', 'unknown'].includes(result?.status) ? result.status : null;
  run(
    `UPDATE vehicles
        SET pti_status = ?, pti_plate = ?, pti_inspected_at = ?, pti_expires_at = ?,
            pti_checked_at = ?, updated_at = datetime('now')
      WHERE id = ?`,
    status,
    result?.plate ?? null,
    result?.inspectedAt ?? null,
    result?.expiresAt ?? null,
    result?.checkedAt ?? null,
    vehicleId,
  );
}

export const remove = (id) => run('DELETE FROM vehicles WHERE id = ?', id);
