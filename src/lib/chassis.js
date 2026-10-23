/**
 * Chassis codes.
 *
 * A Japanese car carries a chassis code instead of a VIN - "EG6" for a
 * Civic, "GC8" for an Impreza, "JZX100" for a Chaser. Sometimes the code
 * comes with a serial number: "GC8-012345" is a frame number, and the
 * frame is what the maker's own catalogue is written against.
 *
 * The table below is the well known codes, so the check can tell a driver
 * what their car is. A code that is not in here is passed on untouched -
 * it is still worth searching the parts with.
 */

/** The chassis codes worth knowing by heart. */
export const CHASSIS_CODES = {
  /* Toyota */
  AE86: { make: 'Toyota', model: 'Corolla Levin / Sprinter Trueno', years: '1983-1988', note: 'Hachiroku' },
  AW11: { make: 'Toyota', model: 'MR2', years: '1984-1989' },
  SW20: { make: 'Toyota', model: 'MR2', years: '1989-1999' },
  MA70: { make: 'Toyota', model: 'Supra', years: '1986-1993' },
  JZA80: { make: 'Toyota', model: 'Supra', years: '1993-2002' },
  JZX100: { make: 'Toyota', model: 'Chaser / Mark II / Cresta', years: '1996-2001' },
  JZS160: { make: 'Toyota', model: 'Aristo / Lexus GS 300', years: '1997-2005' },
  SXE10: { make: 'Toyota', model: 'Altezza / Lexus IS 200', years: '1998-2005' },
  ZN6: { make: 'Toyota', model: '86 / GT86 / Subaru BRZ', years: '2012-2020' },
  A90: { make: 'Toyota', model: 'GR Supra', years: '2019-' },

  /* Nissan */
  S13: { make: 'Nissan', model: 'Silvia / 240SX', years: '1988-1993' },
  S14: { make: 'Nissan', model: 'Silvia / 240SX', years: '1993-1998' },
  S15: { make: 'Nissan', model: 'Silvia', years: '1998-2002' },
  PS13: { make: 'Nissan', model: 'Silvia / 180SX', years: '1995-1999' },
  B13: { make: 'Nissan', model: 'Sunny / Sentra', years: '1990-1994' },
  B14: { make: 'Nissan', model: 'Sentra', years: '1994-1999' },
  R31: { make: 'Nissan', model: 'Skyline', years: '1986-1990' },
  R32: { make: 'Nissan', model: 'Skyline GT-R', years: '1989-1994' },
  R33: { make: 'Nissan', model: 'Skyline GT-R', years: '1995-1998' },
  R34: { make: 'Nissan', model: 'Skyline GT-R', years: '1999-2002' },
  Z32: { make: 'Nissan', model: '300ZX', years: '1989-2000' },
  Z33: { make: 'Nissan', model: '350Z', years: '2002-2009' },
  SKYLINE: { make: 'Nissan', model: 'Skyline', years: '1969-2002' },

  /* Honda */
  EF9: { make: 'Honda', model: 'Civic', years: '1988-1991' },
  EG6: { make: 'Honda', model: 'Civic', years: '1992-1995' },
  EG8: { make: 'Honda', model: 'Civic SiR-II', years: '1992-1995' },
  EK9: { make: 'Honda', model: 'Civic Type R', years: '1997-2000' },
  EM2: { make: 'Honda', model: 'Civic', years: '1996-2000' },
  EP3: { make: 'Honda', model: 'Civic Type R', years: '2001-2005' },
  FN2: { make: 'Honda', model: 'Civic Type R', years: '2007-2011' },
  FK8: { make: 'Honda', model: 'Civic Type R', years: '2017-2021' },
  FL5: { make: 'Honda', model: 'Civic Type R', years: '2023-' },
  DC1: { make: 'Honda', model: 'Integra', years: '1993-2001' },
  DC2: { make: 'Honda', model: 'Integra', years: '1993-2001', note: 'Type R / SiR (1.8)' },
  BB1: { make: 'Honda', model: 'Prelude', years: '1992-1996' },
  BC1: { make: 'Honda', model: 'Prelude', years: '1997-2001' },
  NA1: { make: 'Honda', model: 'NSX', years: '1990-2005' },

  /* Mazda */
  NA6: { make: 'Mazda', model: 'MX-5 Miata', years: '1990-1997' },
  NB: { make: 'Mazda', model: 'MX-5 Miata', years: '1998-2005' },
  NC: { make: 'Mazda', model: 'MX-5 Miata', years: '2005-2015' },
  SE3P: { make: 'Mazda', model: 'RX-8', years: '2003-2012' },
  FD: { make: 'Mazda', model: 'RX-7', years: '1992-2002' },
  FD3S: { make: 'Mazda', model: 'RX-7 Type R', years: '1992-1995' },

  /* Subaru and Mitsubishi */
  GC8: { make: 'Subaru', model: 'Impreza WRX STi', years: '1992-2000' },
  GF: { make: 'Subaru', model: 'Impreza / WRX', years: '1992-2000' },
  CP9A: { make: 'Mitsubishi', model: 'Lancer Evolution', years: '1997-2001' },

  /* The ones Europe knows by their code */
  E30: { make: 'BMW', model: '3 Series / M3', years: '1982-1994' },
  E36: { make: 'BMW', model: '3 Series / M3', years: '1990-2000' },
  E46: { make: 'BMW', model: '3 Series / M3', years: '1998-2006' },
  E39: { make: 'BMW', model: '5 Series', years: '1995-2003' },
  E90: { make: 'BMW', model: '3 Series', years: '2005-2011' },
  Z3: { make: 'BMW', model: 'Z3', years: '1996-2003' },
  W124: { make: 'Mercedes-Benz', model: 'E-Class / 500E', years: '1984-1995' },
  W210: { make: 'Mercedes-Benz', model: 'E-Class', years: '1995-2003' },
  R129: { make: 'Mercedes-Benz', model: 'SL / 500SL', years: '1989-2001' },
  W202: { make: 'Mercedes-Benz', model: 'C-Class', years: '1993-2000' },
  B5: { make: 'Audi', model: 'A4', years: '1994-2000' },
  B6: { make: 'Audi', model: 'A4', years: '2000-2004' },
  '8P': { make: 'Audi', model: 'A3 / S3', years: '2003-2013' },
  '8J': { make: 'Audi', model: 'TT', years: '2006-2014' },
  MK4: { make: 'Volkswagen', model: 'Golf', years: '1997-2003' },
  MK5: { make: 'Volkswagen', model: 'Golf', years: '2003-2009' },
};

