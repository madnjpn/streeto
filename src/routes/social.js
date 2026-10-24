/**
 * Public discovery endpoints: sitemap, robots and social preview cards.
 * These routes never require a session; they only expose things a guest
 * can already open.
 */
import express from 'express';
import config from '../config.js';
import { all } from '../db.js';
import * as builds from '../models/builds.js';
import * as meetups from '../models/meetups.js';
import { renderOgImage } from '../lib/og-image.js';

const router = express.Router();

const baseUrl = (config.publicUrl || 'https://streeto.net').replace(/\/+$/, '');
const abs = (value) => `${baseUrl}${String(value || '').startsWith('/') ? '' : '/'}${value || ''}`;
const xml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const isTouge = (meetup) =>
  meetup?.category === 'touge' &&
  meetup.route_start_lat != null &&
  meetup.route_start_lng != null &&
  meetup.route_end_lat != null &&
  meetup.route_end_lng != null;

router.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /settings',
      'Disallow: /notifications',
      'Disallow: /chat',
      'Disallow: /api',
      '',
      `Sitemap: ${baseUrl}/sitemap.xml`,
      '',
    ].join('\n'),
  );
});

router.get('/sitemap.xml', (_req, res) => {
  const entries = [];
  const add = (url, lastmod) => entries.push({ url, lastmod });
  for (const url of ['/', '/explore', '/builds', '/groups', '/meetups', '/services', '/partners', '/about']) {
    add(url, null);
  }

  for (const row of all(
    "SELECT id, created_at FROM builds WHERE visibility = 'public' ORDER BY id DESC LIMIT 5000",
  )) {
    add(`/builds/${row.id}`, row.created_at);
  }
  for (const row of all(
    "SELECT id, created_at, category, route_start_lat, privacy FROM meetups WHERE privacy <> 'invite' ORDER BY id DESC LIMIT 5000",
  )) {
    add(`/meetups/${row.id}`, row.created_at);
    if (row.privacy === 'open' && row.category === 'touge' && row.route_start_lat != null) {
      add(`/routes/${row.id}`, row.created_at);
    }
  }
  for (const row of all(
    "SELECT id, slug, created_at FROM groups WHERE privacy <> 'invite' ORDER BY id DESC LIMIT 5000",
  )) {
    add(`/groups/${row.slug}`, row.created_at);
  }
  for (const row of all('SELECT id, created_at FROM parts ORDER BY id DESC LIMIT 5000')) {
    add(`/services/parts/${row.id}`, row.created_at);
  }
  for (const row of all('SELECT id, created_at FROM services ORDER BY id DESC LIMIT 5000')) {
    add(`/services/maintenance/${row.id}`, row.created_at);
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    ({ url, lastmod }) =>
      `  <url><loc>${xml(abs(url))}</loc>${lastmod ? `<lastmod>${xml(String(lastmod).slice(0, 10))}</lastmod>` : ''}</url>`,
  )
  .join('\n')}
</urlset>`;
  res.type('application/xml').set('Cache-Control', 'public, max-age=1800').send(body);
});

router.get('/og/build/:id.png', async (req, res, next) => {
  const build = builds.byId(Number(req.params.id), 0);
  if (!build || build.visibility !== 'public') return next();
  const spec = [build.year, build.make, build.model].filter(Boolean).join(' ');
  const image = await renderOgImage({
    key: `build:${build.id}:${build.cover || ''}`,
    eyebrow: 'BUILD',
    title: build.title || 'Build',
    subtitle: [spec, build.engine].filter(Boolean).join(' · '),
    meta: `@${build.username} · ${build.vote_count || 0} votes · streeto.net`,
    coverPath: build.cover,
    accent: '#1fe0ff',
  });
  res.type('png').set('Cache-Control', 'public, max-age=3600').send(image);
});

router.get('/og/meetup/:id.png', async (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup || !meetups.canView(meetup, 0)) return next();
  const place = meetup.place_name || meetup.address || 'Location in the app';
  const image = await renderOgImage({
    key: `meetup:${meetup.id}:${meetup.title}`,
    eyebrow: isTouge(meetup) ? 'TOUGE ROUTE' : 'MEETUP',
    title: meetup.title || 'Meetup',
    subtitle: `${place} · ${new Date(meetup.starts_at).toLocaleDateString('en-GB')}`,
    meta: `@${meetup.host_username} · ${meetup.going_count || 0} going · streeto.net`,
    accent: isTouge(meetup) ? '#ffb02e' : '#1fe0ff',
  });
  res.type('png').set('Cache-Control', 'public, max-age=3600').send(image);
});

router.get('/og/route/:id.png', async (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup || meetup.privacy !== 'open' || !isTouge(meetup) || !meetups.canView(meetup, 0)) return next();
  const start = meetup.route_start_name || 'Start';
  const finish = meetup.route_end_name || 'Finish';
  const image = await renderOgImage({
    key: `route:${meetup.id}:${meetup.route_distance_km || ''}`,
    eyebrow: 'TOUGE ROUTE',
    title: meetup.title || 'Touge route',
    subtitle: `${start} → ${finish}`,
    meta: [
      meetup.route_distance_km != null ? `${Number(meetup.route_distance_km).toFixed(1)} km` : null,
      meetup.starts_at ? new Date(meetup.starts_at).toLocaleDateString('en-GB') : null,
      'streeto.net',
    ].filter(Boolean).join(' · '),
    accent: '#ffb02e',
  });
  res.type('png').set('Cache-Control', 'public, max-age=3600').send(image);
});

export default router;
