/**
 * The letters the site sends on its own.
 *
 * Two kinds:
 *
 * - the inspection reminder: the site already knows when a car has to
 *   go to the technical inspection, so it says so before the date;
 * - the weekly digest: what happened while the member was away.
 *
 * Everything that was already sent is written down in `mail_log`, so
 * nobody gets the same letter twice, and a member can turn the digest
 * off in their settings.
 */
import config from '../config.js';
import { all, get, run } from '../db.js';
import { sendMail, mailReady, mailCaptured } from './mail.js';
import { digestEmail, ptiReminderEmail } from './mail-templates.js';
import { translate } from './i18n.js';
import { currentWeek } from './periods.js';

/** How long before the inspection the first letter goes out. */
const PTI_DAYS = 30;

/* ── what was already sent ────────────────────────────────────────── */

/** True when this letter went out already. */
function alreadySent(userId, kind, ref) {
  return Boolean(get(
    'SELECT 1 AS x FROM mail_log WHERE user_id = ? AND kind = ? AND ref = ?',
    userId, kind, ref,
  ));
}

/** Remember that a letter went out. */
function remember(userId, kind, ref) {
  run(
    'INSERT OR IGNORE INTO mail_log (user_id, kind, ref) VALUES (?, ?, ?)',
    userId, kind, ref,
  );
}

/* ── the inspection reminder ──────────────────────────────────────── */

/**
 * The cars of a member whose inspection is coming up.
 *
 * The same car is often in the list twice - once as a build, once as a
 * My Ride vehicle - so the plate decides: one car, one line.
 */
function carsDueFor(userId) {
  const rows = [];
  const seen = new Set();

  const add = (car) => {
    const plate = String(car.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const key = plate || `${car.kind}:${car.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(car);
  };

  for (const build of all(
    `SELECT id, title, number_plate, pti_plate, pti_expires_at FROM builds
      WHERE user_id = ? AND pti_expires_at IS NOT NULL`,
    userId,
  )) {
    add({
      kind: 'build',
      id: build.id,
      name: build.title,
      plate: build.number_plate || build.pti_plate || '',
      expires: build.pti_expires_at,
    });
  }

  for (const vehicle of all(
    `SELECT id, name, number_plate, pti_plate, pti_expires_at FROM vehicles
      WHERE user_id = ? AND pti_expires_at IS NOT NULL`,
    userId,
  )) {
    add({
      kind: 'vehicle',
      id: vehicle.id,
      name: vehicle.name,
      plate: vehicle.number_plate || vehicle.pti_plate || '',
      expires: vehicle.pti_expires_at,
    });
  }

  return rows;
}

/** The days left until a date, or null when the date is not a date. */
export function daysLeft(when) {
  if (!when) return null;
  const then = new Date(when).getTime();
  if (!Number.isFinite(then)) return null;
  const now = Date.now();
  return Math.ceil((then - now) / 86400000);
}

/**
 * The inspection reminders that are due.
 *
 * A car that is due inside the month gets one letter. When the week
 * comes it gets a second, shorter one - and nothing after that, because
 * a reminder that repeats every day is noise.
 */
export function ptiRemindersDue() {
  const due = [];
  const members = all(
    `SELECT id, username, display_name, email, language FROM users
      WHERE email IS NOT NULL AND email <> '' AND mail_pti = 1`,
  );

  for (const member of members) {
    const cars = [];
    for (const car of carsDueFor(member.id)) {
      const left = daysLeft(car.expires);
      if (left === null || left > PTI_DAYS) continue;
      // One letter when the month starts, one in the last week.
      const bucket = left <= 7 ? 'week' : 'month';
      const ref = `${car.kind}:${car.id}:${bucket}`;
      if (alreadySent(member.id, 'pti', ref)) continue;
      cars.push({ ...car, bucket, ref, left });
    }
    if (!cars.length) continue;
    due.push({ member, cars });
  }

  return due;
}

/** Send the inspection reminders that are due. */
export async function sendPtiReminders() {
  const due = ptiRemindersDue();
  let sent = 0;
  for (const { member, cars } of due) {
    const t = (key, vars) => translate(member.language || 'en', key, vars);
    const days = Math.min(...cars.map((car) => car.left));
    const letter = ptiReminderEmail({
      t,
      user: { username: member.username, display_name: member.display_name },
      cars: cars.map((car) => ({
        name: car.name,
        plate: car.plate,
        expires: String(car.expires || '').slice(0, 10),
      })),
      days,
      siteName: config.siteName,
      siteUrl: config.publicUrl || `http://localhost:${config.port}`,
      logoUrl: `${config.publicUrl || `http://localhost:${config.port}`}/websitelogo.png`,
      lang: member.language || 'en',
    });
    try {
      await sendMail({
        to: member.email,
        subject: letter.subject,
        html: letter.html,
        text: letter.text,
      });
      for (const car of cars) remember(member.id, 'pti', car.ref);
      sent += 1;
    } catch (error) {
      console.warn('[mail] inspection reminder failed:', error?.message || error);
    }
  }
  if (sent) console.log(`[mail] sent ${sent} inspection reminder(s)`);
  return sent;
}

