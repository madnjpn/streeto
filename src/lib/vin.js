/**
 * VIN check.
 *
 * The VIN is read with the National Highway Traffic Safety
 * Administration's own vPIC service - a free, public API that needs no
 * key and no account. It says what the car is: the year, the make, the
 * model, the engine and a lot more.
 *
 * The VIN itself is checked first: the ninth character is a check digit
 * that is calculated from the others, so a mistyped number can be
 * caught before anything else happens.
 */

import { lookupChassis, lookupPlatform, PLATFORM_MAKES, inYears } from './chassis.js';
import { makeFromVin } from './wmi.js';
import { namesOf } from './twins.js';

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';

/** The letters a VIN may hold. */
const ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

/**
 * The value of every letter, as the check digit wants it. The numbers
 * keep their own value.
 */
const VALUES = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
};

/** The weights of the check digit, from the left. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Check a VIN the way the standard says: the ninth character is a
 * check digit over the others.
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkVin(vin) {
  const value = String(vin || '').trim().toUpperCase();
  if (value.length !== 17) {
    return { ok: false, reason: 'A VIN is 17 characters long.' };
  }
  for (const char of value) {
    if (!ALPHABET.includes(char)) {
      return { ok: false, reason: 'A VIN only holds letters and numbers - no I, O or Q.' };
    }
  }
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += (VALUES[value[i]] ?? 0) * WEIGHTS[i];
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  if (value[8] !== expected) {
    return { ok: false, reason: `The check digit does not match - it should be ${expected}.` };
  }
  return { ok: true, reason: '' };
}

/**
 * The year a VIN names in its tenth character. A letter or a digit
 * stands for two years thirty apart, so the year is the newest one that
 * is not in the future.
 */
const YEAR_CODES = {
  A: 1980, B: 1981, C: 1982, D: 1983, E: 1984, F: 1985, G: 1986, H: 1987,
  J: 1988, K: 1989, L: 1990, M: 1991, N: 1992, P: 1993, R: 1994, S: 1995,
  T: 1996, V: 1997, W: 1998, X: 1999, Y: 2000,
  1: 2001, 2: 2002, 3: 2003, 4: 2004, 5: 2005, 6: 2006, 7: 2007, 8: 2008,
  9: 2009,
};

/** The year the tenth character of a VIN names, or 0. */
export function yearFromVin(vin) {
  const code = String(vin || '').trim().toUpperCase()[9];
  const base = YEAR_CODES[code];
  if (!base) return 0;
  let year = base;
  const now = new Date().getFullYear();
  while (year + 30 <= now) year += 30;
  return year;
}

/**
 * Read a VIN as a number that may be one. Every market writes the same
 * seventeen characters with the same alphabet. The check digit in the
 * ninth place is a North American rule: a European VIN usually has a
 * letter of the model code there instead, so a VIN that fails the check
 * is still a VIN - it just cannot be checked for a mistyped character.
 */
export function readVin(value) {
  const vin = String(value || '').trim().toUpperCase();
  if (vin.length !== 17) return { ok: false, reason: 'A VIN is 17 characters long.' };
  for (const char of vin) {
    if (!ALPHABET.includes(char)) {
      return { ok: false, reason: 'A VIN only holds letters and numbers - no I, O or Q.' };
    }
  }
  const check = checkVin(vin);
  return {
    ok: true,
    vin,
    checkDigit: check.ok,
    warning: check.ok
      ? ''
      : 'The ninth character is not a check digit - outside North America it usually is not one.',
  };
}

/**
 * A chassis code - the short code a Japanese car carries instead of a
 * VIN ("GH-BP5", "EK9", "BN9"). It is shorter than a VIN and it has no
 * check digit, so it cannot be verified the way a VIN can.
 */
export const isChassisCode = (value) => {
  const code = String(value || '').trim().toUpperCase();
  if (!code || code.length >= 17) return false;
  if (!/^[A-Z0-9][A-Z0-9\s\-./]*$/.test(code)) return false;
  // At least one letter: a plain number is a part number, not a chassis.
  return /[A-Z]/.test(code);
};

/**
 * A frame number - a chassis code with a serial number behind it
 * ("GC8-012345", "JZX100-0012345"). This is what the maker's own
 * catalogue is written against.
 */
export const FRAME_PATTERN = /^([A-Z0-9]{2,8})-?([0-9]{4,8})$/;

/**
 * Split a frame number into its chassis code and its serial number.
 * A frame is written without a dash as often as with one, and the
 * digits of the code and of the serial run together ("DC1" + "1305656"
 * is "DC11305656"), so a code that is known by name is preferred - that
 * is what tells "DC1|1305656" from "DC1130|5656".
 * @param {string} value the number the driver typed
 * @param {(code: string) => boolean} [isKnown] knows a chassis code
 */
export function parseFrame(value, isKnown = () => false) {
  const raw = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const match = FRAME_PATTERN.exec(raw);
  if (!match) return null;
  // A VIN is 17 characters - it is never a frame number.
  if (raw.replace('-', '').length === 17) return null;
  // The chassis of a frame is a code, not a number.
  if (!/[A-Z]/.test(match[1])) return null;

  const digits = raw.replace(/-/g, '');
  const options = [];
  for (let size = 2; size <= 8 && size < digits.length; size += 1) {
    const chassis = digits.slice(0, size);
    const serial = digits.slice(size);
    if (!/[A-Z]/.test(chassis)) continue;
    if (!/^[0-9]{4,8}$/.test(serial)) continue;
    options.push({ chassis, serial, full: `${chassis}-${serial}`, known: isKnown(chassis) });
  }
  if (!options.length) return null;
  // The known code first; then the split a catalogue writes: a short
  // code and a six or seven digit serial.
  const best = options.find((row) => row.known)
    || options.find((row) => row.serial.length === 7)
    || options.find((row) => row.serial.length === 6)
    || options[options.length - 1];
  return { chassis: best.chassis, serial: best.serial, full: best.full };
}

