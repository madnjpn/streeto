/**
 * Go live with one command.
 *
 *   node scripts/go-live.mjs              # everything, in order
 *   node scripts/go-live.mjs check        # only report what is missing
 *   node scripts/go-live.mjs prepare     # .env.production, certificate, dependencies
 *   node scripts/go-live.mjs cloudflare   # zone, tunnel, DNS, SSL settings
 *   node scripts/go-live.mjs runtime      # cloudflared + the app as services
 *   node scripts/go-live.mjs verify       # is the public site answering?
 *
 * Everything is idempotent - run it again after moving to a new machine and
 * it fills in whatever is missing.
 *
 * It needs one Cloudflare API token in .env.production:
 *
 *   CF_API_TOKEN   "Edit zone DNS" + "Zone:SSL and Cache:Edit"
 *                  + "Zone:Settings:Edit" + "Account:Cloudflare Tunnel:Edit"
 *
 * The token is never printed and never leaves the machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Cloudflare, CloudflareError } from './lib/cloudflare.mjs';
import { ensureCloudflared, installServices, serviceStatus, portFree, isWindows } from './lib/runtime.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.production');
const CERT_DIR = path.join(ROOT, 'certs');

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'all';
const dryRun = argv.includes('--dry-run');

const log = (msg) => console.log(msg);
const step = (msg) => console.log(`\n\x1b[36m==> ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32mok\x1b[0m    ${msg}`);
const warn = (msg) => console.log(`  \x1b[33mwarn\x1b[0m  ${msg}`);
const fail = (msg) => console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
const todo = (msg) => console.log(`  \x1b[33mTODO\x1b[0m  ${msg}`);

/* ── .env.production ─────────────────────────────────────────────────── */

/** Read a .env file into a plain object. */
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** The env for this run: the process environment wins over the file. */
function loadEnv() {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    /* no file yet */
  }
  return { ...readEnvFile(ENV_FILE), ...process.env };
}

function writeEnv(values) {
  const lines = [
    '# STREETO - production environment.',
    '# Created by scripts/go-live.mjs. Git-ignored - keep it out of version control.',
    '',
  ];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n');
  fs.chmodSync(ENV_FILE, 0o600);
}

/* ── steps ───────────────────────────────────────────────────────────── */

async function stepPrepare(env) {
  step('Preparing the project');

  // Dependencies.
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
    log('  installing dependencies...');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev'], { stdio: 'inherit', cwd: ROOT });
    ok('dependencies installed');
  } else {
    ok('dependencies are installed');
  }

  // The production environment file. Anything already in the file is kept -
  // the file may hold secrets (the API token, the tunnel token) that this
  // script does not know about.
  const current = readEnvFile(ENV_FILE);
  const domain = current.PUBLIC_URL ? new URL(current.PUBLIC_URL).hostname : (env.CF_DNS_NAME || 'streeto.net');
  const values = {
    ...current,
    NODE_ENV: 'production',
    PUBLIC_URL: current.PUBLIC_URL || `https://${domain}`,
    PORT: current.PORT || '443',
    HTTP_PORT: current.HTTP_PORT || '80',
    HOST: current.HOST || '0.0.0.0',
    TRUST_PROXY: current.TRUST_PROXY || '1',
    SESSION_SECRET: current.SESSION_SECRET || crypto.randomBytes(48).toString('hex'),
    CERT_DIR: current.CERT_DIR || 'certs',
    VAPID_SUBJECT: current.VAPID_SUBJECT || `mailto:admin@${domain}`,
    CF_API_TOKEN: current.CF_API_TOKEN || env.CF_API_TOKEN || '',
    CF_ZONE_ID: current.CF_ZONE_ID || '',
    CF_DNS_NAME: current.CF_DNS_NAME || domain,
    CF_DNS_TYPE: current.CF_DNS_TYPE || 'A',
    CF_TUNNEL_ID: current.CF_TUNNEL_ID || '',
  };
  if (!current.SESSION_SECRET) log('  generated a new SESSION_SECRET');
  if (!dryRun) writeEnv(values);
  else log('  (dry run: .env.production not written)');
  ok(`.env.production ready (${values.PUBLIC_URL})`);

  // A TLS certificate for the origin.
  const originCert = path.join(CERT_DIR, 'origin.pem');
  const originKey = path.join(CERT_DIR, 'origin-key.pem');
  const localCert = path.join(CERT_DIR, 'cert.pem');
  const localKey = path.join(CERT_DIR, 'key.pem');
  if (fs.existsSync(originCert) && fs.existsSync(originKey)) {
    ok('the Cloudflare Origin CA certificate is in place');
  } else if (fs.existsSync(localCert) && fs.existsSync(localKey)) {
    warn('only the local self-signed certificate is present - the Cloudflare step will fetch an Origin CA one');
  } else {
    log('  generating a local certificate as a fallback...');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-cert.js')], { stdio: 'inherit', cwd: ROOT, env: { ...process.env, PUBLIC_URL: values.PUBLIC_URL } });
    ok('generated certs/cert.pem and certs/key.pem');
  }
  return values;
}

