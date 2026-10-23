/**
 * Shared certificate text helpers.
 *
 * The OCR itself is done by Google Gemini (see ocr-server.js), which reads
 * every field on the card. These helpers only normalise what comes back:
 * the plate, the dates and the free text.
 *
 * No DOM and no browser APIs, so the same code runs on the server.
 */

/** The app's field name for a certificate code. */
export const FIELD_FOR_CODE = {
  A: 'number_plate', B: 'year', I: 'registration_date',
  'C.1.1': 'owner_surname', 'C.1.2': 'owner_name', 'C.1.3': 'owner_address',
  'C.1.4': 'owner_id', 'C.4(a)': 'owner_of_vehicle', H: 'expiry_date',
  'D.1': 'make', 'D.2': 'vehicle_type', 'D.3': 'model', E: 'vin',
  'F.1': 'max_laden_mass', 'F.2': 'permissible_mass', G: 'unladen_mass',
  P: 'technical_passport',
  'P.1': 'engine_capacity', 'P.2': 'net_power_kw', 'P.3': 'fuel_type',
  'P.5': 'engine_number', Q: 'power_weight_ratio', R: 'colour',
  'S.1': 'seats', 'S.2': 'standing_places',
};

export function coerceField(field, value) {
  switch (field) {
    case 'number_plate': return toPlate(value);
    case 'year': {
      const m2 = value.match(/(?:19|20)\d{2}/);
      return m2 ? m2[0] : '';
    }
    case 'registration_date':
    case 'expiry_date': return toIsoDate(value);
    case 'owner_id': {
      const m3 = value.match(/\d[\d\s]{4,}/);
      return m3 ? m3[0].replace(/\s+/g, '') : '';
    }
    case 'vin': {
      const m4 = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return m4.length >= 6 ? m4.slice(0, 40) : '';
    }
    case 'technical_passport': {
      return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
    }
    case 'max_laden_mass':
    case 'permissible_mass':
    case 'unladen_mass':
    case 'engine_capacity':
    case 'net_power_kw':
    case 'seats':
    case 'standing_places': {
      const m5 = value.match(/\d{1,6}/);
      return m5 ? String(parseInt(m5[0], 10)) : '';
    }
    case 'power_weight_ratio': {
      const m6 = value.replace(',', '.').match(/\d+(?:\.\d+)?/);
      return m6 ? m6[0] : '';
    }
    case 'engine_number':
      return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 60);
    default:
      return value.replace(/[^0-9A-Za-z\u10A0-\u10FF\s.,'’\-\/]/g, '')
        .replace(/\s+/g, ' ').trim().slice(0, 120);
  }
}

export function toPlate(value) {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = raw.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  if (raw.length === 7) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const toDigit = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
    const toLetter = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '7': 'T', '4': 'A' };
    let fixed = '';
    for (let i = 0; i < 7; i++) {
      let ch = raw.charAt(i);
      if (i >= 2 && i <= 4) {
        if (toDigit[ch]) ch = toDigit[ch];
        fixed += /\d/.test(ch) ? ch : '';
      } else {
        if (toLetter[ch]) ch = toLetter[ch];
        fixed += letters.indexOf(ch) >= 0 ? ch : '';
      }
    }
    if (fixed.length === 7) return fixed.slice(0, 2) + '-' + fixed.slice(2, 5) + '-' + fixed.slice(5, 7);
  }
  return raw.length >= 5 && raw.length <= 10 ? raw : '';
}

const MONTHS = new Map([
  ['იანვარი', 1], ['თებერვალი', 2], ['მარტი', 3], ['აპრილი', 4], ['მაისი', 5], ['ივნისი', 6],
  ['ივლისი', 7], ['აგვისტო', 8], ['სექტემბერი', 9], ['ოქტომბერი', 10], ['ნოემბერი', 11], ['დეკემბერი', 12]
]);

export function toIsoDate(value) {
  const text = String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const named = text.match(/(\d{1,2})\s+([^\s0-9]+)\s+(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS.get(named[2].replace(/[^\p{L}]/gu, ''));
    const year = Number(named[3]);
    if (month && day >= 1 && day <= 31) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }
  const numeric = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (numeric) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${numeric[3]}-${pad(Number(numeric[2]))}-${pad(Number(numeric[1]))}`;
  }
  return '';
}

export default { FIELD_FOR_CODE, coerceField, toPlate, toIsoDate };
