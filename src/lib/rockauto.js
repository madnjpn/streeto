import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ROOT } from '../config.js';
import proxyManager from './proxy-manager.js';

/**
 * RockAuto - the parts catalogue.
 *
 * RockAuto has no public API, so this reads the same pages their own
 * visitors read: the catalogue tree for a vehicle and the part search.
 *
 * Our server address is refused by RockAuto at the network level, so the
 * pages are fetched through a reader that fetches them from its own
 * address. The catalogue pages are plain GET pages (every level of the
 * tree is a page of its own), so no form token or session is needed.
 *
 * Three rules keep this a good guest:
 *  - one request at a time, with a pause in between,
 *  - the answers are cached for a while, so the same search is not sent
 *    twice,
 *  - nothing is stored about the visitor - the catalogue is public.
 */

const BASE = 'https://www.rockauto.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** The reader that fetches the page for us. */
const READER = String(process.env.ROCKAUTO_READER || 'https://r.jina.ai/').replace(/\/?$/, '/');
const READER_KEY = String(process.env.JINA_API_KEY || '').trim();

/** How long a catalogue answer stays fresh. */
const TTL = {
  makes: 24 * 60 * 60 * 1000,
  years: 24 * 60 * 60 * 1000,
  models: 24 * 60 * 60 * 1000,
  engines: 24 * 60 * 60 * 1000,
  parts: 60 * 60 * 1000,
  search: 30 * 60 * 1000,
};

/** A pause between two requests to the same site. */
const GAP = 1200;

/** How many times one request may be tried before it is given up on. */
const TRIES = 2;
const cache = new Map();

/**
 * The answers are also kept on disk. The catalogue is slow to answer
 * and it does not change often, so a copy on the disk means the page
 * keeps working - even after a restart, and even when the catalogue
 * refuses to answer for a while.
 */
const CACHE_DIR = path.join(ROOT, 'data', 'cache', 'rockauto');

/** Read a saved answer. */
function readDisk(key) {
  try {
    const file = path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
    const raw = fs.readFileSync(file, 'utf8');
    const saved = JSON.parse(raw);
    if (!saved || !saved.at) return null;
    return saved;
  } catch {
    return null;
  }
}

/** Save an answer for later. */
let writes = 0;
function writeDisk(key, value) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), value }), 'utf8');
    // Every so often, the old answers are swept away.
    writes += 1;
    if (writes % 50 === 0) sweepDisk();
  } catch {
    /* a cache we cannot write is a cache we simply do not have */
  }
}

/** Remove the answers that are too old to be of any use. */
function sweepDisk() {
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(CACHE_DIR)) {
      const file = path.join(CACHE_DIR, name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
      } catch {
        /* leave a file we cannot judge alone */
      }
    }
  } catch {
    /* no cache to sweep */
  }
}

let lastRequest = 0;

/**
 * When the catalogue stops answering, the next searches are refused
 * straight away instead of waiting for a timeout that may never come.
 */
let downUntil = 0;
const isDown = () => Date.now() < downUntil;

