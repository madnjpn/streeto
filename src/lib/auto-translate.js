import config from '../config.js';

/**
 * Machine-translate English interface strings into Georgian with Gemini.
 *
 * Gemini is already configured for certificate OCR and produces much more
 * natural Georgian than the free Google endpoint. Strings are sent in
 * batches so a whole dictionary does not burn one API request per key.
 * The normal translation validator still checks every result before it is
 * saved - a dropped {placeholder} or broken tag is never accepted.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Models tried in order. Quota is counted per model. */
function modelChain() {
  const list = [
    config.translateGeminiModel,
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
  ];
  return [...new Set(list.filter(Boolean))];
}

function apiKey() {
  return config.geminiApiKey || process.env.GEMINI_API_KEY || '';
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
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const PROMPT = [
  'You are a professional English-to-Georgian translator for STREETO, a Georgian car community website.',
  'Translate every string in the input JSON array into natural, concise Georgian (ka) that a Georgian driver would actually use in a car app.',
  'Keep the meaning. Do not translate word-for-word when the result sounds unnatural.',
  'Return ONLY a JSON object whose keys are exactly the input strings and whose values are the Georgian translations.',
  'Do not add comments, explanations or extra keys.',
  'Use Georgian letters only. Never use Armenian or Cyrillic letters, even when a word looks similar.',
  'Preserve {placeholders}, HTML tags, punctuation, numbers and units exactly.',
  'Keep brand names and model names in Latin where that is how Georgians write them.',
  'Input:',
].join('\n');

async function callGemini(model, texts, key, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const send = async (generationConfig) => {
      const response = await fetch(
        `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{ text: `${PROMPT}\n${JSON.stringify(texts)}` }],
            }],
            generationConfig,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`Gemini answered ${response.status}: ${body.slice(0, 400)}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    };

    const baseConfig = {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    };
    let data;
    try {
      // Translation is not a reasoning task, so skip thinking tokens.
      data = await send({ ...baseConfig, thinkingConfig: { thinkingBudget: 0 } });
    } catch (error) {
      // Some models reject the thinking config; try once without it.
      if (error.status !== 400) throw error;
      data = await send(baseConfig);
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((part) => part.text || '').join('').trim();
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'empty response';
      throw new Error(`No text in Gemini reply (${reason})`);
    }
    return extractJson(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate a list of English strings in one Gemini request.
 * Returns an object keyed by the exact English source strings.
 */
export async function autoTranslateBatchToGeorgian(texts) {
  const source = [...new Set(
    (Array.isArray(texts) ? texts : [])
      .map((text) => String(text ?? '').trim())
      .filter(Boolean),
  )].slice(0, 60);
  if (!source.length) throw new Error('Nothing to translate.');

  // Long manual paragraphs can fill the JSON reply on their own. Keep each
  // request comfortably below the output limit, then merge the answers.
  const CHUNK_CHARS = 6000;
  if (source.length > 1 && source.reduce((sum, text) => sum + text.length, 0) > CHUNK_CHARS) {
    const chunks = [];
    let current = [];
    let size = 0;
    for (const text of source) {
      if (current.length && size + text.length > CHUNK_CHARS) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(text);
      size += text.length;
    }
    if (current.length) chunks.push(current);
    if (chunks.length > 1) {
      const merged = {};
      for (const chunk of chunks) Object.assign(merged, await autoTranslateBatchToGeorgian(chunk));
      return merged;
    }
  }

  const key = apiKey();
  if (!key) {
    const error = new Error('GEMINI_API_KEY is not configured.');
    error.status = 503;
    throw error;
  }

  const timeoutMs = Number(config.geminiTimeoutMs) || 60_000;
  let lastError = null;
  let quotaError = null;
  for (const model of modelChain()) {
    try {
      const parsed = await callGemini(model, source, key, timeoutMs);
      if (!parsed) throw new Error('Gemini reply was not valid JSON');
      const out = {};
      for (const text of source) {
        const value = parsed[text];
        if (typeof value === 'string' && value.trim()) out[text] = value.trim();
      }
      if (!Object.keys(out).length) throw new Error('Gemini returned no translations');
      return out;
    } catch (error) {
      lastError = error;
      if (error.status === 429) quotaError = error;
      console.warn(`[translate] gemini ${model} failed: ${error.message}`);
    }
  }
  throw quotaError || lastError || new Error('Gemini translation failed.');
}

/** Translate one string; used by the single-key admin endpoint. */
export async function autoTranslateToGeorgian(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('Nothing to translate.');
  const result = await autoTranslateBatchToGeorgian([source]);
  const value = result[source];
  if (!value) throw new Error('Gemini returned no translation.');
  return value;
}

export default { autoTranslateToGeorgian, autoTranslateBatchToGeorgian };