async function stepCloudflare(env) {
  step('Cloudflare');
  const token = env.CF_API_TOKEN;
  if (!token) {
    todo('no CF_API_TOKEN - create one and add it to .env.production');
    log('    Cloudflare > My Profile > API Tokens > Create Token > Edit zone DNS');
    log('    add "Zone:SSL and Cache:Edit", "Zone:Settings:Edit" and "Account:Cloudflare Tunnel:Edit"');
    return null;
  }

  const cf = new Cloudflare(token);
  const domain = new URL(env.PUBLIC_URL).hostname;

  const zone = await cf.findZone(domain);
  if (!zone) {
    fail(`${domain} is not in this Cloudflare account - add the zone first`);
    return null;
  }
  ok(`zone ${domain} (${zone.id})`);

  const { accountId } = await cf.accountOf(zone.id);
  ok(`account ${accountId}`);

  // The Origin CA certificate, if we do not have one yet.
  if (!fs.existsSync(path.join(CERT_DIR, 'origin.pem'))) {
    if (dryRun) {
      todo('would request an Origin CA certificate');
    } else {
      const hosts = [domain, `*.${domain}`];
      const { certificate, privateKey } = await cf.createOriginCert({ hosts });
      fs.mkdirSync(CERT_DIR, { recursive: true });
      fs.writeFileSync(path.join(CERT_DIR, 'origin.pem'), certificate.trim() + '\n');
      fs.writeFileSync(path.join(CERT_DIR, 'origin-key.pem'), privateKey.trim() + '\n');
      ok(`Origin CA certificate written for ${hosts.join(', ')}`);
    }
  } else {
    ok('the Origin CA certificate is already in place');
  }

  // The tunnel.
  let tunnelId = env.CF_TUNNEL_ID;
  if (!tunnelId) {
    const tunnels = await cf.listTunnels(accountId, domain);
    if (tunnels.length) {
      tunnelId = tunnels[0].id;
      ok(`reusing the existing tunnel "${tunnels[0].name}" (${tunnelId})`);
    } else if (dryRun) {
      todo('would create a tunnel');
    } else {
      const tunnel = await cf.createTunnel(accountId, domain);
      tunnelId = tunnel.id;
      ok(`created the tunnel "${domain}" (${tunnelId})`);
    }
  } else {
    ok(`using the configured tunnel ${tunnelId}`);
  }

  if (!tunnelId) return { cf, zone, accountId, tunnelId: null };

  // The routing rules.
  const ingress = [
    { hostname: domain, service: 'https://localhost:443', originRequest: { noTLSVerify: true, originServerName: domain } },
    { hostname: `www.${domain}`, service: 'https://localhost:443', originRequest: { noTLSVerify: true, originServerName: domain } },
    { service: 'http_status:404' },
  ];
  if (dryRun) {
    todo('would set the tunnel routes');
  } else {
    await cf.setTunnelConfig(accountId, tunnelId, ingress);
    ok(`tunnel routes point ${domain} and www.${domain} at https://localhost:443`);
  }

  // DNS records for the tunnel.
  const records = await cf.dnsRecords(zone.id);
  const tunnelTarget = `${tunnelId}.cfargotunnel.com`;
  for (const name of [domain, `www.${domain}`]) {
    const existing = records.find((r) => r.name === name && r.type === 'CNAME');
    if (existing) {
      if (existing.content !== tunnelTarget) {
        if (dryRun) todo(`would repoint ${name}`);
        else {
          await cf.updateDnsRecord(zone.id, existing.id, { type: 'CNAME', name, content: tunnelTarget, proxied: true, ttl: 1 });
          ok(`repointed ${name} at the tunnel`);
        }
      } else {
        ok(`${name} already points at the tunnel`);
      }
    } else if (dryRun) {
      todo(`would create the CNAME for ${name}`);
    } else {
      await cf.createDnsRecord(zone.id, { type: 'CNAME', name, content: tunnelTarget, proxied: true, ttl: 1 });
      ok(`created the CNAME for ${name}`);
    }
  }

  // Edge settings. WebSockets is an account-level switch and is on by
  // default, so it is not part of the per-zone settings.
  const settings = [
    ['ssl', 'strict', 'SSL mode'],
    ['always_use_https', 'on', 'Always Use HTTPS'],
  ];
  for (const [setting, value, label] of settings) {
    if (dryRun) {
      todo(`would set ${label} to "${value}"`);
      continue;
    }
    try {
      await cf.setSetting(zone.id, setting, value);
      ok(`${label} = ${value}`);
    } catch (err) {
      warn(`${label} could not be set (${err.message})`);
    }
  }

  // Remember the tunnel id for the next run.
  if (!dryRun) {
    const values = readEnvFile(ENV_FILE);
    values.CF_TUNNEL_ID = tunnelId;
    values.CF_ZONE_ID = zone.id;
    writeEnv(values);
  }

  return { cf, zone, accountId, tunnelId };
}

