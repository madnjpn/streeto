/**
 * Visual and accessibility gate for the web UI.
 *
 * Runs against a throwaway seeded database and a local Express instance.
 * Checks both phone (390x844) and desktop (1440x900) layouts for:
 *   - horizontal overflow
 *   - stretched avatars
 *   - actions pushed outside the viewport
 *   - missing images
 *   - serious/critical axe WCAG violations
 *
 * Run with: npm run ui:visual
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = path.join(ROOT, 'data', 'ui-visual.db');
const ARTIFACTS = path.join(ROOT, 'artifacts', 'ui');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = 'data/ui-visual.db';
process.env.UPLOAD_DIR = 'uploads-ui-visual';
process.env.BACKUP_DIR = 'data/backups-ui-visual';
process.env.SESSION_SECRET = 'ui-visual-check-only';
process.env.MEDIA_QUEUE_DISABLED = '1';
process.env.MAIL_CAPTURE = '1';

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
fs.rmSync(path.join(ROOT, 'uploads-ui-visual'), { recursive: true, force: true });
fs.rmSync(ARTIFACTS, { recursive: true, force: true });
fs.mkdirSync(ARTIFACTS, { recursive: true });

/* A tiny, believable dataset for every page. Run seed in a child process:
   it closes the SQLite handle when it finishes. */
const seeded = spawnSync(process.execPath, ['scripts/seed.js'], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
});
if (seeded.status !== 0) throw new Error('seed failed');
const { get, run } = await import('../src/db.js');
const { default: app } = await import('../src/app.js');
run("UPDATE users SET is_admin = 1 WHERE username = 'nightrider'");

const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const base = `http://127.0.0.1:${server.address().port}`;

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const axeSource = fs.readFileSync(axePath, 'utf8');
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const failures = [];
const completed = [];

const record = (page, viewport, message) => {
  const line = `${viewport} ${page}: ${message}`;
  failures.push(line);
  console.error(`  ✗ ${line}`);
};

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.type('input[name="login"]', 'nightrider');
  await page.type('input[name="password"]', 'street123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('form button[type="submit"]'),
  ]);
  await page.evaluate(() => {
    try {
      localStorage.setItem('onboardingSeen', '1');
      localStorage.setItem('streeto.notificationPromptAt', String(Date.now()));
    } catch {
      /* private mode */
    }
  });
}

async function auditLayout(page, route, viewport) {
  const result = await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const avatars = [...document.querySelectorAll('.avatar, .chatdock__avatar')]
      .filter(visible)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 10 && Math.abs(r.width - r.height) > 2;
      })
      .map((el) => rect(el));
    const buttons = [...document.querySelectorAll('.btn, .iconbtn')]
      .filter(visible)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && (r.left < -2 || r.right > innerWidth + 2);
      })
      .map((el) => ({ text: (el.innerText || '').trim().slice(0, 40), ...rect(el) }));
    const brokenImages = [...document.images]
      .filter((img) => img.complete && !img.naturalWidth)
      .map((img) => img.src);
    const hugeChecks = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
      .filter(visible)
      .filter((input) => {
        const r = input.getBoundingClientRect();
        return r.width > 28 || r.height > 28;
      })
      .map((input) => ({ name: input.name, ...rect(input) }));
    const tabbar = document.querySelector('[data-tabbar]');
    const tabbarInfo = tabbar && visible(tabbar)
      ? { items: tabbar.querySelectorAll('.tabbar__item').length, ...rect(tabbar) }
      : null;
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      avatars,
      buttons,
      brokenImages,
      hugeChecks,
      tabbar: tabbarInfo,
      h1: document.querySelector('h1')?.innerText || '',
    };
  });

  if (result.overflow > 1) record(route, viewport, `horizontal overflow ${result.overflow}px`);
  for (const avatar of result.avatars) record(route, viewport, `stretched avatar ${JSON.stringify(avatar)}`);
  for (const button of result.buttons) record(route, viewport, `action outside viewport ${JSON.stringify(button)}`);
  for (const image of result.brokenImages) record(route, viewport, `broken image ${image}`);
  for (const check of result.hugeChecks) record(route, viewport, `oversized checkbox/radio ${JSON.stringify(check)}`);
  if (viewport.startsWith('390px') && route !== '/login' && route !== '/register' && route !== '/install'
      && !route.startsWith('/notifications?') && result.tabbar && result.tabbar.items !== 5) {
    record(route, viewport, `bottom tab bar has ${result.tabbar.items} items`);
  }
  return result;
}

