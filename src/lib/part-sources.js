/**
 * Where a part number can be looked up.
 *
 * The truth about the parts world: there is no open, key-free,
 * cross-reference API. The catalogues that answer a part number
 * properly - RockAuto for the aftermarket brands, Amayama and 7zap for
 * the factory parts and the diagrams - either sit behind a bot check
 * that a server cannot pass, or they are paid services (Toyota's own
 * EPC, Parts-Catalogs, the Apify actors).
 *
 * So the server does what it can (RockAuto, with the answers
 * kept on disk), and every other place is handed to the driver as a
 * link with the number already filled in - their own browser passes
 * the checks that our server cannot.
 */

/** The places a part number can be looked up, in the driver's browser. */
export const PART_SOURCES = [
  {
    id: 'rockauto',
    label: 'RockAuto',
    note: 'Every aftermarket brand that sells the part, with the prices',
    url: (q) => `https://www.rockauto.com/en/partsearch/?partnum=${encodeURIComponent(q)}`,
  },
  {
    id: 'amayama',
    label: 'Amayama',
    note: 'The factory parts, with the diagrams',
    url: (q) => `https://www.amayama.com/en/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: '7zap',
    label: '7zap',
    note: 'Seventy makes, the factory numbers and the exploded diagrams',
    url: (q) => `https://7zap.com/en/search/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'megazip',
    label: 'MegaZip',
    note: 'The factory catalogue for Japanese and European cars',
    url: (q) => `https://www.megazip.net/en/search/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'jpcarparts',
    label: 'JP-CarParts',
    note: 'Lightweight factory lookup for Japanese cars',
    url: (q) => `https://jp-carparts.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'ebay',
    label: 'eBay',
    note: 'What the market charges for it',
    url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  },
  {
    id: 'amazon',
    label: 'Amazon',
    note: 'What the shops charge for it',
    url: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  },
];

/**
 * The links for one number.
 * @returns {{ id: string, label: string, note: string, url: string }[]}
 */
export function partSources(query) {
  const text = String(query || '').trim();
  if (!text) return [];
  return PART_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    note: source.note,
    url: source.url(text),
  }));
}

/**
 * The factory catalogue of one maker - the place where a chassis code
 * or a frame number is written against the real parts.
 */
export const MAKER_CATALOGUES = {
  toyota: 'https://www.amayama.com/en/catalog/toyota',
  nissan: 'https://www.amayama.com/en/catalog/nissan',
  honda: 'https://www.amayama.com/en/catalog/honda',
  mazda: 'https://www.amayama.com/en/catalog/mazda',
  subaru: 'https://www.amayama.com/en/catalog/subaru',
  mitsubishi: 'https://www.amayama.com/en/catalog/mitsubishi',
  bmw: 'https://www.amayama.com/en/catalog/bmw',
  mercedes: 'https://www.amayama.com/en/catalog/mercedes-benz',
  audi: 'https://www.amayama.com/en/catalog/audi',
  volkswagen: 'https://www.amayama.com/en/catalog/volkswagen',
};

/** The catalogue of a maker, if we know one. */
export function makerCatalogue(make) {
  const key = String(make || '').trim().toLowerCase();
  return MAKER_CATALOGUES[key] || null;
}

export default { PART_SOURCES, partSources, makerCatalogue, MAKER_CATALOGUES };
