/**
 * End-to-end smoke test.
 *
 * Boots the real Express app against a throwaway SQLite file and drives
 * it over HTTP with two cookie jars, exactly like two browsers would:
 * register -> post -> like -> comment -> befriend -> chat -> crew ->
 * meetup, plus the negative cases around validation and auth.
 *
 *   npm run smoke
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

/* ── point the app at a scratch database before it is imported ──── */
process.env.NODE_ENV = 'test';
process.env.DB_PATH = 'data/smoke.db';
process.env.UPLOAD_DIR = 'uploads-smoke';
process.env.BACKUP_DIR = 'data/backups-smoke';
process.env.SESSION_SECRET = 'smoke-test-secret-value-please-ignore';
process.env.PTI_TIMEOUT_MS = '2000';

/* A tiny local pti.ge stand-in keeps the smoke test offline while still
   exercising the real lookup -> parser -> database path. */
const ptiServer = http.createServer((req, res) => {
  const plate = new URL(req.url, 'http://127.0.0.1').searchParams.get('govNum') || '';
  if (plate === 'UNKNOWN1') {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><title>Server Error</title></html>');
    return;
  }
  const expired = plate === 'EXPIRED1';
  const title = expired ? 'ვადაგადაცილებულია' : 'ინსპექტირებულია';
  const inspected = expired ? '1 იანვარი 2019' : '1 იანვარი 2029';
  const expires = expired ? '1 იანვარი 2020 23:59:59' : '1 იანვარი 2030 23:59:59';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`
    <div class="col-md-12 mt-3 deadlineTitle">${title}</div>
    <div class="ptiTextBG">სახელმწიფო ნომერი: ${plate}</div>
    <div class="ptiTextBG">ინსპექტირების თარიღი: ${inspected}</div>
    <div class="ptiTextBG">მოქმედების ვადა: ${expires}</div>
  `);
});
await new Promise((resolve) => ptiServer.listen(0, '127.0.0.1', resolve));
ptiServer.unref();
process.env.PTI_BASE_URL = `http://127.0.0.1:${ptiServer.address().port}/`;

const ROOT = path.resolve(import.meta.dirname, '..');
const DB_FILES = ['data/smoke.db', 'data/smoke.db-wal', 'data/smoke.db-shm'].map((p) =>
  path.join(ROOT, p),
);
const BACKUP_DIR = path.join(ROOT, 'data/backups-smoke');
for (const file of DB_FILES) fs.rmSync(file, { force: true });
fs.rmSync(path.join(ROOT, 'uploads-smoke'), { recursive: true, force: true });
fs.rmSync(BACKUP_DIR, { recursive: true, force: true });

const { app } = await import('../src/app.js');
const { db, get, all } = await import('../src/db.js');
const { parsePtiHtml, ptiState, normalizePlate } = await import('../src/lib/pti.js');
const { checkVin, readVin, yearFromVin, readIdentifier, namesFor } = await import('../src/lib/vin.js');
const { makeFromVin } = await import('../src/lib/wmi.js');
const { lookupPlatform, inYears } = await import('../src/lib/chassis.js');
const { vehicleSlug } = await import('../src/lib/rockauto.js');
const { twinsOf } = await import('../src/lib/twins.js');
const { outbox } = await import('../src/lib/mail.js');

