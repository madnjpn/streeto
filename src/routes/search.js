import express from 'express';
import * as users from '../models/users.js';
import * as groups from '../models/groups.js';
import * as meetups from '../models/meetups.js';
import * as posts from '../models/posts.js';
import * as friends from '../models/friends.js';
import * as parts from '../models/parts.js';
import * as maintenance from '../models/maintenance.js';
import { get, all } from '../db.js';

const router = express.Router();

const TYPES = ['people', 'groups', 'meetups', 'builds', 'parts', 'services', 'posts'];

/** Global search: people, groups, meetups, builds, parts, services, posts. */
router.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const viewerId = req.user?.id ?? 0;
  const type = TYPES.includes(req.query.type) ? req.query.type : 'all';

  if (!q) {
    return res.page('search', {
      title: `Search - ${req.app.locals.config.siteName}`,
      active: 'search',
      q,
      type,
      people: [],
      groups: [],
      meetups: [],
      builds: [],
      parts: [],
      services: [],
      posts: [],
      partCategories: parts.CATEGORIES,
      serviceCategories: maintenance.CATEGORIES,
      suggestions: req.user ? users.suggestions(req.user.id, 12) : [],
    });
  }

  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const people =
    type === 'all' || type === 'people'
      ? users.search(q, { excludeId: viewerId, limit: 20 }).map((person) => ({
          ...person,
          relationship: req.user ? friends.relationship(viewerId, person.id) : { status: null },
        }))
      : [];

  const groupHits =
    type === 'all' || type === 'groups'
      ? groups.directory({ q, userId: viewerId, limit: 12 })
      : [];

  const meetupHits =
    type === 'all' || type === 'meetups'
      ? meetups.list({ scope: 'upcoming', viewerId, q, limit: 12 })
      : [];

  let buildHits = [];
  if (type === 'all' || type === 'builds') {
    // Public builds only - private garages stay private.
    buildHits = all(
      `SELECT b.id, b.title, b.make, b.model, b.year, b.engine, b.cover, b.visibility,
              b.power_hp, b.drivetrain, b.created_at,
              u.username, u.display_name, u.avatar,
              (SELECT COUNT(*) FROM build_votes bv WHERE bv.build_id = b.id) AS vote_count
         FROM builds b JOIN users u ON u.id = b.user_id
        WHERE b.visibility = 'public'
          AND (b.title LIKE :like ESCAPE '\\'
               OR b.make LIKE :like ESCAPE '\\'
               OR b.model LIKE :like ESCAPE '\\'
               OR b.engine LIKE :like ESCAPE '\\')
        ORDER BY vote_count DESC, b.created_at DESC
        LIMIT 12`,
      { like },
    );
  }

  // Parts and maintenance listings use the same free-text search their own
  // boards use (title, description, seller, location).
  const partHits = type === 'all' || type === 'parts' ? parts.feed({ q, limit: 12 }) : [];
  const serviceHits = type === 'all' || type === 'services' ? maintenance.feed({ q, limit: 12 }) : [];

  let postHits = [];
  if (type === 'all' || type === 'posts') {
    const tagQuery = q.startsWith('#') ? q.slice(1).toLowerCase() : null;
    if (tagQuery) {
      postHits = posts.postsByTag(tagQuery, { viewerId, limit: 15 });
    } else {
      // Public wall posts only - group content stays inside the group.
      postHits = all(
        `SELECT p.id, p.body, p.created_at, p.post_type, p.media_type, p.media_path,
                u.username, u.display_name, u.avatar
           FROM posts p JOIN users u ON u.id = p.user_id
          WHERE p.group_id IS NULL AND p.body LIKE :like ESCAPE '\\'
          ORDER BY p.created_at DESC LIMIT 15`,
        { like },
      );
    }
  }

  return res.page('search', {
    title: `Search: ${q} - ${req.app.locals.config.siteName}`,
    active: 'search',
    q,
    type,
    people,
    groupHits,
    meetups: meetupHits,
    builds: buildHits,
    parts: partHits,
    services: serviceHits,
    partCategories: parts.CATEGORIES,
    serviceCategories: maintenance.CATEGORIES,
    posts: postHits,
    suggestions: [],
    total: people.length + groupHits.length + meetupHits.length + buildHits.length
      + partHits.length + serviceHits.length + postHits.length,
  });
});

export default router;
