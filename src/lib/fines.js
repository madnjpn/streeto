import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Georgian traffic-fines lookup.
 *
 * The public portal (https://protocols.ge) is a small React app that asks
 * the visitor for a car number and the technical passport number, then
 * calls its API (https://api.protocols.ge). Every call is protected by an
 * invisible reCAPTCHA v3 check, and the site key is locked to the
 * protocols.ge origin - a token minted anywhere else is rejected
 * ("reCAPTCHA verification failed").
 *
 * There is therefore no way to call the API from Node alone. Instead we
 * drive a real Chromium browser (Edge or Chrome, both shipped with
 * Windows) headlessly through the DevTools protocol: open protocols.ge,
 * let its own page mint a valid token, and ask it to perform the lookup.
 * The browser is launched per check and torn down afterwards.
 *
 * `BROWSER_PATH` can point at a specific browser executable; otherwise the
 * usual Windows/macOS/Linux locations are tried.
 */

const PORTAL_URL = 'https://protocols.ge/';
const API_BASE = 'https://api.protocols.ge';
const RECAPTCHA_KEY = '6LdJoBUqAAAAANzkPmnCW3N03N0k4UfVkNplFi3d';
const TIMEOUT_MS = Number(process.env.FINES_TIMEOUT_MS || 60000);

const candidates = () => [
  process.env.BROWSER_PATH,
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

/** Path to a usable Chromium browser, or null when none is installed. */
export function findBrowser() {
  for (const candidate of candidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export const isFinesAvailable = () => Boolean(findBrowser());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Plate lookups hit a public service; keep them serial so we never open
 *  two browsers at once. */
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(() => {}, () => {});
  return run;
}

async function readDevToolsPort(userDir, child) {
  const file = path.join(userDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('browser-exited');
    try {
      const [line] = fs.readFileSync(file, 'utf8').split('\n');
      const port = Number(line);
      if (port) return port;
    } catch {
      /* not written yet */
    }
    await sleep(120);
  }
  throw new Error('browser-start-timeout');
}

async function firstPageTarget(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* devtools not ready yet */
    }
    await sleep(150);
  }
  throw new Error('browser-page-timeout');
}

/** Minimal CDP client over the page target's websocket. */
async function openSession(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await withTimeout(new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('browser-socket-error'));
  }), 10000, 'browser-socket-timeout');

  let id = 0;
  const pending = new Map();

  const failPending = (message) => {
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  };

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'cdp-error'));
      else resolve(message.result);
    }
  };

  socket.onclose = () => failPending('browser-closed');
  socket.onerror = () => failPending('browser-socket-error');

  const send = (method, params) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error('browser-closed'));
      return;
    }
    id += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params: params || {} }));
  });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'evaluate-failed';
      throw new Error(text);
    }
    return result.result?.value;
  };

  return { socket, send, evaluate };
}

function buildExpression(plate, passport) {
  const endpoint = passport ? '/api/getByID' : '/api/getUnregisteredVehicle/';
  const request = passport
    ? `{ govNumber: ${JSON.stringify(plate)}, techPass: ${JSON.stringify(passport)}, page: 0, size: 30 }`
    : `{ govNumber: ${JSON.stringify(plate)}, page: 0, size: 30 }`;
  return `(async () => {
    const key = ${JSON.stringify(RECAPTCHA_KEY)};
    const token = await new Promise((resolve, reject) => {
      if (!window.grecaptcha || !window.grecaptcha.ready) return reject(new Error('recaptcha-not-loaded'));
      window.grecaptcha.ready(() => {
        window.grecaptcha.execute(key, { action: 'submit' }).then(resolve, reject);
      });
    });
    const response = await fetch(${JSON.stringify(API_BASE + endpoint)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign(${request}, { recaptchaToken: token })),
    });
    return { status: response.status, body: await response.text() };
  })()`;
}

/** Turn the API payload into the shape the view renders. */
function normalize(item) {
  const penalty = item.penalty || {};
  const tetri = (value) => (Number.isFinite(value) ? value : null);
  return {
    protocolNo: penalty.protocolNo ?? null,
    protocolId: penalty.protocolId ?? null,
    documentNo: penalty.documentNo ?? null,
    automobileNo: penalty.automobileNo ?? null,
    makeModel: penalty.makeModel ?? null,
    violationDate: penalty.violationDate ?? null,
    place: penalty.place ?? null,
    lawName: penalty.law?.name ?? null,
    lawDescription: penalty.law?.description ?? null,
    lawFullName: penalty.law?.fullName ?? null,
    amount: tetri(penalty.amount),
    amountToPay: tetri(penalty.amountToPay),
    discount: Boolean(penalty.discount),
    discountEndDate: penalty.discountEndDate ?? null,
    discountPercentage: penalty.discountPercentage ?? null,
    state: penalty.state ?? null,
    stateId: penalty.stateId ?? null,
    canPay: penalty.canPay ?? null,
    payable: penalty.canPay === 0,
    protocolOwnerId: item.protocolOwnerId ?? null,
    accessToken: penalty.accessToken ?? item.accessToken ?? null,
    ownerName: item.protocolOwnerName ?? null,
    note: item.note ?? null,
  };
}

