/**
 * The same car under another name.
 *
 * A maker sold the same car in another market under its own badge - the
 * Toyota Altezza was the Lexus IS200, the Honda Integra the Acura
 * Integra, the Opel Zafira the Subaru Traviq. The body and the drivetrain
 * are the same, so the parts of one fit the other.
 *
 * The pairs are the well-known ones (Wikipedia's list of badge-engineered
 * vehicles, cross-read against the catalogue). Cars that only share a
 * floor pan are left out, so a part offered through a twin really does
 * fit. The catalogue uses the names of the market each car was sold in,
 * so when a driver picks a name the catalogue does not have, the other
 * name is offered next to it.
 */

/** [make, model, make, model] - the two names of one car. */
export const PAIRS = [
  /* ── Toyota and Lexus ─────────────────────────────────────────── */
  ['TOYOTA', 'ALTEZZA', 'LEXUS', 'IS200'],
  ['TOYOTA', 'ALTEZZA', 'LEXUS', 'IS300'],
  ['TOYOTA', 'ARISTO', 'LEXUS', 'GS300'],
  ['TOYOTA', 'ARISTO', 'LEXUS', 'GS400'],
  ['TOYOTA', 'CELSIOR', 'LEXUS', 'LS400'],
  ['TOYOTA', 'CELSIOR', 'LEXUS', 'LS430'],
  ['TOYOTA', 'SOARER', 'LEXUS', 'SC300'],
  ['TOYOTA', 'SOARER', 'LEXUS', 'SC400'],
  ['TOYOTA', 'SOARER', 'LEXUS', 'SC430'],
  ['TOYOTA', 'HARRIER', 'LEXUS', 'RX300'],
  ['TOYOTA', 'HARRIER', 'LEXUS', 'RX330'],
  ['TOYOTA', 'WINDOM', 'LEXUS', 'ES300'],
  ['TOYOTA', 'LAND CRUISER', 'LEXUS', 'LX450'],
  ['TOYOTA', 'LAND CRUISER', 'LEXUS', 'LX470'],
  ['TOYOTA', 'LAND CRUISER PRADO', 'LEXUS', 'GX470'],
  ['TOYOTA', 'MATRIX', 'PONTIAC', 'VIBE'],
  ['TOYOTA', 'COROLLA', 'GEO', 'PRIZM'],
  ['TOYOTA', 'SPRINTER', 'GEO', 'PRIZM'],
  ['TOYOTA', '86', 'SCION', 'FR-S'],
  ['TOYOTA', '86', 'SUBARU', 'BRZ'],
  ['SCION', 'FR-S', 'SUBARU', 'BRZ'],

  /* ── Honda and Acura ──────────────────────────────────────────── */
  ['HONDA', 'INTEGRA', 'ACURA', 'INTEGRA'],
  ['HONDA', 'LEGEND', 'ACURA', 'LEGEND'],
  ['HONDA', 'LEGEND', 'ACURA', 'RL'],
  ['HONDA', 'INSPIRE', 'ACURA', 'TL'],
  ['HONDA', 'SABER', 'ACURA', 'TL'],
  ['HONDA', 'VIGOR', 'ACURA', 'TL'],
  ['HONDA', 'ACCORD', 'ACURA', 'TSX'],
  ['HONDA', 'PASSPORT', 'ISUZU', 'RODEO'],

  /* ── Isuzu and the cars it built for others ───────────────────── */
  ['ISUZU', 'TROOPER', 'ACURA', 'SLX'],
  ['ISUZU', 'TROOPER', 'OPEL', 'MONTEREY'],
  ['ISUZU', 'TROOPER', 'VAUXHALL', 'MONTEREY'],
  ['ISUZU', 'RODEO', 'OPEL', 'FRONTERA'],
  ['ISUZU', 'RODEO', 'VAUXHALL', 'FRONTERA'],
  ['ISUZU', 'HOMBRE', 'CHEVROLET', 'S10'],
  ['ISUZU', 'ASCENDER', 'GMC', 'ENVOY'],
  ['ISUZU', 'D-MAX', 'MAZDA', 'BT-50'],

  /* ── Suzuki and the cars it built for others ──────────────────── */
  ['SUZUKI', 'VITARA', 'CHEVROLET', 'TRACKER'],
  ['SUZUKI', 'SIDEKICK', 'CHEVROLET', 'TRACKER'],
  ['SUZUKI', 'VITARA', 'GEO', 'TRACKER'],
  ['SUZUKI', 'SIDEKICK', 'GEO', 'TRACKER'],
  ['SUZUKI', 'SWIFT', 'GEO', 'METRO'],
  ['SUZUKI', 'SWIFT', 'PONTIAC', 'FIREFLY'],
  ['SUZUKI', 'EQUATOR', 'NISSAN', 'FRONTIER'],
  ['SUZUKI', 'FORENZA', 'CHEVROLET', 'OPTRA'],
  ['SUZUKI', 'FORENZA', 'DAEWOO', 'LACETTI'],
  ['SUZUKI', 'RENO', 'CHEVROLET', 'OPTRA'],

  /* ── Mazda, Ford, Mercury and Lincoln ─────────────────────────── */
  ['MAZDA', 'TRIBUTE', 'FORD', 'ESCAPE'],
  ['MAZDA', 'TRIBUTE', 'MERCURY', 'MARINER'],
  ['MAZDA', 'B-SERIES', 'FORD', 'RANGER'],
  ['MAZDA', 'BT-50', 'FORD', 'RANGER'],
  ['MAZDA', 'MX-6', 'FORD', 'PROBE'],
  ['MAZDA', 'NAVAJO', 'FORD', 'EXPLORER'],
  ['FORD', 'EXPLORER', 'MERCURY', 'MOUNTAINEER'],
  ['FORD', 'ESCAPE', 'MERCURY', 'MARINER'],
  ['FORD', 'TAURUS', 'MERCURY', 'SABLE'],
  ['FORD', 'CROWN VICTORIA', 'MERCURY', 'GRAND MARQUIS'],
  ['FORD', 'CROWN VICTORIA', 'LINCOLN', 'TOWN CAR'],
  ['FORD', 'FUSION', 'MERCURY', 'MILAN'],
  ['FORD', 'FUSION', 'LINCOLN', 'MKZ'],
  ['FORD', 'ESCORT', 'MERCURY', 'LYNX'],
  ['FORD', 'ESCORT', 'MERCURY', 'TRACER'],
  ['FORD', 'EXPEDITION', 'LINCOLN', 'NAVIGATOR'],
  ['FORD', 'EDGE', 'LINCOLN', 'NAUTILUS'],
  ['FORD', 'SIERRA', 'MERKUR', 'XR4TI'],

  /* ── Mitsubishi and Chrysler ──────────────────────────────────── */
  ['MITSUBISHI', 'ECLIPSE', 'EAGLE', 'TALON'],
  ['MITSUBISHI', 'ECLIPSE', 'PLYMOUTH', 'LASER'],
  ['MITSUBISHI', '3000GT', 'DODGE', 'STEALTH'],
  ['MITSUBISHI', 'RAIDER', 'DODGE', 'DAKOTA'],
  ['MITSUBISHI', 'LANCER', 'PLYMOUTH', 'ARROW'],
  ['MITSUBISHI', 'MIRAGE', 'PLYMOUTH', 'COLT'],
  ['MITSUBISHI', 'MIRAGE', 'DODGE', 'COLT'],
  ['MITSUBISHI', 'MIGHTY MAX', 'DODGE', 'RAM 50'],
  ['MITSUBISHI', 'COLT', 'RENAULT', 'CLIO'],
  ['MITSUBISHI', 'ASX', 'RENAULT', 'CAPTUR'],

  /* ── Chrysler, Dodge, Plymouth, Eagle ─────────────────────────── */
  ['DODGE', 'NEON', 'PLYMOUTH', 'NEON'],
  ['DODGE', 'NEON', 'CHRYSLER', 'NEON'],
  ['DODGE', 'SHADOW', 'PLYMOUTH', 'SUNDANCE'],
  ['DODGE', 'ARIES', 'PLYMOUTH', 'RELIANT'],
  ['CHRYSLER', 'LEBARON', 'DODGE', 'SPIRIT'],
  ['DODGE', 'INTREPID', 'EAGLE', 'VISION'],
  ['DODGE', 'INTREPID', 'CHRYSLER', 'CONCORDE'],
  ['CHRYSLER', 'TOWN & COUNTRY', 'DODGE', 'GRAND CARAVAN'],
  ['CHRYSLER', 'TOWN & COUNTRY', 'PLYMOUTH', 'VOYAGER'],
  ['CHRYSLER', 'TOWN & COUNTRY', 'LANCIA', 'GRAND VOYAGER'],
  ['CHRYSLER', 'TOWN & COUNTRY', 'VOLKSWAGEN', 'ROUTAN'],
  ['DODGE', 'JOURNEY', 'FIAT', 'FREEMONT'],
  ['CHRYSLER', '300', 'DODGE', 'CHARGER'],
  ['CHRYSLER', '300', 'DODGE', 'MAGNUM'],
  ['CHRYSLER', '300', 'LANCIA', 'THEMA'],
  ['ALFA ROMEO', 'TONALE', 'DODGE', 'HORNET'],

  /* ── Chevrolet, GMC, Buick, Cadillac, Pontiac, Saturn ─────────── */
  ['CHEVROLET', 'SILVERADO', 'GMC', 'SIERRA'],
  ['CHEVROLET', 'SUBURBAN', 'GMC', 'YUKON XL'],
  ['CHEVROLET', 'TAHOE', 'GMC', 'YUKON'],
  ['CHEVROLET', 'TAHOE', 'CADILLAC', 'ESCALADE'],
  ['CHEVROLET', 'SUBURBAN', 'CADILLAC', 'ESCALADE ESV'],
  ['CHEVROLET', 'AVALANCHE', 'CADILLAC', 'ESCALADE EXT'],
  ['CHEVROLET', 'TRAILBLAZER', 'GMC', 'ENVOY'],
  ['CHEVROLET', 'TRAILBLAZER', 'SAAB', '9-7X'],
  ['CHEVROLET', 'TRAILBLAZER', 'BUICK', 'RAINIER'],
  ['CHEVROLET', 'TRAILBLAZER', 'OLDSMOBILE', 'BRAVADA'],
  ['CHEVROLET', 'COLORADO', 'GMC', 'CANYON'],
  ['CHEVROLET', 'EXPRESS', 'GMC', 'SAVANA'],
  ['CHEVROLET', 'ASTRO', 'GMC', 'SAFARI'],
  ['CHEVROLET', 'BLAZER', 'GMC', 'JIMMY'],
  ['CHEVROLET', 'CAVALIER', 'PONTIAC', 'SUNFIRE'],
  ['CHEVROLET', 'COBALT', 'PONTIAC', 'G5'],
  ['CHEVROLET', 'EQUINOX', 'GMC', 'TERRAIN'],
  ['CHEVROLET', 'EQUINOX', 'PONTIAC', 'TORRENT'],
  ['CHEVROLET', 'CAPTIVA', 'OPEL', 'ANTARA'],
  ['CHEVROLET', 'CAPTIVA', 'VAUXHALL', 'ANTARA'],
  ['CHEVROLET', 'CAPTIVA', 'SATURN', 'VUE'],
  ['CHEVROLET', 'AVEO', 'PONTIAC', 'G3'],
  ['CHEVROLET', 'AVEO', 'PONTIAC', 'WAVE'],
  ['CHEVROLET', 'SPARK', 'DAEWOO', 'MATIZ'],
  ['CHEVROLET', 'OPTRA', 'DAEWOO', 'LACETTI'],
  ['CHEVROLET', 'CAPRICE', 'BUICK', 'ROADMASTER'],
  ['SAAB', '9-4X', 'CADILLAC', 'SRX'],
  ['PONTIAC', 'SOLSTICE', 'SATURN', 'SKY'],
  ['PONTIAC', 'SOLSTICE', 'OPEL', 'GT'],

  /* ── Opel and Vauxhall: one car, two national badges ──────────── */
  ['OPEL', 'ASTRA', 'VAUXHALL', 'ASTRA'],
  ['OPEL', 'CORSA', 'VAUXHALL', 'CORSA'],
  ['OPEL', 'VECTRA', 'VAUXHALL', 'VECTRA'],
  ['OPEL', 'OMEGA', 'VAUXHALL', 'OMEGA'],
  ['OPEL', 'ZAFIRA', 'VAUXHALL', 'ZAFIRA'],
  ['OPEL', 'MERIVA', 'VAUXHALL', 'MERIVA'],
  ['OPEL', 'TIGRA', 'VAUXHALL', 'TIGRA'],
  ['OPEL', 'AGILA', 'VAUXHALL', 'AGILA'],
  ['OPEL', 'SIGNUM', 'VAUXHALL', 'SIGNUM'],
  ['OPEL', 'MOKKA', 'VAUXHALL', 'MOKKA'],
  ['OPEL', 'INSIGNIA', 'VAUXHALL', 'INSIGNIA'],
  ['OPEL', 'ANTARA', 'VAUXHALL', 'ANTARA'],
  ['OPEL', 'FRONTERA', 'VAUXHALL', 'FRONTERA'],
  ['OPEL', 'COMBO', 'VAUXHALL', 'COMBO'],
  ['OPEL', 'VIVARO', 'VAUXHALL', 'VIVARO'],
  ['OPEL', 'MOVANO', 'VAUXHALL', 'MOVANO'],
  ['OPEL', 'INSIGNIA', 'BUICK', 'REGAL'],
  ['OPEL', 'MOKKA', 'BUICK', 'ENCORE'],
  ['OPEL', 'ZAFIRA', 'SUBARU', 'TRAVIQ'],

  /* ── the vans: one van, four or five badges ───────────────────── */
  ['FIAT', 'DUCATO', 'PEUGEOT', 'BOXER'],
  ['FIAT', 'DUCATO', 'CITROEN', 'JUMPER'],
  ['FIAT', 'DUCATO', 'RAM', 'PROMASTER'],
  ['FIAT', 'DUCATO', 'OPEL', 'MOVANO'],
  ['FIAT', 'DUCATO', 'VAUXHALL', 'MOVANO'],
  ['CITROEN', 'JUMPY', 'PEUGEOT', 'EXPERT'],
  ['CITROEN', 'JUMPY', 'FIAT', 'SCUDO'],
  ['CITROEN', 'JUMPY', 'TOYOTA', 'PROACE'],
  ['CITROEN', 'JUMPY', 'OPEL', 'VIVARO'],
  ['CITROEN', 'BERLINGO', 'PEUGEOT', 'PARTNER'],
  ['CITROEN', 'BERLINGO', 'OPEL', 'COMBO'],
  ['CITROEN', 'BERLINGO', 'TOYOTA', 'PROACE CITY'],
  ['CITROEN', 'BERLINGO', 'FIAT', 'DOBLO'],
  ['RENAULT', 'TRAFIC', 'NISSAN', 'PRIMASTAR'],
  ['RENAULT', 'TRAFIC', 'OPEL', 'VIVARO'],
  ['RENAULT', 'TRAFIC', 'VAUXHALL', 'VIVARO'],
  ['RENAULT', 'MASTER', 'NISSAN', 'INTERSTAR'],
  ['RENAULT', 'MASTER', 'OPEL', 'MOVANO'],
  ['RENAULT', 'KANGOO', 'NISSAN', 'KUBISTAR'],
  ['RENAULT', 'KANGOO', 'MERCEDES-BENZ', 'CITAN'],
  ['VOLKSWAGEN', 'CRAFTER', 'MERCEDES-BENZ', 'SPRINTER'],
  ['NISSAN', 'NV200', 'CHEVROLET', 'CITY EXPRESS'],

  /* ── Subaru, Saab and the rest ────────────────────────────────── */
  ['SUBARU', 'IMPREZA', 'SAAB', '9-2X'],
  ['FIAT', '500', 'FORD', 'KA'],

  /* ── Hyundai and Kia ──────────────────────────────────────────── */
  ['HYUNDAI', 'TUCSON', 'KIA', 'SPORTAGE'],
  ['HYUNDAI', 'SONATA', 'KIA', 'OPTIMA'],
  ['HYUNDAI', 'SONATA', 'KIA', 'K5'],
];

const key = (make, model) => `${String(make ?? '').trim().toUpperCase()}|${String(model ?? '').trim().toUpperCase()}`;

/** The list of other names, by name. */
const BY_NAME = new Map();
for (const [make, model, twinMake, twinModel] of PAIRS) {
  const rows = [
    [make, model, twinMake, twinModel],
    [twinMake, twinModel, make, model],
  ];
  for (const [ownMake, ownModel, otherMake, otherModel] of rows) {
    const id = key(ownMake, ownModel);
    const list = BY_NAME.get(id) || [];
    if (!list.some((twin) => key(twin.make, twin.model) === key(otherMake, otherModel))) {
      list.push({ make: otherMake, model: otherModel });
    }
    BY_NAME.set(id, list);
  }
}

/** Every other name the car is sold under. */
export function twinsOf(make, model) {
  return (BY_NAME.get(key(make, model)) || []).slice();
}

/** The first other name, or null when the car has none. */
export function twinOf(make, model) {
  return twinsOf(make, model)[0] || null;
}

/** Every name the car is sold under, its own first. */
export function namesOf(make, model) {
  return [{ make, model }, ...twinsOf(make, model)];
}

export default { PAIRS, twinsOf, twinOf, namesOf };
