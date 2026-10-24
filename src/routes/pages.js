import express from 'express';
import * as users from '../models/users.js';
import * as groups from '../models/groups.js';
import * as meetups from '../models/meetups.js';
import * as posts from '../models/posts.js';
import * as builds from '../models/builds.js';
import * as partners from '../models/partners.js';
import * as howitworks from '../models/howitworks.js';
import { get, all, count } from '../db.js';
import config from '../config.js';
import { DEFAULT_LATIN, DEFAULT_GEORGIAN } from '../models/appearance.js';
import { checkCoords, cleanText } from '../lib/validate.js';

/**
 * Built-in Latin (English) pairings: a display font for headings and a
 * text font for the body. Fallbacks are specific family names only -
 * the generic families are appended once by the layout, after the
 * Georgian font, so they never steal Georgian letters.
 */
export const latinFonts = [
  DEFAULT_LATIN,
  {
    name: 'Inter / Inter',
    heading: 'Inter',
    headingFallback: 'Arial',
    body: 'Inter',
    bodyFallback: 'Arial',
    description: 'Modern neutral sans, unified heading and body',
  },
  {
    name: 'Roboto / Roboto',
    heading: 'Roboto',
    headingFallback: 'Arial',
    body: 'Roboto',
    bodyFallback: 'Arial',
    description: 'Clean, familiar, unified heading and body',
  },
  {
    name: 'Oswald / Fira Sans',
    heading: 'Oswald',
    headingFallback: "'Arial Narrow', Impact",
    body: 'Fira Sans',
    bodyFallback: 'Arial',
    description: 'Condensed headlines with a friendly text face',
  },
  {
    name: 'Fira Sans Condensed / Fira Sans',
    heading: 'Fira Sans Condensed',
    headingFallback: "'Arial Narrow', Arial",
    body: 'Fira Sans',
    bodyFallback: 'Arial',
    description: 'Tight headlines, easy body text',
  },
  {
    name: 'Roboto Serif / Roboto',
    heading: 'Roboto Serif',
    headingFallback: 'Georgia',
    body: 'Roboto',
    bodyFallback: 'Arial',
    description: 'Serif headlines with a neutral sans body',
  },
  {
    name: 'Nunito / Nunito Sans',
    heading: 'Nunito',
    headingFallback: 'Arial',
    body: 'Nunito Sans',
    bodyFallback: 'Arial',
    description: 'Rounded and friendly',
  },
  {
    name: 'Manrope / Manrope',
    heading: 'Manrope',
    headingFallback: 'Arial',
    body: 'Manrope',
    bodyFallback: 'Arial',
    description: 'Modern geometric, unified heading and body',
  },
];

/** Built-in Georgian fonts (single family, used for headings and body). */
export const georgianFonts = [
  DEFAULT_GEORGIAN,
  {
    name: 'Noto Serif Georgian',
    family: 'Noto Serif Georgian',
    description: 'Serif Georgian with a classic feel',
  },
];

const router = express.Router();

router.get('/about', (req, res) =>
  res.page('pages/about', {
    title: `How it works - ${config.siteName}`,
    active: 'about',
    bodyClass: 'page-about',
    howSections: howitworks.sections(),
  }),
);

/** Trending / explore page. */
router.get('/explore', (req, res) => {
  const viewerId = req.user?.id ?? 0;

  // "Hot posts" - public posts ranked by engagement (likes + comments) from the last week,
  // not just most recent. Avoids brand-new posts dominating the section.
  const topPosts = all(
    `SELECT p.id, p.body, p.created_at, p.post_type, p.media_type, p.media_path,
            u.username, u.display_name, u.avatar,
            (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
      WHERE p.group_id IS NULL
        AND p.privacy = 'public'
        AND p.created_at >= datetime('now', '-7 days')
      ORDER BY (like_count + comment_count) DESC, p.created_at DESC
      LIMIT 10`,
  );

  const hotBuilds = all(
    `SELECT b.id, b.title, b.make, b.model, b.year, b.cover, b.visibility,
            u.username, u.display_name, u.avatar,
            (SELECT COUNT(*) FROM build_votes bv WHERE bv.build_id = b.id) AS vote_count
       FROM builds b JOIN users u ON u.id = b.user_id
      WHERE b.visibility = 'public'
      ORDER BY vote_count DESC, b.created_at DESC
      LIMIT 8`,
  );
  const upcoming = meetups.list({ scope: 'upcoming', viewerId, limit: 6 });
  const activeGroups = groups.directory({ q: '', userId: viewerId, limit: 8 });
  const trending = posts.trendingTags(7, 12);
  // Cars on the market, newest first - the same feed the For sale tab uses.
  const saleBuilds = builds.feed({ scope: 'sale', viewerId, sort: 'new', limit: 4 });

  return res.page('pages/explore', {
    title: `Explore - ${config.siteName}`,
    active: 'explore',
    bodyClass: 'page-explore',
    topPosts,
    hotBuilds,
    saleBuilds,
    upcoming,
    activeGroups,
    trending,
  });
});