/**
 * Launch a headless Chromium, open protocols.ge and run `work` with a CDP
 * session. The portal's own origin is what makes both the reCAPTCHA and
 * the payment API happy, so every call starts from this page.
 */
async function withPortal(work, { needCaptcha = false, timeoutMs = TIMEOUT_MS } = {}) {
  const exe = findBrowser();
  if (!exe) throw new Error('no-browser');

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streeto-fines-'));
  const child = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--mute-audio',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let session;
  let watchdog;
  try {
    // Hard stop: a stuck portal must not leave a browser running forever.
    watchdog = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    if (typeof watchdog.unref === 'function') watchdog.unref();

    const port = await readDevToolsPort(userDir, child);
    const wsUrl = await firstPageTarget(port);
    session = await openSession(wsUrl);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url: PORTAL_URL });

    // Wait until the portal (and, for lookups, its reCAPTCHA script) has loaded.
    const deadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < deadline) {
      const state = await session.evaluate('({ href: location.href, ready: document.readyState, captcha: typeof window.grecaptcha })');
      const captchaReady = !needCaptcha || state?.captcha === 'object';
      if (state && state.href.startsWith('https://protocols.ge') && state.ready === 'complete' && captchaReady) {
        ready = true;
        break;
      }
      await sleep(250);
    }
    if (!ready) throw new Error('portal-load-timeout');

    return await work(session);
  } finally {
    clearTimeout(watchdog);
    try {
      session?.socket?.close();
    } catch {
      /* already closed */
    }
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    setTimeout(() => fs.rm(userDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 }, () => {}), 800);
  }
}

async function runLookup(plate, passport) {
  return withPortal(async (session) => {
    const raw = await session.evaluate(buildExpression(plate, passport));
    if (!raw || typeof raw.body !== 'string') throw new Error('portal-empty-response');

    let payload;
    try {
      payload = JSON.parse(raw.body);
    } catch {
      throw new Error('portal-bad-response');
    }
    if (raw.status !== 200) {
      throw new Error(payload.message || (payload.error && payload.error.message) || `portal-error-${raw.status}`);
    }
    const content = Array.isArray(payload.content) ? payload.content : [];
    return { total: payload.total ?? content.length, fines: content.map(normalize) };
  }, { needCaptcha: true });
}

/** The service name protocols.ge expects for each protocol owner. */
export function serviceNameFor(ownerId) {
  switch (Number(ownerId)) {
    case 2:
    case 3:
      return 'TBPARK_PEN';
    case 4:
      return 'EMS_FINES';
    case 5:
      return 'BATUMI_PEN';
    case 6:
      return 'DES_PEN';
    case 9:
      return 'GPPENALTY';
    default:
      return 'PATROL';
  }
}

function buildPaymentExpression(fine, gateway) {
  const payload = {
    protocolNo: fine.protocolNo,
    vehicleNumber: fine.automobileNo,
    methodType: 1,
    paymentGateway: gateway,
    accessToken: fine.accessToken,
    serviceName: serviceNameFor(fine.protocolOwnerId),
  };
  // TBC needs the amount and payer's personal number; BOG derives both.
  if (gateway === 'TBC') {
    payload.amount = Number(fine.amountToPay) / 100;
    payload.personalNumber = fine.documentNo;
  }
  return `(async () => {
    const response = await fetch(${JSON.stringify(`${API_BASE}/api/getPaymentURL`)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify(payload))},
    });
    return { status: response.status, body: await response.text() };
  })()`;
}

