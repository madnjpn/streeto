/**
 * Certificate OCR - Google Gemini only (no ocr.space, no in-browser Tesseract).
 *
 * Sends the photo of a vehicle registration certificate to the Gemini API with
 * a strict JSON instruction, then maps the structured answer onto the field
 * names used across the app (see src/lib/certificate-ocr.js).
 *
 * Every text field is read twice: the Latin value the document prints and the
 * Georgian original next to it. Both end up in the one field, separated by
 * " / ", exactly the way the paper certificate prints them.
 */
import config from '../config.js';
import certOcr from './certificate-ocr.js';

const { coerceField, toPlate, toIsoDate } = certOcr;

/* ── Gemini ─────────────────────────────────────────────────────── */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Models tried in order; the first one that answers wins. The free tier
 * allows a limited number of requests per day *per model*, so falling back
 * to the next model is what keeps the scanner working when one is exhausted.
 */
function modelChain() {
  const list = [
    config.geminiModel,
    'gemini-2.5-flash',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest',
  ];
  return [...new Set(list.filter(Boolean))];
}

function apiKey() {
  return config.geminiApiKey || process.env.GEMINI_API_KEY || '';
}

/**
 * Field spec.
 *  - `plain`  : free text, no certificate code.
 *  - `value`  : a single value (numbers, dates, codes).
 *  - `both`   : the document prints a Latin and a Georgian spelling, so the
 *                field carries `value` (Latin) and `value_ka` (Georgian),
 *                which the app shows together in the one field.
 */
const SPEC = {
  document_info: {
    title_ka: 'plain',
    title_en: 'plain',
    country_ka: 'plain',
    country_en: 'plain',
    country_code: 'plain',
    certificate_number: 'plain',
    issuing_authority_ka: 'plain',
    issuing_authority_en: 'plain',
  },
  registration_details: {
    registration_number: { code: 'A', v: 'value' },
    manufacture_year: { code: 'B', v: 'value' },
    date_of_registration: { code: 'I', v: 'value' },
    expiration_date: { code: 'H', v: 'value' },
  },
  owner_details: {
    surname: { code: 'C.1.1', v: 'both' },
    first_name: { code: 'C.1.2', v: 'both' },
    address: { code: 'C.1.3', v: 'both' },
    personal_number_or_id_code: { code: 'C.1.4', v: 'value' },
    relationship: { code: 'C.4(a)', v: 'both' },
  },
  vehicle_details: {
    make: { code: 'D.1', v: 'both' },
    type: { code: 'D.2', v: 'both' },
    model: { code: 'D.3', v: 'both' },
    vin: { code: 'E', v: 'value' },
    max_tech_permissible_laden_mass_kg: { code: 'F.1', v: 'value' },
    permissible_max_mass_kg: { code: 'F.2', v: 'value' },
    unladen_mass_kg: { code: 'G', v: 'value' },
    engine_capacity_cm3: { code: 'P.1', v: 'value' },
    max_net_power_kw: { code: 'P.2', v: 'value' },
    fuel_type: { code: 'P.3', v: 'both' },
    engine_identification_number: { code: 'P.5', v: 'value' },
    technical_passport: { code: 'P', v: 'value' },
    power_weight_ratio_kw_kg: { code: 'Q', v: 'value' },
    colour: { code: 'R', v: 'both' },
    number_of_seats: { code: 'S.1', v: 'value' },
    number_of_standing_places: { code: 'S.2', v: 'value' },
  },
};

/** Builds the exact JSON skeleton handed to Gemini. */
function buildSkeleton() {
  const out = {};
  for (const [group, fields] of Object.entries(SPEC)) {
    out[group] = {};
    for (const [name, def] of Object.entries(fields)) {
      if (def === 'plain') {
        out[group][name] = '';
        continue;
      }
      if (def.v === 'both') {
        out[group][name] = { code: def.code, value: '', value_ka: '' };
      } else {
        out[group][name] = { code: def.code, value: '' };
      }
    }
  }
  return out;
}

