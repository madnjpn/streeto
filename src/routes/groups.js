import express from 'express';
import * as groups from '../models/groups.js';
import * as posts from '../models/posts.js';
import * as users from '../models/users.js';
import * as friends from '../models/friends.js';
import * as meetups from '../models/meetups.js';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { groupUpload, postUpload, removeUpload, optimizeAs } from '../lib/uploads.js';
import { buildPost } from '../lib/post-form.js';
import { shareCard, shareUrl, SHARE_LABELS } from '../lib/share.js';
import { cleanText } from '../lib/validate.js';
import { backTo, wantsJson, jsonOk, jsonError, pagination } from '../lib/http.js';

const router = express.Router();
const PRIVACIES = ['open', 'private', 'invite'];

/** Resolve :slug once per request. Invite-only groups stay hidden from
 *  people who are not members or invitees; open and private groups are
 *  loadable so a non-member can see the locked page and ask to join. */
function loadGroup(req, res, next) {
  const group = groups.bySlug(req.params.slug);
  if (!group) return next();

  const viewerId = req.user?.id ?? 0;
  const row = viewerId ? groups.membership(group.id, viewerId) : null;
  const invitedOrMember = Boolean(row && (row.status === 'active' || row.status === 'invited'));

  if (group.privacy === 'invite' && !invitedOrMember) {
    req.flash('error', 'That group is invite only. Ask a member for an invite.');
    return res.redirect('/groups');
  }

  req.group = group;
  req.membershipRow = row;
  req.staff = viewerId ? groups.staffRole(group.id, viewerId) : null;
  return next();
}

/* ── directory ────────────────────────────────────────────────── */
router.get('/groups', (req, res) => {
  const view = req.query.view === 'mine' ? 'mine' : 'all';
  const q = String(req.query.q ?? '').trim();

  return res.page('groups/index', {
    title: `Groups - ${req.app.locals.config.siteName}`,
    active: 'groups',
    view,
    q,
    groups: groups.directory({ q, userId: req.user?.id ?? 0, limit: 40 }),
    myGroups: req.user ? groups.myGroups(req.user.id) : [],
  });
});

/* ── create ───────────────────────────────────────────────────── */
router.get('/groups/new', requireAuth, (req, res) =>
  res.page('groups/new', {
    title: `Start a group - ${req.app.locals.config.siteName}`,
    active: 'groups',
    errors: {},
    values: { name: '', description: '', privacy: 'open' },
    privacies: PRIVACIES,
  }),
);

router.post('/groups/new', requireAuth, groupUpload, optimizeAs('group'), verifyCsrf, (req, res) => {
  const name = cleanText(req.body.name ?? '', 60);
  const description = cleanText(req.body.description ?? '', 800);
  const privacy = PRIVACIES.includes(req.body.privacy) ? req.body.privacy : 'open';
  const errors = {};

  if (name.length < 3) errors.name = 'Give the group a name of at least 3 characters.';

  if (Object.keys(errors).length) {
    if (req.file) removeUpload(req.file.filename);
    return res.status(400).page('groups/new', {
      title: `Start a group - ${req.app.locals.config.siteName}`,
      active: 'groups',
      errors,
      values: { name, description, privacy },
      privacies: PRIVACIES,
    });
  }

  const group = groups.createGroup({
    name,
    description,
    privacy,
    ownerId: req.user.id,
    avatar: req.file ? req.file.filename : null,
  });

  req.flash('success', 'Group "{name}" is live. Invite your people.', { name: group.name });
  return res.redirect(`/groups/${group.slug}`);
});

/* ── one group ────────────────────────────────────────────────── */
router.get('/groups/:slug', loadGroup, (req, res, next) => {
  const group = req.group;
  // A slug that is not a group at all.
  if (!group) return next();
  const { page, perPage, offset } = pagination(req.query, { perPage: 15 });
  const isMember = req.membershipRow?.status === 'active';

  if (!isMember && group.privacy !== 'open') {
    return res.page('groups/locked', {
      title: `${group.name} - ${req.app.locals.config.siteName}`,
      active: 'groups',
      group,
      membership: req.membershipRow,
    });
  }

  const items = posts.feed({
    scope: 'group',
    groupId: group.id,
    viewerId: req.user?.id ?? 0,
    limit: perPage,
    offset,
  });

  return res.page('groups/show', {
    title: `${group.name} - ${req.app.locals.config.siteName}`,
    active: 'groups',
    group,
    membership: req.membershipRow,
    isMember,
    staff: req.staff,
    items,
    page,
    hasMore: items.length === perPage,
    postCount: posts.countFor({ scope: 'group', groupId: group.id }),
    members: groups.members(group.id, ['active']),
    pending: req.staff ? groups.members(group.id, ['pending']) : [],
    invited: groups.members(group.id, ['invited']),
    groupMeetups: meetups.list({ scope: 'group', groupId: group.id, viewerId: req.user?.id ?? 0, limit: 5 }),
    pinned: posts.feed({ scope: 'location', groupId: group.id, viewerId: req.user?.id ?? 0, limit: 4 }),
    section: 'feed',
  });
});

