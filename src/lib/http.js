/** Small HTTP helpers shared by the route modules. */

/** True when the request came from our own fetch() code. */
export const wantsJson = (req) =>
  req.get('x-requested-with') === 'fetch' ||
  (req.is('application/json') === 'application/json' && !req.is('application/x-www-form-urlencoded'));

/**
 * Redirect back where the form was submitted from, but only to our own
 * origin - a spoofed Referer must not turn into an open redirect.
 */
export function backTo(req, fallback = '/') {
  const referer = req.get('referer');
  if (!referer) return fallback;
  try {
    const target = new URL(referer);
    if (target.host !== req.get('host')) return fallback;
    const path = `${target.pathname}${target.search}`;
    return path.startsWith('/') ? path : fallback;
  } catch {
    return fallback;
  }
}

/** Shared paging maths for the wall, groups, chat and meetups. */
export function pagination(query, { perPage = 20, maxPage = 500 } = {}) {
  const page = Math.min(Math.max(Number.parseInt(query.page, 10) || 1, 1), maxPage);
  return { page, perPage, offset: (page - 1) * perPage };
}

export const jsonOk = (res, data = {}) => res.json({ ok: true, ...data });

export const jsonError = (res, error, status = 400, extra = null) =>
  res.status(status).json({ ok: false, error, ...(extra || {}) });

/** 403 helper for route guards. */
export function forbidden(message = 'You do not have access to that.') {
  const error = new Error(message);
  error.status = 403;
  return error;
}

export function notFoundError(message = 'Not found.') {
  const error = new Error(message);
  error.status = 404;
  return error;
}

export default { wantsJson, backTo, pagination, jsonOk, jsonError, forbidden, notFoundError };

/** Flash an error and redirect back. */
export function fail(req, res, message) {
  if (wantsJson(req)) return jsonError(res, req.t(message));
  req.flash('error', message);
  return res.redirect(backTo(req, '/'));
}