const PROMPT = [
  'You are an OCR engine for Georgian vehicle registration certificates.',
  'Read every printed value in the image and return ONLY a JSON object that has',
  'exactly the same keys as the skeleton below.',
  '',
  'Rules:',
  '- You MUST return every key of the skeleton, even when the value is unknown.',
  '  Unknown or unreadable values are empty strings, never null and never',
  '  missing. Never invent a value.',
  '- "value" always holds a usable LATIN text for the field. Use the Latin',
  '  spelling the document prints; if the field is printed only in Georgian,',
  '  transliterate the Georgian letters into Latin (for example "საქართველო,',
  '  თბილისი" becomes "Sakartvelo, Tbilisi"). A transliteration is not a',
  '  translation: "საქართველო" is "Sakartvelo", never "Georgia".',
  '- Never repeat a word or a place name inside the same value.',
  '- "value_ka" holds the GEORGIAN text the document prints for that field,',
  '  copied exactly. Leave "value_ka" empty when the field is printed only in',
  '  Latin (for example a brand name such as "HONDA") or when you are not',
  '  sure which Georgian words belong to the field rather than to its',
  '  printed Georgian label.',
  '- Never invent a Georgian value. If the document prints "ბენზინი / Gasoline",',
  '  then value is "Gasoline" and value_ka is "ბენზინი".',
  '- The Georgian label of a field is not part of the value. The labels are:',
  '  რეგისტრაციის ნომერი (A), გამოშვების წელი (B), რეგისტრაციის თარიღი (I),',
  '  გვარი (C.1.1), სახელი (C.1.2), მისამართი (C.1.3), მფლობელი (C.4(a)),',
  '  მარკა (D.1), ტიპი (D.2), მოდელი (D.3), მოცულობა (P.1), საწვავის ტიპი (P.3),',
  '  ფერი (R). If a field only shows its Georgian label and no value, leave',
  '  both value and value_ka empty for it.',
  '- But a value that the card prints in large type in the field itself, such',
  '  as "Owner of the vehicle" at C.4(a), IS the value of that field.',
  '- Dates: use DD.MM.YYYY. Years: 4 digits only.',
  '- Number plate (A) without dashes. VIN (E) in upper case without spaces.',
  '- Numeric fields: digits only, no units.',
  '- The technical passport number (field P) is printed in the BOTTOM LEFT',
  '  corner of the FRONT side of the card, in the form AJA10232211. Copy that',
  '  number into technical_passport.',
  '- On the BACK side of the card a small number plate is printed in the',
  '  bottom left corner. That plate is a photo of the plate, not a field, so',
  '  leave registration_number empty when you are reading the back side.',
  '- Do not add any commentary, only the JSON object.',
  '',
  'SKELETON:',
].join('\n');

function mimeFor(buffer, filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  if (ext === 'gif') return 'image/gif';
  // Sniff the magic bytes, fall back to jpeg (what the camera produces).
  if (buffer && buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer && buffer.length > 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer && buffer.length > 12 && buffer[8] === 0x57 && buffer[9] === 0x45) return 'image/webp';
  return 'image/jpeg';
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const attempts = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) attempts.unshift(fenced[1]);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(raw.slice(start, end + 1));
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function callGemini(model, buffer, filename, apiKeyValue, timeoutMs) {
  const base64 = Buffer.from(buffer).toString('base64');
  const contents = [{
    role: 'user',
    parts: [
      { text: PROMPT + JSON.stringify(buildSkeleton(), null, 2) },
      { inline_data: { mime_type: mimeFor(buffer, filename), data: base64 } },
    ],
  }];

  const send = async (generationConfig) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKeyValue)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text();
        const error = new Error(`HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 400)}`);
        error.status = res.status;
        throw error;
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const baseConfig = {
    temperature: 0.1,
    topP: 0.95,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
  };

  let json;
  try {
    // Reading a form is not a reasoning task, so the thinking budget stays
    // at zero. It keeps the reply fast and the price down.
    json = await send({ ...baseConfig, thinkingConfig: { thinkingBudget: 0 } });
  } catch (err) {
    // Not every model knows the thinking config - retry without it.
    if (err.status !== 400) throw err;
    json = await send(baseConfig);
  }

  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('').trim();
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || 'empty response';
    throw new Error(`No text in Gemini reply (${reason})`);
  }
  return { text, json };
}