async function auditAxe(page, route, viewport) {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () =>
    window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    }),
  );
  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  for (const violation of serious) {
    record(route, viewport, `a11y ${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`);
  }
  return serious.length;
}

async function auditReducedMotion(page, viewport) {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const duration = await page.evaluate(() => {
    const el = document.querySelector('.btn') || document.querySelector('a');
    return el ? getComputedStyle(el).transitionDuration : '';
  });
  const seconds = Number.parseFloat(String(duration).replace('ms', 'e-3')) || 0;
  if (seconds > 0.01) record('/', `${viewport}-reduced-motion`, `transitions still run for ${duration}`);
  await page.emulateMediaFeatures([]);
}

async function visit(page, route, viewport) {
  try {
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const result = await auditLayout(page, route, viewport);
    const name = route === '/' ? 'wall' : route.replace(/^\/+/, '').replace(/[/?=&]+/g, '-');
    await page.screenshot({ path: path.join(ARTIFACTS, `${viewport.toLowerCase()}-${name}.png`), fullPage: false });
    await auditAxe(page, route, viewport);
    completed.push(`${viewport} ${route} (${result.h1 || 'no h1'})`);
  } catch (error) {
    record(route, viewport, `visit failed: ${error.message.split('\n')[0]}`);
  }
}

const guestRoutes = ['/login', '/register', '/explore', '/near', '/install'];
const authRoutes = [
  '/',
  '/builds',
  '/groups',
  '/meetups',
  '/services',
  '/garage/ride',
  '/garage/fines',
  '/settings',
  '/notifications',
  '/admin/style-guide',
  '/u/nightrider',
];

try {
  for (const dimensions of [
    { width: 390, height: 844, name: '390px' },
    { width: 1440, height: 900, name: '1440px' },
  ]) {
    console.log(`\n${dimensions.name}`);
    const guestContext = await browser.createBrowserContext();
    const guestPage = await guestContext.newPage();
    await guestPage.setViewport({
      width: dimensions.width,
      height: dimensions.height,
      deviceScaleFactor: 1,
      isMobile: dimensions.width < 700,
      hasTouch: dimensions.width < 700,
    });
    for (const route of guestRoutes) await visit(guestPage, route, dimensions.name);
    await guestContext.close();

    const authContext = await browser.createBrowserContext();
    const authPage = await authContext.newPage();
    await authPage.setViewport({
      width: dimensions.width,
      height: dimensions.height,
      deviceScaleFactor: 1,
      isMobile: dimensions.width < 700,
      hasTouch: dimensions.width < 700,
    });
    await login(authPage);
    await auditReducedMotion(authPage, dimensions.name);
    for (const route of authRoutes) await visit(authPage, route, dimensions.name);

    const routeId = get(
      "SELECT id FROM meetups WHERE category = 'touge' AND privacy = 'open' AND route_start_lat IS NOT NULL ORDER BY id DESC LIMIT 1",
    )?.id;
    if (routeId) await visit(authPage, `/routes/${routeId}`, dimensions.name);

    // Long Georgian strings are part of the design contract too.
    await authPage.goto(`${base}/lang/ka`, { waitUntil: 'domcontentloaded' });
    for (const route of ['/', '/near', '/settings', '/builds', '/groups', '/meetups', '/services', '/notifications', '/admin/style-guide']) {
      await visit(authPage, route, `${dimensions.name}-ka`);
    }
    if (routeId) await visit(authPage, `/routes/${routeId}`, `${dimensions.name}-ka`);
    await authContext.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${completed.length} page/viewport combinations checked.`);
if (failures.length) {
  console.error(`\n${failures.length} UI issue(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('UI visual + accessibility check passed.');
}
