/* ══════════════════════════════════════════════════════════════════
   STREETO — browser translations
   Reads the JSON map the server wrote into #i18n-data (see
   views/partials/i18n-data.ejs). Keys are the English source strings,
   so an unknown key just renders English.
   ══════════════════════════════════════════════════════════════════ */

let strings = {};
const el = document.getElementById('i18n-data');
if (el && el.dataset.json) {
  try {
    strings = JSON.parse(el.dataset.json) || {};
  } catch {
    strings = {};
  }
}

/** Translate `key`, interpolating `{placeholders}` from `vars`. */
export function t(key, vars) {
  const source = String(key ?? '');
  let text = Object.prototype.hasOwnProperty.call(strings, source) ? strings[source] : source;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
    );
  }
  return text;
}

export default t;
