import { all, get, run, count } from '../db.js';
import { slugify } from '../lib/validate.js';

const GROUP_FIELDS = `
  g.*,
  (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'active') AS member_count,
  (SELECT COUNT(*) FROM posts p WHERE p.group_id = g.id) AS post_count
`;

export const byId = (id) => get(`SELECT ${GROUP_FIELDS} FROM groups g WHERE g.id = ?`, id);

export const bySlug = (slug) => get(`SELECT ${GROUP_FIELDS} FROM groups g WHERE g.slug = ?`, slug);

/** Unique slug: "night-runners", "night-runners-2", ... */
function uniqueSlug(name) {
  const base = slugify(name) || 'group';
  let slug = base;
  let n = 2;
  while (get('SELECT 1 AS x FROM groups WHERE slug = ?', slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export function createGroup({ name, description = null, privacy = 'open', ownerId, avatar = null }) {
  const slug = uniqueSlug(name);
  const info = run(
    `INSERT INTO groups (name, slug, description, privacy, owner_id, avatar)
     VALUES (?, ?, ?, ?, ?, ?)`,
    name,
    slug,
    description,
    privacy,
    ownerId,
    avatar,
  );
  run(
    `INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
    info.lastInsertRowid,
    ownerId,
  );
  return byId(info.lastInsertRowid);
}

export function updateGroup(id, { name, description, privacy, avatar }) {
  run(
    `UPDATE groups
        SET name = ?, description = ?, privacy = ?, avatar = COALESCE(?, avatar)
      WHERE id = ?`,
    name,
    description || null,
    privacy,
    avatar || null,
    id,
  );
  return byId(id);
}

export const deleteGroup = (id) => run('DELETE FROM groups WHERE id = ?', id);

/** My membership row, whatever its status. */
export const membership = (groupId, userId) =>
  get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', groupId, userId);

export const memberRole = (groupId, userId) => membership(groupId, userId)?.role ?? null;

/** owner/admin can moderate; returns 'owner' | 'admin' | null */
export function staffRole(groupId, userId) {
  const row = membership(groupId, userId);
  if (!row || row.status !== 'active') return null;
  return row.role === 'owner' || row.role === 'admin' ? row.role : null;
}

export const isActiveMember = (groupId, userId) => membership(groupId, userId)?.status === 'active';

/** Can this viewer read the group's posts and member list? */
export function canView(group, userId) {
  if (!group) return false;
  if (group.privacy === 'open') return true;
  const row = userId ? membership(group.id, userId) : null;
  if (!row) return false;
  return row.status === 'active' || row.status === 'invited';
}

export const members = (groupId, statuses = ['active']) => {
  const marks = statuses.map(() => '?').join(', ');
  return all(
    `SELECT gm.role, gm.status, gm.created_at AS joined_at,
            u.id, u.username, u.display_name, u.avatar, u.car, u.city
       FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ? AND gm.status IN (${marks})
      ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.username COLLATE NOCASE`,
    groupId,
    ...statuses,
  );
};

export const pendingMembers = (groupId) => members(groupId, ['pending']);

/** Groups I belong to (or am invited to / waiting on). */
export const myGroups = (userId) =>
  all(
    `SELECT ${GROUP_FIELDS}, gm.role, gm.status
       FROM group_members gm JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = :me AND gm.status IN ('active','pending','invited')
      ORDER BY gm.status = 'active' DESC, g.name COLLATE NOCASE`,
    { me: userId },
  );

/** Group directory. Open groups are listed for everyone; private ones are
 *  listed too (they are joinable by request); invite-only stays hidden. */
export function directory({ q = '', userId = 0, limit = 30, offset = 0 }) {
  const like = `%${String(q).replace(/[%_]/g, (m) => `\\${m}`)}%`;
  return all(
    `SELECT ${GROUP_FIELDS},
            (SELECT gm.status FROM group_members gm
              WHERE gm.group_id = g.id AND gm.user_id = :me) AS status
       FROM groups g
      WHERE (g.privacy <> 'invite' OR g.id IN (
              SELECT group_id FROM group_members WHERE user_id = :me AND status IN ('active','invited')))
        AND (
          :q = '' OR g.name LIKE :like ESCAPE '\\' OR g.description LIKE :like ESCAPE '\\'
          OR g.id IN (SELECT group_id FROM group_members gm2
                       JOIN users u ON u.id = gm2.user_id
                      WHERE u.username LIKE :like ESCAPE '\\')
        )
      ORDER BY member_count DESC, g.created_at DESC
      LIMIT :limit OFFSET :offset`,
    { me: userId, q: String(q), like, limit, offset },
  );
}

/**
 * Join (or request to join) a group.
 *  open    -> active immediately
 *  private -> pending approval
 *  invite  -> only possible if already invited as 'invited'
 */
export function join(group, userId) {
  const existing = membership(group.id, userId);
  if (existing) {
    if (existing.status === 'active') return { ok: false, error: 'You are already a member.' };
    if (existing.status === 'pending') return { ok: false, error: 'Your request is still waiting.' };
    if (existing.status === 'invited') {
      run(`UPDATE group_members SET status = 'active' WHERE group_id = ? AND user_id = ?`, group.id, userId);
      return { ok: true, status: 'active' };
    }
  }

  if (group.privacy === 'invite') {
    return { ok: false, error: 'This group is invite only - ask a member for an invite.' };
  }

  const status = group.privacy === 'open' ? 'active' : 'pending';
  run(
    `INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'member', ?)`,
    group.id,
    userId,
    status,
  );
  return { ok: true, status };
}

export function approve(groupId, userId) {
  run(`UPDATE group_members SET status = 'active' WHERE group_id = ? AND user_id = ? AND status = 'pending'`, groupId, userId);
  return membership(groupId, userId);
}

export function invite(groupId, userId) {
  const existing = membership(groupId, userId);
  if (existing) {
    if (existing.status === 'active') return { ok: false, error: 'Already a member.' };
    run(`UPDATE group_members SET status = 'invited' WHERE group_id = ? AND user_id = ?`, groupId, userId);
    return { ok: true, status: 'invited' };
  }
  run(
    `INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'member', 'invited')`,
    groupId,
    userId,
  );
  return { ok: true, status: 'invited' };
}

export function removeMember(groupId, userId) {
  run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
}

export const leave = (groupId, userId) => removeMember(groupId, userId);

export function setRole(groupId, userId, role) {
  run('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?', role, groupId, userId);
}

export const ownerCount = (groupId) =>
  count('group_members', `group_id = ? AND role = 'owner' AND status = 'active'`, groupId);

/** Groups where I have moderation powers, for the nav. */
export const moderatedGroups = (userId) =>
  all(
    `SELECT g.id, g.name, g.slug, g.privacy, gm.role
       FROM group_members gm JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = ? AND gm.status = 'active' AND gm.role IN ('owner','admin')
      ORDER BY g.name COLLATE NOCASE`,
    userId,
  );

export default {
  byId, bySlug, createGroup, updateGroup, deleteGroup, membership, memberRole, staffRole,
  isActiveMember, canView, members, pendingMembers, myGroups, directory, join, approve,
  invite, removeMember, leave, setRole, ownerCount, moderatedGroups,
};
