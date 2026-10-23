/**
 * Generate the self-signed certificate used for local HTTPS.
 *
 * The camera API only works in a secure context, so the dev server runs
 * over HTTPS. This script includes localhost, the machine hostname and
 * every current LAN IPv4 address in the SAN list, which keeps
 * https://<lan-ip>:3000 working when DHCP hands out a different address.
 *
 *   npm run cert
 *
 * Re-run it whenever the LAN address changes, then restart the server.
 *
 * For the public site, put a Cloudflare Origin CA certificate in
 * certs/origin.pem and certs/origin-key.pem instead - the server prefers
 * that one over this file. Create it in Cloudflare under
 * SSL/TLS > Origin Server > Create Certificate.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import config from '../src/config.js';

const dir = path.resolve(import.meta.dirname, '..', 'certs');
fs.mkdirSync(dir, { recursive: true });

const ips = new Set(['127.0.0.1']);
for (const list of Object.values(os.networkInterfaces())) {
  for (const net of list || []) {
    if (net.family === 'IPv4' && !net.internal) ips.add(net.address);
  }
}

/** Public host names the certificate should also be valid for. */
const hosts = new Set(['localhost', os.hostname()]);
const publicUrl = process.env.PUBLIC_URL || config.publicUrl;
if (publicUrl) {
  try {
    hosts.add(new URL(publicUrl.includes('://') ? publicUrl : `https://${publicUrl}`).hostname);
  } catch {
    /* ignore a malformed PUBLIC_URL */
  }
}
for (const extra of String(process.env.EXTRA_HOSTS || '').split(',')) {
  const host = extra.trim();
  if (host) hosts.add(host);
}

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01' + Date.now().toString(16).slice(-12);
cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
cert.validity.notAfter = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000);

const attrs = [{ name: 'commonName', value: 'STREETO local' }];
cert.setSubject(attrs);
cert.setIssuer(attrs);

const altNames = [
  ...[...hosts].map((host) => ({ type: 2, value: host })),
  ...[...ips].map((ip) => ({ type: 7, ip })),
];

cert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
  { name: 'extKeyUsage', serverAuth: true },
  { name: 'subjectAltName', altNames },
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

fs.writeFileSync(path.join(dir, 'key.pem'), forge.pki.privateKeyToPem(keys.privateKey));
fs.writeFileSync(path.join(dir, 'cert.pem'), forge.pki.certificateToPem(cert));

console.log('Wrote certs/key.pem and certs/cert.pem');
console.log('Hosts:', [...hosts].join(', '));
console.log('IPs:', [...ips].join(', '));