/* ── group admin / members / shared spots tabs ────────────────── */
const requireStaff = (req, res, next) => {
  if (!req.staff) {
    if (wantsJson(req)) return jsonError(res, 'Only group admins can access this.', 403);
    req.flash('error', 'Only group admins can access this.');
    return res.redirect(`/groups/${req.group.slug}`);
  }
  next();
};

router.get('/groups/:slug/admin', loadGroup, requireAuth, requireStaff, (req, res) => {
  const group = req.group;
  return res.page('groups/show', {
    title: `${group.name} - ${req.app.locals.config.siteName}`,
    active: 'groups',
    group,
    membership: req.membershipRow,
    isMember: true,
    staff: true,
    items: [],
    page: 1,
    hasMore: false,
    postCount: posts.countFor({ scope: 'group', groupId: group.id }),
    members: groups.members(group.id, ['active']),
    pending: groups.members(group.id, ['pending']),
    invited: groups.members(group.id, ['invited']),
    groupMeetups: meetups.list({ scope: 'group', groupId: group.id, viewerId: req.user?.id ?? 0, limit: 5 }),
    pinned: posts.feed({ scope: 'location', groupId: group.id, viewerId: req.user?.id ?? 0, limit: 4 }),
    section: 'admin',
  });
});

router.get('/groups/:slug/members', loadGroup, requireAuth, requireStaff, (req, res) => {
  const group = req.group;
  return res.page('groups/show', {
    title: `${group.name} - ${req.app.locals.config.siteName}`,
    active: 'groups',
    group,
    membership: req.membershipRow,
    isMember: true,
    staff: true,
    items: [],
    page: 1,
    hasMore: false,
    postCount: posts.countFor({ scope: 'group', groupId: group.id }),
    members: groups.members(group.id, ['active']),
    pending: groups.members(group.id, ['pending']),
    invited: groups.members(group.id, ['invited']),
    groupMeetups: meetups.list({ scope: 'group', groupId: group.id, viewerId: req.user?.id ?? 0, limit: 5 }),
    pinned: posts.feed({ scope: 'location', groupId: group.id, viewerId: req.user?.id ?? 0, limit: 4 }),
    section: 'members',
  });
});

router.get('/groups/:slug/shared', loadGroup, requireAuth, requireStaff, (req, res) => {
  const group = req.group;
  return res.page('groups/show', {
    title: `${group.name} - ${req.app.locals.config.siteName}`,
    active: 'groups',
    group,
    membership: req.membershipRow,
    isMember: true,
    staff: true,
    items: [],
    page: 1,
    hasMore: false,
    postCount: posts.countFor({ scope: 'group', groupId: group.id }),
    members: groups.members(group.id, ['active']),
    pending: groups.members(group.id, ['pending']),
    invited: groups.members(group.id, ['invited']),
    groupMeetups: meetups.list({ scope: 'group', groupId: group.id, viewerId: req.user?.id ?? 0, limit: 5 }),
    pinned: posts.feed({ scope: 'shared', groupId: group.id, viewerId: req.user?.id ?? 0, limit: 4 }),
    section: 'shared',
  });
});

/* ── join / leave / invite ────────────────────────────────────── */
router.post('/groups/:slug/join', requireAuth, loadGroup, verifyCsrf, (req, res) => {
  const result = groups.join(req.group, req.user.id);

  if (!result.ok) {
    if (wantsJson(req)) return jsonError(res, result.error);
    req.flash('error', result.error);
    return res.redirect(`/groups/${req.group.slug}`);
  }

  if (result.status === 'pending') {
    const staffIds = groups
      .members(req.group.id, ['active'])
      .filter((member) => member.role === 'owner' || member.role === 'admin')
      .map((member) => member.id);
    staffIds.forEach((id) =>
      notifications.notify({
        userId: id,
        actorId: req.user.id,
        type: 'group_request',
        entityId: req.group.id,
        url: `/groups/${req.group.slug}`,
        text: 'asked to join {name}|' + req.group.name,
      }),
    );
    req.flash('success', 'Request sent. A group admin will approve you.');
  } else {
    req.flash('success', 'You are in "{name}".', { name: req.group.name });
  }

  if (wantsJson(req)) return jsonOk(res, { status: result.status });
  return res.redirect(`/groups/${req.group.slug}`);
});