/* ── tiny test harness ────────────────────────────────────────── */
let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  \u2717 ${name}\n      ${error.message.split('\n')[0]}`);
  }
}

const CSRF_RE = /<meta name="csrf-token" content="([^"]+)"/;

class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.csrf = '';
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(res) {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, target, { form, json, multipart, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = this.cookieHeader();

    let body;
    if (form) {
      // An array value becomes repeated keys, the way a browser sends
      // several inputs with the same name (poll options).
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(form)) {
        if (Array.isArray(value)) value.forEach((one) => params.append(key, one));
        else params.append(key, value);
      }
      body = params.toString();
      h['content-type'] = 'application/x-www-form-urlencoded';
    } else if (json) {
      body = JSON.stringify(json);
      h['content-type'] = 'application/json';
      h['x-requested-with'] = 'fetch';
    } else if (multipart) {
      body = multipart;
    }

    const res = await fetch(this.base + target, { method, headers: h, body, redirect: 'manual' });
    this.storeCookies(res);
    return res;
  }

  /** GET a page and remember the CSRF token it carries. */
  async page(target) {
    const res = await this.request('GET', target);
    const html = await res.text();
    const token = html.match(CSRF_RE)?.[1];
    if (token) this.csrf = token;
    return { res, html };
  }

  post(target, options = {}) {
    return this.request('POST', target, options);
  }

  jsonHeaders() {
    return { 'x-csrf-token': this.csrf, 'x-requested-with': 'fetch' };
  }

  formWithCsrf(fields) {
    return { form: { ...fields, _csrf: this.csrf } };
  }
}

const tag = Date.now().toString(36).slice(-6);
const A = { username: `smokea${tag}`, email: `smokea${tag}@streeto.test` };
const B = { username: `smokeb${tag}`, email: `smokeb${tag}@streeto.test` };
const PASSWORD = 'street123';

async function register(client, { username, email }, displayName) {
  await client.page('/register');
  const res = await client.post('/register', {
    form: {
      username,
      email,
      display_name: displayName,
      password: PASSWORD,
      confirm: PASSWORD,
      _csrf: client.csrf,
    },
  });
  // Registering regenerates the session, so the CSRF token must be
  // scraped again from the first page of the new session.
  if (res.status === 302) await client.page('/');
  return res;
}

/* ── run ──────────────────────────────────────────────────────── */
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`\nSTREETO smoke test against ${base}\n`);

const a = new Client(base);
const b = new Client(base);

try {
  /* 1. public pages ------------------------------------------------- */
  console.log('public pages');
  {
    const health = await a.request('GET', '/api/health');
    const body = await health.json();
    check('GET /api/health returns ok', () => {
      assert.equal(health.status, 200);
      assert.equal(body.ok, true);
    });
  }
  {
    const version = await a.request('GET', '/api/app/version');
    const body = await version.json();
    check('GET /api/app/version returns web and Android versions', () => {
      assert.equal(version.status, 200);
      assert.equal(body.ok, true);
      assert.match(body.web.version, /^\d+\.\d+\.\d+/);
      assert.match(body.android.versionName, /^\d+\.\d+\.\d+/);
      assert.ok(body.android.versionCode >= 1);
      assert.equal(body.android.url, '/downloads/STREETO-android.apk');
      assert.match(version.headers.get('cache-control') || '', /no-store/);
    });
  }
  {
    const { res, html } = await a.page('/about');
    check('GET /about renders', () => {
      assert.equal(res.status, 200);
      assert.ok(html.length > 500);
    });
  }
  {
    const { res, html } = await a.page('/explore');
    check('GET /explore renders', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Hot posts/);
    });
  }
  {
    const res = await a.request('GET', '/');
    check('guest visiting / is redirected to /login', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    });
  }
  {
    const res = await a.request('GET', '/nope-not-here');
    const html = await res.text();
    check('unknown path returns the 404 page', () => {
      assert.equal(res.status, 404);
      assert.match(html, /wrong turn/);
    });
  }

  /* 2. auth guards + validation ------------------------------------ */
  console.log('\nauth + validation');
  {
    const res = await a.request('GET', '/settings');
    check('protected page bounces guests to /login', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    });
  }
  {
    const res = await a.request('POST', '/posts', a.formWithCsrf({ body: 'no auth' }));
    check('posting without a session is rejected', () => assert.equal(res.status, 302));
  }
  {
    const c = new Client(base);
    await c.page('/register');
    const res = await c.post('/register', {
      form: {
        username: 'bad name!',
        email: 'bad@streeto.test',
        password: 'short',
        confirm: 'short',
        _csrf: c.csrf,
      },
    });
    const html = await res.text();
    check('register rejects symbols + short password', () => {
      assert.equal(res.status, 400);
      assert.match(html, /no symbols/i);
      assert.match(html, /at least 8 characters/i);
    });
  }
  {
    const c = new Client(base);
    await c.page('/register');
    const res = await c.post('/register', {
      form: {
        username: `nocase${tag}`,
        email: 'mismatch@streeto.test',
        password: PASSWORD,
        confirm: 'different1',
        _csrf: c.csrf,
      },
    });
    const html = await res.text();
    check('register rejects mismatched passwords', () => {
      assert.equal(res.status, 400);
      assert.match(html, /do not match/i);
    });
  }
  {
    const c = new Client(base);
    await c.page('/');
    const res = await c.post('/posts', { form: { body: 'x' } });
    check('guest POST to /posts is bounced to login', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    });
  }

  /* 3. register + session ------------------------------------------ */
  console.log('\naccounts');
  {
    const res = await register(a, A, 'Smoke A');
    check('account A registers and is redirected home', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/');
      assert.ok(a.cookies.has('streeto.sid'));
    });
    const home = await a.page('/');
    check('logged-in wall renders with the composer', () => {
      assert.equal(home.res.status, 200);
      assert.match(home.html, /data-composer|composer/);
    });
  }
  {
    const { res, html } = await a.page('/settings');
    check('settings shows the app update and changes panels', () => {
      assert.equal(res.status, 200);
      assert.match(html, /id="changes-modal"/);
      assert.match(html, /data-show-changes/);
      assert.match(html, /data-changelog-version="\d+\.\d+\.\d+"/);
      assert.match(html, /data-footer-app-version/);
    });
  }
  {
    const res = await register(b, B, 'Smoke B');
    check('account B registers', () => assert.equal(res.status, 302));
  }
  {
    const c = new Client(base);
    await c.page('/login');
    const res = await c.post('/login', {
      form: { login: A.username, password: 'wrongpass1', _csrf: c.csrf },
    });
    check('login with a wrong password fails', () => assert.equal(res.status, 401));
  }
  {
    const c = new Client(base);
    await c.page('/login');
    const res = await c.post('/login', {
      form: { login: A.email, password: PASSWORD, _csrf: c.csrf },
    });
    check('login with email works', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/');
    });
  }
  {
    const res = await a.request('GET', `/api/username-check?u=${A.username}`);
    const body = await res.json();
    check('username availability API reports taken names', () => {
      assert.equal(body.available, false);
    });
  }
  {
    const res = await a.request('GET', `/u/${A.username}`);
    check('profile page renders', () => assert.equal(res.status, 200));
  }

  /* 3b. password recovery ------------------------------------------ */
  console.log('\npassword recovery');
  const R = { username: `smoker${tag}`, email: `smoker${tag}@streeto.test` };
  const NEW_PASSWORD = 'midnight88';
  const recoverClient = new Client(base);
  const visitor = new Client(base);
  let resetPath = '';

  {
    const res = await register(recoverClient, R, 'Smoke R');
    check('account R registers for the recovery test', () => assert.equal(res.status, 302));
  }
  {
    const { html } = await visitor.page('/login');
    check('the login screen carries a forgot-password link', () =>
      assert.match(html, /href="\/forgot"/),
    );
  }
  {
    const { res, html } = await visitor.page('/forgot');
    check('the recovery page renders', () => {
      assert.equal(res.status, 200);
      assert.match(html, /action="\/forgot"/);
    });
  }
  {
    const before = outbox.length;
    const res = await visitor.post('/forgot', visitor.formWithCsrf({ login: R.username }));
    const html = await res.text();
    check('a username shows the inbox before anything is sent', () => {
      assert.equal(res.status, 200);
      assert.ok(html.includes('@streeto.test'));
      assert.ok(!html.includes(R.email), 'the whole address must stay hidden');
      assert.equal(outbox.length, before, 'nothing is sent yet');
    });
  }
  {
    const { html } = await visitor.page('/forgot');
    check('the recovery form carries the name field exactly once', () => {
      const fields = html.match(/name="login"/g) || [];
      assert.equal(fields.length, 1, `found ${fields.length} inputs named login`);
    });
  }
  {
    const before = outbox.length;
    const res = await visitor.post(
      '/forgot',
      visitor.formWithCsrf({ login: [R.username, R.username] }),
    );
    const html = await res.text();
    check('a duplicated name field still finds the account', () => {
      assert.equal(res.status, 200);
      assert.ok(html.includes('@streeto.test'), 'the confirm step is shown');
      assert.ok(!html.includes(R.email), 'the whole address must stay hidden');
      assert.ok(!html.includes(`${R.username},${R.username}`), 'the name is not doubled');
      assert.equal(outbox.length, before, 'nothing is sent yet');
    });
  }
  {
    const before = outbox.length;
    const res = await visitor.post('/forgot/confirm', visitor.formWithCsrf({ login: R.username }));
    const html = await res.text();
    const mail = outbox[outbox.length - 1] || {};
    resetPath =
      (String(mail.html || '').match(/https?:\/\/[^"']+\/reset\/[A-Za-z0-9_-]+/) || [])[0]?.replace(
        /^https?:\/\/[^/]+/,
        '',
      ) || '';
    check('confirming the inbox sends the recovery letter', () => {
      assert.equal(res.status, 200);
      assert.equal(outbox.length, before + 1);
      assert.equal(mail.to, R.email);
      assert.match(String(mail.subject), /password/i);
      assert.ok(resetPath.startsWith('/reset/'), `no link in the letter: ${resetPath}`);
    });
  }
  {
    const token = resetPath.split('/').pop();
    const row = get(
      'SELECT token_hash FROM password_resets WHERE user_id = (SELECT id FROM users WHERE username = ?) ORDER BY id DESC LIMIT 1',
      R.username,
    );
    check('only the hash of the link is written down', () => {
      assert.match(row.token_hash, /^[a-f0-9]{64}$/);
      assert.ok(!row.token_hash.includes(token));
    });
  }
  {
    const { res, html } = await visitor.page(resetPath);
    check('the letter link opens the new-password page', () => {
      assert.equal(res.status, 200);
      assert.match(html, /name="password"/);
      assert.match(html, /name="confirm"/);
    });
  }
  {
    const res = await visitor.post(resetPath, visitor.formWithCsrf({ password: 'short', confirm: 'short' }));
    check('a weak password is refused on the reset page', () => assert.equal(res.status, 400));
  }
  {
    const res = await visitor.post(
      resetPath,
      visitor.formWithCsrf({ password: NEW_PASSWORD, confirm: 'different99' }),
    );
    check('a mismatched pair is refused on the reset page', () => assert.equal(res.status, 400));
  }
  {
    const res = await visitor.post(
      resetPath,
      visitor.formWithCsrf({ password: NEW_PASSWORD, confirm: NEW_PASSWORD }),
    );
    check('the new password is saved and the driver is sent to log in', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    });
  }
  {
    const res = await visitor.request('GET', resetPath);
    check('a used link cannot be opened again', () => assert.equal(res.status, 410));
  }
  {
    const { res } = await recoverClient.page('/');
    check('the old session of the account is logged out', () => {
      assert.equal(res.status, 302);
      assert.match(String(res.headers.get('location')), /\/login/);
    });
  }
  {
    const c = new Client(base);
    await c.page('/login');
    const res = await c.post('/login', {
      form: { login: R.username, password: PASSWORD, _csrf: c.csrf },
    });
    check('the old password no longer works', () => assert.equal(res.status, 401));
  }
  {
    const c = new Client(base);
    await c.page('/login');
    const res = await c.post('/login', {
      form: { login: R.username, password: NEW_PASSWORD, _csrf: c.csrf },
    });
    check('the new password works', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/');
    });
  }
  {
    const before = outbox.length;
    const res = await visitor.post('/forgot', visitor.formWithCsrf({ login: `nobody${tag}@streeto.test` }));
    const html = await res.text();
    check('an unknown email gets the same answer as a real one', () => {
      assert.equal(res.status, 200);
      assert.equal(outbox.length, before);
      assert.ok(html.includes('href="/forgot"'), 'the sent card is shown');
    });
  }
  {
    const res = await visitor.post('/forgot', visitor.formWithCsrf({ login: `nobody${tag}` }));
    check('an unknown username is said plainly', () => assert.equal(res.status, 404));
  }
  {
    const { makeToken, create } = await import('../src/models/password-resets.js');
    const row = get('SELECT id FROM users WHERE username = ?', R.username);
    const token = makeToken();
    create({ userId: row.id, token, ttlMs: 60 * 60 * 1000 });

    const signedIn = new Client(base);
    await signedIn.page('/login');
    await signedIn.post('/login', {
      form: { login: R.username, password: NEW_PASSWORD, _csrf: signedIn.csrf },
    });
    await signedIn.page('/');

    const open = await signedIn.page(`/reset/${token}`);
    check('a signed-in driver still gets the reset form', () => {
      assert.equal(open.res.status, 200);
      assert.match(open.html, /name="password"/);
    });

    const done = await signedIn.post(
      `/reset/${token}`,
      signedIn.formWithCsrf({ password: 'garage77x', confirm: 'garage77x' }),
    );
    check('resetting while signed in sends the driver back to log in', () => {
      assert.equal(done.status, 302);
      assert.equal(done.headers.get('location'), '/login');
    });

    const after = await signedIn.page('/');
    check('the browser that reset the password is signed out', () => {
      assert.equal(after.res.status, 302);
      assert.match(String(after.res.headers.get('location')), /\/login/);
    });
  }
  {
    const { makeToken, create } = await import('../src/models/password-resets.js');
    const row = get('SELECT id FROM users WHERE username = ?', R.username);
    const token = makeToken();
    create({ userId: row.id, token, ttlMs: -1000 });
    const res = await visitor.request('GET', `/reset/${token}`);
    check('an expired link is refused', () => assert.equal(res.status, 410));
  }

  /* 4. wall: post / like / comment --------------------------------- */
  console.log('\nwall');
  let postId;
  {
    const res = await a.post('/posts', { form: { body: 'missing token', post_type: 'text' } });
    check('an authenticated POST without a CSRF token is refused', () => {
      assert.equal(res.status, 403);
    });
  }
  {
    const res = await a.post('/posts', a.formWithCsrf({
      body: 'Smoke test: midnight run on the coast road.',
      post_type: 'text',
    }));
    check('text post is accepted', () => {
      assert.equal(res.status, 302);
      postId = get('SELECT id FROM posts ORDER BY id DESC LIMIT 1').id;
      assert.ok(postId > 0);
    });
  }
  {
    const { res, html } = await a.page('/');
    check('new post shows on the author wall', () => {
      assert.equal(res.status, 200);
      assert.match(html, /midnight run on the coast road/);
    });
  }
  {
    // A poll needs a question and at least two options, otherwise it was
    // dropped without a word and it looked like polls did not work.
    const res = await a.post('/posts', a.formWithCsrf({
      body: 'Smoke test: a poll with one option only.',
      post_type: 'text',
      poll_question: 'Which tires?',
      poll_option: ['Only one'],
    }));
    check('a half filled poll is refused with a reason', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT COUNT(*) AS n FROM polls WHERE question = ?', 'Which tires?');
      assert.equal(row.n, 0);
    });
  }
  {
    const res = await a.post('/posts', a.formWithCsrf({
      body: 'Smoke test: a proper poll.',
      post_type: 'text',
      poll_question: 'Which tires?',
      poll_option: ['Summer', 'Winter'],
    }));
    check('a poll post is accepted', () => {
      assert.equal(res.status, 302);
      const poll = get('SELECT id FROM polls WHERE question = ?', 'Which tires?');
      assert.ok(poll && poll.id > 0);
      const options = all('SELECT label FROM poll_options WHERE poll_id = ?', poll.id);
      assert.equal(options.length, 2);
    });
  }
  {
    // A poll is a post on its own - the "what happened" text is extra.
    const res = await a.post('/posts', a.formWithCsrf({
      post_type: 'text',
      poll_question: 'Which engine?',
      poll_option: ['Turbo', 'Naturally aspirated'],
    }));
    check('a poll needs no text of its own', () => {
      assert.equal(res.status, 302);
      const poll = get('SELECT id FROM polls WHERE question = ?', 'Which engine?');
      assert.ok(poll && poll.id > 0);
      const post = get('SELECT body FROM posts WHERE id = (SELECT post_id FROM polls WHERE id = ?)', poll.id);
      assert.equal(post.body, null);
    });
  }
  {
    const { res, html } = await a.page('/');
    check('the poll shows on the wall with its options', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Which tires\?/);
      assert.match(html, /Summer/);
      assert.match(html, /Winter/);
    });
  }
  {
    const poll = get('SELECT id, post_id FROM polls WHERE question = ?', 'Which tires?');
    const option = get('SELECT id FROM poll_options WHERE poll_id = ? LIMIT 1', poll.id);
    const res = await b.post(`/posts/${poll.post_id}/poll/vote`, {
      form: { option_id: option.id, _csrf: b.csrf },
    });
    check('a vote on a poll is counted', () => {
      assert.equal(res.status, 302);
      const votes = get('SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id = ?', poll.id);
      assert.equal(votes.n, 1);
    });
  }
  {
    const res = await b.post(`/posts/${postId}/like`, { headers: b.jsonHeaders() });
    const body = await res.json();
    check('B can like the post (JSON)', () => {
      assert.equal(body.ok, true);
      assert.equal(body.liked, true);
      assert.equal(body.likes, 1);
    });
  }
  {
    const res = await b.post(`/posts/${postId}/comments`, {
      json: { body: 'See you there.' },
      headers: b.jsonHeaders(),
    });
    const body = await res.json();
    check('B can comment and gets a rendered fragment', () => {
      assert.equal(body.ok, true);
      assert.equal(body.count, 1);
      assert.match(body.html, /See you there\./);
    });
  }
  {
    const res = await a.request('GET', `/posts/${postId}/comments`);
    const body = await res.json();
    check('comments load endpoint returns the thread', () => {
      assert.equal(body.count, 1);
      assert.equal(body.comments[0].username, B.username);
    });
  }
  {
    // A reply hangs under the comment it answers.
    const parent = get('SELECT id FROM comments WHERE post_id = ? ORDER BY id LIMIT 1', postId);
    const res = await a.post(`/posts/${postId}/comments`, {
      form: { body: 'Replying to you', parent_id: parent.id, _csrf: a.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const body = await res.json();
    check('a comment can be replied to', () => {
      assert.equal(body.ok, true);
      assert.equal(body.parent_id, parent.id);
      assert.match(body.html, /Replying to you/);
      const reply = get('SELECT parent_id FROM comments WHERE id = (SELECT MAX(id) FROM comments WHERE post_id = ?)', postId);
      assert.equal(reply.parent_id, parent.id);
    });
  }
  {
    // @name in a comment is turned into a link.
    const res = await a.post(`/posts/${postId}/comments`, {
      form: { body: `Hey @${B.username} take a look`, _csrf: a.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const body = await res.json();
    check('a mention in a comment becomes a link', () => {
      assert.equal(body.ok, true);
      assert.match(body.html, new RegExp(`class="mention" href="/u/${B.username}"`));
    });
  }
  {
    // A reply can be answered as well - the thread is not only one level deep.
    const parent = get('SELECT id FROM comments WHERE post_id = ? ORDER BY id LIMIT 1', postId);
    await a.post(`/posts/${postId}/comments`, {
      form: { body: 'A reply that will be answered', parent_id: parent.id, _csrf: a.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const reply = get('SELECT id FROM comments WHERE post_id = ? ORDER BY id DESC LIMIT 1', postId);
    const res = await b.post(`/posts/${postId}/comments`, {
      form: { body: 'The answer to that reply', parent_id: reply.id, _csrf: b.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const body = await res.json();
    check('a reply can be answered as well', () => {
      assert.equal(body.ok, true);
      assert.equal(body.parent_id, reply.id);
      const row = get('SELECT parent_id FROM comments WHERE id = (SELECT MAX(id) FROM comments WHERE post_id = ?)', postId);
      assert.equal(row.parent_id, reply.id);
    });
  }
  {
    // The answer must still be there when the thread is loaded again.
    const res = await a.request('GET', `/posts/${postId}/comments`);
    const body = await res.json();
    check('the answer to a reply survives a reload of the thread', () => {
      assert.match(body.html, /The answer to that reply/);
    });
  }
  {
    // The avatar of the commenter has to come back with the comment, or
    // the picture only shows up after a refresh.
    db.prepare('UPDATE users SET avatar = ? WHERE username = ?').run('smoke-avatar.png', B.username);
    const res = await b.post(`/posts/${postId}/comments`, {
      json: { body: 'Commenting with a picture on.' },
      headers: b.jsonHeaders(),
    });
    const body = await res.json();
    check('a new comment carries the avatar of its author', () => {
      assert.equal(body.ok, true);
      assert.equal(body.comment.avatar, 'smoke-avatar.png');
      assert.match(body.html, /class="avatar[^"]*"\s+src="[^"]*smoke-avatar\.png"/);
    });
  }
  {
    // The author may change the words of their own comment.
    const comment = get('SELECT id FROM comments WHERE post_id = ? AND body = ?', postId, 'Commenting with a picture on.');
    const res = await b.post(`/comments/${comment.id}/edit`, {
      json: { body: 'Commenting with a picture on - and changed.' },
      headers: b.jsonHeaders(),
    });
    const body = await res.json();
    check('the author can edit their comment', () => {
      assert.equal(body.ok, true);
      assert.match(body.body_html, /and changed\./);
      const row = get('SELECT body, edited_at FROM comments WHERE id = ?', comment.id);
      assert.equal(row.body, 'Commenting with a picture on - and changed.');
      assert.ok(row.edited_at, 'the time of the edit is kept');
    });
  }
  {
    // Somebody else may not rewrite the words of a comment.
    const comment = get('SELECT id FROM comments WHERE post_id = ? AND body = ?', postId, 'Commenting with a picture on - and changed.');
    const res = await a.post(`/comments/${comment.id}/edit`, {
      json: { body: 'Words that are not mine.' },
      headers: a.jsonHeaders(),
    });
    const body = await res.json();
    check('another driver cannot edit a comment that is not theirs', () => {
      assert.equal(body.ok, false);
      const row = get('SELECT body FROM comments WHERE id = ?', comment.id);
      assert.equal(row.body, 'Commenting with a picture on - and changed.');
    });
  }
  {
    // The author may change the words of their own post.
    await a.post('/posts', a.formWithCsrf({ body: 'Smoke test: a post to edit.', post_type: 'text' }));
    const editable = get('SELECT id FROM posts WHERE body = ?', 'Smoke test: a post to edit.');
    const res = await a.post(`/posts/${editable.id}/edit`, {
      json: { body: 'Smoke test: a post that was edited #smoketag' },
      headers: a.jsonHeaders(),
    });
    const body = await res.json();
    check('the author can edit their post', () => {
      assert.equal(body.ok, true);
      assert.match(body.body_html, /that was edited/);
      const row = get('SELECT body, edited_at FROM posts WHERE id = ?', editable.id);
      assert.equal(row.body, 'Smoke test: a post that was edited #smoketag');
      assert.ok(row.edited_at, 'the time of the edit is kept');
    });
    check('the hashtags follow the new text of the post', () => {
      const tags = all('SELECT tag FROM post_tags WHERE post_id = ?', editable.id).map((row) => row.tag);
      assert.ok(tags.includes('smoketag'));
    });
  }
  {
    // Somebody else may not change the words of a post.
    await a.post('/posts', a.formWithCsrf({ body: 'Smoke test: a post of mine.', post_type: 'text' }));
    const other = get('SELECT id FROM posts WHERE body = ?', 'Smoke test: a post of mine.');
    const res = await b.post(`/posts/${other.id}/edit`, {
      json: { body: 'Words that are not mine.' },
      headers: b.jsonHeaders(),
    });
    const body = await res.json();
    check('another driver cannot edit a post that is not theirs', () => {
      assert.equal(body.ok, false);
      const row = get('SELECT body FROM posts WHERE id = ?', other.id);
      assert.equal(row.body, 'Smoke test: a post of mine.');
    });
  }
  {
    const res = await a.request('GET', `/posts/${postId}/likes`);
    const body = await res.json();
    check('likes endpoint lists who liked', () => assert.equal(body.users.length, 1));
  }
  {
    // Photo upload through multipart, exercising multer + buildPost.
    // A big picture, so the pipeline has something to work on.
    const png = await sharp({
      create: { width: 2000, height: 1400, channels: 3, background: { r: 40, g: 60, b: 90 } },
    })
      .png()
      .toBuffer();
    const fd = new FormData();
    fd.set('body', 'Garage shot.');
    fd.set('post_type', 'photo');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([png], { type: 'image/png' }), 'engine.png');
    const res = await a.post('/posts', { multipart: fd });
    check('photo upload creates a media post', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT media_path, post_type FROM posts ORDER BY id DESC LIMIT 1');
      assert.equal(row.post_type, 'photo');
      assert.ok(row.media_path);
      const file = path.join(ROOT, 'uploads-smoke', row.media_path);
      assert.ok(fs.existsSync(file), 'uploaded file exists on disk');
    });
    const row = get('SELECT media_path FROM posts ORDER BY id DESC LIMIT 1');
    const served = await a.request('GET', `/uploads/${row.media_path}`);
    check('uploaded media is served back', () => assert.equal(served.status, 200));
    check('an upload lands in the folder of the driver who sent it', () => {
      assert.match(row.media_path, /^users\/\d+\//, `media path is ${row.media_path}`);
    });
    check('a big photo is made no bigger than the place it is shown', async () => {
      const meta = await sharp(path.join(ROOT, 'uploads-smoke', row.media_path)).metadata();
      assert.equal(meta.format, 'webp', 'the picture is a webp');
      assert.ok(meta.width <= 1600, `the picture is ${meta.width}px wide`);
    });
    check('the picture comes with smaller copies for a phone', () => {
      const copies = all("SELECT width, path FROM upload_variants WHERE source = ?", row.media_path);
      assert.ok(copies.length >= 2, `found ${copies.length} copies`);
      for (const copy of copies) {
        assert.ok(fs.existsSync(path.join(ROOT, 'uploads-smoke', copy.path)), `${copy.path} exists`);
      }
    });
    {
      const { html } = await a.page('/');
      const copies = all("SELECT width, path FROM upload_variants WHERE source = ?", row.media_path);
      check('the page offers the smaller copies to the browser', () => {
        assert.ok(html.includes('srcset='), 'the picture has a srcset');
        const small = copies.find((c) => c.width === 640);
        assert.ok(small, 'there is a 640px copy');
        assert.ok(html.includes(small.path), `${small.path} is offered`);
      });
    }
  }
  {
    /* The driver can ask for the full size: the picture keeps its
       detail for the lightbox, and the small copies are still made. */
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 90, g: 120, b: 60 } },
    })
      .png()
      .toBuffer();

    const sdFd = new FormData();
    sdFd.set('body', 'Small version.');
    sdFd.set('post_type', 'photo');
    sdFd.set('quality', 'sd');
    sdFd.set('_csrf', a.csrf);
    sdFd.set('media', new Blob([big], { type: 'image/png' }), 'big.png');
    const sdRes = await a.post('/posts', { multipart: sdFd });
    const sdRow = get('SELECT media_path FROM posts ORDER BY id DESC LIMIT 1');
    const sdMeta = await sharp(path.join(ROOT, 'uploads-smoke', sdRow.media_path)).metadata();

    const hdFd = new FormData();
    hdFd.set('body', 'Full size version.');
    hdFd.set('post_type', 'photo');
    hdFd.set('quality', 'hd');
    hdFd.set('_csrf', a.csrf);
    hdFd.set('media', new Blob([big], { type: 'image/png' }), 'big.png');
    const hdRes = await a.post('/posts', { multipart: hdFd });
    const hdRow = get('SELECT media_path FROM posts ORDER BY id DESC LIMIT 1');
    const hdMeta = await sharp(path.join(ROOT, 'uploads-smoke', hdRow.media_path)).metadata();

    check('the small version is made for the screen', () => {
      assert.equal(sdRes.status, 302);
      assert.ok(sdMeta.width <= 1600, `the picture is ${sdMeta.width}px wide`);
    });
    check('the full size version keeps the detail', () => {
      assert.equal(hdRes.status, 302);
      assert.equal(hdMeta.width, 2560, `the picture is ${hdMeta.width}px wide`);
    });
    check('the full size picture still comes with small copies', () => {
      const copies = all("SELECT width FROM upload_variants WHERE source = ?", hdRow.media_path);
      assert.ok(copies.length >= 2, `found ${copies.length} copies`);
    });
  }
  {
    const res = await a.post('/posts', a.formWithCsrf({
      body: 'Near the top of the pass, popped a hose.',
      post_type: 'emergency',
      lat: '35.2127',
      lng: '139.0247',
      place_name: 'Hakone Turnpike',
      address: 'Hakone, Kanagawa, Japan',
    }));
    check('SOS post with a pin is accepted', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT post_type, lat FROM posts ORDER BY id DESC LIMIT 1');
      assert.equal(row.post_type, 'emergency');
      assert.ok(row.lat);
    });
  }
  {
    const res = await a.post('/posts', a.formWithCsrf({ body: '', post_type: 'text' }));
    check('empty post is refused', () => assert.equal(res.status, 302));
    const count = get(
      `SELECT COUNT(*) AS n FROM posts
        WHERE body IS NULL AND post_type = :t
          AND id NOT IN (SELECT post_id FROM polls)`,
      { t: 'text' },
    );
    check('no empty text post was written', () => assert.equal(count.n, 0));
  }

  /* 5. friends ------------------------------------------------------ */
  console.log('\nfriends');
  let requestId;
  {
    const res = await b.post(`/friends/request/${A.username}`, { headers: b.jsonHeaders() });
    const body = await res.json();
    requestId = body.id;
    check('B sends A a friend request', () => {
      assert.equal(body.ok, true);
      assert.equal(body.accepted, false);
      assert.ok(requestId);
    });
  }
  {
    const res = await a.request('GET', '/api/pulse', { headers: a.jsonHeaders() });
    const body = await res.json();
    check('A pulse shows the pending request', () => assert.equal(body.requests, 1));
  }
  {
    const res = await a.request('GET', '/friends');
    const html = await res.text();
    check('friends page lists the incoming request', () => assert.match(html, new RegExp(B.username)));
  }
  {
    const res = await a.post(`/friends/accept/${requestId}`, { headers: a.jsonHeaders() });
    const body = await res.json();
    check('A accepts the request', () => assert.equal(body.accepted, true));
  }
  {
    const res = await b.request('GET', `/u/${A.username}`);
    const html = await res.text();
    check('B now sees A as a friend on the profile', () => {
      assert.equal(res.status, 200);
      assert.match(html, /is-friend|Friends|friend/i);
    });
  }

  /* 6. chat --------------------------------------------------------- */
  console.log('\nchat');
  let conversationId;
  {
    const res = await a.post(`/chat/with/${B.username}`, a.formWithCsrf({}));
    const location = res.headers.get('location') ?? '';
    // The chat is the dock now, so the redirect carries the thread id.
    conversationId = Number(new URLSearchParams(location.split('?')[1] || '').get('chat'));
    check('A opens a chat with B', () => {
      assert.equal(res.status, 302);
      assert.ok(Number.isInteger(conversationId) && conversationId > 0);
    });
  }
  {
    const res = await a.post(`/chat/${conversationId}/send`, {
      json: { body: 'Meet at the usual spot, 11pm.' },
      headers: a.jsonHeaders(),
    });
    const body = await res.json();
    check('A sends a chat message', () => {
      assert.equal(body.ok, true);
      assert.equal(body.message.body, 'Meet at the usual spot, 11pm.');
      assert.equal(body.message.mine, true);
    });
  }
  {
    const res = await b.post(`/chat/${conversationId}/send`, {
      json: { body: 'Bringing the jack.' },
      headers: b.jsonHeaders(),
    });
    check('B replies', () => assert.equal(res.status, 200));
  }
  {
    const res = await a.request('GET', `/chat/${conversationId}/messages?after=0`, {
      headers: a.jsonHeaders(),
    });
    const body = await res.json();
    check('polling returns the whole thread in order', () => {
      assert.equal(body.messages.length, 2);
      assert.equal(body.messages[0].body, 'Meet at the usual spot, 11pm.');
      assert.equal(body.messages[1].body, 'Bringing the jack.');
      assert.ok(body.lastId >= 2);
    });
  }
  {
    // A message that answers another one.
    const first = get('SELECT id FROM messages WHERE conversation_id = ? ORDER BY id LIMIT 1', conversationId);
    const res = await a.post(`/chat/${conversationId}/send`, {
      form: { body: 'Answering you', parent_id: first.id, _csrf: a.csrf },
    });
    check('a chat message can be a reply', () => {
      assert.equal(res.status, 302);
      const reply = get('SELECT parent_id FROM messages WHERE body = ?', 'Answering you');
      assert.equal(reply.parent_id, first.id);
    });
  }
  {
    // A reaction on a message.
    const message = get('SELECT id FROM messages WHERE conversation_id = ? ORDER BY id LIMIT 1', conversationId);
    const res = await a.post(`/chat/${conversationId}/message/${message.id}/react`, {
      json: { emoji: '🔥' },
      headers: a.jsonHeaders(),
    });
    const body = await res.json();
    check('a message can be reacted to', () => {
      assert.equal(body.ok, true);
      assert.equal(body.added, true);
      assert.equal(body.reactions[0].emoji, '🔥');
      assert.equal(body.reactions[0].count, 1);
    });
  }
  {
    // A message you wrote can be edited.
    const message = get(
      `SELECT m.id FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? AND u.username = ? ORDER BY m.id LIMIT 1`,
      conversationId,
      A.username,
    );
    const res = await a.post(`/chat/${conversationId}/message/${message.id}/edit`, {
      json: { body: 'Meet at the usual spot, 11pm. (edited)' },
      headers: a.jsonHeaders(),
    });
    const body = await res.json();
    check('a message can be edited', () => {
      assert.equal(body.ok, true);
      assert.equal(body.message.body, 'Meet at the usual spot, 11pm. (edited)');
      assert.ok(body.message.edited_at, 'the edit is marked');
    });
  }
  {
    // Somebody else's message cannot be edited.
    const message = get(
      `SELECT m.id FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? AND u.username = ? ORDER BY m.id LIMIT 1`,
      conversationId,
      A.username,
    );
    const res = await b.post(`/chat/${conversationId}/message/${message.id}/edit`, {
      json: { body: 'not mine to change' },
      headers: b.jsonHeaders(),
    });
    const body = await res.json();
    check('a message of somebody else cannot be edited', () => {
      assert.equal(body.ok, false);
    });
  }
  {
    // Pressing the same emoji again takes it back.
    const message = get('SELECT id FROM messages WHERE conversation_id = ? ORDER BY id LIMIT 1', conversationId);
    const res = await a.post(`/chat/${conversationId}/message/${message.id}/react`, {
      json: { emoji: '🔥' },
      headers: a.jsonHeaders(),
    });
    const body = await res.json();
    check('the same reaction twice takes it back', () => {
      assert.equal(body.added, false);
      assert.equal(body.reactions.length, 0);
    });
  }
  {
    // The chat is the floating dock now, so the old page is retired and
    // sends you to the wall with the dock open.
    const res = await b.request('GET', '/chat');
    check('the old chat page is retired in favour of the dock', () => {
      assert.equal(res.status, 302);
      assert.match(res.headers.get('location'), /\/\?chat=1/);
    });
  }
  {
    const res = await a.request('GET', '/api/chat/dock', { headers: a.jsonHeaders() });
    const body = await res.json();
    check('the dock lists the conversation', () => {
      assert.equal(res.status, 200);
      assert.ok(body.conversations.length >= 1);
      assert.ok(body.conversations.some((c) => c.username === B.username));
    });
  }
  {
    // Sharing a thing: the card is built on the server, so it can only
    // point at a thing that really exists.
    const res = await a.post('/share', {
      form: { type: 'post', id: postId, username: B.username, note: 'Look at this one.', _csrf: a.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const body = await res.json();
    check('a post can be handed to another driver in a chat', () => {
      assert.equal(body.ok, true);
      assert.ok(body.conversationId > 0);
      assert.equal(body.share.type, 'post');
      assert.equal(body.share.id, postId);
      assert.match(body.message.html, /class="msg__share"/);
      assert.match(body.message.html, /Look at this one\./);
      const row = get('SELECT share_type, share_id, share_title FROM messages WHERE id = (SELECT MAX(id) FROM messages)');
      assert.equal(row.share_type, 'post');
      assert.equal(row.share_id, postId);
      assert.ok(row.share_title);
    });
  }
  {
    // The other driver finds the card in their thread.
    const res = await b.request('GET', `/chat/${conversationId}/messages?after=0`, { headers: b.jsonHeaders() });
    const body = await res.json();
    check('the shared card shows up in the thread of the other driver', () => {
      const shared = body.messages.find((m) => m.share && m.share.type === 'post');
      assert.ok(shared, 'the message carries the shared thing');
      assert.equal(shared.share.id, postId);
    });
  }
  {
    const res = await a.post('/share', {
      form: { type: 'post', id: 999999, username: B.username, _csrf: a.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const body = await res.json();
    check('a thing that does not exist cannot be shared', () => {
      assert.equal(body.ok, false);
    });
  }
  {
    const res = await a.post('/share', {
      form: { type: 'post', id: postId, username: A.username, _csrf: a.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const body = await res.json();
    check('a driver cannot share with themselves', () => {
      assert.equal(body.ok, false);
    });
  }
  {
    // A thread that was just started has no messages, so the dock asks
    // for it by id instead of finding it in the list.
    const res = await a.request('GET', `/api/chat/dock?id=${conversationId}`, { headers: a.jsonHeaders() });
    const body = await res.json();
    check('the dock can open a thread that has no messages yet', () => {
      assert.equal(res.status, 200);
      assert.ok(body.conversation);
      assert.equal(body.conversation.id, conversationId);
    });
  }
  {
    const res = await b.post(`/chat/${conversationId}/mute`, { headers: b.jsonHeaders() });
    const body = await res.json();
    check('a chat can be muted for one member', () => {
      assert.equal(res.status, 200);
      assert.equal(body.muted, true);
    });

    const dock = await b.request('GET', '/api/chat/dock', { headers: b.jsonHeaders() });
    const dockBody = await dock.json();
    const row = dockBody.conversations.find((c) => c.id === conversationId);
    check('the dock marks the muted conversation', () => {
      assert.ok(row);
      assert.equal(row.muted, true);
    });

    const again = await b.post(`/chat/${conversationId}/mute`, { headers: b.jsonHeaders() });
    const againBody = await again.json();
    check('the mute can be turned off again', () => assert.equal(againBody.muted, false));
  }
  {
    const res = await b.post(`/chat/${conversationId}/delete`, b.formWithCsrf({}));
    check('B deletes the chat for themselves', () => assert.equal(res.status, 302));
    const cleared = get(
      'SELECT cleared_at FROM conversation_members WHERE conversation_id = ? AND user_id = (SELECT id FROM users WHERE username = ?)',
      conversationId,
      B.username,
    );
    check('chat is only cleared for B', () => assert.ok(cleared.cleared_at));
  }
  {
    const res = await a.request('GET', '/api/chat/dock', { headers: a.jsonHeaders() });
    const body = await res.json();
    check('A still sees the chat after B deleted it', () => {
      assert.ok(body.conversations.some((c) => c.username === B.username));
    });
  }
  let globalId;
  {
    globalId = get("SELECT id FROM conversations WHERE kind = 'global'").id;
    check('a single shared global channel exists', () => assert.ok(globalId > 0));
  }
  {
    const res = await a.request('GET', '/api/chat/dock', { headers: a.jsonHeaders() });
    const body = await res.json();
    check('the global channel heads the dock list', () => {
      assert.ok(body.conversations.some((c) => c.kind === 'global'));
    });
  }
  {
    const res = await a.post(`/chat/${globalId}/send`, {
      json: { body: 'Anyone heading to the docks tonight?' },
      headers: a.jsonHeaders(),
    });
    const body = await res.json();
    check('A posts in the global channel', () => {
      assert.equal(body.ok, true);
      assert.equal(body.message.body, 'Anyone heading to the docks tonight?');
    });
  }
  {
    const res = await b.request('GET', `/chat/${globalId}`, { headers: b.jsonHeaders() });
    check('a thread link opens the dock in that thread', () => {
      assert.equal(res.status, 302);
      assert.match(res.headers.get('location'), new RegExp(`/\\?chat=${globalId}`));
    });
  }
  {
    const res = await a.post(`/chat/${globalId}/delete`, a.formWithCsrf({}));
    check('the global channel cannot be deleted', () => {
      assert.equal(res.status, 302);
      const row = get("SELECT COUNT(*) AS n FROM conversations WHERE id = ? AND kind = 'global'", globalId);
      assert.equal(row.n, 1);
    });
  }

  /* 7. groups ------------------------------------------------------- */
  console.log('\ngroups');
  let slug;
  let groupId;
  {
    const res = await a.post('/groups/new', a.formWithCsrf({
      name: `Smoke Crew ${tag}`,
      description: 'Created by the smoke test.',
      privacy: 'open',
    }));
    const location = res.headers.get('location') ?? '';
    slug = location.split('/').pop();
    check('A creates an open crew', () => {
      assert.equal(res.status, 302);
      assert.ok(slug);
      groupId = get('SELECT id FROM groups WHERE slug = ?', slug).id;
    });
  }
  {
    const res = await b.post(`/groups/${slug}/join`, b.formWithCsrf({}));
    check('B joins the open crew', () => assert.equal(res.status, 302));
    const member = get(
      'SELECT status FROM group_members WHERE group_id = ? AND user_id = (SELECT id FROM users WHERE username = ?)',
      groupId,
      B.username,
    );
    check('B is an active member', () => assert.equal(member.status, 'active'));
  }
  {
    const res = await b.post(`/groups/${slug}/posts`, b.formWithCsrf({
      body: 'Crew post from B.',
      post_type: 'text',
    }));
    check('B posts inside the crew', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT group_id FROM posts ORDER BY id DESC LIMIT 1');
      assert.equal(row.group_id, groupId);
    });
  }
  {
    const { res, html } = await a.page(`/groups/${slug}`);
    check('crew page shows both members and the post', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Crew post from B\./);
      assert.match(html, new RegExp(B.username));
    });
  }
  {
    const res = await a.post('/groups/new', a.formWithCsrf({
      name: `Private ${tag}`,
      description: 'Approval required.',
      privacy: 'private',
    }));
    const privateSlug = (res.headers.get('location') ?? '').split('/').pop();
    const join = await b.post(`/groups/${privateSlug}/join`, b.formWithCsrf({}));
    const status = get(
      'SELECT status FROM group_members WHERE group_id = (SELECT id FROM groups WHERE slug = ?) AND user_id = (SELECT id FROM users WHERE username = ?)',
      privateSlug,
      B.username,
    );
    check('joining a private crew creates a pending request', () => {
      assert.equal(join.status, 302);
      assert.equal(status.status, 'pending');
    });
  }

  /* 8. meetups ------------------------------------------------------ */
  console.log('\nmeetups');
  let meetupId;
  {
    const res = await a.post('/meetups/new', a.formWithCsrf({
      title: 'Smoke Meetup',
      description: 'GPS pin from the device.',
      place_name: 'Coast Road Lookout',
      address: 'Coast Road, Somewhere',
      lat: '35.6812',
      lng: '139.7671',
      starts_at: '2030-06-01T20:00',
      privacy: 'open',
      capacity: '10',
    }));
    const location = res.headers.get('location') ?? '';
    meetupId = Number(location.split('/').pop());
    check('A hosts an open meetup with a pinned location', () => {
      assert.equal(res.status, 302);
      assert.ok(meetupId > 0);
    });
  }
  {
    const { res, html } = await a.page(`/meetups/${meetupId}`);
    check('meetup page renders with the location', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Smoke Meetup/);
      assert.match(html, /Coast Road Lookout/);
    });
  }
  {
    const res = await b.post(`/meetups/${meetupId}/join`, { headers: b.jsonHeaders() });
    const body = await res.json();
    check('B joins the meetup', () => {
      assert.equal(body.ok, true);
      assert.equal(body.status, 'going');
    });
  }
  {
    const res = await b.post(`/meetups/${meetupId}/maybe`, { headers: b.jsonHeaders() });
    const body = await res.json();
    check('B can toggle maybe', () => assert.equal(body.status, 'maybe'));
  }
  {
    const res = await a.post('/meetups/new', a.formWithCsrf({
      title: 'No Place',
      starts_at: '2030-06-01T20:00',
      privacy: 'open',
    }));
    const html = await res.text();
    check('meetup without a location is rejected', () => {
      assert.equal(res.status, 400);
      assert.match(html, /street|GPS|spot/i);
    });
  }
  {
    const { res, html } = await a.page('/meetups');
    check('meetups list renders', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Smoke Meetup/);
    });
  }

  /* 9. builds ------------------------------------------------------- */
  console.log('\nbuilds');
  const guest = new Client(base);
  let buildId;
  {
    const res = await guest.request('GET', '/builds/new');
    check('adding a build requires a login', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    });
  }
  {
    const res = await guest.request('GET', '/builds');
    check('the builds gallery is public', () => assert.equal(res.status, 200));
  }
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const fd = new FormData();
    fd.set('title', 'Smoke Skyline');
    fd.set('make', 'Nissan');
    fd.set('model', 'Skyline R33');
    fd.set('year', '1995');
    fd.set('engine', 'RB26DETT twin turbo');
    fd.set('power_hp', '420');
    fd.set('visibility', 'public');
    fd.set('description', 'Assembled by the smoke test.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([png], { type: 'image/png' }), 'front.png');
    const res = await a.post('/builds', { multipart: fd });
    buildId = Number((res.headers.get('location') ?? '').split('/').pop());
    check('A publishes a build with a photo', () => {
      assert.equal(res.status, 302);
      assert.ok(buildId > 0);
      const row = get('SELECT title, visibility, cover FROM builds WHERE id = ?', buildId);
      assert.equal(row.title, 'Smoke Skyline');
      assert.equal(row.visibility, 'public');
      assert.ok(row.cover, 'cover image was set');
      assert.ok(fs.existsSync(path.join(ROOT, 'uploads-smoke', row.cover)), 'cover exists on disk');
    });
  }
  {
    const { res, html } = await a.page(`/builds/${buildId}`);
    check('the build page shows the gallery and spec sheet', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Smoke Skyline/);
      assert.match(html, /RB26DETT twin turbo/);
      assert.match(html, /420 hp/);
    });
  }
  {
    // The edit form is multipart and carries the build specs plus every
    // registration-certificate field. Keep this above Multer's old field cap
    // so the "too many fields" save crash cannot come back.
    const fd = new FormData();
    for (const [key, value] of Object.entries({
      title: 'Smoke Skyline',
      make: 'Nissan',
      model: 'Skyline R33',
      year: '1995',
      engine: 'RB26DETT twin turbo',
      drivetrain: 'RWD',
      transmission: '5-speed manual',
      power_hp: '420',
      torque_nm: '392',
      weight_kg: '1530',
      mods: 'Twin turbo, coilovers',
      description: 'Assembled by the smoke test.',
      visibility: 'public',
      for_sale: '',
      price: '',
      currency: 'GEL',
      price_note: '',
      linked_vehicle_id: '',
      pull_certificate: '',
      number_plate: 'SMK-001',
      technical_passport: 'AJA0000001',
      registration_date: '2020-01-01',
      expiry_date: '2030-01-01',
      owner_surname: 'Smoke',
      owner_name: 'Tester',
      owner_address: 'Tbilisi',
      owner_id: '01000000000',
      owner_of_vehicle: 'Smoke Tester',
      vehicle_type: 'C0',
      vin: 'BNR33-000001',
      max_laden_mass: '1800',
      permissible_mass: '1750',
      unladen_mass: '1530',
      engine_capacity: '2568',
      net_power_kw: '309',
      fuel_type: 'Petrol',
      engine_number: 'RB26-000001',
      power_weight_ratio: '0.2',
      colour: 'White',
      seats: '4',
      standing_places: '0',
    })) fd.set(key, value);
    fd.set('_csrf', a.csrf);
    const res = await a.post(`/builds/${buildId}`, { multipart: fd });
    check('the full build form saves every certificate field', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT number_plate, owner_surname, vin FROM builds WHERE id = ?', buildId);
      assert.equal(row.number_plate, 'SMK-001');
      assert.equal(row.owner_surname, 'Smoke');
      assert.equal(row.vin, 'BNR33-000001');
    });
  }
  {
    check('the PTI parser reads an active inspection', () => {
      const parsed = parsePtiHtml(`
        <div class="row"><div class="col-12 mt-3 deadlineTitle">ინსპექტირებულია</div></div>
        <div class="ptiTextBG">სახელმწიფო ნომერი: JZ110XX</div>
        <div class="ptiTextBG">ინსპექტირების თარიღი:  9 ოქტომბერი  2026</div>
        <div class="ptiTextBG">მოქმედების ვადა:  9 ოქტომბერი  2027 23:59:59</div>
      `);
      assert.equal(parsed.status, 'valid');
      assert.equal(parsed.plate, 'JZ110XX');
      assert.equal(parsed.inspectedAt, '2026-10-09');
      assert.equal(parsed.expiresAt, '2027-10-09');
    });
    check('the PTI parser reads an expired inspection', () => {
      const parsed = parsePtiHtml(`
        <div class="deadlineTitle">ვადაგადაცილებულია</div>
        <div class="ptiTextBG">სახელმწიფო ნომერი: JP-004-AN</div>
        <div class="ptiTextBG">ინსპექტირების თარიღი: 29 დეკემბერი 2023</div>
        <div class="ptiTextBG">მოქმედების ვადა: 29 დეკემბერი 2024 23:59:59</div>
      `);
      assert.equal(parsed.status, 'expired');
      assert.equal(parsed.plate, 'JP004AN');
      assert.equal(parsed.expiresAt, '2024-12-29');
      assert.equal(normalizePlate('JP-004-AN'), 'JP004AN');
    });
    check('an unknown PTI page and a stale plate are not treated as valid', () => {
      assert.equal(parsePtiHtml('<html><title>Server Error</title></html>').status, 'unknown');
      const future = ptiState({
        number_plate: 'JZ-110-XX',
        pti_status: 'valid',
        pti_plate: 'OTHER',
        pti_expires_at: '2099-01-01',
      });
      assert.equal(future.status, 'unknown');
      const expired = ptiState({
        number_plate: 'JP-004-AN',
        pti_status: 'valid',
        pti_plate: 'JP004AN',
        pti_expires_at: '2024-12-29',
      }, new Date('2026-10-20T12:00:00Z'));
      assert.equal(expired.status, 'expired');

      // A linked build may rely on the snapshot's plate when the card itself
      // has no plate field; with no plate anywhere the badge stays hidden.
      const inherited = ptiState({
        number_plate: null,
        pti_status: 'valid',
        pti_plate: 'SYNC001',
        pti_expires_at: '2030-01-01',
      });
      assert.equal(inherited.status, 'valid');
      assert.equal(ptiState({ number_plate: null, pti_plate: null }).status, 'missing');
    });
  }
  {
    const ownerId = get('SELECT id FROM users WHERE username = ?', A.username).id;
    const vehicle = db.prepare(
      `INSERT INTO vehicles (user_id, name, linked_build_id, number_plate, owner_surname)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(ownerId, 'Smoke Cert Car', buildId, 'OLD-001', 'OldOwner');
    const vehicleId = Number(vehicle.lastInsertRowid);
    db.prepare('UPDATE builds SET linked_vehicle_id = ? WHERE id = ?').run(vehicleId, buildId);
    const { res, html } = await a.page(`/builds/${buildId}/edit`);
    check('the pull-certificate box stays checked for a linked build', () => {
      assert.equal(res.status, 200);
      assert.match(html, /name="pull_certificate"[^>]*checked/);
    });

    const fd = new FormData();
    for (const [key, value] of Object.entries({
      title: 'Smoke Skyline',
      make: 'Toyota',
      model: 'Supra',
      year: '1998',
      visibility: 'public',
      linked_vehicle_id: String(vehicleId),
      number_plate: 'SYNC-001',
      technical_passport: 'AJA9999999',
      owner_surname: 'Synced',
      owner_name: 'Owner',
      vin: 'JT2SYNC000000001',
      engine_capacity: '2997',
      fuel_type: 'Petrol',
      net_power_kw: '239',
      unladen_mass: '1500',
    })) fd.set(key, value);
    fd.set('_csrf', a.csrf);
    const save = await a.post(`/builds/${buildId}`, { multipart: fd });
    check('editing a build certificate updates the linked My Ride vehicle', () => {
      assert.equal(save.status, 302);
      const row = get(
        `SELECT make, model, year, number_plate, owner_surname, technical_passport, vin,
                engine, power_hp, weight_kg
           FROM vehicles WHERE id = ?`,
        vehicleId,
      );
      assert.equal(row.make, 'Toyota');
      assert.equal(row.model, 'Supra');
      assert.equal(row.year, 1998);
      assert.equal(row.number_plate, 'SYNC-001');
      assert.equal(row.owner_surname, 'Synced');
      assert.equal(row.technical_passport, 'AJA9999999');
      assert.equal(row.vin, 'JT2SYNC000000001');
      assert.equal(row.engine, '2997 cm³ Petrol');
      assert.equal(row.power_hp, 321);
      assert.equal(row.weight_kg, 1500);
    });
    check('saving a build plate stores the inspection on the build and linked vehicle', () => {
      const b = get('SELECT pti_status, pti_plate, pti_expires_at FROM builds WHERE id = ?', buildId);
      const v = get('SELECT pti_status, pti_plate, pti_expires_at FROM vehicles WHERE id = ?', vehicleId);
      assert.equal(b.pti_status, 'valid');
      assert.equal(b.pti_plate, 'SYNC001');
      assert.equal(b.pti_expires_at, '2030-01-01');
      assert.equal(v.pti_status, 'valid');
      assert.equal(v.pti_plate, 'SYNC001');
      assert.equal(v.pti_expires_at, '2030-01-01');
    });

    const checkedAt = new Date().toISOString();
    db.prepare(
      `UPDATE builds
          SET pti_status = 'valid', pti_plate = 'SYNC001', pti_inspected_at = '2029-01-01',
              pti_expires_at = '2030-01-01', pti_checked_at = ?
        WHERE id = ?`,
    ).run(checkedAt, buildId);
    db.prepare(
      `UPDATE vehicles
          SET pti_status = 'valid', pti_plate = 'SYNC001', pti_inspected_at = '2029-01-01',
              pti_expires_at = '2030-01-01', pti_checked_at = ?
        WHERE id = ?`,
    ).run(checkedAt, vehicleId);

    const shown = await a.page(`/builds/${buildId}`);
    check('a build shows its green technical-inspection badge', () => {
      assert.equal(shown.res.status, 200);
      assert.match(shown.html, /pti-badge--valid/);
      assert.match(shown.html, /Technical inspection/);
    });
    const ride = await a.page('/garage/ride');
    check('My Ride shows the same technical-inspection badge', () => {
      assert.equal(ride.res.status, 200);
      assert.match(ride.html, /pti-badge--valid/);
    });

    db.prepare('UPDATE builds SET pti_expires_at = ? WHERE id = ?').run('2020-01-01', buildId);
    const expiredPage = await a.page(`/builds/${buildId}`);
    check('an expired inspection turns the build badge red', () => {
      assert.match(expiredPage.html, /pti-badge--expired/);
    });

    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
    db.prepare('UPDATE builds SET linked_vehicle_id = NULL WHERE id = ?').run(buildId);
  }
  {
    const ownerId = get('SELECT id FROM users WHERE username = ?', A.username).id;
    const vehicle = db.prepare(
      'INSERT INTO vehicles (user_id, name, number_plate) VALUES (?, ?, ?)',
    ).run(ownerId, 'Smoke Expired Car', 'EXPIRED1');
    const vehicleId = Number(vehicle.lastInsertRowid);
    const ride = await a.page('/garage/ride');
    check('My Ride automatically checks an unchecked plate', () => {
      const row = get('SELECT pti_status, pti_expires_at FROM vehicles WHERE id = ?', vehicleId);
      assert.equal(row.pti_status, 'expired');
      assert.equal(row.pti_expires_at, '2020-01-01');
      assert.match(ride.html, /pti-badge--expired/);
    });
    check('Garage keeps My Ride, Fines and Add vehicle in one switch', () => {
      assert.match(ride.html, /href="\/garage\/ride"/);
      assert.match(ride.html, /href="\/garage\/fines"/);
      assert.match(ride.html, /id="toggle-add-vehicle"/);
    });
    const fines = await a.page('/garage/fines');
    check('the Fines tab opens the fines page', () => {
      assert.equal(fines.res.status, 200);
      assert.match(fines.html, /Check traffic fines/);
      assert.match(fines.html, /href="\/garage\/fines"/);
    });
    const garage = await a.page('/garage');
    check('the Garage route opens My Ride directly', () => {
      assert.equal(garage.res.status, 302);
      assert.equal(garage.res.headers.get('location'), '/garage/ride');
    });
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
  }
  {
    const fd = new FormData();
    for (const [key, value] of Object.entries({
      title: 'Smoke PTI Car',
      make: 'Toyota',
      model: 'Corolla',
      number_plate: 'EXPIRED1',
    })) fd.set(key, value);
    fd.set('_csrf', a.csrf);
    const res = await a.post('/garage/ride', { multipart: fd });
    const row = get(
      'SELECT id, pti_status, pti_expires_at FROM vehicles WHERE name = ? ORDER BY id DESC LIMIT 1',
      'Smoke PTI Car',
    );
    check('adding a vehicle stores its inspection automatically', () => {
      assert.equal(res.status, 302);
      assert.equal(row.pti_status, 'expired');
      assert.equal(row.pti_expires_at, '2020-01-01');
    });
    if (row) {
      const edit = await a.post(
        `/garage/ride/${row.id}/certificate`,
        a.formWithCsrf({ title: 'Smoke PTI Car', make: 'Toyota', model: 'Corolla', number_plate: 'SYNC-001' }),
      );
      const updated = get('SELECT pti_status, pti_plate, pti_expires_at FROM vehicles WHERE id = ?', row.id);
      check('editing a vehicle plate refreshes its inspection', () => {
        assert.equal(edit.status, 302);
        assert.equal(updated.pti_status, 'valid');
        assert.equal(updated.pti_plate, 'SYNC001');
        assert.equal(updated.pti_expires_at, '2030-01-01');
      });
      const unknownEdit = await a.post(
        `/garage/ride/${row.id}/certificate`,
        a.formWithCsrf({ title: 'Smoke PTI Car', make: 'Toyota', model: 'Corolla', number_plate: 'UNKNOWN1' }),
      );
      const unknown = get('SELECT pti_status, pti_plate FROM vehicles WHERE id = ?', row.id);
      check('a failed inspection lookup stores an unknown snapshot', () => {
        assert.equal(unknownEdit.status, 302);
        assert.equal(unknown.pti_status, 'unknown');
        assert.equal(unknown.pti_plate, 'UNKNOWN1');
      });
      db.prepare('DELETE FROM vehicles WHERE id = ?').run(row.id);
    }
  }
  {
    db.prepare(
      `UPDATE builds
          SET pti_status = NULL, pti_plate = NULL, pti_inspected_at = NULL,
              pti_expires_at = NULL, pti_checked_at = NULL
        WHERE id = ?`,
    ).run(buildId);
    const page = await a.page(`/builds/${buildId}`);
    check('a build page refreshes a stale inspection for its owner', () => {
      const row = get('SELECT pti_status, pti_plate FROM builds WHERE id = ?', buildId);
      assert.equal(row.pti_status, 'valid');
      assert.equal(row.pti_plate, 'SYNC001');
      assert.match(page.html, /pti-badge--valid/);
    });
  }
  {
    const page = await guest.page(`/builds/${buildId}`);
    check('a public build page shows the inspection badge', () => {
      assert.match(page.html, /pti-badge--valid/);
      assert.doesNotMatch(page.html, /SYNC-001/);
      assert.doesNotMatch(page.html, /pti\.ge\?govNum/);
    });
  }
  {
    db.prepare('UPDATE builds SET pti_status = ?, pti_expires_at = NULL, pti_checked_at = ? WHERE id = ?')
      .run('unknown', new Date().toISOString(), buildId);
    const page = await guest.page(`/builds/${buildId}`);
    check('a public build page keeps a failed lookup visible as grey', () => {
      assert.match(page.html, /pti-badge--unknown/);
    });
    db.prepare('UPDATE builds SET pti_status = ?, pti_plate = ?, pti_expires_at = ? WHERE id = ?')
      .run('valid', 'SYNC001', '2030-01-01', buildId);
  }
  {
    const saved = get('SELECT number_plate, pti_status, pti_plate, pti_expires_at, pti_checked_at FROM builds WHERE id = ?', buildId);
    db.prepare('UPDATE builds SET number_plate = NULL, pti_status = NULL, pti_plate = NULL, pti_expires_at = NULL, pti_checked_at = NULL WHERE id = ?').run(buildId);
    const page = await guest.page(`/builds/${buildId}`);
    check('a build without a plate hides the inspection badge', () => {
      assert.doesNotMatch(page.html, /pti-badge/);
    });
    db.prepare(
      `UPDATE builds SET number_plate = ?, pti_status = ?, pti_plate = ?, pti_expires_at = ?, pti_checked_at = ? WHERE id = ?`,
    ).run(saved.number_plate, saved.pti_status, saved.pti_plate, saved.pti_expires_at, saved.pti_checked_at, buildId);
  }
  {
    const ownerId = get('SELECT id FROM users WHERE username = ?', A.username).id;
    const vehicle = db.prepare('INSERT INTO vehicles (user_id, name, current_mileage, linked_build_id) VALUES (?, ?, ?, ?)')
      .run(ownerId, 'Smoke Odometer Car', 180000, buildId);
    const vehicleId = Number(vehicle.lastInsertRowid);
    db.prepare('UPDATE builds SET linked_vehicle_id = ? WHERE id = ?').run(vehicleId, buildId);

    const fd = new FormData();
    for (const [key, value] of Object.entries({
      title: 'Smoke Skyline',
      make: 'Toyota',
      model: 'Supra',
      year: '1998',
      visibility: 'public',
      linked_vehicle_id: String(vehicleId),
      number_plate: 'SYNC-001',
      odometer_km: '191000',
    })) fd.set(key, value);
    fd.set('_csrf', a.csrf);
    const save = await a.post(`/builds/${buildId}`, { multipart: fd });
    check('the build editor saves the odometer', () => {
      assert.equal(save.status, 302);
      assert.equal(get('SELECT odometer_km FROM builds WHERE id = ?', buildId).odometer_km, 191000);
    });
    check('saving a build odometer updates the linked My Ride vehicle', () => {
      assert.equal(get('SELECT current_mileage FROM vehicles WHERE id = ?', vehicleId).current_mileage, 191000);
    });

    const odometerRes = await a.post(`/garage/ride/${vehicleId}/odometer`, {
      form: { mileage: '197500', _csrf: a.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const odometerBody = await odometerRes.json();
    check('editing the odometer in My Ride updates the linked build', () => {
      assert.equal(odometerRes.status, 200);
      assert.equal(odometerBody.ok, true);
      assert.equal(odometerBody.mileage, 197500);
      assert.equal(get('SELECT current_mileage FROM vehicles WHERE id = ?', vehicleId).current_mileage, 197500);
      assert.equal(get('SELECT odometer_km FROM builds WHERE id = ?', buildId).odometer_km, 197500);
    });

    const ride = await a.page('/garage/ride');
    check('My Ride renders the odometer as an inline editor', () => {
      assert.match(ride.html, /data-odometer-input/);
      assert.match(ride.html, /197500/);
    });

    db.prepare('UPDATE vehicles SET linked_build_id = NULL WHERE id = ?').run(vehicleId);
    db.prepare('UPDATE builds SET linked_vehicle_id = NULL WHERE id = ?').run(buildId);
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
  }
  {
    const { refreshStalePti } = await import('../src/lib/pti-refresh.js');
    const bId = get('SELECT id FROM users WHERE username = ?', B.username).id;
    const v = db.prepare(
      `INSERT INTO vehicles (user_id, name, number_plate, pti_status, pti_plate, pti_checked_at, pti_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(bId, 'Smoke Sweep Car', 'SYNC-001', 'valid', 'SYNC001', new Date(Date.now() - 48 * 3600 * 1000).toISOString(), '2030-01-01');
    const vehicleId = Number(v.lastInsertRowid);
    const result = await refreshStalePti();
    check('the daily sweep refreshes a stale plate for another member', () => {
      assert.ok(result.checked >= 1);
      const row = get('SELECT pti_status, pti_expires_at FROM vehicles WHERE id = ?', vehicleId);
      assert.equal(row.pti_status, 'valid');
      assert.equal(row.pti_expires_at, '2030-01-01');
    });
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
  }
  {
    const res = await b.post(`/builds/${buildId}/vote`, { headers: b.jsonHeaders() });
    const body = await res.json();
    check('B votes for build of the week', () => {
      assert.equal(body.ok, true);
      assert.equal(body.voted, true);
      assert.equal(body.weekVotes, 1);
      assert.equal(body.votes, 1);
    });
  }
  {
    const res = await b.post(`/builds/${buildId}/vote`, { headers: b.jsonHeaders() });
    const body = await res.json();
    check('voting again withdraws the vote', () => {
      assert.equal(body.ok, true);
      assert.equal(body.voted, false);
      assert.equal(body.weekVotes, 0);
    });
  }
  {
    const res = await a.post(`/builds/${buildId}/vote`, { headers: a.jsonHeaders() });
    check('a driver cannot vote for their own build', () => assert.equal(res.status, 400));
  }
  {
    const res = await a.post('/builds', a.formWithCsrf({ title: '', visibility: 'public' }));
    const html = await res.text();
    check('a build without a name is rejected', () => {
      assert.equal(res.status, 400);
      assert.match(html, /Give your build a name/i);
    });
  }
  let privateId;
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const fd = new FormData();
    fd.set('title', 'Smoke Secret Build');
    fd.set('visibility', 'private');
    fd.set('description', 'Hidden while it is in pieces.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([png], { type: 'image/png' }), 'secret.png');
    const res = await a.post('/builds', { multipart: fd });
    privateId = Number((res.headers.get('location') ?? '').split('/').pop());
    check('A publishes a private build', () => assert.ok(privateId > 0));
  }
  {
    const mine = await a.request('GET', `/builds/${privateId}`);
    const other = await b.request('GET', `/builds/${privateId}`);
    check('a private build is only visible to its owner', () => {
      assert.equal(mine.status, 200);
      assert.equal(other.status, 404);
    });
  }
  {
    const { html } = await b.page('/builds?scope=all');
    check('private builds stay out of the public gallery', () => {
      assert.doesNotMatch(html, /Smoke Secret Build/);
      assert.match(html, /Smoke Skyline/);
    });
  }
  {
    const { html } = await a.page('/builds?scope=mine');
    check('the owner sees a private build under "My builds"', () => {
      assert.match(html, /Smoke Secret Build/);
    });
  }
  {
    const { res, html } = await a.page('/builds');
    check('the gallery shows the live weekly standings', () => {
      assert.equal(res.status, 200);
      assert.match(html, /This week/);
    });
  }
  let saleId;
  let watchId;
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const fd = new FormData();
    fd.set('title', 'Smoke Seller');
    fd.set('make', 'Toyota');
    fd.set('model', 'Supra');
    fd.set('visibility', 'public');
    fd.set('for_sale', '1');
    fd.set('price', '25000');
    fd.set('price_note', 'negotiable');
    fd.set('description', 'Up for grabs.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([png], { type: 'image/png' }), 'sale.png');
    const res = await a.post('/builds', { multipart: fd });
    saleId = Number((res.headers.get('location') ?? '').split('/').pop());
    check('A lists a build for sale with a price', () => {
      assert.equal(res.status, 302);
      assert.ok(saleId > 0);
      const row = get('SELECT for_sale, price, price_note FROM builds WHERE id = ?', saleId);
      assert.equal(row.for_sale, 1);
      assert.equal(row.price, 25000);
      assert.equal(row.price_note, 'negotiable');
    });
  }
  {
    const { res, html } = await guest.page('/builds?scope=sale');
    check('the "For sale" tab lists the car with its price for guests', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Smoke Seller/);
      assert.match(html, /25,000 ₾/);
    });
  }
  {
    const { res, html } = await b.page(`/builds/${saleId}`);
    check('the build page shows the asking price and a message button', () => {
      assert.equal(res.status, 200);
      assert.match(html, /For sale/);
      assert.match(html, /25,000 ₾/);
      assert.match(html, /friends\/message\//);
    });
  }
  {
    const fd = new FormData();
    fd.set('title', 'Smoke Hidden Sale');
    fd.set('visibility', 'private');
    fd.set('for_sale', '1');
    fd.set('price', '9000');
    fd.set('description', 'Kept off the public market.');
    fd.set('_csrf', a.csrf);
    await a.post('/builds', { multipart: fd });
    const { html } = await guest.page('/builds?scope=sale');
    check('a private build stays out of the "For sale" tab', () => {
      assert.doesNotMatch(html, /Smoke Hidden Sale/);
    });
  }
  {
    /* The timeline: the history of the build. */
    const fd = new FormData();
    fd.set('title', 'Smoke Timeline Car');
    fd.set('make', 'Honda');
    fd.set('model', 'Integra');
    fd.set('description', 'A car with a story.');
    fd.set('_csrf', a.csrf);
    await a.post('/builds', { multipart: fd });
    const tlId = get('SELECT id FROM builds WHERE title = ? ORDER BY id DESC LIMIT 1', 'Smoke Timeline Car')?.id;
    check('the test build was created', () => assert.ok(tlId, 'the build is there'));
    const fd2 = new FormData();
    fd2.set('title', 'Smoke Turbo Swap');
    fd2.set('kind', 'engine');
    fd2.set('mileage', '180000');
    fd2.set('cost', '1200');
    fd2.set('changed_at', '2026-09-15');
    fd2.set('_csrf', a.csrf);
    const res = await a.post(`/builds/${tlId}/timeline`, { multipart: fd2 });
    check('an entry goes onto the timeline', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT * FROM build_timeline WHERE build_id = ? ORDER BY id DESC LIMIT 1', tlId);
      assert.equal(row.title, 'Smoke Turbo Swap');
      assert.equal(row.kind, 'engine');
      assert.equal(row.mileage, 180000);
    });
    const { html } = await guest.page(`/builds/${tlId}`);
    check('the public build page tells the story of the build', () => {
      assert.match(html, /Smoke Turbo Swap/);
      assert.match(html, /180,?000 km/);
    });
    const entryId = get('SELECT id FROM build_timeline WHERE build_id = ? ORDER BY id DESC LIMIT 1', tlId).id;
    const edited = await a.post(`/builds/${tlId}/timeline/${entryId}`, a.formWithCsrf({
      title: 'Smoke Turbo Swap v2',
      kind: 'suspension',
      mileage: '190000',
      cost: '900',
    }));
    check('an entry can be changed after the fact', () => {
      assert.equal(edited.status, 302);
      const row = get('SELECT * FROM build_timeline WHERE id = ?', entryId);
      assert.equal(row.title, 'Smoke Turbo Swap v2');
      assert.equal(row.kind, 'suspension');
      assert.equal(row.mileage, 190000);
    });
    const removed = await a.post(`/builds/${tlId}/timeline/${entryId}/delete`, a.formWithCsrf({}));
    check('an entry can be taken off the timeline', () => {
      assert.equal(removed.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM build_timeline WHERE id = ?', entryId).n, 0);
    });
    check('the timeline keeps its tab after a change', () => {
      assert.match(String(removed.headers.get('location') || ''), /#timeline$/);
    });
  }
  {
    /* The inspection badge: short, and the colour says the rest. */
    const fd = new FormData();
    fd.set('title', 'Smoke Badge Car');
    fd.set('make', 'Honda');
    fd.set('model', 'Integra');
    fd.set('description', 'A car with a plate.');
    fd.set('_csrf', a.csrf);
    await a.post('/builds', { multipart: fd });
    const badgeId = get('SELECT id FROM builds WHERE title = ? ORDER BY id DESC LIMIT 1', 'Smoke Badge Car')?.id;
    check('the badge test build was created', () => assert.ok(badgeId, 'the build is there'));
    const plate = 'BG1234';
    db.prepare('UPDATE builds SET number_plate = ? WHERE id = ?').run(plate, badgeId);

    db.prepare(
      "UPDATE builds SET pti_status = 'expired', pti_expires_at = '2024-12-29', pti_plate = ? WHERE id = ?",
    ).run(plate, badgeId);
    const { html } = await guest.page(`/builds/${badgeId}`);
    check('the inspection badge is short, and red when it has run out', () => {
      // The badge itself carries the date and nothing else.
      const badgeText = (html.match(/pti-badge__date">([^<]*)</) || ['', ''])[1].trim();
      assert.equal(badgeText, 'Dec 29, 2024');
      assert.match(html, /pti-badge__label[^>]*>PTI\.GE</);
      assert.match(html, /pti-badge--expired/);
    });

    db.prepare(
      "UPDATE builds SET pti_status = 'valid', pti_expires_at = '2027-07-05', pti_plate = ? WHERE id = ?",
    ).run(plate, badgeId);
    const ok = await guest.page(`/builds/${badgeId}`);
    check('the inspection badge is green while it holds', () => {
      const badgeText = (ok.html.match(/pti-badge__date">([^<]*)</) || ['', ''])[1].trim();
      assert.equal(badgeText, 'Jul 5, 2027');
      assert.match(ok.html, /pti-badge__label[^>]*>PTI\.GE</);
      assert.match(ok.html, /pti-badge--valid/);
    });
  }
  {
    const res = await a.post(`/builds/${saleId}`, a.formWithCsrf({
      title: 'Smoke Seller',
      visibility: 'public',
    }));
    const { html } = await guest.page('/builds?scope=sale');
    check('unticking "for sale" takes the car off the market', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT for_sale FROM builds WHERE id = ?', saleId).for_sale, 0);
      assert.doesNotMatch(html, /Smoke Seller/);
    });
  }
  {
    const res = await a.post(`/builds/${buildId}/delete`, a.formWithCsrf({}));
    check('the owner can delete a build', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM builds WHERE id = ?', buildId).n, 0);
    });
  }

  /* 9b. watching a build until it goes on sale --------------------- */
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const fd = new FormData();
    fd.set('title', 'Smoke Watch Car');
    fd.set('make', 'Nissan');
    fd.set('model', 'Silvia');
    fd.set('visibility', 'public');
    fd.set('description', 'Not on the market yet.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([png], { type: 'image/png' }), 'watch.png');
    const res = await a.post('/builds', { multipart: fd });
    watchId = Number((res.headers.get('location') ?? '').split('/').pop());
    check('A publishes a car that is not for sale yet', () => {
      assert.equal(res.status, 302);
      assert.ok(watchId > 0);
      assert.equal(get('SELECT for_sale FROM builds WHERE id = ?', watchId).for_sale, 0);
    });
  }
  const watcherId = get('SELECT id FROM users WHERE username = ?', B.username).id;
  {
    const res = await b.post(`/builds/${watchId}/watch`, b.formWithCsrf({}));
    check('B can follow a car to hear when it goes on sale', () => {
      assert.equal(res.status, 302);
      assert.equal(
        get('SELECT COUNT(*) AS n FROM build_watchers WHERE build_id = ? AND user_id = ?', watchId, watcherId).n,
        1,
      );
    });
  }
  {
    const res = await b.post(`/builds/${watchId}/watch`, b.formWithCsrf({}));
    check('tapping "notify me" again stops following', () => {
      assert.equal(res.status, 302);
      assert.equal(
        get('SELECT COUNT(*) AS n FROM build_watchers WHERE build_id = ? AND user_id = ?', watchId, watcherId).n,
        0,
      );
    });
  }
  {
    // Follow again, then A ticks "for sale" - B is pinged exactly once.
    await b.post(`/builds/${watchId}/watch`, b.formWithCsrf({}));
    const before = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?', watcherId, 'build_sale').n;
    const res = await a.post(`/builds/${watchId}`, a.formWithCsrf({
      title: 'Smoke Watch Car',
      make: 'Nissan',
      model: 'Silvia',
      visibility: 'public',
      for_sale: '1',
      price: '9000',
      description: 'Not on the market yet.',
    }));
    const row = get(
      'SELECT text, url FROM notifications WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT 1',
      watcherId,
      'build_sale',
    );
    check('the watcher is told the moment the car goes on sale', () => {
      assert.equal(res.status, 302);
      assert.equal(before, 0);
      assert.ok(row, 'a build_sale notification was written');
      assert.match(row.text, /^put \{name\} up for sale\|/);
      assert.equal(row.url, `/builds/${watchId}`);
    });
  }
  {
    const before = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?', watcherId, 'build_sale').n;
    await a.post(`/builds/${watchId}`, a.formWithCsrf({
      title: 'Smoke Watch Car',
      make: 'Nissan',
      model: 'Silvia',
      visibility: 'public',
      for_sale: '1',
      price: '9500',
      description: 'Not on the market yet.',
    }));
    check('re-saving an existing listing does not ping the watcher again', () => {
      assert.equal(
        get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?', watcherId, 'build_sale').n,
        before,
      );
    });
  }
  {
    const { res, html } = await guest.page('/explore');
    check('Explore surfaces the cars that are for sale', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Builds for sale/);
      assert.match(html, /Smoke Watch Car/);
    });
  }
  /* 9c. watch notifications for updates & new photos ---------------- */
  {
    // A updates the build specs - B should get a build_update notification.
    const beforeUpdate = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?', watcherId, 'build_update').n;
    await a.post(`/builds/${watchId}`, a.formWithCsrf({
      title: 'Smoke Watch Car',
      make: 'Nissan',
      model: 'Silvia S15',
      visibility: 'public',
      for_sale: '0',
      price: '',
      description: 'Updated description.',
    }));
    const afterUpdate = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?', watcherId, 'build_update').n;
    check('watcher is notified when the build is updated', () => {
      assert.equal(afterUpdate, beforeUpdate + 1);
      const row = get('SELECT text FROM notifications WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT 1', watcherId, 'build_update');
      assert.match(row.text, /^updated their build \{name\}\|/);
    });
  }
  {
    // A adds new photos to the build - B should get a build_photo notification.
    const TINY_PNG2 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const fd = new FormData();
    fd.set('title', 'Smoke Watch Car');
    fd.set('make', 'Nissan');
    fd.set('model', 'Silvia S15');
    fd.set('visibility', 'public');
    fd.set('description', 'Updated description.');
    fd.set('_csrf', a.csrf);
    fd.append('media', new Blob([TINY_PNG2], { type: 'image/png' }), 'watch2.png');
    fd.append('media', new Blob([TINY_PNG2], { type: 'image/png' }), 'watch3.png');
    const beforePhoto = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?', watcherId, 'build_photo').n;
    await a.post('/builds/' + watchId, { multipart: fd });
    const afterPhoto = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?', watcherId, 'build_photo').n;
    check('watcher is notified when new photos are added', () => {
      assert.equal(afterPhoto, beforePhoto + 1);
      const row = get('SELECT text FROM notifications WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT 1', watcherId, 'build_photo');
      assert.match(row.text, /^added \{n\} new photo/);
    });
  }

  /* 10. search + notifications -------------------------------------- */
  console.log('\nsearch + activity');
  {
    const { res, html } = await a.page(`/search?q=${B.username}`);
    check('search finds drivers', () => {
      assert.equal(res.status, 200);
      assert.match(html, new RegExp(B.username));
    });
  }
  {
    const { res, html } = await a.page(`/search?q=Smoke&type=builds`);
    check('search keeps private builds out of results', () => {
      assert.equal(res.status, 200);
      assert.doesNotMatch(html, new RegExp(`/builds/${privateId}`));
    });
  }
  const notifUserId = get('SELECT id FROM users WHERE username = ?', A.username).id;
  {
    const res = await a.request('GET', '/notifications');
    check('notifications page renders', () => assert.equal(res.status, 200));
  }
  {
    const before = get(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
      notifUserId,
    ).n;
    await a.request('GET', '/notifications');
    const after = get(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
      notifUserId,
    ).n;
    check('opening activity does not silently mark everything read', () => assert.equal(after, before));
  }
  {
    const { res, html } = await a.page('/notifications?filter=unread&type=social');
    check('activity can be filtered by unread and category', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Unread/);
    });
  }
  {
    const res = await a.post('/settings/notifications', a.formWithCsrf({
      notify_messages: '1',
      notify_social: '1',
      notify_groups: '1',
      notify_meetups: '1',
      notify_builds: '1',
      notify_services: '1',
    }));
    check('per-category notification settings save', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT notify_prefs FROM users WHERE id = ?', notifUserId);
      const prefs = JSON.parse(row.notify_prefs);
      assert.equal(prefs.messages, true);
      assert.equal(prefs.social, true);
      assert.equal(prefs.services, true);
    });
  }
  {
    const unread = get(
      'SELECT id FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 1',
      notifUserId,
    );
    if (unread) {
      const res = await a.request('GET', `/notifications/open/${unread.id}`);
      check('opening one activity item marks it read and redirects', () => {
        assert.equal(res.status, 302);
        assert.ok(get('SELECT read_at FROM notifications WHERE id = ?', unread.id).read_at);
      });
    }
  }
  {
    const res = await a.request('GET', '/api/pulse?html=1', { headers: a.jsonHeaders() });
    const body = await res.json();
    check('pulse returns counters', () => {
      assert.equal(body.ok, true);
      assert.equal(typeof body.messages, 'number');
      assert.equal(typeof body.notifications, 'number');
    });
  }

  /* 11. admin console + backups ------------------------------------ */
  console.log('\nadmin console');
  const aId = get('SELECT id FROM users WHERE username = ?', A.username).id;
  const bId = get('SELECT id FROM users WHERE username = ?', B.username).id;
  {
    const res = await a.request('GET', '/admin');
    check('the admin console is closed to normal drivers', () => assert.equal(res.status, 403));
  }
  let adminPostId = 0;
  {
    await b.post('/posts', b.formWithCsrf({ body: 'Smoke moderation target', post_type: 'text' }));
    adminPostId = get('SELECT id FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT 1', bId)?.id ?? 0;
    check('B posts something for the console to moderate', () => assert.ok(adminPostId > 0));
  }
  {
    // Grant the flag the way the CLI does, then reload.
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(aId);
    const { res, html } = await a.page('/admin');
    check('an admin can open the console', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Admin console/);
    });
  }
  {
    const res = await a.post(`/admin/users/${bId}/admin`, a.formWithCsrf({ admin: '1' }));
    check('an admin can promote another driver', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT is_admin FROM users WHERE id = ?', bId).is_admin, 1);
    });
  }
  {
    const res = await a.post(`/admin/users/${bId}/admin`, a.formWithCsrf({ admin: '0' }));
    check('an admin can take the flag back', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT is_admin FROM users WHERE id = ?', bId).is_admin, 0);
    });
  }
  {
    const res = await a.post(`/admin/users/${aId}/admin`, {
      ...a.formWithCsrf({ admin: '0' }),
      headers: a.jsonHeaders(),
    });
    check('the last admin cannot demote themselves', () => {
      assert.equal(res.status, 400);
      assert.equal(get('SELECT is_admin FROM users WHERE id = ?', aId).is_admin, 1);
    });
  }
  {
    const res = await a.post(`/admin/users/${aId}/delete`, {
      ...a.formWithCsrf({}),
      headers: a.jsonHeaders(),
    });
    check('an admin cannot delete their own account from the console', () => assert.equal(res.status, 400));
  }
  {
    const res = await a.post(`/admin/posts/${adminPostId}/delete`, a.formWithCsrf({}));
    check('an admin can delete any post', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM posts WHERE id = ?', adminPostId).n, 0);
    });
  }
  {
    const res = await a.post('/admin/backups', { ...a.formWithCsrf({}), headers: a.jsonHeaders() });
    const body = await res.json();
    check('an admin can take a database snapshot', () => {
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.ok(fs.existsSync(path.join(BACKUP_DIR, body.name)));
    });
    check('the snapshot shows up in the console list', () => {
      assert.ok(fs.readdirSync(BACKUP_DIR).includes(body.name));
    });

    if (body.name) {
      const restore = await a.post(`/admin/backups/${body.name}/restore`, {
        ...a.formWithCsrf({}),
        headers: a.jsonHeaders(),
      });
      check('a snapshot can be restored into the live database', () => {
        assert.equal(restore.status, 200);
        assert.ok(get('SELECT COUNT(*) AS n FROM users').n >= 2);
      });

      const removed = await a.post(`/admin/backups/${body.name}/delete`, {
        ...a.formWithCsrf({}),
        headers: a.jsonHeaders(),
      });
      check('a snapshot can be deleted', () => {
        assert.equal(removed.status, 200);
        assert.equal(fs.existsSync(path.join(BACKUP_DIR, body.name)), false);
      });
    }
  }
  {
    const { res, html } = await a.page('/admin/partners');
    check('the partners console loads app.js only once', () => {
      assert.equal(res.status, 200);
      // A second copy of app.js would cancel every form on the page.
      assert.ok(!/from '\/js\/app\.js'/.test(html), 'app.js is imported from the stamped path only');
    });
  }
  {
    const res = await a.request('GET', `/api/search?q=${B.username}`);
    const body = await res.json();
    check('live search answers with JSON results', () => {
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.ok(body.people.some((p) => p.username === B.username));
    });
  }
  {
    /* The partners wall: the admin gives a logo, the name comes from the
       file, the link can be filled in later. */
    // A mark with a transparent border around it: the wall trims it, so
    // the logo fills the frame it is given.
    const png = await sharp({
      create: { width: 200, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: { create: { width: 80, height: 30, channels: 4, background: { r: 30, g: 220, b: 255, alpha: 1 } } },
        top: 20,
        left: 60,
      }])
      .png()
      .toBuffer();
    const fd = new FormData();
    fd.set('_csrf', a.csrf);
    fd.set('logo', new Blob([png], { type: 'image/png' }), 'Smoke Garage logo.png');
    const res = await a.post('/admin/partners/new', { multipart: fd });
    check('a partner is added from the logo alone', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT name, url, logo_path, logo_w, logo_h FROM partners ORDER BY id DESC LIMIT 1');
      assert.equal(row.name, 'Smoke Garage');
      assert.equal(row.url, null);
      assert.ok(row.logo_path, 'the logo is stored');
      assert.equal(row.logo_w, 80, 'the empty space around the mark is cut away');
      assert.equal(row.logo_h, 30);
    });
    const partnerId = get('SELECT id FROM partners ORDER BY id DESC LIMIT 1').id;
    const wall = await a.request('GET', '/partners');
    const wallHtml = await wall.text();
    check('the new partner shows on the wall', () => {
      assert.equal(wall.status, 200);
      assert.match(wallHtml, /Smoke Garage/);
    });
    const saved = await a.post(`/admin/partners/${partnerId}`, a.formWithCsrf({
      name: 'Smoke Garage Tuning',
      url: 'smoke.example',
      is_active: '1',
    }));
    check('the name and the link can be added later', () => {
      assert.equal(saved.status, 302);
      const row = get('SELECT name, url FROM partners WHERE id = ?', partnerId);
      assert.equal(row.name, 'Smoke Garage Tuning');
      assert.equal(row.url, 'https://smoke.example');
    });
    const hidden = await a.post(`/admin/partners/${partnerId}`, a.formWithCsrf({
      name: 'Smoke Garage Tuning',
    }));
    check('a partner can be taken off the wall without being deleted', () => {
      assert.equal(hidden.status, 302);
      assert.equal(get('SELECT is_active FROM partners WHERE id = ?', partnerId).is_active, 0);
    });
    const bad = await a.post(`/admin/partners/${partnerId}`, a.formWithCsrf({
      name: 'Smoke Garage Tuning',
      url: 'not a web address',
    }));
    check('a broken address is refused instead of going on the wall', () => {
      assert.equal(bad.status, 302);
      assert.equal(get('SELECT url FROM partners WHERE id = ?', partnerId).url, null);
    });
    const removed = await a.post(`/admin/partners/${partnerId}/delete`, a.formWithCsrf({}));
    check('a partner can be removed again', () => {
      assert.equal(removed.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM partners WHERE id = ?', partnerId).n, 0);
    });
  }

  /* 12. audience, hidden spots, chat dock, extra admin powers ----- */
  console.log('\nprivacy, chat dock and extra admin powers');
  const guestD = new Client(base);
  {
    const res = await a.post('/posts', a.formWithCsrf({
      body: 'Friends-only smoke post',
      post_type: 'text',
      privacy: 'friends',
    }));
    const row = get('SELECT id, privacy FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT 1', aId);
    check('a wall post can be limited to friends', () => {
      assert.equal(res.status, 302);
      assert.equal(row.privacy, 'friends');
    });

    const own = await a.page('/?view=everyone');
    check('the author sees their own friends-only post', () => assert.match(own.html, /Friends-only smoke post/));

    const friend = await b.page('/?view=everyone');
    check('a friend sees a friends-only post', () => assert.match(friend.html, /Friends-only smoke post/));

    const stranger = await guestD.page('/?view=everyone');
    check('a logged-out visitor does not see friends-only posts', () => {
      assert.equal(stranger.res.status, 200);
      assert.doesNotMatch(stranger.html, /Friends-only smoke post/);
    });

    const profile = await guestD.page(`/u/${A.username}`);
    check('a friends-only post stays off the profile for strangers', () => {
      assert.doesNotMatch(profile.html, /Friends-only smoke post/);
    });
  }
  let privateMeetupId = 0;
  {
    const res = await a.post('/meetups/new', a.formWithCsrf({
      title: 'Hidden Spot Meetup',
      place_name: 'Secret Underpass',
      address: 'Secret Underpass, Somewhere',
      lat: '41.7151',
      lng: '44.8271',
      starts_at: '2030-07-01T20:00',
      privacy: 'private',
    }));
    privateMeetupId = Number((res.headers.get('location') ?? '').split('/').pop());
    check('A hosts a private meetup', () => assert.ok(privateMeetupId > 0));

    const guestView = await guestD.page(`/meetups/${privateMeetupId}`);
    check('a guest sees no spot or map on a private meetup', () => {
      assert.equal(guestView.res.status, 200);
      assert.doesNotMatch(guestView.html, /Secret Underpass/);
      assert.doesNotMatch(guestView.html, /mapcard__map/);
      assert.match(guestView.html, /Location hidden/);
    });

    const guestList = await guestD.page('/meetups');
    check('the private meetup lists without its spot', () => {
      assert.match(guestList.html, /Hidden Spot Meetup/);
      assert.doesNotMatch(guestList.html, /Secret Underpass/);
    });

    const loggedIn = await b.page(`/meetups/${privateMeetupId}`);
    check('a logged-in driver sees the private spot', () => assert.match(loggedIn.html, /Secret Underpass/));

    const openGuest = await guestD.page(`/meetups/${meetupId}`);
    check('an open meetup still shows its spot to guests', () => assert.match(openGuest.html, /Coast Road Lookout/));
  }
  let memberSlug = '';
  {
    await a.post('/groups/new', a.formWithCsrf({ name: `Member Card ${tag}`, privacy: 'open' }));
    memberSlug = get('SELECT slug FROM groups WHERE name = ?', `Member Card ${tag}`).slug;
    const asOwner = await a.page('/groups');
    check('the crew directory shows View for a crew you are in', () => {
      assert.doesNotMatch(asOwner.html, new RegExp(`action="/groups/${memberSlug}/join"`));
    });
    const asOutsider = await b.page('/groups');
    check('the crew directory still shows Join for a crew you are not in', () => {
      assert.match(asOutsider.html, new RegExp(`action="/groups/${memberSlug}/join"`));
    });
  }
  {
    const crewId = get('SELECT id FROM groups WHERE slug = ?', memberSlug).id;
    const res = await a.post(`/admin/groups/${crewId}/delete`, a.formWithCsrf({}));
    check('an admin can delete any crew', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM groups WHERE id = ?', crewId).n, 0);
    });
  }
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const fd = new FormData();
    fd.set('title', 'Smoke Crewmate Build');
    fd.set('visibility', 'public');
    fd.set('description', 'Owner will not delete this one.');
    fd.set('_csrf', b.csrf);
    fd.set('media', new Blob([png], { type: 'image/png' }), 'crewmate.png');
    const created = await b.post('/builds', { multipart: fd });
    const otherBuildId = Number((created.headers.get('location') ?? '').split('/').pop());
    check('B publishes a build for the admin to remove', () => assert.ok(otherBuildId > 0));

    const res = await a.post(`/builds/${otherBuildId}/delete`, a.formWithCsrf({}));
    check('an admin can delete another driver\'s build', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM builds WHERE id = ?', otherBuildId).n, 0);
    });
  }
  {
    const { res, html } = await a.page('/admin?tab=content');
    check('the console lists groups and builds for moderation', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Recent groups/);
      assert.match(html, /Recent builds/);
      assert.match(html, /\/admin\/builds\/\d+\/delete/);
    });
  }
  {
    const res = await a.request('GET', '/api/chat/dock');
    const body = await res.json();
    check('the chat dock lists threads and an unread count', () => {
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(typeof body.unread, 'number');
      assert.ok(Array.isArray(body.conversations));
      assert.ok(body.conversations.some((c) => c.kind === 'global'));
    });
    const asGuest = await guestD.request('GET', '/api/chat/dock');
    check('the chat dock needs a login', () => {
      assert.equal(asGuest.status, 302);
      assert.equal(asGuest.headers.get('location'), '/login');
    });
  }

  /* 13. services: parts marketplace + maintenance directory -------- */
  console.log('\nservices');
  let partId = 0;
  let serviceId = 0;
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  {
    const { res, html } = await a.page('/services');
    check('the services hub renders every section', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Parts/);
      assert.match(html, /Maintenance/);
      assert.match(html, /Part search/);
      assert.doesNotMatch(html, /VIN check/);
    });
  }
  {
    const parts = await a.request('GET', '/services/parts');
    const maint = await a.request('GET', '/services/maintenance');
    const search = await a.request('GET', '/services/part-search');
    check('the parts board, the directory and the part search are public', () => {
      assert.equal(parts.status, 200);
      assert.equal(maint.status, 200);
      assert.equal(search.status, 200);
    });
  }
  {
    const { html } = await a.page('/services/part-search');
    check('the part search offers the three ways in', () => {
      assert.match(html, /data-ps-tab="number"/);
      assert.match(html, /data-ps-tab="car"/);
      assert.match(html, /data-ps-tab="vin"/);
    });
  }
  {
    const { html } = await a.page('/services/part-search');
    check('the part search explains what a number from another market does', () => {
      assert.match(html, /data-ps-vin-form/);
      assert.match(html, /check digit only in North America/);
      assert.doesNotMatch(html, /Coming soon/);
    });
  }
  {
    // The places a number can be looked up are answered straight away,
    // even when the catalogue itself is slow.
    const res = await a.request('GET', '/api/parts/sources?q=90915-YZZD2', { headers: a.jsonHeaders() });
    const body = await res.json();
    check('the other places to look a number up are offered', () => {
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.ok(body.sources.length >= 4);
      assert.ok(body.sources.some((s) => /rockauto/.test(s.id)));
      assert.ok(body.sources.some((s) => /amayama/.test(s.id)));
      assert.ok(body.sources.every((s) => s.url.includes('90915-YZZD2')));
    });
  }
  {
    // The catalogue writes the engine with the spaces as plus signs -
    // getting this wrong sends the driver to the wrong car.
    const slug = vehicleSlug('HONDA', '2010', 'CIVIC', '1.8L L4', '1444952');
    check('the address of a car is written the way the catalogue writes it', () => {
      assert.equal(slug, 'honda,2010,civic,1.8l+l4,1444952');
      assert.equal(vehicleSlug('ACURA', '1998', 'INTEGRA', '1.8L L4', '1382790'), 'acura,1998,integra,1.8l+l4,1382790');
    });
  }
  {
    // A reaction on a comment: press it, and press it again to take it back.
    const comment = get('SELECT id FROM comments WHERE post_id = ? ORDER BY id LIMIT 1', postId);
    const res = await b.post(`/comments/${comment.id}/react`, {
      form: { emoji: '🔥', _csrf: b.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const body = await res.json();
    check('a comment can be reacted to', () => {
      assert.equal(body.ok, true);
      const fire = body.reactions.find((r) => r.emoji === '🔥');
      assert.ok(fire, 'the reaction is in the list');
      assert.equal(fire.count, 1);
      assert.equal(fire.mine, true);
    });
    const again = await b.post(`/comments/${comment.id}/react`, {
      form: { emoji: '🔥', _csrf: b.csrf },
      headers: { 'x-requested-with': 'fetch' },
    });
    const back = await again.json();
    check('the same reaction pressed again is taken back', () => {
      assert.equal(back.ok, true);
      assert.equal(back.reactions.find((r) => r.emoji === '🔥'), undefined);
    });
  }
  {
    // A VIN is checked digit by digit before anything else happens.
    const good = checkVin('1HGCM82633A004352');
    const bad = checkVin('1HGCM82633A00435X');
    const short = checkVin('1HGCM826');
    check('a VIN is checked before it is read', () => {
      assert.equal(good.ok, true);
      assert.equal(bad.ok, false);
      assert.match(bad.reason, /check digit/);
      assert.equal(short.ok, false);
    });
  }
  {
    // A Japanese chassis code is shorter than a VIN and has no check
    // digit, so it must not be refused as one.
    const chassis = readIdentifier('GH-BP5');
    const vin = readIdentifier('1HGCM82633A004352');
    const wrong = readIdentifier('1HGCM82633A00435X');
    const junk = readIdentifier('12345');
    check('a chassis code is read as one, and a VIN as a VIN', () => {
      assert.equal(chassis.kind, 'chassis');
      assert.equal(chassis.value, 'GH-BP5');
      assert.equal(chassis.normalized, 'GHBP5');
      assert.equal(vin.kind, 'vin');
      assert.equal(vin.checkDigit, true);
      assert.equal(wrong.kind, 'vin');
      assert.equal(wrong.checkDigit, false);
      assert.equal(junk.kind, 'invalid');
    });
    // The check digit is a North American rule - a European VIN has a
    // character of the model code in the ninth place instead.
    const eu = readIdentifier('WVWZZZ1JZXW000001');
    const euVin = readVin('WVWZZZ1JZXW000001');
    check('a VIN from another market is read as a VIN', () => {
      assert.equal(eu.kind, 'vin');
      assert.equal(eu.checkDigit, false);
      assert.equal(euVin.ok, true);
      assert.equal(euVin.checkDigit, false);
      assert.match(euVin.warning, /check digit/);
    });
    check('a VIN that cannot be one is still refused', () => {
      assert.equal(readVin('1HGCM82633A00435I').ok, false);
      assert.equal(readVin('12345').ok, false);
    });
    check('the year of a VIN is read from the number itself', () => {
      assert.equal(yearFromVin('1HGCM82633A004352'), 2003);
      assert.equal(yearFromVin('WVWZZZ1JZXW000001'), 1999);
      assert.equal(yearFromVin('WBA5A5C51ED123456'), 2014);
      assert.equal(yearFromVin('nonsense'), 0);
    });
    // The maker stands in the first three characters - a Renault or a
    // Skoda is not registered with the American register at all.
    check('the maker is read from the first three characters', () => {
      assert.equal(makeFromVin('VF1RFB00959638458')?.make, 'Renault');
      assert.equal(makeFromVin('TMBHS61Z382230614')?.make, 'Skoda');
      assert.equal(makeFromVin('WDDGF4HB3DA830083')?.make, 'Mercedes-Benz');
      assert.equal(makeFromVin('1HGCM82633A004352')?.make, 'Honda');
      assert.equal(makeFromVin('12345'), null);
    });
    // A Mercedes is sold in the catalogue as a C250, not as a C-Class.
    const merc = namesFor({ make: 'Mercedes-Benz', model: 'C-Class', trim: 'C300' });
    check('the trim is a name the catalogue may know the car by', () => {
      assert.deepEqual(merc.map((one) => one.model), ['C-Class', 'C300']);
      assert.equal(merc[1].make, 'Mercedes-Benz');
    });
    check('a two letter trim is not taken for a model', () => {
      const small = namesFor({ make: 'Honda', model: 'Civic', trim: 'SE' });
      assert.equal(small.some((one) => one.model === 'SE'), false);
    });
    check('the names of a car carry the name it is sold under elsewhere', () => {
      const names = namesFor({ make: 'Honda', model: 'Integra' });
      assert.equal(names[0].model, 'Integra');
      assert.equal(names.some((one) => one.make === 'ACURA' && one.model === 'INTEGRA'), true);
    });
    // A German car from another market carries its platform in the
    // seventh and eighth place - that is the model.
    check('the platform code in the middle of a VIN names the model', () => {
      assert.equal(lookupPlatform('1J')?.model, 'Golf');
      assert.equal(lookupPlatform('1Z')?.model, 'Octavia');
      assert.equal(lookupPlatform('3B')?.model, 'Passat');
      assert.equal(lookupPlatform('ZZ'), null);
      assert.equal(inYears('1998-2005', 1999), true);
      assert.equal(inYears('1998-2005', 2012), false);
      assert.equal(inYears('2019-', 2024), true);
      assert.equal(inYears('1998-2005', ''), false);
    });
    const res = await a.request('GET', '/api/parts/vin?vin=GH-BP5', { headers: a.jsonHeaders() });
    const body = await res.json();
    check('the chassis code is answered without being refused', () => {
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.kind, 'chassis');
      assert.equal(body.normalized, 'GHBP5');
    });
  }
  {
    // A frame number is a chassis code with a serial number behind it -
    // that is what the maker's own catalogue is written against.
    const frame = readIdentifier('JZX100-0012345');
    check('a frame number is split into its chassis code and its serial', () => {
      assert.equal(frame.kind, 'frame');
      assert.equal(frame.chassis, 'JZX100');
      assert.equal(frame.serial, '0012345');
      assert.equal(frame.full, 'JZX100-0012345');
    });
    const res = await a.request('GET', '/api/parts/vin?vin=JZX100-0012345', { headers: a.jsonHeaders() });
    const body = await res.json();
    check('the frame number is answered with the car it belongs to', () => {
      assert.equal(res.status, 200);
      assert.equal(body.kind, 'frame');
      assert.equal(body.code, 'JZX100');
      assert.equal(body.serial, '0012345');
      assert.equal(body.car.make, 'Toyota');
      assert.match(body.car.model, /Chaser/);
      assert.match(body.oemUrl, /amayama/);
      assert.deepEqual(body.twins, []);
    });
    // The digits of the code and of the serial run together as often as
    // not - the known code has to win.
    const tight = readIdentifier('DC11305656');
    check('a frame written without a dash is still split at the code', () => {
      assert.equal(tight.kind, 'frame');
      assert.equal(tight.chassis, 'DC1');
      assert.equal(tight.serial, '1305656');
      assert.equal(tight.full, 'DC1-1305656');
    });
    const integra = await (await a.request('GET', '/api/parts/vin?vin=DC11305656', { headers: a.jsonHeaders() })).json();
    check('the frame knows the car and the name it is sold under elsewhere', () => {
      assert.equal(integra.car.make, 'Honda');
      assert.match(integra.car.model, /Integra/);
      assert.deepEqual(integra.twins, [{ make: 'ACURA', model: 'INTEGRA' }]);
    });
  }
  {
    // The same car under another name: the drivetrain parts are shared.
    const tribute = twinsOf('MAZDA', 'TRIBUTE').map((row) => `${row.make} ${row.model}`).sort();
    check('a car sold under another name names its twins', () => {
      assert.deepEqual(tribute, ['FORD ESCAPE', 'MERCURY MARINER']);
    });
    check('the twin table is symmetrical', () => {
      const back = twinsOf('FORD', 'ESCAPE').map((row) => `${row.make} ${row.model}`);
      assert.ok(back.includes('MAZDA TRIBUTE'), back.join(', '));
      assert.ok(twinsOf('LEXUS', 'IS300').some((row) => row.make === 'TOYOTA' && row.model === 'ALTEZZA'));
    });
    check('a car sold under one name only has no twins', () => {
      assert.deepEqual(twinsOf('HONDA', 'CIVIC'), []);
      assert.deepEqual(twinsOf('MAZDA', 'NOT A CAR'), []);
    });
  }
  {
    const res = await guest.request('GET', '/services/parts/new');
    check('listing a part needs a login', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    });
  }
  {
    const fd = new FormData();
    fd.set('title', 'Smoke RB25 turbo');
    fd.set('category', 'engine');
    fd.set('price', '350');
    fd.set('price_note', 'negotiable');
    fd.set('phone', '+995 555 112 233');
    fd.set('location', 'Tbilisi, Didube');
    fd.set('description', 'Pulled from a running car, no shaft play.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([TINY_PNG], { type: 'image/png' }), 'turbo.png');
    const res = await a.post('/services/parts/new', { multipart: fd });
    partId = Number((res.headers.get('location') ?? '').split('/').pop());
    check('A lists a part with a photo and a price', () => {
      assert.equal(res.status, 302);
      assert.ok(partId > 0);
      const row = get('SELECT title, category, price, status, cover FROM parts WHERE id = ?', partId);
      assert.equal(row.title, 'Smoke RB25 turbo');
      assert.equal(row.category, 'engine');
      assert.equal(row.price, 350);
      assert.equal(row.status, 'available');
      assert.ok(row.cover, 'cover image was set');
      assert.ok(fs.existsSync(path.join(ROOT, 'uploads-smoke', row.cover)), 'cover exists on disk');
    });
  }
  {
    const { res, html } = await a.page(`/services/parts/${partId}`);
    check('the part page shows the price, phone and category', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Smoke RB25 turbo/);
      assert.match(html, /350/);
      assert.match(html, /\+995 555 112 233/);
      assert.match(html, /Engine/);
    });
  }
  {
    const hit = await b.page('/services/parts?category=engine');
    const miss = await b.page('/services/parts?category=brakes');
    check('parts can be filtered by category', () => {
      assert.match(hit.html, /Smoke RB25 turbo/);
      assert.doesNotMatch(miss.html, /Smoke RB25 turbo/);
    });
  }
  {
    const { html } = await b.page('/services/parts?scope=mine');
    check('My listings only shows your own parts', () => {
      assert.doesNotMatch(html, /Smoke RB25 turbo/);
    });
  }
  {
    const res = await a.post(`/services/parts/${partId}/sold`, a.formWithCsrf({}));
    check('the seller can mark a part sold', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT status FROM parts WHERE id = ?', partId).status, 'sold');
    });
    await a.post(`/services/parts/${partId}/sold`, a.formWithCsrf({}));
  }
  {
    const fd = new FormData();
    fd.set('title', 'Smoke Motors - ECU lab');
    fd.set('category', 'ecu_tuning');
    fd.set('description', 'Dyno-backed remaps for turbo cars.');
    fd.set('phone', '+995 555 44 55 66');
    fd.set('email', 'shop@smokemotors.test');
    fd.set('place_name', 'Smoke Motors, Didube');
    fd.set('address', 'Test street 1, Tbilisi');
    fd.set('lat', '41.6938');
    fd.set('lng', '44.8015');
    fd.set('_csrf', a.csrf);
    fd.set('cover', new Blob([TINY_PNG], { type: 'image/png' }), 'shop.png');
    const res = await a.post('/services/maintenance/new', { multipart: fd });
    serviceId = Number((res.headers.get('location') ?? '').split('/').pop());
    check('A offers a service with a map pin and a cover', () => {
      assert.equal(res.status, 302);
      assert.ok(serviceId > 0);
      const row = get('SELECT title, category, lat, lng, place_name, cover FROM services WHERE id = ?', serviceId);
      assert.equal(row.title, 'Smoke Motors - ECU lab');
      assert.equal(row.category, 'ecu_tuning');
      assert.ok(row.lat > 41 && row.lng > 44, 'coordinates were stored');
      assert.ok(row.cover, 'cover image was set');
    });
  }
  {
    const { res, html } = await b.page('/search?q=RB25');
    check('search finds a part listing', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Smoke RB25 turbo/);
      assert.match(html, /type=parts/);
    });
  }
  {
    const partsTab = await b.page('/search?q=Smoke&type=parts');
    const servicesTab = await b.page('/search?q=Smoke&type=services');
    check('the parts and services tabs filter the results', () => {
      assert.match(partsTab.html, /Smoke RB25 turbo/);
      assert.doesNotMatch(partsTab.html, /Smoke Motors/);
      assert.match(servicesTab.html, /Smoke Motors/);
      assert.doesNotMatch(servicesTab.html, /Smoke RB25 turbo/);
    });
  }
  {
    const res = await b.request('GET', '/api/search?q=RB25');
    const body = await res.json();
    check('the live search dropdown answers with parts', () => {
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.ok(body.parts.length >= 1, 'a part came back');
      assert.equal(body.parts[0].title, 'Smoke RB25 turbo');
      assert.ok(body.parts[0].priceLabel, 'the price is pre-formatted for the browser');
    });
  }
  {
    const partForm = await a.page('/services/parts/new');
    const svcForm = await a.page('/services/maintenance/new');
    const partEdit = await a.page(`/services/parts/${partId}/edit`);
    const svcEdit = await a.page(`/services/maintenance/${serviceId}/edit`);
    check('the listing and edit forms render for the owner', () => {
      assert.equal(partForm.res.status, 200);
      assert.equal(svcForm.res.status, 200);
      assert.equal(partEdit.res.status, 200);
      assert.equal(svcEdit.res.status, 200);
      assert.match(partForm.html, /name="category"/);
      assert.match(svcForm.html, /name="lat"/);
      assert.match(partEdit.html, /Smoke RB25 turbo/);
      assert.match(svcEdit.html, /Smoke Motors - ECU lab/);
    });
  }
  {
    const fd = new FormData();
    fd.set('title', 'x');
    fd.set('_csrf', a.csrf);
    const res = await a.post('/services/parts/new', { multipart: fd });
    const html = await res.text();
    check('an invalid listing re-renders the form with its errors', () => {
      assert.equal(res.status, 400);
      assert.match(html, /Give the part a clear name/);
      assert.match(html, /Add at least one photo of the part/);
      assert.match(html, /name="category"/);
    });
  }
  {
    const { res, html } = await b.page(`/services/maintenance/${serviceId}`);
    check('the service page shows the map, contact details and a review form', () => {
      assert.equal(res.status, 200);
      assert.match(html, /Smoke Motors - ECU lab/);
      assert.match(html, /data-map-readonly/);
      assert.match(html, /shop@smokemotors\.test/);
      assert.match(html, /name="rating"/);
    });
  }
  {
    const res = await b.post(
      `/services/maintenance/${serviceId}/review`,
      b.formWithCsrf({ rating: '5', body: 'Mapped my ECU in an hour.' }),
    );
    check('B leaves a 5-star review', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT rating, body FROM service_reviews WHERE service_id = ?', serviceId);
      assert.equal(row.rating, 5);
      assert.match(row.body, /ECU/);
    });
  }
  {
    const res = await b.post(
      `/services/maintenance/${serviceId}/review`,
      b.formWithCsrf({ rating: '3', body: 'Changed my mind.' }),
    );
    const row = get('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM service_reviews WHERE service_id = ?', serviceId);
    check('reviewing again edits the same review instead of stacking', () => {
      assert.equal(res.status, 302);
      assert.equal(row.n, 1);
      assert.equal(row.avg, 3);
    });
  }
  {
    const { res, html } = await a.page(`/services/maintenance/${serviceId}`);
    check('a provider cannot review their own service', () => {
      assert.equal(res.status, 200);
      assert.match(html, /You cannot review your own service/);
    });
  }
  {
    const res = await b.post(`/services/maintenance/${serviceId}/review/delete`, b.formWithCsrf({}));
    check('a driver can remove their review', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM service_reviews WHERE service_id = ?', serviceId).n, 0);
    });
  }
  {
    const { html } = await a.page('/settings');
    const res = await a.post('/settings', a.formWithCsrf({
      display_name: 'Smoke A',
      bio: '',
      car: '',
      city: '',
      is_provider: '1',
    }));
    check('a driver can flag themselves as a service provider', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT is_provider FROM users WHERE username = ?', A.username);
      assert.equal(row.is_provider, 1);
    });
  }
  {
    // The picture the driver has just chosen is shown before it is saved.
    const { html } = await a.page('/settings');
    check('the settings page shows the picture that has just been chosen', () => {
      assert.match(html, /data-avatar-input/);
      assert.match(html, /data-avatar-preview/);
      assert.match(html, /data-avatar-img/);
    });
  }
  {
    const { html } = await a.page('/settings');
    check('the provider flag stays checked after applying', () => {
      assert.match(html, /name="is_provider" value="1" checked/);
    });
  }
  {
    // A provider who publishes their own listing does not have to click
    // Claim - the claim is filed for them and an admin confirms it.
    const res = await a.post('/services/maintenance/new', a.formWithCsrf({
      title: 'Smoke Own Garage', category: 'engine_mech', description: 'A garage of my own',
      phone: '555000999', place_name: 'Tbilisi',
    }));
    const ownId = Number((res.headers.get('location') ?? '').split('/').pop());
    const claim = get("SELECT id, status FROM service_claims WHERE service_id = ? ORDER BY id DESC LIMIT 1", ownId);
    check('a provider publishing a listing files the claim for themselves', () => {
      assert.equal(res.status, 302);
      assert.ok(ownId > 0);
      assert.ok(claim, 'a claim was filed automatically');
      assert.equal(claim.status, 'pending');
      assert.equal(get('SELECT verified FROM services WHERE id = ?', ownId).verified, 0);
    });
  }
  {
    // The admins have to hear about the claim, or they never know there
    // is one waiting for them. A different driver publishes, so the
    // admin is not notifying themselves.
    await b.post('/settings', b.formWithCsrf({ is_provider: '1' }));
    const res = await b.post('/services/maintenance/new', b.formWithCsrf({
      title: 'Smoke Provider Garage', category: 'engine_mech', description: 'Another garage',
      phone: '555000998', place_name: 'Tbilisi',
    }));
    const ownId = Number((res.headers.get('location') ?? '').split('/').pop());
    const admin = get('SELECT id FROM users WHERE is_admin = 1 LIMIT 1');
    const note = get(
      "SELECT id FROM notifications WHERE user_id = ? AND type = 'service_claim' AND entity_id = ?",
      admin.id,
      ownId,
    );
    check('the admins are told that a claim is waiting', () => {
      assert.equal(res.status, 302);
      assert.ok(ownId > 0);
      assert.ok(note, 'the admin has a notification about the claim');
    });
  }
  {
    const ownId = get("SELECT id FROM services WHERE title = 'Smoke Own Garage'").id;
    const claim = get("SELECT id FROM service_claims WHERE service_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", ownId);
    const res = await a.post(`/admin/service-claims/${claim.id}/approve`, a.formWithCsrf({}));
    check('an admin approving the claim verifies the listing and names the business', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT verified FROM services WHERE id = ?', ownId).verified, 1);
      const row = get('SELECT is_provider, provider_name FROM users WHERE username = ?', A.username);
      assert.equal(row.is_provider, 1);
      assert.match(row.provider_name, /Smoke Own Garage/);
    });
  }
  {
    const { html } = await b.page('/services/maintenance');
    check('a provider listing carries the provider badge', () => {
      assert.match(html, /badge--provider/);
    });
  }
  {
    const photo = get('SELECT id FROM part_photos WHERE part_id = ? ORDER BY position ASC LIMIT 1', partId);
    const res = await a.post(`/services/parts/${partId}/photos/${photo.id}/delete`, a.formWithCsrf({}));
    check('a listing photo can be removed, and the cover clears', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM part_photos WHERE part_id = ?', partId).n, 0);
      assert.equal(get('SELECT cover FROM parts WHERE id = ?', partId).cover, null);
    });
  }
  {
    const removedPart = await a.post(`/services/parts/${partId}/delete`, a.formWithCsrf({}));
    const removedService = await a.post(`/services/maintenance/${serviceId}/delete`, a.formWithCsrf({}));
    check('parts and services can be deleted by their owner', () => {
      assert.equal(removedPart.status, 302);
      assert.equal(removedService.status, 302);
      assert.equal(get('SELECT COUNT(*) AS n FROM parts WHERE id = ?', partId).n, 0);
      assert.equal(get('SELECT COUNT(*) AS n FROM services WHERE id = ?', serviceId).n, 0);
    });
  }

  /* 13b. themes ----------------------------------------------------- */
  console.log('\nthemes');
  {
    const { html } = await a.page('/settings');
    check('the settings page offers the theme picker', () => {
      assert.match(html, /data-theme="street"/);
      assert.match(html, /href="\/theme\/gold"/);
      assert.match(html, /href="\/theme\/light"/);
    });
  }
  {
    const res = await a.request('GET', '/theme/gold');
    check('picking a theme stores it on the account', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT theme FROM users WHERE username = ?', A.username).theme, 'gold');
    });
    const { html } = await a.page('/');
    check('the chosen theme is applied to the page', () => {
      assert.match(html, /data-theme="gold"/);
    });
  }
  {
    await a.request('GET', '/theme/nonsense');
    const { html } = await a.page('/');
    check('an unknown theme code is ignored', () => {
      assert.match(html, /data-theme="gold"/);
      assert.equal(get('SELECT theme FROM users WHERE username = ?', A.username).theme, 'gold');
    });
  }
  {
    await a.request('GET', '/theme/light');
    const { html } = await a.page('/settings');
    check('the picker marks the active theme', () => {
      assert.match(html, /data-theme="light"/);
      assert.match(html, /class="themecard is-active"\s+href="\/theme\/light"/);
    });
  }

  /* 13c. currencies ----------------------------------------------- */
  console.log('\ncurrency');
  let usdPartId = 0;
  let gelPartId = 0;
  {
    // The currency picker lives in the header, not on the settings page.
    const { html } = await a.page('/');
    check('the header offers the currency picker', () => {
      assert.match(html, /href="\/currency\/GEL"/);
      assert.match(html, /href="\/currency\/USD"/);
    });
    const { html: settings } = await a.page('/settings');
    check('the settings page does not repeat the currency picker', () => {
      // The header is on every page - the settings page must not carry a
      // second, bigger picker of its own.
      assert.doesNotMatch(settings, /curcard__swatch/);
      assert.equal((settings.match(/langswitch"/g) || []).length, 1);
    });
  }
  {
    /* The phone number has one shape: +995 and nine digits. */
    const fd = new FormData();
    fd.set('title', 'Smoke Short Phone');
    fd.set('category', 'tuning');
    fd.set('price', '100');
    fd.set('phone', '577009');
    fd.set('description', 'A number that is too short.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([TINY_PNG], { type: 'image/png' }), 'short.png');
    const res = await a.post('/services/parts/new', { multipart: fd });
    const html = await res.text();
    check('a phone number that is too short is refused', () => {
      assert.equal(res.status, 400);
      assert.match(html, /\+995 577 009 096/);
    });
    check('the listing was not created', () => {
      assert.equal(get('SELECT COUNT(*) AS n FROM parts WHERE title = ?', 'Smoke Short Phone').n, 0);
    });
  }
  {
    const fd = new FormData();
    fd.set('title', 'Smoke Good Phone');
    fd.set('category', 'tuning');
    fd.set('price', '100');
    fd.set('phone', '+995 577 009 096');
    fd.set('description', 'A number in the right shape.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([TINY_PNG], { type: 'image/png' }), 'good.png');
    const res = await a.post('/services/parts/new', { multipart: fd });
    check('a phone number in the right shape is accepted', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT phone FROM parts WHERE title = ?', 'Smoke Good Phone');
      assert.equal(row.phone, '+995 577 009 096');
    });
  }
  {
    const fd = new FormData();
    fd.set('title', 'Smoke USD turbo');
    fd.set('category', 'tuning');
    fd.set('price', '100');
    fd.set('currency', 'USD');
    fd.set('description', 'Quoted in dollars.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([TINY_PNG], { type: 'image/png' }), 'usd.png');
    const res = await a.post('/services/parts/new', { multipart: fd });
    usdPartId = Number((res.headers.get('location') ?? '').split('/').pop());
    check('a seller can list a part in US dollars', () => {
      assert.equal(res.status, 302);
      assert.ok(usdPartId > 0);
      assert.equal(get('SELECT currency FROM parts WHERE id = ?', usdPartId).currency, 'USD');
    });
  }
  {
    // The seller still reads prices in lari at this point (the default).
    const { html } = await a.page(`/services/parts/${usdPartId}`);
    check('a USD price is converted to GEL for a lari reader', () => {
      assert.match(html, /270 ₾/);
      assert.match(html, /\$100/);
    });
  }
  {
    const res = await a.request('GET', '/currency/USD');
    check('picking a currency stores it on the account', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT currency FROM users WHERE username = ?', A.username).currency, 'USD');
    });
  }
  {
    const { html } = await a.page(`/services/parts/${usdPartId}`);
    check('a USD price shows as-is for a dollar reader', () => {
      assert.match(html, /\$100/);
      assert.doesNotMatch(html, /270 ₾/);
    });
  }
  {
    const fd = new FormData();
    fd.set('title', 'Smoke GEL turbo');
    fd.set('category', 'tuning');
    fd.set('price', '2700');
    fd.set('currency', 'GEL');
    fd.set('description', 'Quoted in lari.');
    fd.set('_csrf', a.csrf);
    fd.set('media', new Blob([TINY_PNG], { type: 'image/png' }), 'gel.png');
    const res = await a.post('/services/parts/new', { multipart: fd });
    gelPartId = Number((res.headers.get('location') ?? '').split('/').pop());
    const { html } = await a.page(`/services/parts/${gelPartId}`);
    check('a GEL price is converted to USD for a dollar reader', () => {
      assert.equal(res.status, 302);
      assert.match(html, /\$1,000/);
      assert.match(html, /2,700 ₾/);
    });
  }
  {
    await a.request('GET', '/currency/nonsense');
    const { html } = await a.page(`/services/parts/${usdPartId}`);
    check('an unknown currency code is ignored', () => {
      assert.match(html, /\$100/);
      assert.equal(get('SELECT currency FROM users WHERE username = ?', A.username).currency, 'USD');
    });
  }
  {
    // Price sorting converts to one currency first: $100 (~270 GEL) is
    // cheaper than 2,700 GEL, so the dollar listing should come first.
    const { html } = await a.page('/services/parts?scope=mine&sort=price_low');
    check('price sorting works across currencies', () => {
      const usd = html.indexOf('Smoke USD turbo');
      const gel = html.indexOf('Smoke GEL turbo');
      assert.ok(usd !== -1 && gel !== -1, 'both listings are on the board');
      assert.ok(usd < gel, 'the cheaper listing sorts first');
    });
  }
  {
    const p1 = await a.post(`/services/parts/${usdPartId}/delete`, a.formWithCsrf({}));
    const p2 = await a.post(`/services/parts/${gelPartId}/delete`, a.formWithCsrf({}));
    check('currency test listings can be cleaned up', () => {
      assert.equal(p1.status, 302);
      assert.equal(p2.status, 302);
    });
  }

  /* 14. the letters the site sends on its own --------------------- */
  console.log('\nthe letters');
  {
    const { sendPtiReminders, sendDigests, ptiRemindersDue, daysLeft } =
      await import('../src/lib/mail-jobs.js');

    // A car whose inspection is coming up.
    const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
    db.prepare('UPDATE users SET mail_pti = 1, mail_digest = 1 WHERE id = ?').run(aId);
    db.prepare(
      'UPDATE builds SET pti_expires_at = ?, pti_plate = ? WHERE id = (SELECT id FROM builds WHERE user_id = ? LIMIT 1)',
    ).run(soon, 'AB123CD', aId);

    check('the days left are counted', () => {
      assert.equal(daysLeft(soon), 20);
      assert.equal(daysLeft(null), null);
    });

    const due = ptiRemindersDue();
    check('a car that is due inside the month brings a reminder', () => {
      assert.ok(due.length >= 1, 'at least one reminder is due');
      assert.ok(due.some((d) => d.member.id === aId), 'the member with the car is in the list');
    });
    check('the same car is not written twice', () => {
      for (const entry of due) {
        const plates = entry.cars.map((c) => c.plate).filter(Boolean);
        const unique = new Set(plates);
        assert.equal(plates.length, unique.size, `the letter lists ${plates.join(', ')}`);
      }
    });

    const before = outbox.length;
    const sent = await sendPtiReminders();
    check('the inspection reminder goes out', () => {
      assert.equal(sent, due.length);
      assert.equal(outbox.length, before + due.length);
      const mail = outbox[outbox.length - 1] || {};
      assert.ok(String(mail.subject || '').length > 0, 'the letter has a subject');
      assert.ok(String(mail.html || '').includes('AB123CD'), 'the letter names the car');
    });

    const again = await sendPtiReminders();
    check('the same reminder is not sent twice', () => {
      assert.equal(again, 0, 'nothing was sent the second time');
    });

    // A car that is due in half a year is nobody's problem yet.
    db.prepare(
      'UPDATE builds SET pti_expires_at = ? WHERE id = (SELECT id FROM builds WHERE user_id = ? LIMIT 1)',
    ).run(far, aId);
    const notYet = ptiRemindersDue();
    check('a car that is due in half a year is left alone', () => {
      assert.ok(!notYet.some((d) => d.member.id === aId), 'no reminder for a car that is not due');
    });

    // The weekly digest.
    const digestBefore = outbox.length;
    const digests = await sendDigests();
    check('the weekly digest goes out to the members who want it', () => {
      assert.ok(digests >= 1, 'at least one digest was sent');
      assert.equal(outbox.length, digestBefore + digests);
    });
    const secondDigest = await sendDigests();
    check('the digest is not sent twice in the same week', () => {
      assert.equal(secondDigest, 0);
    });

    // A member who turned it off is left alone.
    db.prepare('UPDATE users SET mail_digest = 0 WHERE id = ?').run(bId);
    const offBefore = outbox.length;
    await sendDigests();
    check('a member who turned the digest off is left alone', () => {
      const toB = outbox.slice(offBefore).filter((m) => String(m.to || '').includes(B.email));
      assert.equal(toB.length, 0, 'no letter went to the member who opted out');
    });
  }

  /* 15b. Underground ------------------------------------------------ */
  console.log('\nunderground');
  let undergroundId = 0;
  {
    const form = await a.page('/underground/new');
    check('a driver can open the Underground host form', () => {
      assert.equal(form.res.status, 200);
      assert.match(form.html, /Open the Underground/);
    });
    const startsAt = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
    const res = await a.post('/underground/new', a.formWithCsrf({
      title: 'Smoke Underground Night',
      type: 'drag',
      starts_at: startsAt,
      description: 'Closed smoke night',
      lat: '41.7151',
      lng: '44.8271',
      place_name: 'Smoke spot',
      zoom: '14',
    }));
    undergroundId = Number((res.headers.get('location') || '').split('/').pop());
    check('the host creates a closed Underground night', () => {
      assert.equal(res.status, 302);
      assert.ok(undergroundId > 0);
      const row = get('SELECT * FROM underground_events WHERE id = ?', undergroundId);
      assert.equal(row.type, 'drag');
      assert.equal(row.status, 'open');
      assert.ok(get('SELECT 1 AS x FROM underground_requests WHERE event_id = ? AND user_id = ? AND status = ?', undergroundId, aId, 'approved'));
    });
    check('the network gets an Underground notification', () => {
      assert.ok(get('SELECT 1 AS x FROM notifications WHERE user_id = ? AND type = ? AND entity_id = ?', bId, 'underground_event', undergroundId));
    });
  }
  {
    const page = await b.page('/underground/' + undergroundId);
    check('an unapproved driver sees the locked map, not the host', () => {
      assert.equal(page.res.status, 200);
      assert.match(page.html, /The map is locked/);
      assert.doesNotMatch(page.html, new RegExp(A.username));
      assert.doesNotMatch(page.html, /data-ug-map/);
    });
    const fd = new FormData();
    fd.set('_csrf', b.csrf);
    fd.set('car_model', 'Smoke E36');
    const res = await b.post('/underground/' + undergroundId + '/join', { multipart: fd });
    check('a driver asks to join with a car', () => {
      assert.equal(res.status, 302);
      const row = get('SELECT * FROM underground_requests WHERE event_id = ? AND user_id = ?', undergroundId, bId);
      assert.equal(row.status, 'requested');
      assert.equal(row.car_model, 'Smoke E36');
    });
  }
  {
    const page = await a.page('/underground/' + undergroundId);
    check('the host sees the car and username for approval', () => {
      assert.match(page.html, /Smoke E36/);
      assert.match(page.html, new RegExp('@' + B.username));
    });
    const res = await a.post('/underground/' + undergroundId + '/requests/' + bId + '/approve', a.formWithCsrf({}));
    check('the host approves the driver', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT status FROM underground_requests WHERE event_id = ? AND user_id = ?', undergroundId, bId).status, 'approved');
    });
    const approved = await b.page('/underground/' + undergroundId);
    check('approval unlocks the map and race controls', () => {
      assert.match(approved.html, /data-ug-map/);
      assert.match(approved.html, /data-ug-enter/);
    });
  }
  {
    const res = await b.post('/api/underground/' + undergroundId + '/position', {
      json: { lat: 41.7151, lng: 44.8271, speed: 91 },
      headers: b.jsonHeaders(),
    });
    check('approved drivers can publish live speed and position', () => {
      assert.equal(res.status, 200);
      const row = get('SELECT * FROM underground_positions WHERE event_id = ? AND user_id = ?', undergroundId, bId);
      assert.ok(row);
      assert.equal(Math.round(row.speed), 91);
    });
    const live = await a.request('GET', '/api/underground/' + undergroundId + '/live', { headers: a.jsonHeaders() });
    const payload = await live.json();
    check('the host can see live drivers on the map API', () => {
      assert.equal(live.status, 200);
      assert.ok(payload.participants.some((p) => p.user_id === bId && p.speed === 91));
    });
  }
  {
    const track = [
      { lat: 41.7151, lng: 44.8271, t: Date.now() - 12000, speed: 0 },
      { lat: 41.7161, lng: 44.8281, t: Date.now() - 6000, speed: 70 },
      { lat: 41.7171, lng: 44.8291, t: Date.now(), speed: 120 },
    ];
    const res = await b.post('/api/underground/' + undergroundId + '/run', {
      json: { track },
      headers: b.jsonHeaders(),
    });
    const payload = await res.json().catch(() => ({}));
    check('a finished run is saved with server-calculated metrics', () => {
      assert.equal(res.status, 200);
      assert.ok(payload.run);
      assert.ok(payload.run.top_speed >= 120);
      assert.ok(payload.run.distance_km > 0);
      const row = get('SELECT * FROM underground_runs WHERE event_id = ? AND user_id = ?', undergroundId, bId);
      assert.ok(row);
      assert.ok(row.top_speed >= 120);
    });
  }
  {
    const before = outbox.length;
    const res = await a.post('/underground/' + undergroundId + '/finish', a.formWithCsrf({}));
    check('the host finishes the night', () => {
      assert.equal(res.status, 302);
      assert.equal(get('SELECT status FROM underground_events WHERE id = ?', undergroundId).status, 'finished');
    });
    check('every approved driver gets an Underground summary email', () => {
      assert.ok(outbox.length > before);
      assert.ok(outbox.slice(before).some((mail) => /Underground summary/.test(String(mail.subject || ''))));
    });
    const mine = await b.page('/underground?scope=mine');
    check('My Underground keeps the finished run', () => {
      assert.equal(mine.res.status, 200);
      assert.match(mine.html, /Smoke Underground Night/);
      assert.match(mine.html, /data-ug-run-map/);
      assert.match(mine.html, /Top speed/);
    });
  }

  /* 16. logout ------------------------------------------------------ */
  console.log('\nsession');
  {
    const res = await a.post('/logout', a.formWithCsrf({}));
    check('logout redirects to /login', () => {
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    });
    const after = await a.request('GET', '/');
    check('session is gone after logout', () => {
      assert.equal(after.status, 302);
      assert.equal(after.headers.get('location'), '/login');
    });
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
}

/* ── summary ──────────────────────────────────────────────────── */
console.log(`\n${'-'.repeat(52)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nfailures:');
  for (const { name, error } of failures) {
    console.log(`  - ${name}`);
    console.log(`    ${error.stack?.split('\n').slice(0, 4).join('\n    ')}`);
  }
}

// The throwaway database and uploads are removed on the way out.
for (const file of DB_FILES) fs.rmSync(file, { force: true });
fs.rmSync(path.join(ROOT, 'uploads-smoke'), { recursive: true, force: true });
fs.rmSync(BACKUP_DIR, { recursive: true, force: true });

process.exitCode = failures.length ? 1 : 0;