/** Pull the bank URL out of the API's TBC (plain string) or BOG (JSON) reply. */
function extractPaymentUrl(status, body, gateway) {
  const expected = gateway === 'TBC' ? 200 : 201;
  if (status !== expected) throw new Error(`payment-http-${status}`);

  let url = String(body || '').trim();
  if (url.startsWith('{')) {
    try {
      url = JSON.parse(url).url;
    } catch {
      throw new Error('payment-bad-response');
    }
  } else if (url.startsWith('"')) {
    try {
      url = JSON.parse(url);
    } catch {
      throw new Error('payment-bad-response');
    }
  }
  if (!/^https:\/\//i.test(String(url || ''))) throw new Error('payment-bad-url');
  return url;
}

async function runPaymentUrl(fine, gateway) {
  if (!fine.accessToken) throw new Error('payment-token-missing');
  return withPortal(async (session) => {
    const raw = await session.evaluate(buildPaymentExpression(fine, gateway));
    if (!raw || typeof raw.body !== 'string') throw new Error('payment-empty-response');
    return extractPaymentUrl(raw.status, raw.body, gateway);
  }, { needCaptcha: false, timeoutMs: Math.min(TIMEOUT_MS, 45000) });
}

/** Normalise a plate to the portal's expected `CX316CX` form. */
export const normalizePlate = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Human-friendly text for a lookup failure code. */
export function describeError(code = '') {
  if (code === 'no-browser') return 'No Edge or Chrome browser was found on this computer.';
  if (/^browser-|^lookup-timeout/.test(code)) return 'The protocols.ge check did not finish in time. Please try again.';
  if (code === 'portal-load-timeout') return 'The protocols.ge portal did not load. Check the internet connection and try again.';
  if (/reCAPTCHA|recaptcha/i.test(code)) return 'The portal refused its security check. Please try again in a moment.';
  if (/validation/i.test(code)) return 'protocols.ge rejected the number plate or technical passport. Please check them in My Ride.';
  if (/portal-bad-response|portal-empty-response/.test(code)) return 'protocols.ge returned an unexpected answer. Please try again.';
  return 'Could not read fines from protocols.ge. Please try again later.';
}

/**
 * Look up the fines for one vehicle. A stuck portal is cut off after
 * TIMEOUT_MS (the browser is killed, which unblocks the lookup).
 */
export function lookupFines({ plate, passport } = {}) {
  const cleanPlate = normalizePlate(plate);
  const cleanPassport = String(passport ?? '').trim().toUpperCase();
  return enqueue(() => runLookup(cleanPlate, cleanPassport || null));
}

/**
 * Ask protocols.ge for a hosted checkout URL for one fine. This mirrors the
 * portal's own payment dialog: the access token returned with the fine is
 * enough, so the user only has to pick a bank. Queued with lookups so only
 * one headless browser is ever open.
 */
export function paymentUrl({ fine, gateway } = {}) {
  const code = String(gateway ?? '').toUpperCase();
  if (code !== 'TBC' && code !== 'BOG') return Promise.reject(new Error('payment-bad-gateway'));
  if (!fine || !fine.protocolNo || !fine.automobileNo) {
    return Promise.reject(new Error('payment-bad-fine'));
  }
  return enqueue(() => runPaymentUrl(fine, code));
}

/**
 * Liberty Bank is handled directly by protocols.ge: no API call and no
 * access token, just a hosted URL built from the protocol and vehicle.
 * This mirrors the portal's own Liberty branch.
 */
export function libertyPaymentUrl({ protocolNo, documentNo, automobileNo } = {}) {
  const protocol = String(protocolNo ?? '').trim();
  const vehicle = String(automobileNo ?? '').trim();
  const document = String(documentNo ?? '').trim();
  if (!protocol || (!vehicle && !document)) throw new Error('payment-bad-fine');

  const params = new URLSearchParams();
  params.set('lang', 'ka');
  params.set('providerId', '1');
  if (vehicle) {
    params.set('identityNumber', vehicle);
  } else if (/^\d{11}$/.test(document)) {
    params.set('personalNo', document);
  } else {
    params.set('documentId', document);
  }
  params.set('protocolNo', protocol);
  params.set('successUrl', 'https://protocols.ge');

  const errorParams = new URLSearchParams();
  errorParams.set('o.protocolId', protocol);
  errorParams.set('o.vehicleNumber', vehicle);
  errorParams.set('o.resourceAlias', 'LIBERTY');
  params.set('errorUrl', `https://protocols.ge?${errorParams.toString()}`);

  return `https://protocolspayments.lb.ge/Processing/MakePayment?${params.toString()}`;
}

/** Human-friendly text for a payment failure code. */
export function describePaymentError(code = '') {
  if (code === 'no-browser') return 'No Edge or Chrome browser was found on this computer.';
  if (code === 'payment-bad-gateway') return 'Choose TBC, Bank of Georgia or Liberty.';
  if (code === 'payment-bad-fine') return 'Check the fines again before paying.';
  if (code === 'payment-token-missing' || code === 'payment-http-401' || code === 'payment-http-403') {
    return 'The payment session has expired. Check the fines again and retry.';
  }
  if (/timeout|^browser-/.test(code)) return 'The bank took too long to respond. Please try again.';
  if (/payment-http-4\d\d/.test(code)) return 'protocols.ge rejected this payment. Check the fines again and retry.';
  if (/payment-(bad|empty)/.test(code)) return 'The bank returned an unexpected answer. Please try again.';
  return 'Could not open the bank payment page. Please try again.';
}

export default { lookupFines, isFinesAvailable, findBrowser, normalizePlate, paymentUrl, libertyPaymentUrl };