/**
 * Send the certificate photo to Gemini and return the structured answer.
 * Falls back through the model chain so one bad model name does not break OCR.
 */
async function geminiOcrImage(buffer, options = {}) {
  const key = apiKey();
  if (!key) throw new Error('GEMINI_API_KEY not configured. Set in config or env.');
  if (!buffer || !buffer.length) throw new Error('Empty image.');

  const timeoutMs = Number(options.timeoutMs) || Number(config.geminiTimeoutMs) || 60000;
  const models = options.model ? [options.model, ...modelChain()] : modelChain();

  let lastError = null;
  for (const model of [...new Set(models)]) {
    try {
      const started = Date.now();
      const { text, json } = await callGemini(model, buffer, options.filename, key, timeoutMs);
      console.log(`[ocr] gemini ${model} responded in ${Date.now() - started}ms`);
      const data = extractJson(text);
      if (!data) throw new Error('Gemini reply was not valid JSON');
      return { data, text, model, raw: json };
    } catch (err) {
      lastError = err;
      console.warn(`[ocr] gemini ${model} failed: ${err.message}`);
      // The daily quota is counted per model, so the next model in the chain
      // can still answer. Keep going unless every model is out.
    }
  }
  throw lastError || new Error('Gemini OCR failed');
}

/* ── mapping Gemini JSON → app fields ───────────────────────────── */

/** Latin text of a field. */
function pickValue(node) {
  if (!node || typeof node !== 'object') return '';
  return String(node.value ?? '').trim();
}

/** Georgian text of a field, when the document prints one. */
function pickValueKa(node) {
  if (!node || typeof node !== 'object') return '';
  return String(node.value_ka ?? '').trim();
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  }
  const dmy = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmy) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  }
  return toIsoDate(text);
}

/** Field name in the app for each certificate code we consume. */
const FIELD_FOR_CODE = {
  A: 'number_plate',
  B: 'year',
  I: 'registration_date',
  H: 'expiry_date',
  'C.1.1': 'owner_surname',
  'C.1.2': 'owner_name',
  'C.1.3': 'owner_address',
  'C.1.4': 'owner_id',
  'C.4(a)': 'owner_of_vehicle',
  'D.1': 'make',
  'D.2': 'vehicle_type',
  'D.3': 'model',
  E: 'vin',
  'F.1': 'max_laden_mass',
  'F.2': 'permissible_mass',
  G: 'unladen_mass',
  P: 'technical_passport',
  'P.1': 'engine_capacity',
  'P.2': 'net_power_kw',
  'P.3': 'fuel_type',
  'P.5': 'engine_number',
  Q: 'power_weight_ratio',
  R: 'colour',
  'S.1': 'seats',
  'S.2': 'standing_places',
};
  /** Fields the document can print in Georgian script as well as Latin. */
/** Fields that also get a Georgian twin (`<field>_ka`). */
const GE_FIELDS = new Set([
  'make', 'model', 'vehicle_type', 'fuel_type', 'colour',
  'owner_surname', 'owner_name', 'owner_address', 'owner_of_vehicle',
]);

function finalize(field, raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  switch (field) {
    case 'number_plate': return toPlate(value);
    case 'year': {
      const m = value.match(/(?:19|20)\d{2}/);
      return m ? m[0] : '';
    }
    case 'registration_date':
    case 'expiry_date': return normalizeDate(value);
    case 'vin': {
      const v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return v.length >= 6 ? v.slice(0, 40) : '';
    }
    case 'technical_passport': {
      const v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return v.slice(0, 40);
    }
    case 'owner_id': {
      const m = value.match(/\d[\d\s]{4,}/);
      return m ? m[0].replace(/\s+/g, '') : '';
    }
    case 'owner_address': {
      // The model sometimes repeats a place name when it reads both the
      // Georgian and the English spelling of the same address.
      const parts = value.split(/,\s*/);
      const seen = new Set();
      const kept = [];
      for (const part of parts) {
        const key = part.trim().toLowerCase();
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(part.trim());
      }
      return kept.join(', ');
    }
    case 'engine_capacity':
    case 'net_power_kw':
    case 'seats':
    case 'standing_places':
    case 'max_laden_mass':
    case 'permissible_mass':
    case 'unladen_mass': {
      const m = value.match(/\d{1,7}/);
      return m ? String(parseInt(m[0], 10)) : '';
    }
    case 'power_weight_ratio': {
      const m = value.replace(',', '.').match(/\d+(?:\.\d+)?/);
      return m ? m[0] : '';
    }
    default: {
      // Strip the separators a partial read can leave behind.
      const cleaned = value.replace(/^[\s,;:.\-/]+/, '').replace(/[\s,;:.\-/]+$/, '');
      const out = coerceField(field, cleaned);
      return out || '';
    }
  }
}

