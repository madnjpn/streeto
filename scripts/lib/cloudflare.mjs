/**
 * Small Cloudflare API client for the deployment automation.
 *
 * Only the calls the go-live script needs are here. The API token is read
 * from CF_API_TOKEN and is never printed.
 */
import forge from 'node-forge';

const API = 'https://api.cloudflare.com/client/v4';

export class CloudflareError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'CloudflareError';
    this.details = details;
  }
}

export class Cloudflare {
  constructor(token) {
    if (!token) {
      throw new CloudflareError(
        'No API token. Create one at Cloudflare > My Profile > API Tokens > Create Token > Edit zone DNS ' +
          '(plus "Zone:SSL and Cache:Edit", "Zone:Settings:Edit" and "Account:Cloudflare Tunnel:Edit") ' +
          'and put it in .env.production as CF_API_TOKEN.',
      );
    }
    this.token = token;
  }

  async request(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    let json = {};
    try {
      json = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok || json.success === false) {
      const message = (json.errors || []).map((e) => e.message).join('; ') || `${res.status} ${res.statusText}`;
      throw new CloudflareError(`Cloudflare API ${method} ${path}: ${message}`, json.errors);
    }
    return json.result;
  }

  /* ── zones ──────────────────────────────────────────────────────────── */

  /** The zone id for a domain, or null when Cloudflare does not host it. */
  async findZone(domain) {
    const zones = await this.request(`/zones?name=${encodeURIComponent(domain)}`);
    return zones[0] || null;
  }

  /** The account id that owns a zone. */
  async accountOf(zoneId) {
    const zone = await this.request(`/zones/${zoneId}`);
    return { accountId: zone.account?.id, zone };
  }

  /* ── origin certificate ─────────────────────────────────────────────── */

  /**
   * Ask Cloudflare to sign a certificate for the given hosts. The key and
   * the CSR are made here, so the private key never leaves the machine.
   */
  async createOriginCert({ hosts, validityDays = 5475 }) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([{ name: 'commonName', value: hosts[0] }]);
    csr.setExtensions([
      { name: 'subjectAltName', altNames: hosts.map((h) => ({ type: 2, value: h })) },
    ]);
    csr.sign(keys.privateKey, forge.md.sha256.create());

    const result = await this.request(`/zones/${this.zoneId}/origin_ca`, {
      method: 'POST',
      body: {
        certificate: forge.pki.certificationRequestToPem(csr),
        private_key: forge.pki.privateKeyToPem(keys.privateKey),
        hostnames: hosts,
        validity_days: validityDays,
        request_type: 'origin-rsa',
      },
    });
    return {
      certificate: result.certificate,
      privateKey: forge.pki.privateKeyToPem(keys.privateKey),
    };
  }

  /* ── tunnels ────────────────────────────────────────────────────────── */

  async listTunnels(accountId, name) {
    const query = name ? `?name=${encodeURIComponent(name)}` : '';
    return this.request(`/accounts/${accountId}/cfd_tunnel${query}`);
  }

  async createTunnel(accountId, name) {
    // A random 32-byte secret is what makes the tunnel ours.
    const secret = forge.util.bytesToHex(forge.random.getBytesSync(32));
    return this.request(`/accounts/${accountId}/cfd_tunnel`, {
      method: 'POST',
      body: { name, tunnel_secret: secret, config_src: 'cloudflare' },
    });
  }

  /** The token the cloudflared connector runs with. */
  async tunnelToken(accountId, tunnelId) {
    const result = await this.request(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
    return typeof result === 'string' ? result : result.token;
  }

  /** The routing rules of a tunnel. */
  async setTunnelConfig(accountId, tunnelId, ingress) {
    return this.request(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
      method: 'PUT',
      body: { config: { ingress, 'warp-routing': { enabled: false } } },
    });
  }

  /* ── dns ────────────────────────────────────────────────────────────── */

  async dnsRecords(zoneId, name) {
    const query = name ? `?name=${encodeURIComponent(name)}` : '';
    return this.request(`/zones/${zoneId}/dns_records${query}`);
  }

  async createDnsRecord(zoneId, record) {
    return this.request(`/zones/${zoneId}/dns_records`, { method: 'POST', body: record });
  }

  async updateDnsRecord(zoneId, id, record) {
    return this.request(`/zones/${zoneId}/dns_records/${id}`, { method: 'PUT', body: record });
  }

  /* ── zone settings ──────────────────────────────────────────────────── */

  async setSetting(zoneId, setting, value) {
    return this.request(`/zones/${zoneId}/settings/${setting}`, {
      method: 'PATCH',
      body: { value },
    });
  }

  async getSetting(zoneId, setting) {
    return this.request(`/zones/${zoneId}/settings/${setting}`);
  }
}

export default Cloudflare;
