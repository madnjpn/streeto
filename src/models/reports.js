import { all, get, run } from '../db.js';

export function create({ reporterId, targetType, targetId, reason }) {
  const info = run(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)`,
    reporterId, targetType, targetId, reason,
  );
  return get('SELECT * FROM reports WHERE id = ?', info.lastInsertRowid);
}

export const openReports = (limit = 100) =>
  all(
    `SELECT r.*, u.username AS reporter_username, u.display_name AS reporter_display_name
       FROM reports r JOIN users u ON u.id = r.reporter_id
      WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT ?`,
    limit,
  );

export const byId = (id) => get('SELECT * FROM reports WHERE id = ?', id);

export function resolve(id, adminId, status = 'resolved') {
  run('UPDATE reports SET status = ?, resolved_by = ?, resolved_at = datetime(\'now\') WHERE id = ?', status, adminId, id);
}

export const counts = () => get("SELECT COUNT(*) AS open FROM reports WHERE status = 'open'").open;

export default { create, openReports, byId, resolve, counts };