router.post('/groups/:slug/leave', requireAuth, loadGroup, verifyCsrf, (req, res) => {
  const group = req.group;

  if (group.owner_id === req.user.id) {
    req.flash('error', 'You own this group - promote someone else or delete the group instead.');
    return res.redirect(`/groups/${group.slug}`);
  }

  groups.leave(group.id, req.user.id);
  req.flash('success', 'You left "{name}".', { name: group.name });
  return res.redirect('/groups');
});

router.post('/groups/:slug/invite', requireAuth, loadGroup, verifyCsrf, (req, res) => {
  const group = req.group;
  const username = String(req.body.username ?? '').replace(/^@/, '').trim();
  const target = users.findByUsername(username);

  const fail = (message) => {
    if (wantsJson(req)) return jsonError(res, message);
    req.flash('error', message);
    return res.redirect(`/groups/${group.slug}`);
  };

  if (!target) return fail('No driver with that username.');

  const isStaff = Boolean(req.staff);
  const invitesClosed = group.privacy === 'invite' && !isStaff;
  if (invitesClosed && !friends.areFriends(req.user.id, target.id)) {
    return fail('In an invite-only group, members can only invite their friends.');
  }
  if (!groups.isActiveMember(group.id, req.user.id) && !isStaff) {
    return fail('Join the group before inviting people.');
  }

  const result = groups.invite(group.id, target.id);
  if (!result.ok) return fail(result.error);

  notifications.notify({
    userId: target.id,
    actorId: req.user.id,
    type: 'group_invite',
    entityId: group.id,
    url: `/groups/${group.slug}`,
    text: 'invited you to {name}|' + group.name,
  });

  if (wantsJson(req)) return jsonOk(res, { status: 'invited' });
  req.flash('success', '@{user} is invited.', { user: target.username });
  return res.redirect(`/groups/${group.slug}`);
});

/* ── moderation ───────────────────────────────────────────────── */
router.post('/groups/:slug/requests/:userId/approve', requireAuth, loadGroup, verifyCsrf, (req, res) => {
  if (!req.staff) {
    req.flash('error', 'Only group admins can approve members.');
    return res.redirect(`/groups/${req.group.slug}`);
  }
  const userId = Number(req.params.userId);
  groups.approve(req.group.id, userId);
  notifications.notify({
    userId,
    actorId: req.user.id,
    type: 'group_approved',
    entityId: req.group.id,
    url: `/groups/${req.group.slug}`,
    text: 'let you into {name}|' + req.group.name,
  });
  req.flash('success', 'Member approved.');
  return res.redirect(`/groups/${req.group.slug}`);
});

router.post('/groups/:slug/requests/:userId/decline', requireAuth, loadGroup, verifyCsrf, (req, res) => {
  if (!req.staff) {
    req.flash('error', 'Only group admins can do that.');
    return res.redirect(`/groups/${req.group.slug}`);
  }
  groups.removeMember(req.group.id, Number(req.params.userId));
  req.flash('success', 'Request declined.');
  return res.redirect(`/groups/${req.group.slug}`);
});

router.post('/groups/:slug/members/:userId/remove', requireAuth, loadGroup, verifyCsrf, (req, res) => {
  const userId = Number(req.params.userId);
  const isSelf = userId === req.user.id;

  if (!isSelf && !req.staff) {
    req.flash('error', 'Only group admins can remove members.');
    return res.redirect(`/groups/${req.group.slug}`);
  }
  if (userId === req.group.owner_id) {
    req.flash('error', 'The group owner cannot be removed.');
    return res.redirect(`/groups/${req.group.slug}`);
  }

  groups.removeMember(req.group.id, userId);
  req.flash('success', isSelf ? 'You left the group.' : 'Member removed.');
  return res.redirect(isSelf ? '/groups' : `/groups/${req.group.slug}`);
});

router.post('/groups/:slug/members/:userId/role', requireAuth, loadGroup, verifyCsrf, (req, res) => {
  const userId = Number(req.params.userId);
  const role = req.body.role === 'admin' ? 'admin' : 'member';

  if (req.group.owner_id !== req.user.id) {
    req.flash('error', 'Only the group owner can change roles.');
    return res.redirect(`/groups/${req.group.slug}`);
  }
  if (userId === req.user.id) {
    req.flash('error', 'You cannot change your own role.');
    return res.redirect(`/groups/${req.group.slug}`);
  }

  groups.setRole(req.group.id, userId, role);
  req.flash('success', role === 'admin' ? 'Promoted to admin.' : 'Admin rights removed.');
  return res.redirect(`/groups/${req.group.slug}`);
});

