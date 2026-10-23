import * as builds from '../models/builds.js';
import * as posts from '../models/posts.js';
import * as meetups from '../models/meetups.js';
import * as parts from '../models/parts.js';
import * as maintenance from '../models/maintenance.js';
import { format } from './currency.js';
import { truncate } from './format.js';

/**
 * Sharing a thing in a chat.
 *
 * A driver can hand a build, a post, a meetup, a part or a service to
 * another driver. The card is built here, on the server, from the
 * database - never from what the browser says - so a card can only
 * point at a thing that really exists.
 *
 * The card is a snapshot: the title, the line under it and the picture
 * are written into the message, so it still reads well when the thing
 * is deleted later.
 */

/** The things that can be shared. */
export const SHARE_TYPES = ['build', 'post', 'meetup', 'part', 'service'];

/** What each kind is called in the words of the site. */
export const SHARE_LABELS = {
  build: 'build',
  post: 'Post',
  meetup: 'Meetup',
  part: 'Part',
  service: 'Service',
};

/** The icon each kind carries in the chat. */
export const SHARE_ICONS = {
  build: 'garage',
  post: 'wall',
  meetup: 'pin',
  part: 'tag',
  service: 'wrench',
};

/** The address of a shared thing. */
export const shareUrl = (type, id) => {
  const base = {
    build: '/builds/',
    post: '/posts/',
    meetup: '/meetups/',
    part: '/services/parts/',
    service: '/services/maintenance/',
  }[String(type || '')];
  return base ? `${base}${id}` : '/';
};

/** A price the way the seller wrote it. */
const priceOf = (amount, currency) => {
  if (amount === null || amount === undefined || amount === '') return '';
  return format(Number(amount), currency || 'GEL');
};

/** The card of a shared thing, or null when there is nothing to share. */
export function shareCard(type, id, viewerId = 0) {
  const thingId = Number(id);
  if (!Number.isInteger(thingId) || thingId <= 0) return null;

  switch (String(type || '')) {
    case 'build': {
      const build = builds.byId(thingId, viewerId);
      if (!build) return null;
      const spec = [build.year, build.make, build.model].filter(Boolean).join(' ');
      const bits = [spec];
      if (build.for_sale) bits.push(priceOf(build.price, build.currency) || 'For sale');
      return {
        type: 'build',
        id: build.id,
        title: build.title || 'Build',
        text: bits.filter(Boolean).join(' · '),
        image: build.cover || null,
        url: `/builds/${build.id}`,
      };
    }
    case 'post': {
      const post = posts.byId(thingId, viewerId);
      if (!post) return null;
      const body = String(post.body || '').trim();
      return {
        type: 'post',
        id: post.id,
        title: truncate(body.split('\n')[0] || 'Post', 90),
        text: post.place_name ? post.place_name : `@${post.username}`,
        image: post.media_type === 'photo' ? post.media_path : null,
        url: `/posts/${post.id}`,
      };
    }
    case 'meetup': {
      const meetup = meetups.byId(thingId);
      if (!meetup) return null;
      const where = meetup.place_name || meetup.address || '';
      return {
        type: 'meetup',
        id: meetup.id,
        title: meetup.title || 'Meetup',
        text: where,
        image: null,
        url: `/meetups/${meetup.id}`,
      };
    }
    case 'part': {
      const part = parts.byId(thingId);
      if (!part) return null;
      const bits = [priceOf(part.price, part.currency), part.location].filter(Boolean);
      return {
        type: 'part',
        id: part.id,
        title: part.title || 'Part',
        text: bits.join(' · '),
        image: part.cover || null,
        url: `/services/parts/${part.id}`,
      };
    }
    case 'service': {
      const service = maintenance.byId(thingId);
      if (!service) return null;
      const where = service.place_name || service.address || '';
      return {
        type: 'service',
        id: service.id,
        title: service.title || 'Service',
        text: where,
        image: service.cover || null,
        url: `/services/maintenance/${service.id}`,
      };
    }
    default:
      return null;
  }
}

/** The share fields of a message, ready for the database. */
export const shareFields = (card) => ({
  share_type: card?.type || null,
  share_id: card?.id || null,
  share_title: card?.title || null,
  share_text: card?.text || null,
  share_image: card?.image || null,
});

export default { SHARE_TYPES, SHARE_LABELS, SHARE_ICONS, shareCard, shareFields, shareUrl };
