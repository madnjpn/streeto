/**
 * Fixed-window in-memory rate limiter.
 *
 * Good enough for a single-process app: it slows down password
 * guessing and stops the geocoding proxy from hammering Nominatim.
 * Swap for a shared store if you ever run multiple instances.
 */
export function rateLimit({
  windowMs = 60_000,
  max = 30,
  message = 'Too many requests. Slow down and try again shortly.',
  keyFn = (req) => req.ip,
} = {}) {
  const hits = new Map();

  // Keep memory bounded on a long-running process.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (typeof timer.unref === 'function') timer.unref();

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = keyFn(req) || 'unknown';
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      const error = new Error(typeof message === 'function' ? message(req) : message);
      error.status = 429;
      return next(error);
    }
    return next();
  };
}

export default rateLimit;