/**
 * Look a chassis code up.
 * @returns {null | { code: string, make: string, model: string, years: string, note: string }}
 */
export function lookupChassis(code) {
  const key = String(code || '').trim().toUpperCase();
  const found = CHASSIS_CODES[key];
  if (!found) return null;
  return { code: key, ...found };
}

/**
 * The platform codes the German group writes into the middle of a VIN.
 *
 * A Volkswagen, an Audi, a Skoda or a Seat carries the platform of the
 * car in the seventh and eighth place - "WVWZZZ1JZXW000001" is a Golf
 * of the fourth generation, "TMBHS61Z382230614" an Octavia of the
 * second. It is what tells the model of a car from another market,
 * where the American register knows the maker and nothing more.
 *
 * The years are the ones the catalogue lists; a code that does not fit
 * the year of the VIN is not used.
 */
export const PLATFORM_CODES = {
  /* Volkswagen */
  '1J': { make: 'Volkswagen', model: 'Golf', years: '1999-2006', note: 'Golf IV / Bora' },
  '1K': { make: 'Volkswagen', model: 'Golf', years: '2006-2009', note: 'Golf V / Jetta V' },
  '5K': { make: 'Volkswagen', model: 'Golf', years: '2010-2014', note: 'Golf VI' },
  '5G': { make: 'Volkswagen', model: 'Golf', years: '2015-2021', note: 'Golf VII' },
  '1T': { make: 'Volkswagen', model: 'Touran', years: '2003-2015' },
  '5N': { make: 'Volkswagen', model: 'Tiguan', years: '2009-2018' },
  '6R': { make: 'Volkswagen', model: 'Polo', years: '2010-2017', note: 'Polo V' },
  '6C': { make: 'Volkswagen', model: 'Polo', years: '2014-2017', note: 'Polo V' },
  '6N': { make: 'Volkswagen', model: 'Polo', years: '1995-2002', note: 'Polo III' },
  '9N': { make: 'Volkswagen', model: 'Polo', years: '2002-2009', note: 'Polo IV' },
  '3B': { make: 'Volkswagen', model: 'Passat', years: '1998-2005', note: 'Passat B5' },
  '3C': { make: 'Volkswagen', model: 'Passat', years: '2006-2015', note: 'Passat B6 / B7' },
  '3G': { make: 'Volkswagen', model: 'Passat', years: '2016-2023', note: 'Passat B8' },
  '7L': { make: 'Volkswagen', model: 'Touareg', years: '2004-2010' },
  '7P': { make: 'Volkswagen', model: 'Touareg', years: '2011-2018' },
  '1C': { make: 'Volkswagen', model: 'Beetle', years: '1998-2011', note: 'New Beetle' },
  '5C': { make: 'Volkswagen', model: 'Beetle', years: '2012-2019' },

  /* Audi */
  '8L': { make: 'Audi', model: 'A3', years: '1997-2003' },
  '8P': { make: 'Audi', model: 'A3', years: '2004-2013' },
  '8V': { make: 'Audi', model: 'A3', years: '2013-2020' },
  '8E': { make: 'Audi', model: 'A4', years: '2001-2008' },
  '8K': { make: 'Audi', model: 'A4', years: '2008-2016' },
  '8W': { make: 'Audi', model: 'A4', years: '2016-2024' },
  '4B': { make: 'Audi', model: 'A6', years: '1998-2004' },
  '4F': { make: 'Audi', model: 'A6', years: '2005-2011' },
  '4G': { make: 'Audi', model: 'A6', years: '2012-2018' },
  '4E': { make: 'Audi', model: 'A8', years: '2003-2010' },
  '4H': { make: 'Audi', model: 'A8', years: '2011-2017' },
  '8N': { make: 'Audi', model: 'TT', years: '2001-2006' },
  '8J': { make: 'Audi', model: 'TT', years: '2007-2014' },
  '8S': { make: 'Audi', model: 'TT', years: '2015-2023' },
  '8R': { make: 'Audi', model: 'Q5', years: '2009-2017' },
  '8U': { make: 'Audi', model: 'Q3', years: '2012-2018' },
  '4L': { make: 'Audi', model: 'Q7', years: '2007-2015' },

  /* Skoda */
  '1U': { make: 'Skoda', model: 'Octavia', years: '1998-2010', note: 'Octavia I' },
  '1Z': { make: 'Skoda', model: 'Octavia', years: '2004-2013', note: 'Octavia II' },
  '5E': { make: 'Skoda', model: 'Octavia', years: '2013-2020', note: 'Octavia III' },
  '6Y': { make: 'Skoda', model: 'Fabia', years: '2000-2007', note: 'Fabia I' },
  '5J': { make: 'Skoda', model: 'Fabia', years: '2007-2014', note: 'Fabia II' },
  '3U': { make: 'Skoda', model: 'Superb', years: '2002-2008', note: 'Superb I' },
  '3T': { make: 'Skoda', model: 'Superb', years: '2008-2015', note: 'Superb II' },
  '5L': { make: 'Skoda', model: 'Yeti', years: '2010-2017' },

  /* Seat */
  '1M': { make: 'Seat', model: 'Leon', years: '2000-2006', note: 'Leon I' },
  '1P': { make: 'Seat', model: 'Leon', years: '2006-2012', note: 'Leon II' },
  '5F': { make: 'Seat', model: 'Leon', years: '2013-2020', note: 'Leon III' },
};

/** The make whose VINs carry a platform code in the middle. */
export const PLATFORM_MAKES = ['VOLKSWAGEN', 'AUDI', 'SKODA', 'SEAT'];

/**
 * Look a platform code up.
 * @returns {null | { code: string, make: string, model: string, years: string, note?: string }}
 */
export function lookupPlatform(code) {
  const key = String(code || '').trim().toUpperCase();
  const found = PLATFORM_CODES[key];
  if (!found) return null;
  return { code: key, ...found };
}

/**
 * Whether a year falls inside a "1998-2005" range. A range with an open
 * end counts as unbounded on that side.
 */
export function inYears(range, year) {
  const value = Number(year);
  if (!value) return false;
  const [from, to] = String(range || '').split('-');
  if (Number(from) && value < Number(from)) return false;
  if (Number(to) && value > Number(to)) return false;
  return true;
}

/**
 * The maker's own catalogue, where the frame number is written against
 * the factory parts with the diagrams.
 */
export const oemUrl = (code) => `https://www.amayama.com/en/search?q=${encodeURIComponent(code)}`;

export default { CHASSIS_CODES, PLATFORM_CODES, lookupChassis, lookupPlatform, inYears, oemUrl };

