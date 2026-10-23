/**
 * Keep a Cloudflare DNS record pointing at this machine's public IP.
 *
 * Home connections change IP often, so the A record for the domain has to
 * follow. Run this from a scheduled task every few minutes - it only
 * touches Cloudflare when the address actually changed.
 *
 *   node scripts/cf-ddns.mjs            # update once
 *   node scripts/cf-ddns.mjs --watch    # keep it in the foreground
 *
 * Configuration (put these in .env):
 *   CF_API_TOKEN     API token with "Zone:DNS:Edit" for the zone
 *   CF_ZONE_ID      the zone id (Cloudflare dashboard > Overview)
 *   CF_DNS_NAME     the record to update, e.g. streeto.net
 *   CF_DNS_TYPE     A (default) or AAAA
 *
 * The token is created at Cloudflare > My Profile > API Tokens > Create
 * Token > Edit zone DNS. The zone id is also in the zone overview.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* no .env file */
}

const API = 'https://api.cloudflare.com/client/v4';

const token = process.env.CF_API_TOKEN || '';
const zoneId = process.env.CF_ZONE_ID || '';
const dnsName = process.env.CF_DNS_NAME || '';
const dnsType = (process.env.CF_DNS_TYPE || 'A').toUpperCase();
const watch = process.argv.includes('--watch');
const INTERVAL_MS = Number(process.env.CF_DDNS_INTERVAL_MS || 5 * 60 * 1000);

/** Services that report the machine's public IP. */
const IP_SERVICES = [
  'https://api.ipify.org',
  'https://ipv4.icanhazip.com',
  'https://api4.ipify.org',
  'https://ifconfig.me/ip',
];

async function publicIp() {
  for (const url of IP_SERVICES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (/^[0-9a-f:.]{3,45}$/i.test(text)) return text;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('Could not read the public IP address');
}

async function cf(path_, method = 'GET', body) {
  const res = await fetch(API + path_, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const message = json.errors?.map((e) => e.message).join('; ') || res.statusText;
    throw new Error(`Cloudflare API ${res.status}: ${message}`);
  }
  return json.result;
}

/** Find the record id, creating the record when it is missing. */
async function findRecord() {
  const list = await cf(`/zones/${zoneId}/dns_records?type=${dnsType}&name=${encodeURIComponent(dnsName)}`);
  return list[0] || null;
}

async function upsert() {
  const ip = await publicIp();
  const record = await findRecord();

  if (record) {
    if (record.content === ip) {
      console.log(`[ddns] ${dnsName} already points at ${ip} - nothing to do.`);
      return;
    }
    await cf(`/zones/${zoneId}/dns_records/${record.id}`, 'PUT', {
      type: dnsType,
      name: dnsName,
      content: ip,
      ttl: 120,
      proxied: true,
    });
    console.log(`[ddns] ${dnsName}: ${record.content} -> ${ip}`);
    return;
  }

  await cf(`/zones/${zoneId}/dns_records`, 'POST', {
    type: dnsType,
    name: dnsName,
    content: ip,
    ttl: 120,
    proxied: true,
  });
  console.log(`[ddns] created ${dnsName} -> ${ip}`);
}

function checkConfig() {
  const missing = [];
  if (!token) missing.push('CF_API_TOKEN');
  if (!zoneId) missing.push('CF_ZONE_ID');
  if (!dnsName) missing.push('CF_DNS_NAME');
  if (missing.length) {
    console.error(`[ddns] Missing configuration: ${missing.join(', ')}`);
    console.error('[ddns] See scripts/cf-ddns.mjs for how to obtain them.');
    process.exit(1);
  }
}

checkConfig();

if (watch) {
  const run = () => upsert().catch((err) => console.error('[ddns]', err.message));
  run();
  setInterval(run, INTERVAL_MS);
} else {
  try {
    await upsert();
    process.exit(0);
  } catch (err) {
    console.error('[ddns]', err.message);
    process.exit(1);
  }
}
