import { all, get, run } from '../db.js';

export const byPost = (postId) => {
  const poll = get('SELECT * FROM polls WHERE post_id = ?', postId);
  if (!poll) return null;
  const options = all('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order, id', poll.id);
  const counts = all(
    `SELECT option_id, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_id`,
    poll.id,
  );
  const countMap = Object.fromEntries(counts.map((c) => [c.option_id, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  return {
    ...poll,
    options: options.map((o) => ({ ...o, votes: countMap[o.id] || 0 })),
    total,
  };
};

export function createPoll(postId, question, options) {
  const info = run('INSERT INTO polls (post_id, question) VALUES (?, ?)', postId, question);
  const pollId = info.lastInsertRowid;
  options.forEach((label, i) => {
    run('INSERT INTO poll_options (poll_id, label, sort_order) VALUES (?, ?, ?)', pollId, label, i);
  });
  return byPost(postId);
}

export function vote(pollId, optionId, userId) {
  // upsert vote
  const existing = get('SELECT id FROM poll_votes WHERE poll_id = ? AND user_id = ?', pollId, userId);
  if (existing) {
    run('UPDATE poll_votes SET option_id = ? WHERE id = ?', optionId, existing.id);
  } else {
    run('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)', pollId, optionId, userId);
  }
  return true;
}

export const hasVoted = (pollId, userId) =>
  !!get('SELECT 1 AS x FROM poll_votes WHERE poll_id = ? AND user_id = ?', pollId, userId);

export const userVote = (pollId, userId) =>
  get('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?', pollId, userId)?.option_id ?? null;

export default { byPost, createPoll, vote, hasVoted, userVote };