/* ── group posts (text, photo, video, location, SOS) ──────────── */
router.post('/groups/:slug/posts', requireAuth, loadGroup, postUpload, verifyCsrf, (req, res) => {
  const group = req.group;

  if (req.membershipRow?.status !== 'active') {
    if (req.file) removeUpload(req.file.filename);
    req.flash('error', 'Join the group before posting.');
    return res.redirect(`/groups/${group.slug}`);
  }

  const result = buildPost(req, { userId: req.user.id, groupId: group.id });
  if (!result.ok) {
    req.flash('error', result.error);
    return res.redirect(`/groups/${group.slug}`);
  }

  if (result.postType === 'emergency') {
    req.flash('warning', 'SOS shared with {name}.', { name: group.name });
  } else {
    req.flash('success', 'Posted to the group.');
  }
  return res.redirect(`/groups/${group.slug}`);
});

/* ── share a thing in a group ──────────────────────────────────── */
router.post('/groups/share', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    const type = String(req.body.type ?? '').trim();
    const id = Number(req.body.id);
    const slug = String(req.body.group ?? '').trim();
    const note = cleanText(req.body.note ?? '', 300);

    const group = groups.bySlug(slug);
    if (!group) {
      if (wantsJson(req)) return jsonError(res, 'That group is gone.', 404);
      req.flash('error', 'That group is gone.');
      return res.redirect(backTo(req, '/'));
    }
    if (groups.membership(group.id, req.user.id)?.status !== 'active') {
      if (wantsJson(req)) return jsonError(res, 'Join the group before posting.', 403);
      req.flash('error', 'Join the group before posting.');
      return res.redirect(backTo(req, '/'));
    }

    const card = shareCard(type, id, req.user.id);
    if (!card) {
      if (wantsJson(req)) return jsonError(res, 'That thing is gone.', 404);
      req.flash('error', 'That thing is gone.');
      return res.redirect(backTo(req, '/'));
    }

    const url = shareUrl(type, id);
    const label = SHARE_LABELS[type] || 'link';
    const body = note ? note : null;

    const postId = posts.createPost({
      userId: req.user.id,
      groupId: group.id,
      body,
      postType: 'text',
      mediaType: null,
      mediaPath: null,
      placeName: null,
      address: null,
      lat: null,
      lng: null,
      zoom: null,
      privacy: 'public',
      shareType: type,
      shareId: id,
      shareTitle: card.title,
      shareText: card.text,
      shareImage: card.image,
      shareUrl: card.url,
    });

    if (!postId) {
      req.flash('error', 'Could not share that.');
      return res.redirect(`/groups/${slug}`);
    }

    req.flash('success', 'Shared to the group.');
    if (wantsJson(req)) return jsonOk(res, { ok: true, groupId: group.id });
    return res.redirect(`/groups/${slug}`);
  } catch (error) {
    if (wantsJson(req)) return jsonError(res, error.message || 'Could not share that.');
    req.flash('error', error.message || 'Could not share that.');
    return res.redirect(backTo(req, '/'));
  }
});
router.post('/groups/:slug/settings', requireAuth, loadGroup, groupUpload, optimizeAs('group'), verifyCsrf, (req, res) => {
  if (!req.staff) {
    req.flash('error', 'Only group admins can change settings.');
    return res.redirect(`/groups/${req.group.slug}`);
  }

  const name = cleanText(req.body.name ?? '', 60);
  const description = cleanText(req.body.description ?? '', 800);
  const privacy = PRIVACIES.includes(req.body.privacy) ? req.body.privacy : req.group.privacy;

  let avatar = null;
  if (req.file) {
    avatar = req.file.filename;
    if (req.group.avatar) removeUpload(req.group.avatar);
  }

  groups.updateGroup(req.group.id, { name: name || req.group.name, description, privacy, avatar });
  req.flash('success', 'Group settings saved.');
  return res.redirect(`/groups/${req.group.slug}`);
});

router.post('/groups/:slug/delete', requireAuth, loadGroup, verifyCsrf, (req, res) => {
  if (req.group.owner_id !== req.user.id && !req.user.is_admin) {
    req.flash('error', 'Only the owner can delete a group.');
    return res.redirect(`/groups/${req.group.slug}`);
  }
  const name = req.group.name;
  if (req.group.avatar) removeUpload(req.group.avatar);
  groups.deleteGroup(req.group.id);
  req.flash('success', '"{name}" was deleted.', { name });
  return res.redirect('/groups');
});

export default router;
