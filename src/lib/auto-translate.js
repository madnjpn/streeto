import { translate } from '@vitalets/google-translate-api';

/**
 * Machine-translate one English interface key into Georgian.
 *
 * Google blocks the server's own IP after a burst of requests, so a
 * TooManyRequests response falls back to Google Translate through the
 * Jina reader that the parts catalogue already uses. Placeholders and
 * HTML tags are preserved by Google and the normal translation validator
 * still checks every result before it is saved.
 */

const READER = String(process.env.ROCKAUTO_READER || 'https://r.jina.ai/').replace(/\/?$/, '/');
const READER_KEY = String(process.env.JINA_API_KEY || '').trim();
let directBlockedUntil = 0;

function parseGoogleJson(body) {
  const start = body.indexOf('[[[');
  if (start < 0) throw new Error('The translation response was not JSON.');
  const raw = JSON.parse(body.slice(start).trim());
  const parts = Array.isArray(raw?.[0]) ? raw[0] : [];
  const text = parts
    .filter((part) => Array.isArray(part) && typeof part[0] === 'string')
    .map((part) => part[0])
    .join('');
  if (!text) throw new Error('The translation was empty.');
  return text;
}

async function translateThroughReader(source) {
  const target =
    'http://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=en&tl=ka&dt=t&q=' + encodeURIComponent(source);
  const headers = { accept: 'text/plain' };
  if (READER_KEY) headers.authorization = `Bearer ${READER_KEY}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(READER + target, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return parseGoogleJson(await response.text()).trim();
    if (response.status !== 429 || attempt === 2) {
      throw new Error(`Translation reader answered ${response.status}.`);
    }
    // The free reader has a short burst limit; let it breathe and retry.
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  throw new Error('Translation reader is busy.');
}

export async function autoTranslateToGeorgian(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('Nothing to translate.');

  if (Date.now() >= directBlockedUntil) {
    try {
      const result = await translate(source, { from: 'en', to: 'ka' });
      const value = String(result?.text ?? '').trim();
      if (value) return value;
    } catch (error) {
      if (error?.name === 'TooManyRequestsError' || error?.statusCode === 429) {
        // Skip the direct endpoint for a while instead of waiting for a
        // guaranteed 429 on every one of the remaining keys.
        directBlockedUntil = Date.now() + 10 * 60 * 1000;
      }
    }
  }

  return translateThroughReader(source);
}

export default { autoTranslateToGeorgian };
