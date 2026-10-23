import { cleanText } from './validate.js';

/**
 * Every field printed on a Georgian registration certificate (tech
 * passport), read from a submitted form. Both My Ride vehicles and builds
 * accept the same document, so the parsing lives in one place.
 *
 * Keys are camelCase; the models map them onto snake_case columns.
 */

/** Shared certificate/model keys -> SQLite columns on builds and vehicles. */
export const CERTIFICATE_COLUMNS = {
  make: 'make',
  model: 'model',
  year: 'year',
  engine: 'engine',
  powerHp: 'power_hp',
  weightKg: 'weight_kg',
  numberPlate: 'number_plate',
  technicalPassport: 'technical_passport',
  registrationDate: 'registration_date',
  ownerSurname: 'owner_surname',
  ownerName: 'owner_name',
  ownerAddress: 'owner_address',
  ownerId: 'owner_id',
  ownerOfVehicle: 'owner_of_vehicle',
  expiryDate: 'expiry_date',
  vehicleType: 'vehicle_type',
  vin: 'vin',
  maxLadenMass: 'max_laden_mass',
  permissibleMass: 'permissible_mass',
  unladenMass: 'unladen_mass',
  engineCapacity: 'engine_capacity',
  netPowerKw: 'net_power_kw',
  fuelType: 'fuel_type',
  engineNumber: 'engine_number',
  powerWeightRatio: 'power_weight_ratio',
  colour: 'colour',
  seats: 'seats',
  standingPlaces: 'standing_places',
};

const certText = (body, key, max = 80) => cleanText(body[key] ?? '', max) || null;

const certInt = (body, key) => {
  const raw = body[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : null;
};

const certDecimal = (body, key) => {
  const raw = body[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export function certificateFields(body) {
  return {
    numberPlate: certText(body, 'number_plate', 20),
    technicalPassport: certText(body, 'technical_passport', 40),
    year: certInt(body, 'year'),
    make: certText(body, 'make', 40),
    model: certText(body, 'model', 40),
    registrationDate: certText(body, 'registration_date', 20),
    ownerSurname: certText(body, 'owner_surname'),
    ownerName: certText(body, 'owner_name'),
    ownerAddress: certText(body, 'owner_address', 200),
    ownerId: certText(body, 'owner_id', 40),
    ownerOfVehicle: certText(body, 'owner_of_vehicle', 120),
    expiryDate: certText(body, 'expiry_date', 20),
    vehicleType: certText(body, 'vehicle_type', 40),
    vin: certText(body, 'vin', 40),
    maxLadenMass: certInt(body, 'max_laden_mass'),
    permissibleMass: certInt(body, 'permissible_mass'),
    unladenMass: certInt(body, 'unladen_mass'),
    engineCapacity: certInt(body, 'engine_capacity'),
    netPowerKw: certInt(body, 'net_power_kw'),
    fuelType: certText(body, 'fuel_type', 40),
    engineNumber: certText(body, 'engine_number', 60),
    powerWeightRatio: certDecimal(body, 'power_weight_ratio'),
    colour: certText(body, 'colour', 40),
    seats: certInt(body, 'seats'),
    standingPlaces: certInt(body, 'standing_places'),
  };
}

/** The short spec line and hp figure My Ride shows for a certificate. */
export function certificateSpecs(fields) {
  const engine = fields.engineCapacity
    ? `${fields.engineCapacity} cm³${fields.fuelType ? ` ${fields.fuelType}` : ''}`
    : (fields.fuelType || null);
  const powerHp = fields.netPowerKw ? Math.round(fields.netPowerKw * 1.34102) : null;
  return { engine, powerHp, weightKg: fields.unladenMass || null };
}

export default { certificateFields, certificateSpecs };
