/**
 * Georgian phone numbers.
 *
 * One format, written the way people say it:
 *
 *   +995 577 009 096
 *
 * The country code and exactly nine digits. A listing with a phone
 * number that a driver cannot dial is a listing nobody calls, so the
 * form keeps the shape while the number is typed and the server checks
 * it once more before anything is stored.
 */

/** The country code every number carries. */
export const PHONE_COUNTRY = '+995';

/** How many digits follow the country code. */
export const PHONE_DIGITS = 9;

/** What the field shows when it is empty. */
export const PHONE_PLACEHOLDER = '+995 577 009 096';

/**
 * The number as it should be written: the code, then the digits in
 * threes.
 */
export function formatPhone(value) {
  const digits = String(value ?? '')
    .replace(/\D/g, '')
    .replace(/^995/, '')
    .slice(0, PHONE_DIGITS);
  if (!digits) return '';
  const groups = digits.match(/^(\d{0,3})(\d{0,3})(\d{0,3})$/);
  let out = PHONE_COUNTRY;
  if (groups[1]) out += ` ${groups[1]}`;
  if (groups[2]) out += ` ${groups[2]}`;
  if (groups[3]) out += ` ${groups[3]}`;
  return out;
}

/**
 * Is this a number a driver can ring?
 *
 * An empty field is allowed - a listing can be reached by mail or by
 * its description instead. Anything else has to be the full number.
 */
export function isValidPhone(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  const digits = text.replace(/\D/g, '');
  return digits.startsWith('995') && digits.length === 3 + PHONE_DIGITS;
}

/** The number, ready to be stored. */
export function cleanPhone(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return formatPhone(text);
}

export default { PHONE_COUNTRY, PHONE_DIGITS, PHONE_PLACEHOLDER, formatPhone, isValidPhone, cleanPhone };