/** Ask the reader for a page. */
async function fetchThroughReader(target) {
  const { request } = await import('undici');
  const headers = {
    'x-respond-with': 'html',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': UA,
  };
  if (READER_KEY) headers.authorization = `Bearer ${READER_KEY}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await request(`${READER}${target}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await res.body.text();
    if (res.statusCode === 429) throw new Error('The reader is busy - try again in a minute.');
    if (res.statusCode >= 400) throw new Error(`The reader answered ${res.statusCode}`);
    if (!text || text.length < 500) throw new Error('The reader returned an empty page.');
    if (/^\s*\{\s*"error"/.test(text)) throw new Error('The reader could not fetch the page.');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask RockAuto directly (works only from an address it allows). */
async function fetchDirect(target) {
  const { request } = await import('undici');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await request(target, {
      method: 'GET',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) throw new Error(`RockAuto answered ${res.statusCode}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask one of the free proxies for a page. */
async function fetchThroughProxy(target, proxy) {
  const { request, ProxyAgent } = await import('undici');
  const dispatcher = new ProxyAgent(`${proxy.protocol}://${proxy.host}:${proxy.port}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await request(target, {
      method: 'GET',
      headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8' },
      dispatcher,
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) throw new Error(`RockAuto answered ${res.statusCode}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch one catalogue page, through the reader first. */
async function fetchPage(target, { tries = TRIES } = {}) {
  if (isDown()) throw new Error('The catalogue is not answering right now.');

  let lastError = null;

  for (let attempt = 0; attempt < tries; attempt += 1) {
    const wait = lastRequest + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();

    try {
      return await fetchThroughReader(target);
    } catch (error) {
      lastError = error;
      if (attempt < tries - 1) await sleep(800 * (attempt + 1));
    }
  }

  // The reader may be down - a free proxy can still fetch the page.
  try {
    await proxyManager.refresh();
    for (const proxy of proxyManager.getAllProxies().slice(0, 3)) {
      try {
        return await fetchThroughProxy(target, proxy);
      } catch (error) {
        lastError = error;
      }
    }
  } catch (error) {
    lastError = error;
  }

  // And if RockAuto ever lifts the block, the direct address works.
  try {
    return await fetchDirect(target);
  } catch (error) {
    lastError = error;
  }

  downUntil = Date.now() + 30 * 1000;
  throw lastError || new Error('The catalogue did not answer.');
}

/** A cached answer, or a fresh one. */
async function cached(key, ttl, work) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return hit.value;

  const saved = readDisk(key);
  if (saved && now - saved.at < ttl) {
    cache.set(key, saved);
    return saved.value;
  }

  try {
    const value = await work();
    cache.set(key, { at: now, value });
    writeDisk(key, value);
    return value;
  } catch (error) {
    // The catalogue is not answering - an older answer still beats
    // nothing at all, as long as it is not ancient.
    if (saved && now - saved.at < 7 * 24 * 60 * 60 * 1000) {
      cache.set(key, saved);
      return saved.value;
    }
    throw error;
  }
}

/* ── the addresses ─────────────────────────────────────────────── */

/** One catalogue path segment, written the way RockAuto writes it. */
const slug = (value) => encodeURIComponent(String(value ?? '').trim().toLowerCase())
  .replace(/%20/g, '+')
  .replace(/%2F/g, '/');

/** The address of one car in the catalogue. */
export const vehicleSlug = (make, year, model, engine, carcode) =>
  [make, year, model, engine, carcode]
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .map(slug)
    .join(',');

const catalogUrl = (...parts) => `${BASE}/en/catalog/${parts.filter(Boolean).join(',')}`;

/**
 * The engine code of a car. When the picker did not carry one (the
 * engine list failed), the first engine of the model is used - the
 * catalogue needs a code to open the groups.
 */
async function carCodeFor(make, year, model, engine, carcode) {
  if (carcode) return { engine: engine || '', carcode: String(carcode) };
  const list = await engines(make, year, model);
  if (!list.length) return { engine: engine || '', carcode: '' };
  return { engine: engine || list[0].name, carcode: String(list[0].id) };
}

/* ── the answers ───────────────────────────────────────────────── */

/**
 * Search the catalogue by part number, cross reference or keyword.
 * RockAuto answers a GET with the same listings its form would.
 */
export async function searchParts(query) {
  const text = String(query || '').trim();
  if (!text) return [];
  const key = `search:${text.toLowerCase()}`;

  return cached(key, TTL.search, async () => {
    const found = await searchOnce(text);
    if (found.length) return found;

    const plain = text.toUpperCase().replace(/[\s\-.]+/g, '');
    if (plain && plain !== text.toUpperCase()) {
      const second = await searchOnce(plain);
      if (second.length) return second;
    }
    return found;
  });
}

/** One search of the catalogue. */
async function searchOnce(text) {
  // A word with digits in it is a part number; otherwise it is a name.
  const field = /[a-z]/i.test(text) && /\d/.test(text) ? 'partnum' : 'partname';
  const url = `${BASE}/en/partsearch/?${field}=${encodeURIComponent(text)}`;
  const html = await fetchPage(url);
  return parseListings(html);
}

/** The makes the catalogue knows. */
export async function makes() {
  return cached('makes', TTL.makes, async () => {
    const html = await fetchPage(catalogUrl());
    const out = [];
    for (const node of treeNodes(html)) {
      if (node.nodetype === 'make' && node.make) out.push({ id: node.make, name: node.make });
    }
    return out;
  });
}

/** The years of one make. */
export async function years(make) {
  return cached(`years:${make}`, TTL.years, async () => {
    const html = await fetchPage(catalogUrl(make));
    return treeNodes(html)
      .filter((n) => n.nodetype === 'year' && n.year)
      .map((n) => n.year)
      .sort((a, b) => Number(b) - Number(a));
  });
}

/** The models of one make and year. */
export async function models(make, year) {
  return cached(`models:${make}:${year}`, TTL.models, async () => {
    const html = await fetchPage(catalogUrl(make, year));
    return treeNodes(html)
      .filter((n) => n.nodetype === 'model' && n.model)
      .map((n) => ({ id: n.model, name: n.model }));
  });
}

/** The engines of one car, with the code the catalogue uses for it. */
export async function engines(make, year, model) {
  return cached(`engines:${make}:${year}:${model}`, TTL.engines, async () => {
    const html = await fetchPage(catalogUrl(make, year, model));
    return treeNodes(html)
      .filter((n) => n.nodetype === 'carcode' && n.carcode)
      .map((n) => ({ id: n.carcode, name: n.engine || n.model || n.carcode }));
  });
}

/** The part groups of one car. */
export async function groups(make, year, model, engine, carcode) {
  const key = `groups:${make}:${year}:${model}:${engine}:${carcode}`;
  return cached(key, TTL.models, async () => {
    const code = await carCodeFor(make, year, model, engine, carcode);
    const html = await vehiclePage(make, year, model, code.engine, code.carcode);
    return treeNodes(html)
      .filter((n) => n.nodetype === 'groupname' && n.groupname)
      .map((n) => ({ id: n.groupname, name: n.groupname }));
  });
}

/**
 * The kinds of part inside one group of one car - "Brake Pad", "Brake
 * Rotor" and so on. Each kind is a page of parts of its own.
 */
export async function partTypes({ make, year, model, engine, carcode, group }) {
  const key = `types:${make}:${year}:${model}:${engine}:${carcode}:${group}`;
  return cached(key, TTL.models, async () => {
    const code = await carCodeFor(make, year, model, engine, carcode);
    const html = await fetchPage(catalogUrl(vehicleSlug(make, year, model, code.engine, code.carcode), slug(group)));
    const names = typeNames(html);
    return treeNodes(html)
      .filter((n) => n.nodetype === 'parttype' && n.parttype)
      .map((n) => ({ id: n.parttype, name: names.get(n.parttype) || n.parttype }));
  });
}

/**
 * The parts of one car, in one group.
 * `parttype` narrows it down further - without it every kind in the
 * group comes back, one kind at a time.
 */
export async function partsForVehicle({ make, year, model, engine, carcode, group, parttype }) {
  const key = `parts:${make}:${year}:${model}:${engine}:${carcode}:${group}:${parttype || ''}`;
  return cached(key, TTL.parts, async () => {
    const code = await carCodeFor(make, year, model, engine, carcode);
    const carPath = vehicleSlug(make, year, model, code.engine, code.carcode);
    const groupPath = slug(group);
    const groupHtml = await fetchPage(catalogUrl(carPath, groupPath));
    const types = treeNodes(groupHtml).filter((n) => n.nodetype === 'parttype' && n.parttype);

    let wanted = types;
    if (parttype) wanted = types.filter((n) => String(n.parttype) === String(parttype));
    if (!wanted.length) return [];

    const names = typeNames(groupHtml);
    const out = [];
    for (const type of wanted) {
      const name = names.get(type.parttype) || '';
      const url = catalogUrl(carPath, groupPath, slug(name), type.parttype);
      const html = await fetchPage(url);
      out.push(...parseListings(html));
    }
    return out;
  });
}

/**
 * The name of every part type, read from the links of the catalogue
 * tree - the address of a kind ends with its name and its number.
 */
function typeNames(section) {
  const out = new Map();
  for (const match of String(section || '').matchAll(/href="\/en\/catalog\/[^"]*?,([^,"]+),(\d+)"/g)) {
    const raw = match[1].replace(/&amp;/g, '&').replace(/\+/g, ' ');
    const name = decodeURIComponent(raw)
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .trim();
    if (name) out.set(match[2], name);
  }
  return out;
}

/* ── the plumbing ──────────────────────────────────────────────── */

/**
 * The catalogue page.
 *
 * It is the same page for everybody and it hardly ever changes, so it
 * is kept for an hour.
 */
async function cataloguePage() {
  return cached('page', 60 * 60 * 1000, async () => fetchPage(catalogUrl()));
}

async function vehiclePage(make, year, model, engine, carcode) {
  return fetchPage(catalogUrl(vehicleSlug(make, year, model, engine, carcode)));
}

/** The nodes the catalogue page carries in its hidden fields. */
function treeNodes(html) {
  const out = [];
  for (const match of html.matchAll(/id="jsn\[[^\]]*\]"[^>]*value="([^"]*)"/g)) {
    try {
      out.push(JSON.parse(unescapeHtml(match[1])));
    } catch {
      /* a node we cannot read is a node we skip */
    }
  }
  return out;
}

/* ── reading the answers ───────────────────────────────────────── */

const unescapeHtml = (value) => String(value || '')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const stripTags = (value) => unescapeHtml(String(value || ''))
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Read the parts out of a catalogue listing.
 * The same markup is used for the part search and for the catalogue of
 * one car, so one reader serves both.
 */
export function parseListings(html) {
  const source = String(html || '');
  const chunks = source.split(/id="listingcontainer\[/g).slice(1);
  const out = [];

  for (const chunk of chunks) {
    const row = chunk.slice(0, 200000);
    const brand = /listing-final-manufacturer[^>]*>([^<]*)</.exec(row)?.[1]?.trim() || '';
    const partNumber = /listing-final-partnumber[^>]*>([^<]*)</.exec(row)?.[1]?.trim() || '';
    const description = /span-link-underline-remover[^>]*>([^<]*)</.exec(row)?.[1]?.trim() || '';
    // The numbers inside the ids are placeholders in the catalogue and
    // real numbers in the part search, so any of them will do.
    const price = /id="dprice\[[^\]]*\]\[v\]"[^>]*>([^<]*)</.exec(row)?.[1]?.trim() || '';
    const image = /id="inlineimg\[[^\]]*\]"[^>]*src="([^"]+)"/.exec(row)?.[1] || '';
    const info = /href="(https:\/\/www\.rockauto\.com\/en\/moreinfo\.php[^"]+)"/.exec(row)?.[1] || '';

    // The note under the part tells how it fits. In the catalogue it
    // sits behind the little flag pictures.
    const notes = [];
    for (const match of row.matchAll(/<\/a>\s*([^<]{4,160}?)\s*<\/span>/g)) {
      const note = stripTags(match[1]);
      if (!note || note.length > 160) continue;
      if (/Related Parts|Intentionally blank|Select Category/i.test(note)) continue;
      notes.push(note);
    }
    for (const match of row.matchAll(/<div class="listing-text-row[^"]*"[^>]*>([\s\S]{0,900}?)<\/div>/g)) {
      const note = stripTags(match[1]);
      if (!note || note.length > 160) continue;
      if (/Related Parts|Intentionally blank|Select Category/i.test(note)) continue;
      if (notes.includes(note)) continue;
      notes.push(note);
    }

    if (!brand && !partNumber && !description) continue;

    out.push({
      brand,
      partNumber,
      description,
      price: price ? price.replace(/^\$\s?/, '') : '',
      image: image ? `${BASE}${image}` : '',
      note: notes[0] || '',
      url: info ? info.replace(/&amp;/g, '&') : `${BASE}/en/partsearch/`,
    });
  }

  return out;
}

export default { searchParts, makes, years, models, engines, groups, partTypes, partsForVehicle, parseListings };
