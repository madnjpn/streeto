import express from 'express';
import * as meetups from '../models/meetups.js';
import * as users from '../models/users.js';
import * as groups from '../models/groups.js';
import * as friends from '../models/friends.js';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { cleanText, checkCoords, checkZoom } from '../lib/validate.js';
import { routeDistanceKm } from '../lib/route-length.js';
import { backTo, wantsJson, jsonOk, jsonError, pagination } from '../lib/http.js';

const router = express.Router();
const PRIVACIES = ['open', 'private', 'invite'];
const CATEGORIES = ['meetup', 'track_day', 'show', 'cruise', 'touge'];
const SCOPES = {
  upcoming: 'Upcoming',
  going: 'Going',
  mine: 'Hosting',
  past: 'Past',
};

/* ── list ─────────────────────────────────────────────────────── */
router.get('/meetups', (req, res) => {
  const scope = SCOPES[req.query.scope] ? req.query.scope : 'upcoming';
  const q = String(req.query.q ?? '').trim();
  const { page, perPage, offset } = pagination(req.query, { perPage: 18 });
  const viewerId = req.user?.id ?? 0;

  return res.page('meetups/index', {
    title: `Meetups - ${req.app.locals.config.siteName}`,
    active: 'meetups',
    scope,
    scopes: SCOPES,
    q,
    page,
    items: meetups.list({ scope, viewerId, q, limit: perPage, offset }),
    total: meetups.countFor({ scope, viewerId }),
    myGroups: req.user ? groups.myGroups(req.user.id).filter((group) => group.status === 'active') : [],
  });
});

/* ── host a meetup ────────────────────────────────────────────── */
router.get('/meetups/new', requireAuth, (req, res) => {
  const groupSlug = String(req.query.group ?? '');
  const group = groupSlug ? groups.bySlug(groupSlug) : null;
  const canAttach = group && groups.isActiveMember(group.id, req.user.id);

  return res.page('meetups/new', {
    title: `Host a meetup - ${req.app.locals.config.siteName}`,
    active: 'meetups',
    errors: {},
    values: {
      title: '',
      description: '',
      place_name: '',
      address: '',
      lat: req.query.lat ?? '',
      lng: req.query.lng ?? '',
      starts_at: '',
      privacy: 'open',
      capacity: '',
      category: req.query.category ?? 'meetup',
      entry_fee: '',
      route_start_lat: '',
      route_start_lng: '',
      route_start_name: '',
      route_end_lat: '',
      route_end_lng: '',
      route_end_name: '',
      route_view: '',
    },
    group: canAttach ? group : null,
    privacies: PRIVACIES,
    myGroups: groups.myGroups(req.user.id).filter((row) => row.status === 'active'),
  });
});

