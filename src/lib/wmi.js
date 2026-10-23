/**
 * The maker of a VIN.
 *
 * The first three characters of a VIN are the World Manufacturer
 * Identifier: they name who built the car. The American register knows
 * most of them, but a car that was never sold in America is often not
 * registered at all - a Renault or a Skoda comes back with no maker and
 * no model, just "manufacturer is not registered with NHTSA".
 *
 * The identifiers below are the well known ones, so a number from
 * another market still names its maker. A number that is not in here is
 * left alone: the driver is not told a maker that may be wrong.
 */

/** The identifier, the maker, and the country it was built in. */
export const WMIS = {
  /* Germany */
  WBA: ['BMW', 'Germany'],
  WBS: ['BMW', 'Germany'],
  WBX: ['BMW', 'Germany'],
  WBY: ['BMW', 'Germany'],
  WDB: ['Mercedes-Benz', 'Germany'],
  WDC: ['Mercedes-Benz', 'Germany'],
  WDD: ['Mercedes-Benz', 'Germany'],
  W1K: ['Mercedes-Benz', 'Germany'],
  W1N: ['Mercedes-Benz', 'Germany'],
  WAU: ['Audi', 'Germany'],
  WUA: ['Audi', 'Germany'],
  WA1: ['Audi', 'Germany'],
  TRU: ['Audi', 'Hungary'],
  WVW: ['Volkswagen', 'Germany'],
  WV1: ['Volkswagen', 'Germany'],
  WV2: ['Volkswagen', 'Germany'],
  WVG: ['Volkswagen', 'Germany'],
  '3VW': ['Volkswagen', 'Mexico'],
  '1VW': ['Volkswagen', 'United States'],
  W0L: ['Opel', 'Germany'],
  W0V: ['Opel', 'Germany'],
  W0X: ['Opel', 'Germany'],
  TMB: ['Skoda', 'Czechia'],
  TMP: ['Skoda', 'Czechia'],
  VSS: ['Seat', 'Spain'],
  VSE: ['Seat', 'Spain'],
  WP0: ['Porsche', 'Germany'],
  WP1: ['Porsche', 'Germany'],
  WMW: ['Mini', 'United Kingdom'],
  WME: ['Smart', 'Germany'],

  /* France */
  VF1: ['Renault', 'France'],
  VF2: ['Renault', 'France'],
  VF6: ['Renault', 'France'],
  VF3: ['Peugeot', 'France'],
  VR3: ['Peugeot', 'France'],
  VF7: ['Citroen', 'France'],
  VR7: ['Citroen', 'France'],
  VNK: ['Toyota', 'France'],

  /* Italy */
  ZFA: ['Fiat', 'Italy'],
  ZFC: ['Fiat', 'Italy'],
  ZAR: ['Alfa Romeo', 'Italy'],
  ZLA: ['Lancia', 'Italy'],

  /* Britain */
  SAJ: ['Jaguar', 'United Kingdom'],
  SAL: ['Land Rover', 'United Kingdom'],
  SAD: ['Land Rover', 'United Kingdom'],
  SB1: ['Toyota', 'United Kingdom'],
  SHH: ['Honda', 'United Kingdom'],
  SJN: ['Nissan', 'United Kingdom'],
  SCF: ['Aston Martin', 'United Kingdom'],
  SCC: ['Lotus', 'United Kingdom'],

  /* Sweden */
  YV1: ['Volvo', 'Sweden'],
  YV4: ['Volvo', 'Sweden'],
  YS3: ['Saab', 'Sweden'],

  /* Japan */
  JHM: ['Honda', 'Japan'],
  JHL: ['Honda', 'Japan'],
  JTD: ['Toyota', 'Japan'],
  JTE: ['Toyota', 'Japan'],
  JTH: ['Lexus', 'Japan'],
  JN1: ['Nissan', 'Japan'],
  JN8: ['Nissan', 'Japan'],
  JM1: ['Mazda', 'Japan'],
  JM3: ['Mazda', 'Japan'],
  JMZ: ['Mazda', 'Japan'],
  JF1: ['Subaru', 'Japan'],
  JF2: ['Subaru', 'Japan'],
  JA3: ['Mitsubishi', 'Japan'],
  JA4: ['Mitsubishi', 'Japan'],
  JS1: ['Suzuki', 'Japan'],
  JS2: ['Suzuki', 'Japan'],
  JSA: ['Suzuki', 'Japan'],

  /* Korea */
  KMH: ['Hyundai', 'South Korea'],
  KM8: ['Hyundai', 'South Korea'],
  TMA: ['Hyundai', 'Czechia'],
  KNA: ['Kia', 'South Korea'],
  KND: ['Kia', 'South Korea'],
  U5Y: ['Kia', 'Slovakia'],
  KL1: ['Daewoo', 'South Korea'],
  KL4: ['Daewoo', 'South Korea'],

  /* America */
  '1HG': ['Honda', 'United States'],
  '2HG': ['Honda', 'Canada'],
  '4T1': ['Toyota', 'United States'],
  '4T3': ['Toyota', 'United States'],
  '5TF': ['Toyota', 'United States'],
  '1FA': ['Ford', 'United States'],
  '1FT': ['Ford', 'United States'],
  '5YJ': ['Tesla', 'United States'],
  '7SA': ['Tesla', 'United States'],

  /* Russia and China */
  XTA: ['Lada', 'Russia'],
  XTT: ['UAZ', 'Russia'],
  LVV: ['Chery', 'China'],
  L6T: ['Geely', 'China'],
  LC0: ['BYD', 'China'],
  LSJ: ['MG', 'China'],
};

/**
 * The maker a VIN names, or null when the first three characters are not
 * a known one.
 * @returns {{ make: string, country: string } | null}
 */
export function makeFromVin(vin) {
  const value = String(vin || '').trim().toUpperCase();
  if (value.length < 3) return null;
  const row = WMIS[value.slice(0, 3)];
  if (!row) return null;
  return { make: row[0], country: row[1] };
}

export default { WMIS, makeFromVin };
