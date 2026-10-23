/**
 * Admin CLI.
 *
 *   npm run admin                        # list admins
 *   npm run admin -- create <user> [pass] [email]
 *   npm run admin -- promote <username>
 *   npm run admin -- revoke <username>
 *
 * `create` makes a brand new account with the admin flag. If the
 * username already exists it is promoted instead, so re-running is
 * safe. A random password is generated when none is given.
 */
import crypto from 'node:crypto';
import * as users from '../src/models/users.js';
import { hashPassword } from '../src/lib/password.js';

const [, , command = 'list', ...rest] = process.argv;

/* Reserved names such as "admin" are blocked on the public register
   form, but the CLI is trusted - it may take one. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

const randomPassword = () => `${crypto.randomBytes(9).toString('base64url')}${crypto.randomInt(10)}`;

function list() {
  const admins = users.adminList({ limit: 500 }).filter((u) => u.is_admin);
  if (!admins.length) {
    console.log('[admin] no admins yet. Create one with:');
    console.log('  npm run admin -- create admin');
    return;
  }
  console.log(`[admin] ${admins.length} admin${admins.length === 1 ? '' : 's'}:`);
  for (const admin of admins) {
    console.log(`  #${admin.id}  @${admin.username}  ${admin.email}`);
  }
}

async function create() {
  const username = (rest[0] || 'admin').trim();
  const password = rest[1] || randomPassword();
  const email = (rest[2] || `${username}@streeto.local`).trim();
  const generated = !rest[1];

  if (!USERNAME_RE.test(username)) {
    console.error(`[admin] "${username}" is not a valid username (3-20 letters, numbers, underscores).`);
    process.exitCode = 1;
    return;
  }
  if (!EMAIL_RE.test(email)) {
    console.error(`[admin] "${email}" is not a valid email address.`);
    process.exitCode = 1;
    return;
  }

  const existing = users.findByUsername(username);
  if (existing) {
    users.setAdmin(existing.id, true);
    console.log(`[admin] @${existing.username} was already registered - promoted to admin.`);
    return;
  }

  const created = users.createUser({
    username,
    email,
    passwordHash: await hashPassword(password),
    displayName: 'STREETO Admin',
  });
  users.setAdmin(created.id, true);

  console.log(`[admin] created @${created.username} (id ${created.id}) as an admin.`);
  if (generated) {
    console.log('');
    console.log(`  password: ${password}`);
    console.log('  Store it now - it is not shown again.');
    console.log('');
  }
}

function setFlag(flag) {
  const username = rest[0];
  if (!username) {
    console.error(`[admin] usage: npm run admin -- ${flag ? 'promote' : 'revoke'} <username>`);
    process.exitCode = 1;
    return;
  }
  const user = users.findByUsername(username);
  if (!user) {
    console.error(`[admin] no driver called @${username}.`);
    process.exitCode = 1;
    return;
  }
  if (!flag && user.is_admin && users.adminCount() <= 1) {
    console.error('[admin] refusing to remove the only admin.');
    process.exitCode = 1;
    return;
  }
  users.setAdmin(user.id, flag);
  console.log(`[admin] @${user.username} is ${flag ? 'now an admin' : 'no longer an admin'}.`);
}

async function main() {
  if (command === 'create') return create();
  if (command === 'promote') return setFlag(true);
  if (command === 'revoke') return setFlag(false);
  if (command === 'list') return list();
  console.error(`[admin] unknown command "${command}". Try: list | create | promote | revoke`);
  process.exitCode = 1;
}

await main();