/**
 * Clean a number the way the catalogues write them: no spaces, no
 * dashes, no dots, upper case. A part number is only unique together
 * with its brand, so the brand always travels with it.
 */
export const normalizeCode = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[\s\-.]+/g, '');

/**
 * What the driver typed: a full VIN, a frame number, a chassis code,
 * or something that is none of them.
 */
export function readIdentifier(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw.length === 17) {
    const vin = readVin(raw);
    if (!vin.ok) return { kind: 'invalid', reason: vin.reason };
    return {
      kind: 'vin',
      value: vin.vin,
      checkDigit: vin.checkDigit,
      warning: vin.warning,
    };
  }

  const frame = parseFrame(raw, (code) => Boolean(lookupChassis(code)));
  if (frame) {
    return {
      kind: 'frame',
      value: raw,
      chassis: frame.chassis,
      serial: frame.serial,
      full: frame.full,
      normalized: normalizeCode(frame.full),
    };
  }

  if (isChassisCode(raw)) {
    return { kind: 'chassis', value: raw, normalized: normalizeCode(raw) };
  }
  return {
    kind: 'invalid',
    reason: 'That is neither a 17 character VIN nor a chassis code.',
  };
}

/**
 * The model a car of the German group carries in the middle of its VIN.
 * Empty when the platform code is not known or does not fit the year.
 */
function platformModel(make, vin, year) {
  if (!PLATFORM_MAKES.includes(String(make || '').toUpperCase())) return '';
  const value = String(vin || '').toUpperCase();
  if (value.length !== 17) return '';
  const platform = lookupPlatform(value.slice(6, 8));
  if (!platform) return '';
  if (!inYears(platform.years, year)) return '';
  return platform.model;
}

/**
 * Read a VIN with the government service, or with the VIN itself.
 *
 * The service is the North American register. It knows the cars that
 * were sold there, and for a European or a Japanese car it often knows
 * the make and the year and no more. The tenth character of any VIN
 * names the year, so a car from another market is never refused: what
 * the register does not know is left for the driver to pick, in the
 * catalogue.
 */
export async function decodeVin(vin) {
  const read = readVin(vin);
  if (!read.ok) throw new Error(read.reason);
  const value = read.vin;

  const partly = (reason) => {
    // The register is the American one, and a car that was never sold
    // there is often not registered at all - a Renault comes back with
    // nothing. The first three characters of the VIN name the maker
    // even then.
    const guess = makeFromVin(value);
    const make = guess ? guess.make : '';
    const year = String(yearFromVin(value) || '');
    const model = platformModel(make, value, year);
    return {
      vin: value,
      year,
      make,
      model,
      plant: guess ? guess.country : '',
      partial: true,
      reason: guess ? 'unknown-model' : reason,
      checkDigit: read.checkDigit,
    };
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${VPIC}/DecodeVinValuesExtended/${encodeURIComponent(value)}?format=json`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return partly('unavailable');
    const data = await res.json();
    const row = data.Results?.[0];
    if (!row || !String(row.Make || '').trim()) return partly('unknown');

    const year = row.ModelYear || String(yearFromVin(value) || '');
    const make = row.Make || '';
    // The register knows the maker of a European car and rarely its
    // model - the platform code in the number often names it.
    const model = row.Model || platformModel(make, value, year);

    return {
      vin: value,
      year,
      make,
      model,
      trim: row.Trim || '',
      engine: row.EngineModel || '',
      cylinders: row.EngineCylinders || '',
      displacement: row.DisplacementL || '',
      drive: row.DriveType || '',
      body: row.BodyClass || '',
      doors: row.Doors || '',
      fuel: row.FuelTypePrimary || '',
      manufacturer: row.Manufacturer || '',
      plant: row.PlantCountry || '',
      errorCode: row.ErrorCode || '',
      errorText: row.ErrorText || '',
      // The register knows the make of a car from another market but
      // rarely its model - the driver picks that in the catalogue.
      partial: !model,
      reason: model ? '' : 'unknown-model',
      checkDigit: read.checkDigit,
    };
  } catch {
    return partly('unavailable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every name the catalogue may know the car by.
 *
 * Its own first, then the trim - a Mercedes C-Class is sold in the
 * catalogue as a C250, a BMW as a 328i - and then the names it carries
 * in other markets, because a Honda Integra is an Acura there.
 *
 * @returns {Array<{ make: string, model: string }>}
 */
export function namesFor(car = {}) {
  const up = (value) => String(value || '').trim().toUpperCase();
  const plain = (value) => up(value).replace(/[^A-Z0-9]/g, '');
  const out = [];
  const add = (make, model) => {
    const wantedMake = up(make);
    const wantedModel = up(model);
    if (!wantedMake) return;
    if (out.some((one) => up(one.make) === wantedMake && up(one.model) === wantedModel)) return;
    out.push({ make: String(make).trim(), model: String(model || '').trim() });
  };

  add(car.make, car.model);
  // A two letter trim is not a model - it would match half the list.
  if (plain(car.trim).length >= 4) add(car.make, car.trim);
  if (car.make && car.model) {
    for (const twin of namesOf(car.make, car.model)) add(twin.make, twin.model);
  }
  return out;
}

export default { checkVin, readVin, yearFromVin, decodeVin, namesFor };
