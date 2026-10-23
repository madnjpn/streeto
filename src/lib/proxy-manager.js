/**
 * Free Proxy Manager
 *
 * Manages a pool of free HTTP/HTTPS proxies from multiple sources.
 * Used as fallback when RockAuto blocks our direct IP.
 */

import freeProxy from 'free-proxy';
import Proxifly from 'proxifly';

const PROXIFLY_CDN = 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main';

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.proxifly = new Proxifly({ apiKey: process.env.PROXIFLY_API_KEY });
    this.lastFetch = 0;
    this.fetchInterval = 10 * 60 * 1000; // 10 minutes
  }

  /** Fetch proxies from free-proxy-list.com */
  async fetchFromFreeProxy() {
    try {
      const proxyList = new freeProxy.ProxyList();
      // Add timeout to prevent hanging
      const proxies = await Promise.race([
        proxyList.get(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);
      return proxies
        .filter(p => p.protocol === 'https' || p.protocol === 'http')
        .map(p => ({
          host: p.ip,
          port: p.port,
          protocol: p.protocol,
          country: p.country,
          source: 'free-proxy-list'
        }));
    } catch (e) {
      console.warn('[proxy] free-proxy-list fetch failed:', e.message);
      return [];
    }
  }

  /** Fetch proxies from Proxifly CDN (no API key needed, 80k+ proxies updated every 5 min) */
  async fetchFromProxiflyCDN() {
    try {
      // Fetch HTTP proxies from Proxifly's CDN (updated every 5 minutes)
      const url = `${PROXIFLY_CDN}/proxies/protocols/http/data.txt`;
      const res = await Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const text = await res.text();
      return text
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [host, port] = line.trim().split(':');
          return {
            host: host.trim(),
            port: parseInt(port.trim(), 10),
            protocol: 'http',
            country: 'unknown',
            source: 'proxifly-cdn'
          };
        })
        .filter(p => p.host && p.port && !isNaN(p.port));
    } catch (e) {
      console.warn('[proxy] Proxifly CDN fetch failed:', e.message);
      return [];
    }
  }

  /** Fetch proxies from Proxifly (requires API key for higher limits) */
  async fetchFromProxifly() {
    if (!this.proxifly) return [];
    try {
      const proxy = await Promise.race([
        this.proxifly.getProxy({
          protocol: 'http',
          anonymity: 'elite',
          country: 'US',
          https: true,
          format: 'json',
          quantity: 20
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);
      return Array.isArray(proxy) ? proxy : [proxy].map(p => ({
        host: p.ip,
        port: p.port,
        protocol: p.protocol || 'http',
        country: p.country,
        source: 'proxifly'
      }));
    } catch (e) {
      console.warn('[proxy] Proxifly fetch failed:', e.message);
      return [];
    }
  }

  /** Fetch and validate proxies */
  async refresh() {
    const now = Date.now();
    if (now - this.lastFetch < this.fetchInterval && this.proxies.length > 0) {
      return this.proxies;
    }

    console.log('[proxy] Refreshing proxy list...');
    
    // Add overall timeout for the entire refresh operation
    const [freeProxies, proxiflyProxies, cdnProxies] = await Promise.race([
      Promise.all([
        this.fetchFromFreeProxy(),
        this.fetchFromProxifly(),
        this.fetchFromProxiflyCDN()
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Refresh timeout')), 20000))
    ]);

    const all = [...freeProxies, ...proxiflyProxies, ...cdnProxies];
    
    // Basic validation - test a few
    this.proxies = await this.validateProxies(all.slice(0, 15));
    this.lastFetch = Date.now();
    
    console.log(`[proxy] Loaded ${this.proxies.length} working proxies (free: ${freeProxies.length}, proxifly: ${proxiflyProxies.length}, cdn: ${cdnProxies.length})`);
    return this.proxies;
  }

  /** Quick validation of proxies */
  async validateProxies(proxies) {
    const working = [];
    for (const proxy of proxies) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        const url = `http://httpbin.org/ip`;
        const res = await fetch(url, {
          signal: controller.signal,
          agent: this.getAgent(proxy)
        });
        
        clearTimeout(timeout);
        if (res.ok) {
          working.push(proxy);
          console.log(`[proxy] Valid: ${proxy.host}:${proxy.port} (${proxy.country})`);
        }
      } catch (e) {
        // Proxy failed, skip
      }
    }
    return working;
  }

  /** Get a Node.js agent for the proxy */
  getAgent(proxy) {
    const { URL } = require('url');
    const { HttpProxyAgent, HttpsProxyAgent } = require('http-proxy-agent');
    
    const proxyUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
    return proxy.protocol === 'https' 
      ? new HttpsProxyAgent(proxyUrl)
      : new HttpProxyAgent(proxyUrl);
  }

  /** Get a random working proxy */
  getRandomProxy() {
    if (this.proxies.length === 0) return null;
    return this.proxies[Math.floor(Math.random() * this.proxies.length)];
  }

  /** Get all working proxies */
  getAllProxies() {
    return this.proxies;
  }
}

export default new ProxyManager();