/** Accepts `YYYY-MM-DDTHH:mm` from a datetime-local input. */
function parseStart(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** A coordinate pair from the form, or null when either half is missing. */
function coordsOrNull(lat, lng) {
  const pair = checkCoords(lat, lng);
  return pair.ok ? pair : null;
}

/** The camera the host left the route map at, as { lat, lng, zoom }. */
function parseRouteView(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const view = JSON.parse(value);
    const lat = Number(view.lat);
    const lng = Number(view.lng);
    const zoom = Number(view.zoom);
    if (![lat, lng, zoom].every(Number.isFinite)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (zoom < 0 || zoom > 22) return null;
    return { lat, lng, zoom };
  } catch {
    return null;
  }
}

router.post('/meetups/new', requireAuth, verifyCsrf, async (req, res) => {
  const title = cleanText(req.body.title ?? '', 100);
  const description = cleanText(req.body.description ?? '', 2000);
  const placeName = cleanText(req.body.place_name ?? '', 160);
  const address = cleanText(req.body.address ?? '', 240);
  const privacy = PRIVACIES.includes(req.body.privacy) ? req.body.privacy : 'open';
  const capacity = Number.parseInt(req.body.capacity, 10);
  const startsAt = parseStart(req.body.starts_at);
  const groupSlug = String(req.body.group ?? '');
  const group = groupSlug ? groups.bySlug(groupSlug) : null;
  const attachGroup = group && groups.isActiveMember(group.id, req.user.id) ? group : null;
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'meetup';
  const entryFee = cleanText(req.body.entry_fee ?? '', 80) || null;
  const isTouge = category === 'touge';

  // The route: start (A) and finish (B) for a touge run.
  const routeStart = coordsOrNull(req.body.route_start_lat, req.body.route_start_lng);
  const routeEnd = coordsOrNull(req.body.route_end_lat, req.body.route_end_lng);
  const routeStartName = cleanText(req.body.route_start_name ?? '', 160);
  const routeEndName = cleanText(req.body.route_end_name ?? '', 160);
  const routeViewRaw = String(req.body.route_view ?? '').trim();
  const routeView = parseRouteView(routeViewRaw);

  // For a touge the start point is the meeting spot, so its name stands
  // in when the map itself has not named the place.
  const spotName = placeName || (isTouge ? routeStartName : '');

  // A touge run can use its start point as the meeting spot, so a spot is
  // only missing when there is neither a pinned place nor an A point.
  const spot = coordsOrNull(req.body.lat, req.body.lng) || (isTouge ? routeStart : null);
  const zoom = spot ? checkZoom(req.body.zoom) : null;

  const errors = {};
  if (title.length < 3) errors.title = 'Give the meetup a title.';
  if (!startsAt) errors.starts_at = 'Pick a date and time.';
  if (!placeName && !spot) errors.place_name = 'Search a street or use your GPS so people can find the spot.';
  if (Number.isFinite(capacity) && capacity < 1) errors.capacity = 'Capacity must be at least 1.';
  if (isTouge && (!routeStart || !routeEnd)) {
    errors.route = 'Pick the start (A) and the finish (B) on the map.';
  }

  const values = {
    title,
    description,
    place_name: placeName,
    address,
    lat: req.body.lat ?? '',
    lng: req.body.lng ?? '',
    zoom: req.body.zoom ?? '',
    starts_at: req.body.starts_at ?? '',
    privacy,
    capacity: req.body.capacity ?? '',
    category,
    entry_fee: req.body.entry_fee ?? '',
    route_start_lat: req.body.route_start_lat ?? '',
    route_start_lng: req.body.route_start_lng ?? '',
    route_start_name: routeStartName,
    route_end_lat: req.body.route_end_lat ?? '',
    route_end_lng: req.body.route_end_lng ?? '',
    route_end_name: routeEndName,
    route_view: routeViewRaw,
  };

  if (Object.keys(errors).length) {
    return res.status(400).page('meetups/new', {
      title: `Host a meetup - ${req.app.locals.config.siteName}`,
      active: 'meetups',
      errors,
      values,
      group: attachGroup,
      privacies: PRIVACIES,
      myGroups: groups.myGroups(req.user.id).filter((row) => row.status === 'active'),
    });
  }

  // The routed length knows the bends; it falls back to a straight line
  // with a road factor when the routing engine is unreachable.
  let routeDistance = null;
  if (isTouge && routeStart && routeEnd) {
    routeDistance = (await routeDistanceKm(routeStart, routeEnd)).km;
  }

  const meetup = meetups.createMeetup({
    hostId: req.user.id,
    title,
    description,
    placeName: spotName || null,
    address: address || null,
    lat: spot ? spot.lat : null,
    lng: spot ? spot.lng : null,
    zoom,
    startsAt,
    privacy,
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
    groupId: attachGroup?.id ?? null,
    category,
    entryFee,
    routeStartLat: routeStart?.lat ?? null,
    routeStartLng: routeStart?.lng ?? null,
    routeStartName: routeStartName || null,
    routeEndLat: routeEnd?.lat ?? null,
    routeEndLng: routeEnd?.lng ?? null,
    routeEndName: routeEndName || null,
    routeDistanceKm: routeDistance,
    routeView: routeView ? JSON.stringify(routeView) : null,
  });

  // In a private/invite meetup nobody finds it by browsing, so the host
  // gets a nudge to invite people.
  req.flash('success', privacy === 'open' ? 'Meetup is live.' : 'Meetup created - now invite your people.');
  return res.redirect(`/meetups/${meetup.id}`);
});

/* ── one meetup ───────────────────────────────────────────────── */
router.get('/meetups/:id', (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();

  const viewerId = req.user?.id ?? 0;
  if (!meetups.canView(meetup, viewerId)) {
    req.flash('error', 'That meetup is invite only.');
    return res.redirect('/meetups');
  }

  const isHost = viewerId === meetup.host_id;
  const list = meetups.attendees(meetup.id);

  return res.page('meetups/show', {
    title: `${meetup.title} - ${req.app.locals.config.siteName}`,
    active: 'meetups',
    meetup,
    isHost,
    staff: meetup.group_id ? groups.staffRole(meetup.group_id, viewerId) : null,
    canManage: isHost || (meetup.group_id ? Boolean(groups.staffRole(meetup.group_id, viewerId)) : false),
    join: meetups.joinability(meetup, viewerId),
    going: list.filter((row) => row.status === 'going'),
    invited: list.filter((row) => row.status === 'invited'),
    maybe: list.filter((row) => row.status === 'maybe'),
    requested: list.filter((row) => row.status === 'requested'),
    groupMeetups: meetup.group_id
      ? meetups.list({ scope: 'group', groupId: meetup.group_id, viewerId, limit: 4 })
      : [],
  });
});

/* ── join / leave / invite ────────────────────────────────────── */
router.post('/meetups/:id/join', requireAuth, verifyCsrf, (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();
  if (!meetups.canView(meetup, req.user.id)) {
    if (wantsJson(req)) return jsonError(res, req.t('Invite only.'), 403);
    req.flash('error', 'That meetup is invite only.');
    return res.redirect('/meetups');
  }

  const goingCount = meetups.attendees(meetup.id, ['going']).length;
  if (meetup.capacity && goingCount >= meetup.capacity) {
    if (wantsJson(req)) return jsonError(res, 'That meetup is full.');
    req.flash('error', 'That meetup is full.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  if (meetup.privacy === 'private' && meetup.host_id !== req.user.id) {
    meetups.setStatus(meetup.id, req.user.id, 'requested');
    notifications.notify({
      userId: meetup.host_id,
      actorId: req.user.id,
      type: 'meetup_request',
      entityId: meetup.id,
      url: `/meetups/${meetup.id}`,
      text: 'wants a spot at {name}|' + meetup.title,
    });
    if (wantsJson(req)) return jsonOk(res, { status: 'requested' });
    req.flash('success', 'Request sent to the host.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  meetups.setStatus(meetup.id, req.user.id, 'going');
  if (meetup.host_id !== req.user.id) {
    notifications.notify({
      userId: meetup.host_id,
      actorId: req.user.id,
      type: 'meetup_join',
      entityId: meetup.id,
      url: `/meetups/${meetup.id}`,
      text: 'is going to {name}|' + meetup.title,
    });
  }
  if (wantsJson(req)) return jsonOk(res, { status: 'going' });
  req.flash('success', "You're on the list.");
  return res.redirect(`/meetups/${meetup.id}`);
});

router.post('/meetups/:id/maybe', requireAuth, verifyCsrf, (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();

  const current = meetups.attendeeStatus(meetup.id, req.user.id);
  const next_ = current === 'maybe' ? null : 'maybe';
  if (next_) meetups.setStatus(meetup.id, req.user.id, next_);
  else meetups.removeAttendee(meetup.id, req.user.id);

  if (wantsJson(req)) return jsonOk(res, { status: next_ });
  return res.redirect(`/meetups/${meetup.id}`);
});

router.post('/meetups/:id/leave', requireAuth, verifyCsrf, (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();

  if (meetup.host_id === req.user.id) {
    if (wantsJson(req)) return jsonError(res, 'Hosts cannot leave their own meetup - delete it instead.');
    req.flash('error', 'Hosts cannot leave their own meetup - delete it instead.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  meetups.removeAttendee(meetup.id, req.user.id);
  if (wantsJson(req)) return jsonOk(res, { status: null });
  req.flash('success', "You're off the list.");
  return res.redirect(`/meetups/${meetup.id}`);
});

/* ── host-only management ─────────────────────────────────────── */
router.post('/meetups/:id/invite', requireAuth, verifyCsrf, (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();

  const canManage = meetup.host_id === req.user.id ||
    (meetup.group_id && groups.staffRole(meetup.group_id, req.user.id));
  if (!canManage) {
    if (wantsJson(req)) return jsonError(res, 'Only the host can invite people.', 403);
    req.flash('error', 'Only the host can invite people.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  const target = users.findByUsername(String(req.body.username ?? '').replace(/^@/, '').trim());
  if (!target) {
    if (wantsJson(req)) return jsonError(res, 'No driver with that username.');
    req.flash('error', 'No driver with that username.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  meetups.setStatus(meetup.id, target.id, 'invited');
  notifications.notify({
    userId: target.id,
    actorId: req.user.id,
    type: 'meetup_invite',
    entityId: meetup.id,
    url: `/meetups/${meetup.id}`,
    text: 'invited you to {name}|' + meetup.title,
  });

  if (wantsJson(req)) return jsonOk(res, { invited: target.username });
  req.flash('success', '@{user} invited.', { user: target.username });
  return res.redirect(`/meetups/${meetup.id}`);
});

router.post('/meetups/:id/attendees/:userId/approve', requireAuth, verifyCsrf, (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();

  const canManage = meetup.host_id === req.user.id ||
    (meetup.group_id && groups.staffRole(meetup.group_id, req.user.id));
  if (!canManage) {
    req.flash('error', 'Only the host can approve requests.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  const userId = Number(req.params.userId);
  meetups.setStatus(meetup.id, userId, 'going');
  notifications.notify({
    userId,
    actorId: req.user.id,
    type: 'meetup_approved',
    entityId: meetup.id,
    url: `/meetups/${meetup.id}`,
    text: 'approved your spot at {name}|' + meetup.title,
  });
  req.flash('success', 'Approved.');
  return res.redirect(`/meetups/${meetup.id}`);
});

router.post('/meetups/:id/attendees/:userId/remove', requireAuth, verifyCsrf, (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();

  const userId = Number(req.params.userId);
  const canManage = meetup.host_id === req.user.id ||
    (meetup.group_id && groups.staffRole(meetup.group_id, req.user.id));

  if (!canManage && userId !== req.user.id) {
    req.flash('error', 'Only the host can do that.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  meetups.removeAttendee(meetup.id, userId);
  req.flash('success', 'Removed.');
  return res.redirect(`/meetups/${meetup.id}`);
});

router.post('/meetups/:id/delete', requireAuth, verifyCsrf, (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();

  const canManage = req.user.is_admin || meetup.host_id === req.user.id ||
    (meetup.group_id && groups.staffRole(meetup.group_id, req.user.id));
  if (!canManage) {
    req.flash('error', 'Only the host can delete a meetup.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  meetups.remove(meetup.id);
  req.flash('success', 'Meetup cancelled.');
  return res.redirect('/meetups');
});

/** Quick "invite my friends" action for the meetup page. */
router.post('/meetups/:id/invite-friends', requireAuth, verifyCsrf, (req, res, next) => {
  const meetup = meetups.byId(Number(req.params.id));
  if (!meetup) return next();
  if (meetup.host_id !== req.user.id) {
    req.flash('error', 'Only the host can invite people.');
    return res.redirect(`/meetups/${meetup.id}`);
  }

  const list = friends.friends(req.user.id);
  let invited = 0;
  list.forEach((friend) => {
    const status = meetups.attendeeStatus(meetup.id, friend.id);
    if (status) return;
    meetups.setStatus(meetup.id, friend.id, 'invited');
    notifications.notify({
      userId: friend.id,
      actorId: req.user.id,
      type: 'meetup_invite',
      entityId: meetup.id,
      url: `/meetups/${meetup.id}`,
      text: 'invited you to {name}|' + meetup.title,
    });
    invited += 1;
  });

  req.flash('success', invited
    ? req.t(invited === 1 ? 'Invited {n} friend.' : 'Invited {n} friends.', { n: invited })
    : req.t('All your friends are already invited.'));
  return res.redirect(`/meetups/${meetup.id}`);
});

export default router;