async function stepRuntime(env, cloudflare) {
  step('Runtime');

  // The connector needs a tunnel token.
  let tunnelToken = env.CF_TUNNEL_TOKEN || '';
  if (!tunnelToken && cloudflare?.tunnelId) {
    tunnelToken = await cloudflare.cf.tunnelToken(cloudflare.accountId, cloudflare.tunnelId);
    if (!dryRun) {
      const values = readEnvFile(ENV_FILE);
      values.CF_TUNNEL_TOKEN = tunnelToken;
      writeEnv(values);
    }
  }
  if (!tunnelToken) {
    fail('no tunnel token - run the cloudflare step first');
    return;
  }
  ok('tunnel token available');

  const exe = await ensureCloudflared(log);
  ok(`cloudflared: ${exe}`);

  if (dryRun) {
    todo('would install the services');
    return;
  }

  await installServices({
    exe,
    token: tunnelToken,
    node: process.execPath,
    project: ROOT,
    envFile: ENV_FILE,
    log,
  });
  ok('services installed (they start with the machine)');
}

async function stepVerify(env) {
  step('Verifying');
  const url = env.PUBLIC_URL || 'https://streeto.net';
  const port = Number(env.PORT || 443);

  const local = await portFree(port);
  if (local) warn(`port ${port} is free - is the app running?`);
  else ok(`the app is listening on port ${port}`);

  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(15000) });
    const body = await res.json();
    if (body && body.ok) ok(`${url} is serving the app (${body.service})`);
    else fail(`${url} answered but not with a health response`);
  } catch (err) {
    fail(`${url} did not answer (${err.message})`);
  }

  const status = await serviceStatus();
  ok(`tunnel service: ${status.tunnel}, app service: ${status.app}`);
}

/* ── main ────────────────────────────────────────────────────────────── */

const env = loadEnv();

try {
  if (command === 'check' || command === 'all') {
    const values = await stepPrepare(env);
    const cloudflare = await stepCloudflare({ ...env, ...values });
    if (command === 'all') {
      await stepRuntime({ ...env, ...values }, cloudflare);
      await stepVerify({ ...env, ...values });
    }
  } else if (command === 'prepare') {
    await stepPrepare(env);
  } else if (command === 'cloudflare') {
    const values = await stepPrepare(env);
    await stepCloudflare({ ...env, ...values });
  } else if (command === 'runtime') {
    const cloudflare = await stepCloudflare(env);
    await stepRuntime(env, cloudflare);
  } else if (command === 'verify') {
    await stepVerify(env);
  } else {
    console.log('usage: node scripts/go-live.mjs [check|prepare|cloudflare|runtime|verify|all] [--dry-run]');
    process.exit(1);
  }
  console.log('');
  if (isWindows && command === 'all') {
    log('If the services could not be started, run this once in an');
    log('elevated PowerShell window:');
    log('  powershell -ExecutionPolicy Bypass -File scripts\\setup-production.ps1');
  }
  process.exit(0);
} catch (err) {
  console.error('');
  fail(err.message);
  if (err instanceof CloudflareError && err.details) {
    console.error('       ' + JSON.stringify(err.details).slice(0, 300));
  }
  if (/administrator/i.test(err.message)) {
    console.error('');
    console.error('  The last step needs administrator rights. Open PowerShell');
    console.error('  as administrator and run:');
    console.error('    powershell -ExecutionPolicy Bypass -File scripts\\setup-production.ps1');
  }
  process.exit(1);
}