/* ── the weekly digest ────────────────────────────────────────────── */

/** The member's cars, so the board can be matched to them. */
function carsOf(userId) {
  const cars = [];
  for (const build of all(
    'SELECT id, title, make, model, year FROM builds WHERE user_id = ?',
    userId,
  )) {
    cars.push({ kind: 'build', id: build.id, title: build.title, make: build.make, model: build.model, year: build.year });
  }
  for (const vehicle of all(
    'SELECT id, name, make, model, year FROM vehicles WHERE user_id = ?',
    userId,
  )) {
    cars.push({ kind: 'vehicle', id: vehicle.id, title: vehicle.name, make: vehicle.make, model: vehicle.model, year: vehicle.year });
  }
  return cars;
}

/**
 * What happened while the member was away.
 *
 * Every part is a sentence with a link - the letter is a list of what
 * the site has for them, not a report card.
 */
export function digestFor(userId, lang = 'en') {
  const t = (key, vars) => translate(lang, key, vars);
  const sections = [];
  const base = config.publicUrl || `http://localhost:${config.port}`;

  // Somebody answered on one of their posts.
  const answered = all(
    `SELECT c.id, c.post_id, c.body, u.username
       FROM comments c
       JOIN posts p ON p.id = c.post_id
       JOIN users u ON u.id = c.user_id
      WHERE p.user_id = ? AND c.user_id <> ?
      ORDER BY c.created_at DESC LIMIT 5`,
    userId, userId,
  );
  if (answered.length) {
    sections.push({
      title: t('People answered you'),
      items: answered.map((row) => ({
        text: t('@{user} wrote on your post', { user: row.username }),
        url: `${base}/posts/${row.post_id}`,
      })),
    });
  }

  // Their build was voted for.
  const voted = all(
    `SELECT b.id, b.title, COUNT(v.user_id) AS n
       FROM build_votes v JOIN builds b ON b.id = v.build_id
      WHERE b.user_id = ? AND v.week = ?
      GROUP BY b.id HAVING n > 0
      ORDER BY n DESC LIMIT 3`,
    userId, currentWeek(),
  );
  if (voted.length) {
    sections.push({
      title: t('Your build was voted for'),
      items: voted.map((row) => ({
        text: t('{title} - {n} votes', { title: row.title, n: row.n }),
        url: `${base}/builds/${row.id}`,
      })),
    });
  }

  // Somebody is watching their build.
  const watchers = all(
    `SELECT b.id, b.title, COUNT(w.user_id) AS n
       FROM build_watchers w JOIN builds b ON b.id = w.build_id
      WHERE b.user_id = ?
      GROUP BY b.id HAVING n > 0
      ORDER BY n DESC LIMIT 3`,
    userId,
  );
  if (watchers.length) {
    sections.push({
      title: t('People are watching your build'),
      items: watchers.map((row) => ({
        text: t('{title} - {n} watching', { title: row.title, n: row.n }),
        url: `${base}/builds/${row.id}`,
      })),
    });
  }

  // Parts on the board for the cars they own.
  const cars = carsOf(userId);
  const names = [...new Set(cars.map((c) => c.model).filter(Boolean))];
  if (names.length) {
    const marks = [...new Set(cars.map((c) => c.make).filter(Boolean))];
    const parts = all(
      `SELECT id, title, price, currency FROM parts
        WHERE status = 'available' AND (
          title LIKE ? OR title LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC LIMIT 4`,
      `%${names[0]}%`, `%${marks[0] || names[0]}%`, `%${names[0]}%`,
    );
    if (parts.length) {
      sections.push({
        title: t('Parts for your car on the board'),
        items: parts.map((row) => ({
          text: row.price != null ? `${row.title} - ${row.price} ${row.currency || 'GEL'}` : row.title,
          url: `${base}/services/parts/${row.id}`,
        })),
      });
    }
  }

  // A meetup coming up.
  const meetups = all(
    `SELECT id, title, place_name, starts_at FROM meetups
      WHERE starts_at >= datetime('now') AND privacy IN ('open', 'public')
      ORDER BY starts_at ASC LIMIT 3`,
  );
  if (meetups.length) {
    sections.push({
      title: t('Meetups coming up'),
      items: meetups.map((row) => ({
        text: row.place_name ? `${row.title} - ${row.place_name}` : row.title,
        url: `${base}/meetups`,
      })),
    });
  }

  return sections;
}