/**
 * The Georgian label the card prints in front of each field. A model that
 * confuses the label for the value is common, so these words are rejected
 * when they arrive as the whole value.
 */
const GE_LABELS = {
  A: ['რეგისტრაციის ნომერი'],
  B: ['გამოშვების წელი', 'საშუალების გამოშვების წელი'],
  I: ['რეგისტრაციის თარიღი', 'თარიღი'],
  H: ['ვადის გასვლის თარიღი'],
  'C.1.1': ['გვარი'],
  'C.1.2': ['სახელი'],
  'C.1.3': ['მისამართი'],
  'C.1.4': ['პ/ნ', 'ს/კ'],
  'C.4(a)': ['მფლობელი'],
  'D.1': ['მარკა'],
  'D.2': ['ტიპი'],
  'D.3': ['მოდელი'],
  E: ['საიდენტიფიკაციო ნომერი'],
  'P.1': ['მოცულობა', 'ძრავის მოცულობა'],
  'P.3': ['საწვავის ტიპი', 'საწვავი'],
  R: ['ფერი'],
};

/** Georgian text is kept as printed, only the script is cleaned up. */
function finalizeKa(field, raw, code) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const cleaned = value
    .replace(/[^\u10A0-\u10FF\u0400-\u04FF0-9A-Za-z\s.,'’\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, field === 'owner_address' ? 200 : 120);
  if (!cleaned || !/[\u10A0-\u10FF]/.test(cleaned)) return '';
  // The printed Georgian label is not a value.
  const labels = GE_LABELS[code] || [];
  const key = cleaned.toLowerCase();
  if (labels.some(label => key === label.toLowerCase())) return '';
  return cleaned;
}

/**
 * The certificate prints some fields in Georgian and Latin at the same time
 * ("ბენზინი/Gasoline"). The app keeps both in the one field, Latin first,
 * the way the paper document does.
 */
function joinBilingual(latin, georgian) {
  const parts = [];
  if (latin) parts.push(latin);
  if (georgian && georgian.toLowerCase() !== latin.toLowerCase()) parts.push(georgian);
  return parts.join(' / ');
}

/**
 * Map the Gemini JSON answer onto the app's certificate field names.
 * `side` is 'front' or 'back': the back side carries a small photo of the
 * number plate, which is not a certificate field and is ignored.
 */
export function mapGeminiFields(data, options = {}) {
  const fields = {};
  const side = options.side === 'back' ? 'back' : 'front';
  for (const [group, groupFields] of Object.entries(SPEC)) {
    if (group === 'document_info') continue;
    const groupData = (data && data[group]) || {};
    for (const [name, def] of Object.entries(groupFields)) {
      if (def === 'plain') continue;
      const code = def.code;
      // The back side prints a picture of the plate; that is not field A.
      if (code === 'A' && side === 'back') continue;
      const field = FIELD_FOR_CODE[code];
      if (!field) continue;

      const value = finalize(field, pickValue(groupData[name]));

      if (def.v === 'both' && GE_FIELDS.has(field)) {
        // One field, both spellings - exactly like the paper document.
        const valueKa = finalizeKa(field, pickValueKa(groupData[name]), code);
        const combined = joinBilingual(value, valueKa);
        if (combined) fields[field] = combined;
      } else if (value) {
        fields[field] = value;
      }
    }
  }
  return fields;
}

/**
 * Full certificate OCR: photo in, structured fields out.
 */
export async function certificateOcr(buffer, options = {}) {
  const { data, text, model } = await geminiOcrImage(buffer, options);
  const fields = mapGeminiFields(data, options);
  return { fields, text, model, provider: 'gemini', raw: data };
}

export { geminiOcrImage };