/** Great-circle distance in km, used only for the local discovery page. */
function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const containsCity = (value, city) =>
  Boolean(city) && String(value || '').toLocaleLowerCase().includes(city.toLocaleLowerCase());

/** City/region discovery: nearby meetups, crews and drivers. */
router.get('/near', (req, res) => {
  const viewerId = req.user?.id ?? 0;
  const coords = checkCoords(req.query.lat, req.query.lng);
  const city = cleanText(req.query.city ?? '', 80) || (!coords.ok ? (req.user?.city || '') : '');
  const cities = all(
    `SELECT city, COUNT(*) AS n FROM users
      WHERE city IS NOT NULL AND TRIM(city) <> ''
      GROUP BY city ORDER BY n DESC, city COLLATE NOCASE LIMIT 80`,
  );

  let meetupList = meetups.list({ scope: 'upcoming', viewerId, limit: 100 });
  if (coords.ok) {
    meetupList = meetupList
      .map((meetup) => {
        const lat = meetup.lat ?? meetup.route_start_lat;
        const lng = meetup.lng ?? meetup.route_start_lng;
        return lat != null && lng != null
          ? { ...meetup, distance_km: distanceKm(coords.lat, coords.lng, lat, lng) }
          : meetup;
      })
      .filter((meetup) => meetup.distance_km != null && meetup.distance_km <= 200)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, 8);
  } else if (city) {
    meetupList = meetupList
      .filter((meetup) => containsCity(meetup.place_name, city) || containsCity(meetup.address, city))
      .slice(0, 8);
  } else {
    meetupList = meetupList.slice(0, 8);
  }

  const nearbyGroupIds = new Set(meetupList.map((meetup) => meetup.group_id).filter(Boolean));
  let groupList = all(
    `SELECT g.*, u.city AS owner_city, u.username AS owner_username,
            (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'active') AS member_count,
            (SELECT COUNT(*) FROM posts p WHERE p.group_id = g.id) AS post_count,
            (SELECT gm.status FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = :me) AS status
       FROM groups g JOIN users u ON u.id = g.owner_id
      WHERE g.privacy <> 'invite'
      ORDER BY member_count DESC, g.created_at DESC
      LIMIT 100`,
    { me: viewerId },
  );
  if (city) {
    groupList = groupList.filter(
      (group) =>
        containsCity(group.owner_city, city) ||
        containsCity(group.name, city) ||
        containsCity(group.description, city) ||
        nearbyGroupIds.has(group.id),
    );
  } else if (coords.ok) {
    groupList = groupList.filter((group) => nearbyGroupIds.has(group.id));
  }
  groupList = groupList.slice(0, 6);

  let drivers = [];
  if (city) {
    drivers = users.search(city, { excludeId: viewerId, limit: 6 });
  } else if (viewerId) {
    drivers = users.recentMembers(6).filter((person) => person.id !== viewerId);
  }

  return res.page('pages/near', {
    title: `Near you - ${config.siteName}`,
    active: 'near',
    bodyClass: 'page-near',
    city,
    cities,
    coords,
    meetups: meetupList,
    groups: groupList,
    drivers,
    pageScripts: [`/assets/${res.locals.assetStamp}/js/near.js`],
  });
});

/** Install the web app / PWA on iPhone, Android or desktop. */
router.get('/install', (req, res) =>
  res.page('pages/install', {
    title: `Install STREETO - ${config.siteName}`,
    active: 'install',
    bodyClass: 'page-install',
    pageScripts: [`/assets/${res.locals.assetStamp}/js/install.js`],
  }),
);

/* ── partners page ─────────────────────────────────────────────── */
router.get('/partners', (req, res) => {
  const viewerId = req.user?.id ?? 0;
  const partnersList = partners.list();
  return res.page('pages/partners', {
    title: `Partners - ${config.siteName}`,
    active: 'partners',
    // The wall needs the room: a logo is worth showing big.
    wide: true,
    partners: partnersList,
  });
});

export default router;