/** Send the weekly digest to everybody who wants it. */
export async function sendDigests() {
  const week = currentWeek();
  const members = all(
    `SELECT id, username, display_name, email, language FROM users
      WHERE email IS NOT NULL AND email <> '' AND mail_digest = 1`,
  );

  let sent = 0;
  for (const member of members) {
    if (alreadySent(member.id, 'digest', week)) continue;
    const sections = digestFor(member.id, member.language || 'en');
    if (!sections.length) continue;

    const t = (key, vars) => translate(member.language || 'en', key, vars);
    const base = config.publicUrl || `http://localhost:${config.port}`;
    const letter = digestEmail({
      t,
      user: { username: member.username, display_name: member.display_name },
      sections,
      siteName: config.siteName,
      siteUrl: base,
      logoUrl: `${base}/websitelogo.png`,
      lang: member.language || 'en',
    });
    try {
      await sendMail({
        to: member.email,
        subject: letter.subject,
        html: letter.html,
        text: letter.text,
      });
      remember(member.id, 'digest', week);
      sent += 1;
    } catch (error) {
      console.warn('[mail] digest failed:', error?.message || error);
    }
  }
  if (sent) console.log(`[mail] sent ${sent} digest(s)`);
  return sent;
}

/**
 * Start the daily pass.
 *
 * The inspection reminders go out every day (each one only once), the
 * digest once a week - the log decides when it is due.
 */
export function startMailJobs() {
  if (config.isTest) return null;
  if (!mailReady() && !mailCaptured()) return null;

  const run = () => {
    sendPtiReminders()
      .then(() => sendDigests())
      .catch((error) => console.warn('[mail] daily pass failed:', error?.message || error));
  };

  // The first pass waits a little, so a restart does not fire two rounds
  // of letters at the same time.
  const first = setTimeout(run, 90 * 1000);
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  first.unref?.();
  timer.unref?.();

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export default {
  daysLeft,
  ptiRemindersDue,
  sendPtiReminders,
  digestFor,
  sendDigests,
  startMailJobs,
};
