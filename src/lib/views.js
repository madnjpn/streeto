import path from 'node:path';
import ejs from 'ejs';
import { ROOT } from '../config.js';

/**
 * Views root. EJS resolves `include('x')` relative to the file doing the
 * including, so a partial in views/partials that asks for
 * `include('partials/icon')` would look in views/partials/partials.
 * Passing `views: [...]` gives EJS a fallback list, so both
 * `include('icon')` (from inside partials) and `include('partials/icon')`
 * (from a page) resolve to the same file.
 */
export const VIEWS_DIR = path.join(ROOT, 'views');

/**
 * Rendering options.
 *
 * Note: `async: true` is deliberately NOT set. EJS compiles an async
 * template into an async function, and then `<%- include('x') %>` returns
 * a Promise, so every include would have to be written
 * `<%- await include('x') %>`. Nothing in these templates does async work
 * (partials are rendered up-front in the routes), so rendering
 * synchronously keeps `<%- include(...) %>` returning HTML strings.
 */
const OPTIONS = { views: [VIEWS_DIR] };

/** Render views/<name>.ejs (name without the extension). */
export const renderView = (name, data) =>
  ejs.renderFile(path.join(VIEWS_DIR, `${name}.ejs`), data ?? {}, OPTIONS);

export default renderView;
