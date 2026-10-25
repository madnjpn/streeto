# STREETO

**STREETO.NET** is a street-car community: a wall, crews, chat, meetups, a
builds garage, a parts/maintenance marketplace, and an Android app. It runs as
one Node.js process with a SQLite database, server-rendered EJS pages, and
vanilla ES-module JavaScript. There is no frontend build step.

Live site: **https://streeto.net**  
Repository: **https://github.com/madnjpn/streeto** (public, branch `main`)

> **Taking over?** Read this file, then
> [`android/README.md`](android/README.md) and
> [`src/lib/changelog.js`](src/lib/changelog.js). The *Quick start* and
> *Release process* sections are the shortest path to a working site and a
> safe release.

**Current in this tree:** web `1.6.0` (`package.json`), Android `1.3.3`
(`versionCode 12`, `android/app/build.gradle.kts`). These are the sources of
truth; `GET /api/app/version` reports what the live server is serving.

---

## Contents

1. [What this is](#1-what-this-is)
2. [Quick start](#2-quick-start)
3. [Architecture](#3-architecture)
4. [Configuration](#4-configuration)
5. [Development guide](#5-development-guide)
6. [Database, storage and backups](#6-database-storage-and-backups)
7. [Routes and API](#7-routes-and-api)
8. [Frontend and translations](#8-frontend-and-translations)
9. [Android app](#9-android-app)
10. [Release process](#10-release-process)
11. [Testing](#11-testing)
12. [Going live behind Cloudflare](#12-going-live-behind-cloudflare)
13. [Operations runbook](#13-operations-runbook)
14. [Security and secrets](#14-security-and-secrets)
15. [Troubleshooting](#15-troubleshooting)
16. [Known limitations](#16-known-limitations)
17. [Handover checklist](#17-handover-checklist)
18. [Where to change what](#18-where-to-change-what)
19. [Conventions and definition of done](#19-conventions-and-definition-of-done)

---

## 1. What this is

| Area | What it does |
| --- | --- |
| **Wall** | Text, photo, video, location-pin and SOS posts, likes, threaded comments, polls, tags, reports. `Everyone` / `My crew` scopes. |
| **Builds** | Car spec sheets with up to 8 photos/clips, public/private garages, weekly voting, derived Build of the Week/Month/Year awards, timeline, watchers, for-sale flag. |
| **People** | Search by username/name/city/car, friend requests, suggestions, presence dots. |
| **Chat** | One global channel plus 1:1 threads, attachments, edits, reactions, replies, search, delete-for-me, and per-chat mute (swipe right; delete is swipe left, mouse drag works). Polling every 3 s; Socket.IO for typing/presence. |
| **Notifications** | In-app activity feed + badges, browser Web Push, and near-realtime Android FCM. Messages, friend requests, comments, likes, invites and meetups; muted chats stay quiet. |
| **Crews** | Open/private/invite-only groups, roles, join requests, invites, crew wall, crew meetups, shared items. |
| **Underground** | Closed invite-only drag, drift and touge nights; host approves each car, live map with speed badges, virtual race lock screen, 3D GPS runs and emailed summaries. |
| **Meetups** | Open/private/invite-only events, capacity/maybe, invites, GPS or street search, directions, Touge route A/B, elevation, 3D preview, saved camera view, weather forecast. |
| **Services** | Parts marketplace, maintenance/service listings, reviews, claims, provider badges. |
| **Garage** | My Ride vehicles, registration certificate photos/OCR, technical-inspection status, odometer, fines lookup, photo upload. |
| **Parts** | RockAuto-backed vehicle/part search, VIN decoding, garage-aware fits, translated catalogue groups/types. |
| **Admin** | Users/content moderation, reports, backups/restore, translations, how-it-works editor, partners, service claims, custom fonts, mail jobs. |
| **Android** | A thin WebView shell for the live site with camera/GPS/upload/back-button support, an in-app update checker/downloader, and a signed release APK served only from this website. |

Every user-facing string is translatable; English is the source language and
fallback, and a full Georgian dictionary ships in `src/lib/locales/ka.js`.
The site is designed for phones first and scales to a desktop layout.

---

## 2. Quick start

### 2.1 Development (no Cloudflare, no TLS)

Requirements:

- **Node.js 22.5+** — the app uses the built-in `node:sqlite`. Node 24 or 26
  is recommended. Early Node 22.x may print an `ExperimentalWarning` for
  `node:sqlite`; that is not an error.
- npm (the lockfile is committed).
- No C++ compiler is needed; `sharp` installs prebuilt binaries.

```bash
git clone https://github.com/madnjpn/streeto.git
cd streeto
npm ci
npm run seed          # demo data; skips if users already exist
node server.js        # development defaults: http://localhost:3000
```

Open **http://localhost:3000**.

`node server.js` without `.env.production` runs in development with a local
fallback session secret, plain HTTP, `data/streeto.db`, and `uploads/`. It
loads a `.env` file if one exists (see [Configuration](#4-configuration)).

Demo accounts created by `npm run seed` all use password **`street123`**:

`nightrider`, `burnout_bex`, `kev_boost`, `sara_drift`, `tomas_diesel`,
`mika_gtr`, and `admin` (the seeded admin). These are demo credentials — never
leave them active on a real installation.

Useful first checks:

```bash
npm run smoke          # full end-to-end suite against a scratch DB
npm run admin          # list admins
npm run admin -- create myname 'a long password' me@example.com
```

To reset a development database, stop the server and delete
`data/streeto.db`, `data/streeto.db-wal`, `data/streeto.db-shm`, then run
`npm run seed`. `npm run seed -- --fresh` wipes and re-seeds the demo tables.

### 2.2 Production

Production uses **`.env.production`** and `npm start`:

```bash
npm ci --omit=dev
npm run golive          # writes .env.production, TLS, Cloudflare, services
npm start               # node --env-file=.env.production server.js
```

`npm start` **requires `.env.production`**; a fresh clone does not have one.
`npm run golive` is the supported way to create it, or copy `.env.example` and
fill in the production values manually. See
[Going live](#12-going-live-behind-cloudflare).

On Windows, `go-live.bat` starts the Cloudflare Tunnel and the server in the
foreground without installing services.

### 2.3 Verify it is alive

```bash
curl -k https://localhost/api/health          # local (self-signed cert)
curl https://streeto.net/api/health           # public
curl https://streeto.net/api/app/version      # web + Android versions
npm run prodcheck                             # config/certs/ports/storage checks
```

---

## 3. Architecture

```
Browser / Android WebView
        |
        | HTTPS (Cloudflare Tunnel in production)
        v
    Node.js process  ── EJS HTML ── public/css + public/js (ES modules)
        |
        ├── Express 5 (src/app.js)
        ├── node:sqlite (src/db.js, WAL) ── data/streeto.db
        ├── uploads/ + sharp image variants
        ├── Socket.IO (typing, presence)
        └── external helpers:
              Nominatim (geocode, proxied)
              OpenFreeMap/MapLibre (maps, no key)
              OSRM (route distance/elevation)
              pti.ge (technical inspection)
              protocols.ge via headless Edge/Chrome (fines)
              Google Gemini (certificate OCR, optional)
              Firebase Cloud Messaging (Android push, optional)
              RockAuto via reader or Python FastAPI service (parts, optional)
```

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node.js 22.5+ | `node:sqlite` means no native DB compilation. |
| HTTP | Express 5 | Small, stable, no framework build step. |
| Views | EJS server-rendered HTML | The HTML is the app; JS only enhances it. |
| Client | Vanilla ES modules | No bundler, no framework, no build step. |
| DB | SQLite via `node:sqlite` | One file, WAL, easy backups, enough for one server. |
| Passwords | scrypt (`node:crypto`) | No bcrypt/argon native dependency. |
| Maps | MapLibre GL + OpenFreeMap | No map API key. Vector tiles with 3D buildings. |
| Uploads | multer + sharp + ffmpeg-static | MIME allowlist, random names, responsive image variants, video posters. |
| Realtime | Socket.IO + polling | Typing/presence now; chat still polls for reliability. |
| Mail | nodemailer (Gmail SMTP) | Password resets and scheduled letters; can capture locally. |
| Push | web-push (VAPID) + Firebase Cloud Messaging | Browser notifications and near-realtime Android alerts. |
| Android | Java WebView shell | The web app stays the single product. |

### Design rules

- **Server-rendered first.** Every action also works as a plain form post.
- **English source strings are translation keys.** A missing Georgian string
  falls back to English instead of breaking a template.
- **Migrations are append-only.** Each `.sql` file runs once and is recorded in
  `_migrations`.
- **Secrets live in env files or GitHub Secrets.** Nothing sensitive belongs in
  source.
- **Asset URLs are stamped.** Use the `asset()` helper / `assetStamp` in
  templates; never hard-code `/js/...` in views.
- **One server.** SQLite and in-memory rate limits assume a single Node process.

### Request flow

1. `server.js` loads config, applies migrations, starts backups/mail/PTI jobs,
   starts HTTPS/HTTP listeners and Socket.IO.
2. `src/app.js` applies security headers, body parsing, sessions, CSRF,
   translations, theme/currency, static assets, then routes.
3. A route reads/validates input, calls a model (`src/models/*`), and renders an
   EJS view through `res.page()` (layout + page + locals).
4. Browser modules in `public/js` add interactivity and call `/api/*` or form
   endpoints with the CSRF header.

### Directory map

```
streeto/
├─ server.js                    HTTPS/HTTP listeners, Socket.IO, startup jobs
├─ package.json                 scripts + dependencies (no devDependencies)
├─ .env.example                 complete environment template
├─ .env / .env.production       local/production secrets (git-ignored)
├─ README.md                    this handover document
├─ go-live.bat                  Windows foreground tunnel + server
├─ src/
│  ├─ app.js                    Express app, middleware, static assets, routes
│  ├─ config.js                 env loading/validation
│  ├─ db.js                     node:sqlite handle, helpers, migration runner
│  ├─ migrations/*.sql          append-only schema history (37 files)
│  ├─ models/                   users, posts, groups, chat, builds, meetups,
│  │                            vehicles, parts, maintenance, notifications,
│  │                            partners, push, translations, appearance...
│  ├─ routes/                   auth, wall, profile, friends, chat, builds,
│  │                            services, garage, groups, meetups, api, pages...
│  ├─ middleware/               auth, CSRF, rate limits
│  └─ lib/                      i18n, uploads, mail, push, backup, PTI, fines,
│                               geocode, RockAuto, OCR, maps, VIN, etc.
├─ views/                       EJS layout, partials, one folder per area
├─ public/
│  ├─ css/style.css             the full design system (themes, responsive)
│  ├─ js/*.js                   browser ES modules
│  ├─ sw.js                     push-notification service worker (no asset cache)
│  └─ downloads/                STREETO-android.apk (git-ignored artifact)
├─ android/                     signed WebView app (see android/README.md)
│  └─ signing/                  local keystore backup (git-ignored)
├─ .github/workflows/android.yml  signed APK build
├─ rockauto-service/            optional Python FastAPI parts service
├─ scripts/                     seed, admin, smoke, cert, golive, prodcheck,
│                               DDNS, image/upload maintenance
├─ data/                        SQLite DB + backups (git-ignored)
├─ uploads/                     user media (git-ignored)
├─ certs/                       TLS certs/keys (git-ignored)
└─ node_modules/                dependencies (git-ignored)
```

### Deployment and Git model

- `main` is the production branch. Keep it deployable.
- **Pushing to GitHub does not deploy the website.** The only workflow is the
  Android APK build. The live Node process must be updated/restarted on the
  host (see [Operations](#13-operations-runbook)).
- The live site runs from this project directory on one machine, behind the
  Cloudflare Tunnel. There is no separate build server.
- Web deploy: update the working tree (`git pull` or copy the changed files),
  run `npm ci --omit=dev` if dependencies changed, restart the Node process.
- Android deploy: build via GitHub Actions and copy the signed APK to
  `public/downloads/STREETO-android.apk`.
- CI runs `npm run smoke` only if you add it to a workflow; the local smoke
  suite is the gate before deploying.

### Project-local runtime assets

The project is self-contained after `npm ci`:

- **ffmpeg** — `ffmpeg-static` installs the binary under
  `node_modules/ffmpeg-static`; no machine-wide ffmpeg or Desktop folder is
  required. `FFMPEG_PATH` is only an optional override.
- **Firebase server key** — `firebase-service-account.json` at the project root
  (git-ignored).
- **Android client config** — `android/app/google-services.json` (tracked).
- **Android signing key** — `android/signing/` (git-ignored).
- **TLS / data / uploads / backups** — `certs/`, `data/`, `uploads/`
  (git-ignored).

Do not point the app at files outside this folder; copy them in instead.

---

## 4. Configuration

### 4.1 How env files are loaded

- **Production:** `npm start` passes `--env-file=.env.production`. `NODE_ENV`
  must be `production`, `SESSION_SECRET` is required (min 16 chars; 32+
  recommended), and a TLS certificate must exist.
- **Development:** `node server.js` runs with `NODE_ENV=development` by default.
  `src/config.js` loads `.env` if it exists (but **not** `.env.production`).
  The session secret falls back to a dev-only value; cookies are not `Secure`,
  so plain HTTP works.
- **Tests:** `npm run smoke` sets `NODE_ENV=test` and a scratch database; it
  never loads production secrets.
- `.env` and `.env.production` are git-ignored. `.env.example` is the only
  tracked env file.

### 4.2 Complete environment reference

#### Server / TLS

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables secure cookies and requires TLS/secret. |
| `HOST` | `0.0.0.0` | Listen address. |
| `PORT` | `3000` | Listening port (`443` in production, HTTPS when certs exist). |
| `HTTP_PORT` | `0` | Plain HTTP redirect port (`80` in production); `0` disables. |
| `SITE_NAME` | `STREETO` | Brand name in UI/titles. |
| `PUBLIC_URL` | – | Public origin, e.g. `https://streeto.net`; used for absolute links and the HTTPS redirect target. |
| `TRUST_PROXY` | on in production | Trust one `X-Forwarded-*` hop (Cloudflare/Tunnel). |
| `SESSION_SECRET` | dev fallback | Signs session/CSRF state. **Required in production**; 32+ random chars. |
| `SESSION_MAX_AGE_MS` | 30 days | Login lifetime. |
| `CERT_DIR` | `certs` | TLS folder. `origin.pem` + `origin-key.pem` win over `cert.pem` + `key.pem`. |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### Storage / uploads / backups

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_PATH` | `data/streeto.db` | SQLite file (WAL mode). |
| `UPLOAD_DIR` | `uploads` | Uploaded photos/videos. |
| `UPLOAD_URL` | `/uploads` | Public URL prefix for media. |
| `MAX_UPLOAD_MB` | `25` | Per-file upload limit. |
| `FFMPEG_PATH` | bundled `ffmpeg-static` | Optional override for video poster extraction. |
| `BACKUP_DIR` | `data/backups` | Database snapshots. |
| `BACKUP_INTERVAL_MS` | 6 hours | Automatic snapshot interval; `0` disables. |
| `BACKUP_KEEP` | `24` | Automatic snapshots kept (manual ones are never pruned). |
| `USD_TO_GEL` | `2.7` | Reference rate for GEL/USD price display. |

#### Mail (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAIL_HOST` | `smtp.gmail.com` | SMTP host. |
| `MAIL_PORT` | `465` | SMTP port. |
| `MAIL_SECURE` | `1` | TLS. |
| `MAIL_USER` | – | Gmail address. |
| `MAIL_PASS` | – | **Google App Password** (not the account password). Without it, resets are disabled. |
| `MAIL_FROM` | `STREETO <streeto.official@gmail.com>` | From header. |
| `MAIL_REPLY_TO` | – | Optional reply-to. |
| `MAIL_RESET_MINUTES` | `60` | Reset-link lifetime. |
| `MAIL_CAPTURE` | `0` | Write letters to `data/mail-capture/` instead of sending (dev/testing). |

#### Web push (optional)

| Variable | Purpose |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Public VAPID key (`npx web-push generate-vapid-keys`). |
| `VAPID_PRIVATE_KEY` | Private VAPID key. **Secret.** |
| `VAPID_SUBJECT` | Contact URI, e.g. `mailto:admin@streeto.net`. |

Without these, browser push is simply disabled.

#### Firebase Cloud Messaging (Android, optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | `firebase-service-account.json` | Server service-account JSON, git-ignored. |
| `FIREBASE_SERVICE_ACCOUNT` | – | Raw JSON or base64 service account instead of the file. **Secret.** |

The Android client config is `android/app/google-services.json` (tracked; it is
client configuration, not a server secret). Without a service account FCM is
disabled and the app falls back to the in-app activity feed.

#### External lookups (optional features)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PTI_LOOKUP` | `on` | pti.ge annual-inspection lookup. |
| `PTI_BASE_URL` | `https://pti.ge/` | Override for tests/proxies. |
| `PTI_TIMEOUT_MS` | `4000` | Lookup timeout. |
| `PTI_REFRESH_HOURS` | `24` | Refresh stored inspection after this long. |
| `PTI_SCAN_HOURS` | `24` | Background sweep for all members. |
| `BROWSER_PATH` / `CHROME_PATH` / `EDGE_PATH` | auto-detect | Browser used for the fines lookup. |
| `FINES_TIMEOUT_MS` | `60000` | Fines lookup timeout. |
| `GEMINI_API_KEY` | – | Google Gemini key for certificate OCR. **Secret.** |
| `GEMINI_MODEL` | `gemini-2.5-flash` | OCR model; fallbacks are built in. |
| `GEMINI_TIMEOUT_MS` | `60000` | OCR timeout. |
| `ROCKAUTO_SERVICE_URL` | – | Use the Python RockAuto service (e.g. `http://localhost:8001`). |
| `ROCKAUTO_READER` | `https://r.jina.ai/` | Reader that fetches RockAuto pages. |
| `JINA_API_KEY` | – | Optional reader API key. |
| `PROXIFLY_API_KEY` | – | Optional proxy pool for parts requests. |
| `ROUTE_API` | public OSRM | Driving-route service used for distance/elevation. |

#### Cloudflare (production)

| Variable | Purpose |
| --- | --- |
| `CF_API_TOKEN` | Token used by `npm run golive` / DDNS. Needs Tunnel, DNS, Zone Settings, SSL, Zone Read permissions. **Secret.** |
| `CF_ZONE_ID` | Zone ID (DDNS). |
| `CF_DNS_NAME` | DNS record for DDNS (e.g. `streeto.net`). |
| `CF_DNS_TYPE` | `A` (default). |
| `CF_TUNNEL_TOKEN` | Written by `npm run golive`; used by `go-live.bat`. **Secret.** |
| `CF_DDNS_INTERVAL_MS` | DDNS watch interval (`300000`). |
| `EXTRA_HOSTS` | Extra hostnames for the local self-signed cert (`npm run cert`). |

See [`.env.example`](.env.example) for a ready-to-copy template.

---

## 5. Development guide

### 5.1 Run the app

```bash
npm ci
npm run seed                 # optional, but makes the UI non-empty
node server.js               # http://localhost:3000
```

- `npm start` is the **production** command and requires `.env.production`.
- `node server.js` uses `.env` if present. Do not put `NODE_ENV=production` in
  `.env` unless you also have a cert and a real secret.
- For local HTTPS: `npm run cert` creates `certs/cert.pem` + `certs/key.pem`;
  the server then serves HTTPS (browser warning is expected).
- Change the port with `PORT=3001 node server.js` (PowerShell:
  `$env:PORT=3001; node server.js`).
- `npm run smoke` starts its own app on a random port; you do not need the dev
  server running.

### 5.2 Demo data and admin accounts

`npm run seed` creates six demo drivers and an admin, with realistic posts,
groups, chats, builds and meetups. It skips if users already exist; use
`--fresh` to wipe and re-seed. All demo passwords are `street123`.

For a real admin (production), use the CLI instead of seed:

```bash
npm run admin                            # list admins
npm run admin -- create <user> [pass] [email]
npm run admin -- promote <username>
npm run admin -- revoke <username>
```

If no password is supplied, one is generated and printed once. Change the
seeded `admin` password (or delete the demo admin) before going live.

`npm run admin` normally uses the development DB (`.env`/defaults). To manage
the **production** database, pass the production env file explicitly:

```bash
node --env-file=.env.production scripts/admin.js create myname 'a long password' me@example.com
node --env-file=.env.production scripts/admin.js list
```

### 5.3 Add a feature end-to-end

A typical feature touches these layers:

1. **Schema** — add `src/migrations/039_short_name.sql`. Never edit an applied
   migration. The server applies it on next start.
2. **Model** — add query functions in the relevant `src/models/*.js`. Use
   `run/get/all/tx` from `src/db.js`; never build SQL with user input.
3. **Route** — add a handler in `src/routes/*.js`. Validate server-side, use
   `requireAuth`/`verifyCsrf` as appropriate, and render with `res.page()`.
4. **View** — add or extend an EJS file under `views/`. Use `t('English key')`
   for text and `asset('js/...')` for scripts.
5. **Client** — add a module under `public/js/` if interactivity is needed; it
   is loaded from the layout/page script list.
6. **Translations** — add the key to `src/lib/locales/ka.js` (and
   `src/lib/client-strings.js` if the browser calls `t()`).
7. **Tests** — add a `check(...)` block to `scripts/smoke.js`.
8. **Release notes** — add a changelog entry if users will notice it.

### 5.4 Add a page or API endpoint

- **Page:** create `views/<area>/<page>.ejs`, a route that calls
  `res.page('<area>/<page>', locals)`, and a nav link if it belongs in the
  main navigation (`views/partials/nav.ejs`).
- **API:** add to `src/routes/api.js` (mounted at `/api`). Return JSON with
  `jsonOk`/`jsonError`, set `Cache-Control` when needed, and add a rate limiter
  for anything expensive or external. GET endpoints are public unless wrapped
  in `requireAuth`; state-changing form posts use CSRF.

### 5.5 Asset casting

`src/app.js` computes a short hash of every file in `public/js` and
`public/css`. Layouts load `/assets/<stamp>/js/app.js` etc., so browsers can
cache modules for a year and still get a new file immediately after a change.
The stamp is refreshed at most every 30 seconds.

- Use `<%= asset('js/foo.js') %>` (or the stamped `assetStamp` pattern) in
  templates.
- Do not hard-code `/js/foo.js`; the smoke test checks for that.
- Static file changes do **not** require a server restart.

### 5.6 Debugging

- Server errors are logged by the Express error handler; run in the foreground
  to see them.
- The browser console/network tab is the first stop for client modules.
- `GET /api/health` confirms the process, DB and routes are up.
- Use a throwaway DB (`DB_PATH=data/debug.db`) for risky experiments.
- `npm run smoke` is the fastest regression check.

---

## 6. Database, storage and backups

### 6.1 Schema overview

SQLite, WAL mode, `foreign_keys=ON`, `busy_timeout=5000`. The schema is built
by `src/migrations/*.sql` and recorded in `_migrations`.

| Domain | Main tables |
| --- | --- |
| Accounts | `users`, `sessions`, `password_resets` |
| Social | `posts`, `post_likes`, `comments`, `comment_reactions`, `post_tags`, `polls`, `poll_options`, `poll_votes`, `reports` |
| Friends | `friendships` |
| Crews | `groups`, `group_members` |
| Chat | `conversations`, `conversation_members`, `messages`, `message_reactions` |
| Builds | `builds`, `build_media`, `build_votes`, `build_awards`, `build_watchers`, `build_timeline` |
| Meetups | `meetups`, `meetup_attendees` |
| Underground | `underground_events`, `underground_requests`, `underground_runs`, `underground_positions` |
| Garage | `vehicles`, `vehicle_maintenance` |
| Services/parts | `parts`, `part_photos`, `services`, `service_reviews`, `service_claims`, `partners` |
| Activity | `notifications`, `push_subscriptions`, `device_tokens`, `mail_log` |
| Content/i18n | `translations`, `how_sections`, `how_blocks`, `settings`, `custom_fonts` |
| Media | `upload_variants` |
| Runtime | `config`, `_migrations` |

`conversations.kind` is `dm` or `global`. The global channel is created by
migration 002 and every new account joins it; it cannot be deleted. Build
votes are one-per-driver-per-ISO-week; awards are derived, not hand-written.

### 6.2 Migrations

- Add a new file; never modify a file already applied on a live database.
- Filenames sort lexicographically (`039_...sql` next).
- On boot, `migrate()` applies new files in one transaction each and records
  the filename.
- `_migrations` is deliberately excluded from backup restores so the schema is
  never rolled backwards.
- Start the server after adding a migration; no separate migrate command.

### 6.3 Backups

- Automatic snapshots every 6 hours (`BACKUP_INTERVAL_MS`) into
  `data/backups`, keeping the newest 24 (`BACKUP_KEEP`). Manual snapshots are
  never auto-pruned.
- Snapshots use SQLite `VACUUM INTO`, so they are consistent even while the
  app is writing.
- Admin console → Backups can create, download, restore, and delete snapshots.
  Restore swaps table data in place inside a transaction and leaves `sessions`
  and `_migrations` alone, so the admin stays logged in.
- Copy `data/backups/` off the machine regularly. A backup on the same disk is
  not a disaster-recovery plan.
- Do not copy `data/streeto.db` while the server is running; use the backup
  mechanism or stop the server first (WAL data lives in `-wal`).
- Restore on a new machine: stop the server, replace `data/streeto.db` with the
  backup (remove any `-wal`/`-shm` files), restore `uploads/`, then start. Or
  start with an empty DB and use **Admin → Backups → Restore** once the app is
  running. Always take a fresh backup before a restore.

### 6.4 Uploads and maintenance scripts

Uploads live in `uploads/` with random filenames and a strict MIME allowlist.
`sharp` writes responsive variants recorded in `upload_variants`.

| Script | Use |
| --- | --- |
| `node scripts/build-image-variants.mjs` | Generate missing image variants. |
| `node scripts/prune-orphan-uploads.mjs` | Find/remove files no row references. |
| `node scripts/reorganise-uploads.mjs` | Move uploads into the current layout. |
| `node scripts/repair-upload-paths.mjs` | Fix stored paths after a move. |
| `node scripts/partner-logos.mjs` | Import/normalise partner logos. |
| `node scripts/restore-partner-logo.mjs` | Restore a partner logo. |
| `node scripts/parts-keys.mjs` | Regenerate part-catalogue translation keys. |
| `npm run posters` | Generate missing video thumbnails (`ffmpeg-static`). |

Run maintenance scripts with the server stopped or during a quiet period, and
take a DB backup first. Do not delete uploads by hand.

### 6.5 Video posters

`ffmpeg-static` is installed with npm, so the binary lives inside
`node_modules/ffmpeg-static` and the project has no external ffmpeg
dependency. A video upload is written to disk and a durable `media_jobs` row
is queued. The HTTP response finishes immediately; the background worker:

1. converts the video to a browser-safe **H.264/AAC MP4** (max 720 px wide,
   fast-start),
2. moves every database reference from the original extension to the MP4,
3. extracts a **WebP poster** at ~1 s,
4. marks the job done. Interrupted jobs are recovered on the next boot;
   `GET /api/health` reports queue counts.

The player (`public/js/video.js`) also plays a 2.6 s **muted hover preview** on
desktop; mobile opens on tap. `preload="metadata"` gets the duration without
downloading the whole clip until playback.

- Backfill existing videos: `npm run posters`.
- The poster path is derived from the video path; no extra database column.
- The queue uses one worker per Node process; keep the one-server deployment.
- Deleting a video removes its poster and any pending job becomes a no-op.
- `prune-orphan-uploads.mjs` keeps posters that belong to a referenced video.
- Optional override: set `FFMPEG_PATH` in the environment.
- If your npm policy blocks package install scripts, approve `ffmpeg-static`
  (or provide `FFMPEG_PATH`) so the bundled binary is present.

---

## 7. Routes and API

### 7.1 Page areas

| Path | Area |
| --- | --- |
| `/` | Wall (feed, composer, posts) |
| `/builds` | Builds garage, voting, awards |
| `/groups` | Crews, membership, crew wall |
| `/meetups` | Meetups, Touge routes, weather |
| `/underground` | Closed host-approved drag/drift/touge nights, live map, race mode and My Underground |
| `/services` | Parts marketplace + maintenance |
| `/chat` | Global channel and DMs |
| `/garage`, `/garage/ride`, `/garage/fines` | My Ride and Fines (`/garage` redirects to My Ride) |
| `/people`, `/friends` | Drivers, friend requests |
| `/settings` | Profile, theme, letters, app updates/changes, password, delete |
| `/notifications` | Activity |
| `/search` | Global search |
| `/near` | City / current-location discovery (meetups, crews, drivers) |
| `/routes/:id` | Shareable Touge route page |
| `/install` | iOS / Android / desktop PWA installation manual |
| `/manifest.webmanifest`, `/offline.html`, `/icons/*` | PWA manifest, offline shell and install icons |
| `/u/:username` | Public profile |
| `/about`, `/explore`, `/partners` | Static/marketing pages |
| `/admin` | Admin console (admin only) |
| `/login`, `/register`, `/forgot`, `/reset/:token` | Auth/recovery |
| `/downloads/STREETO-android.apk` | Signed APK (attachment) |
| `/sitemap.xml`, `/robots.txt` | Public discovery files |
| `/og/build/:id.png`, `/og/meetup/:id.png`, `/og/route/:id.png` | Generated share-card images |

### 7.2 JSON API

Mounted at `/api`. Responses are JSON; errors use `{ ok: false, error }`.
Expensive/external endpoints have rate limits.

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `GET /api/health` | – | Process health + time. |
| `GET /api/app/version` | – | Web version + Android version/code/URL/SHA-256. `no-store`. |
| `GET /api/places?q=` | – | Street-name search (Nominatim proxy). |
| `GET /api/geocode/reverse?lat=&lng=` | – | Reverse geocode. |
| `GET /api/search?q=` | – | Global search. |
| `GET /api/pulse` | user | Notification/chat badges. |
| `GET /api/route/distance` | – | Driving distance via OSRM. |
| `GET /api/route/geometry` | – | Route geometry. |
| `GET /api/route/profile` | – | Elevation/profile. |
| `GET /api/groups/mine` | user | Share-to-crew list. |
| `GET /api/weather?lat=&lng=` | – | Forecast only (≤16 days). |
| `GET /api/parts/sources` | – | Part-source links. |
| `GET /api/parts/search` | – | Part search. |
| `GET /api/parts/tree` | – | Catalogue groups/types. |
| `GET /api/parts/vehicle` | – | Vehicle-specific groups/types/parts. |
| `GET /api/parts/garage` | user | Cars from My Ride. |
| `GET /api/parts/vin` | – | VIN decode/fitment. |
| `GET /api/chat/dock` | user | Chat dock unread list. |
| `GET /api/push/vapid-public-key` | – | Public key (empty if push off). |
| `POST /api/push/subscribe` | user | Save a Web Push subscription. |
| `POST /api/push/unsubscribe` | – | Remove a Web Push subscription by endpoint. |
| `POST /api/push/device` | user | Register/refresh an Android FCM token. |
| `POST /api/push/device/remove` | user | Remove an Android FCM token (logout/disable). |
| `POST /api/ocr/certificate` | user | Multipart photo → Gemini OCR; photo deleted after extraction. |

Mutating **form** routes use session CSRF (`_csrf`) and an Origin check. Fetch
calls send `x-csrf-token` and `x-requested-with: fetch` (see `public/js/app.js`).

### 7.3 Optional side services

The site runs without these, but they unlock specific features:

**RockAuto parts service (Python/FastAPI)** — better part search and module
support. The Node client can also use its built-in reader; setting
`ROCKAUTO_SERVICE_URL` switches to the service.

```bash
cd rockauto-service
cp .env.example .env
# Windows: start-rockauto.bat
# Linux/macOS: ./start-rockauto.sh
# or: docker compose up -d
```

Then set in `.env.production`:

```env
ROCKAUTO_SERVICE_URL=http://localhost:8001
```

`rockauto-service/python-portable/` is a local, git-ignored portable Python
environment; `rockauto-service/README.md` has the full setup, Docker/systemd
and API details. If the service is down, `/api/parts/*` falls back or reports
the catalogue as unavailable.

**Mail** — password recovery and scheduled letters need `MAIL_USER` plus a
Google **App Password** in `MAIL_PASS` (Google Account → Security → 2-Step
Verification → App passwords). For local testing set `MAIL_CAPTURE=1` and read
`data/mail-capture/`.

**Notifications** — browsers use standard Web Push (VAPID); the Android app
uses Firebase Cloud Messaging, with `android/app/google-services.json` for the
client and `firebase-service-account.json` on the server. Both are turned on
per member from **Settings → Notifications**. The Android app receives data
messages and posts the notification natively; no persistent notification is
required. A muted chat never produces one.

**Fines / PTI / certificate OCR** — headless Edge/Chrome (fines), pti.ge
(inspection) and a Gemini key (OCR) are optional. See the environment table and
[Troubleshooting](#15-troubleshooting).

---

## 8. Frontend and translations

### 8.1 Views and assets

- `views/layout.ejs` — HTML shell, topbar/sidebar/footer, version footer,
  update banner, global scripts.
- `views/partials/*` — nav, icons, cards, chat dock, share dialog, etc.
- `views/<area>/*` — one page per route.
- `public/css/style.css` - complete theme and page styling: themes via
  `data-theme`, responsive breakpoints, custom fonts, animations.
- `public/css/ui-system.css` - the shared UI contract loaded after
  `style.css`: tokens, controls, avatars, headers, safe areas.
  The rules and the live example page are documented in
  [`docs/UI_SYSTEM.md`](docs/UI_SYSTEM.md) and `/admin/style-guide`.
- `public/js/*` — ES modules (`type="module"`), no bundler.
- `public/sw.js` — push notifications; it does not cache pages or assets.

### 8.2 Browser modules

| File | Responsibility |
| --- | --- |
| `app.js` | Menus, modals, likes, comments, composer, lightbox, badges, build voting/gallery, onboarding. |
| `version.js` | Footer versions, `/api/app/version`, update banner, Changes modal, native updater bridge. |
| `video.js` | Video play cover, duration badge and desktop hover preview. |
| `i18n.js` | Client `t()` reading the server-provided map. |
| `chat.js`, `chat-dock.js` | Chat page + dock polling/send/typing. |
| `search-live.js` | Live search suggestions. |
| `meetup-weather.js` | Meetup forecast UI. |
| `map-picker.js`, `map-style.js` | MapLibre picker + dark basemap. |
| `touge-route-picker.js` | A/B Touge route, elevation, 3D preview, fullscreen, saved view. |
| `part-search.js` | Parts tabs, catalogue tree, part results. |
| `push.js`, `push-init.js` | Web Push subscription, the Settings notification card, and the native Android notification bridge. |
| `share.js` | Share dialog. |
| `share-card.js` | Native/downloadable social preview cards for builds, meetups and routes. |
| `near.js` | Browser geolocation for the city/region discovery page. |
| `pwa.js` | Registers the offline service worker and marks standalone/native display modes. |
| `install.js` | PWA install prompt and platform-specific instructions. |
| `mentions.js` | `@name` picker/links. |
| `admin*.js` | Admin console, translations, how-it-works editor. |

### 8.3 Translation workflow

English source strings **are** the keys:

- Server/template: `<%= t('Save profile') %>`
- Client: `import { t } from './i18n.js'; t('Save')`
- The built-in Georgian dictionary is `src/lib/locales/ka.js`.
- The live dictionary lives in the `translations` DB table. On boot, `ka.js`
  seeds missing values; the DB is then the source of truth, so admins can
  correct Georgian from **Admin → Translations** without a deploy.
- `src/lib/scan-keys.js` scans templates/server/client code on boot and
  registers new keys; strings requested at runtime are registered the first
  time they render.
- Browser-only keys must also be listed in `src/lib/client-strings.js`; that
  map is injected into the page by `views/partials/i18n-data.ejs`.
- `{name}` placeholders must match between English and Georgian; the admin
  console validates them.
- How-it-works content is stored in `how_sections`/`how_blocks` and edited in
  the admin console.
- Part-catalogue groups/types are translated; `src/lib/locales/parts-keys.js`
  holds the generated 1,350 catalogue keys. Remaining catalogue terms can be
  filled in the admin console as users translate them.

**Adding a string:** use it via `t('English text')`; add the Georgian value to
`ka.js`; add it to `CLIENT_KEYS` if the browser uses it; run the page and check
the admin translation list.

### 8.4 PWA / iOS web app

The website is also a full PWA. `/manifest.webmanifest` declares a standalone
portrait app with 192/512px and maskable icons. `public/sw.js` registers the
offline shell, caches static interface files and keeps the existing push
notification handlers. `public/offline.html` is the offline fallback.

- **Install link:** `/install`, reached from the single
  **DOWNLOAD | ANDROID & iOS** button on the login page. Android visitors see
  the signed APK download only; iPhone visitors see the Safari “Add to Home
  Screen” steps; desktop visitors get the Chrome/Edge PWA flow.
- **iOS version:** the PWA uses the web version. Settings shows **iOS version**
  and the footer shows `Web · iOS · Android` versions.
- **Notifications on iOS:** Web Push works only after the PWA is installed to
  the Home Screen (iOS 16.4+), then the normal Settings → Notifications
  permission flow applies.
- **Fonts:** Manrope and the selected Georgian BPG font are self-hosted as
  WOFF2 files, so Android, desktop, iOS and the PWA render the same Latin and
  Georgian text even when Google Fonts or the uploads cache is unavailable.
- **Camera:** certificate scan controls are native `<label>` elements for a
  real `capture="environment"` file input, so iOS opens the camera without a
  programmatic click.
- **Launch screen:** the installed PWA shows the same animated mark, wordmark,
  neon line and STREETO.NET signature as the Android splash. It runs once per
  app session, is skipped for normal browser tabs and respects reduced motion.
- **One shared tab bar:** Android, the browser PWA and iOS all use the same
  in-page HTML/CSS tab bar (`.tabbar`: Wall, Explore, Meetups, Chat, Garage).
  It is **not** a native `UITabBar` and Android no longer uses a Material
  `BottomNavigationView`. Desktop keeps the `.sidenav`; phones and tablets use
  `.tabbar`, so active states, spacing and safe areas are identical everywhere.
- **Future native iOS/Android shells:** keep the same five items, labels,
  order and visual contract. A native `UITabBarController` or Material bar is
  only acceptable if it matches this shared design; the web `.tabbar` remains
  the source of truth.

### 8.5 Changelog / "Changes"

`src/lib/changelog.js` is the curated release history shown in
**Settings → App & updates → Changes**. Entries are newest first:
`version`, ISO `date`, `scope` (`web` | `android` | `both`), and English
`items`. The page translates each item through `t()`, so every new item needs
a Georgian translation in `ka.js`.

The update banner, footer versions and Changes button are all driven by
`public/js/version.js` and `src/lib/app-version.js`. The server reads the
Android version from Gradle and hashes the actually-served APK on demand; a
copied APK is picked up without restarting the server.

---

## 9. Android app

The Android project is in `android/`; the deeper build/signing notes are in
[`android/README.md`](android/README.md).

### 9.1 What it is

A native **Java WebView shell** around `https://streeto.net`:

- full-screen WebView, app icon/name, no browser chrome
- animated launch screen: the white S mark settles in, the STREETO wordmark rises, and a cyan line draws in before the site appears
- native back button (history, then exit), pull-to-refresh, offline retry screen
- gallery **or camera** uploads, GPS permission
- cookies persist (stay logged in)
- links to other sites open in the phone browser
- `window.StreetNative` bridge exposing version info and an in-app updater
- footer shows `Web vX · App vY`; Settings shows update/check/changes UI
- Firebase Cloud Messaging notifications for messages and activity (Settings → Notifications); tapping opens the chat or activity page

Package `net.streeto.app`; min Android 7.0 (API 24); target/compile SDK 35.
The launcher icon source is `android/icon-source.png`; `npm run icons:android`
regenerates the legacy, round and adaptive resources.

### 9.2 Build and release

GitHub Actions (`.github/workflows/android.yml`) builds a **signed release**
on every push to `main` (and manually):

- JDK 17, Gradle 8.9, Android Gradle Plugin 8.7.3
- decodes the keystore from GitHub Secrets
- `gradle assembleRelease`
- verifies with `apksigner --print-certs`
- uploads artifact **`streeto-release-apk`** containing `app-release.apk`

Download the artifact and copy `app-release.apk` to
`public/downloads/STREETO-android.apk`. The login-page button serves it.
Distribution is **website-only**; there is no Play Store listing.

`public/downloads/` is git-ignored, so a fresh clone has **no APK**; the login
button will 404 until you copy a build into it.

### 9.3 Signing

The keystore is **not in Git**. A local backup lives at:

```
android/signing/streeto-release.jks
android/signing/SIGNING.txt      (alias + password)
```

Both are git-ignored. The same key is stored as encrypted GitHub Secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

To restore those secrets on a new GitHub repo or machine (PowerShell):

```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("android/signing/streeto-release.jks"))
$b64 | gh secret set ANDROID_KEYSTORE_BASE64 --repo madnjpn/streeto
gh secret set ANDROID_KEYSTORE_PASSWORD --repo madnjpn/streeto --body "<keystore password>"
gh secret set ANDROID_KEY_ALIAS --repo madnjpn/streeto --body "streeto"
gh secret set ANDROID_KEY_PASSWORD --repo madnjpn/streeto --body "<key password>"
gh secret list --repo madnjpn/streeto
```

On Linux/macOS use
`base64 -w0 android/signing/streeto-release.jks | gh secret set ...` instead.
The alias/password are in `android/signing/SIGNING.txt`; never commit it.
Creating a *new* keystore gives the app a new identity — existing users would
have to uninstall before installing the new build, so only do that for a new
app, not for normal releases.

Release signer SHA-256 (verify with `apksigner --print-certs`):

```
18:D8:DC:6B:BF:79:8B:5A:3B:48:9D:A9:BC:F1:81:84:81:8B:9D:2B:26:30:50:D1:46:75:CC:21:C1:0C:01:23
```

**Back the keystore and password up off the machine** (password manager +
encrypted cloud/USB). If lost, you cannot update installed copies of the app;
users would have to uninstall and reinstall, losing local app data.

Local build (requires JDK 17, Android SDK 35 and Gradle 8.9; CI is the
supported path):

```bash
cd android
gradle assembleRelease
```

The APK is at `android/app/build/outputs/apk/release/app-release.apk`.
Without `KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and
`KEY_PASSWORD`, the local build is unsigned.

### 9.4 Update flow

1. Bump `versionCode` (must increase) and `versionName` in
   `android/app/build.gradle.kts`; add a changelog entry.
2. Push; the workflow builds and signs the APK.
3. Copy `app-release.apk` to `public/downloads/STREETO-android.apk`.
4. On next app launch, `public/js/version.js` calls `/api/app/version`.
5. If the apk `versionCode` is newer, a dismissible banner and the Settings
   update button appear.
6. **Update now** calls the native bridge, downloads via `DownloadManager`,
   verifies the SHA-256 from the API, asks for “install unknown apps” permission
   if needed, and opens the installer.
7. The user confirms the install; Android does not allow silent installs.

The APK must be signed with the **same key** and have a **higher versionCode**
to install over an existing copy. An old debug-signed APK must be uninstalled
once before installing the release build. Web-only changes never require an
APK update: the shell loads the live site.

The update check runs on app page loads and when the user taps
**Check for updates**; it is not a background push service.

### 9.5 Notifications (Firebase Cloud Messaging)

- Firebase project **`streeto-bbbc5`**; Android package `net.streeto.app`.
- Client config: `android/app/google-services.json` (tracked; it is client
  configuration, not a server secret).
- Server credential: `firebase-service-account.json` in the project root
  (git-ignored) or `FIREBASE_SERVICE_ACCOUNT_PATH` / `FIREBASE_SERVICE_ACCOUNT`.
- **Settings → Notifications** requests Android 13+ notification permission,
  fetches the FCM token and posts it to `POST /api/push/device`. Logging out or
  turning notifications off removes it.
- If notifications are still off after login, a dismissible prompt offers
  **Enable notifications** / **Not now**; Not now hides it for 14 days.
- The server sends **data-only** high-priority messages; `StreetoMessagingService`
  renders the notification and opens the relevant chat/activity page. It skips
  the buzz while the app is in the foreground.
- Muted chats are filtered server-side, so they never produce a message alert.
- Android Chrome/PWA Web Push is skipped while that member has an active FCM
  token, so one phone does not buzz twice. Desktop and iOS browser
  subscriptions keep working.
- The host gets a private “Your Underground night is live” confirmation when
  creating a night; the public announcement still excludes the host.
- No persistent foreground-service notification is needed; FCM delivers while
  the app is backgrounded or closed (subject to Doze/Google Play services).

---

## 10. Release process

### 10.1 Web-only release

1. Bump the web version: `npm version <version> --no-git-tag-version`.
2. Add a changelog entry at the top of `src/lib/changelog.js` with
   `scope: 'web'`, an ISO date, and English items.
3. Add the Georgian translation for **every new item** to
   `src/lib/locales/ka.js` (same English key).
4. Deploy/pull and restart the server (`npm ci --omit=dev` if dependencies
   changed). Static JS/CSS need no restart; the asset stamp updates.
5. Verify `/api/app/version`, the footer, and Settings → Changes.
6. Run `npm run ui:check`, `npm run ui:visual` and `npm run smoke`.

No APK build or reinstall is needed; apps get the new site on next load.

### 10.2 Android release

1. Bump `versionCode` and `versionName` in
   `android/app/build.gradle.kts`.
2. Add a changelog entry (`scope: 'android'` or `'both'`) and translations.
3. Commit/push to `main`; wait for **Build Android APK** to succeed.
4. Download artifact `streeto-release-apk` (`app-release.apk`).
5. Copy it to `public/downloads/STREETO-android.apk`.
6. Optionally verify locally:
   `aapt2 dump badging ... | head -1` and
   `apksigner verify --print-certs ...`.
7. Verify `/api/app/version` reports the new code/version and SHA; the site
   now offers it.
8. Run `npm run smoke`.

### 10.3 Both web and Android

Bump both versions and use one changelog entry with `scope: 'both'`. The
footer will show the two versions separately; they do not have to match.

### 10.4 Changelog entry format

```js
{
  version: '1.2.0',
  date: '2026-10-25',
  scope: 'both', // 'web' | 'android' | 'both'
  items: [
    'English source string.',
    'Another change.',
  ],
}
```

Add it at the **top** of `src/lib/changelog.js` (newest first). Add each English
item to `src/lib/locales/ka.js` with its Georgian translation. The Settings
Changes panel is the user-facing changelog; the admin translation console will
also list the new keys.

### 10.5 What never changes

- Do not change the Android `applicationId` or signing key for normal releases.
- Bump `versionCode` every release; the in-app check only offers updates with
  a higher code, and Android rejects downgrades.
- Do not bump the Android version for a web-only change.
- Do not copy an APK without bumping the version (no update prompt).
- Do not commit the keystore, passwords, or `.env.production`.

---

## 11. Testing

### 11.1 Smoke suite

```bash
npm run smoke
```

It boots the real Express app on a random port against a throwaway
`data/smoke.db`, `uploads-smoke`, and a local pti.ge stub. It drives two clients
through registration → posts → likes → comments → friends → chat → crew →
meetup → build upload/vote/visibility/delete → certificate/PTI → parts/VIN and
negative auth/validation cases. It never touches the production DB or external
PTI service.

Current suite: **344 checks** (the number grows with features). The final line
is `N passed, 0 failed`; any failure exits non-zero.

### 11.2 Production checks

```bash
npm run prodcheck
```

Reports missing/weak `SESSION_SECRET`, `PUBLIC_URL`, `TRUST_PROXY`, TLS
certificates, port availability, writable storage and DDNS configuration. Fix
all `FAIL`s before going live; review `warn`s.

### 11.3 Manual checklist before a release

- Home/feed, a post, comments, likes, chat, a crew, a meetup, a build, parts,
  garage/My Ride, settings, admin.
- Georgian and English UI for changed screens.
- Login/logout/password reset (or `MAIL_CAPTURE` in dev).
- Upload a photo and a short video; check size/MIME limits.
- Mobile viewport and the Android app if the shell changed.
- `GET /api/health` and `GET /api/app/version`.
- Run `npm run smoke`.

### 11.4 Adding a smoke test

`scripts/smoke.js` has a tiny harness:

```js
check('what it proves', () => {
  assert.equal(res.status, 200);
  assert.match(html, /expected/);
});
```

Use the `Client` helper (`a`, `b`, …) for cookies/CSRF, `a.page()` to capture
the token, and `a.post()`/`a.request()` for form/JSON requests. Keep tests
independent and use the scratch database.

### 11.5 UI and accessibility gate

```bash
npm run ui:check    # pagehead/avatar/button contracts, tokens, a11y hooks
npm run ui:visual   # seeded browser check at 390x844 and 1440x900 + axe
```

`ui:visual` seeds `data/ui-visual.db`, starts the app on a random port,
checks every major page in English and Georgian, and writes screenshots to
`artifacts/ui/`. It fails on horizontal overflow, stretched avatars, actions
outside the viewport, broken images, or serious/critical WCAG violations.
`.github/workflows/ui.yml` runs it when web files change; the Android
workflow is path-filtered to `android/**` and only builds the APK when the
shell actually changed.

---

## 12. Going live behind Cloudflare

The site runs on one machine. A **Cloudflare Tunnel** connects it to Cloudflare,
so no router port forwarding or dynamic DNS is needed:

```
visitor -> HTTPS -> Cloudflare (streeto.net) -> tunnel -> cloudflared
        -> HTTPS -> https://localhost:443 -> Node app
```

### 12.1 Cloudflare dashboard

1. Add the `streeto.net` zone to Cloudflare (Free plan) and point the registrar
   at Cloudflare's nameservers. Wait for **Active**.
2. **Networking → Tunnels → Create tunnel** (`streeto.net`, cloudflared).
   Add published applications:
   - `streeto.net` → `https://localhost:443`
   - `www.streeto.net` → `https://localhost:443`
   Under TLS settings set **Origin Server Name** = `streeto.net` and
   **Disable TLS certificate verification** (cloudflared on Windows cannot use
   the system root pool with an Origin CA cert).
3. **SSL/TLS → Origin Server → Create Certificate** for `streeto.net` and
   `*.streeto.net`, 15 years. Save the certificate as `certs/origin.pem` and
   the key as `certs/origin-key.pem`. The server prefers this pair.
4. Set SSL mode **Full (strict)** and enable **Always Use HTTPS**
   (SSL/TLS → Edge Certificates).
5. Keep **WebSockets** on (Network); chat/presence need it.

### 12.2 Machine

```bash
npm run golive          # prepare, Cloudflare, tunnel, services
npm run golive -- check # only report what is missing
npm run golive -- verify
```

The script is idempotent and can be re-run after moving machines. It installs
dependencies, writes `.env.production` with a fresh `SESSION_SECRET`, obtains
an Origin CA certificate, creates/reuses the tunnel and DNS routes, sets SSL
mode/Always HTTPS, and registers the `cloudflared` connector and the app as
services (Windows) or systemd/launchd units (Linux/macOS).

It needs `CF_API_TOKEN` available in `.env.production` (or exported in the
environment). Create a custom token with:
**Account → Cloudflare Tunnel → Edit**, **Zone → DNS → Edit**,
**Zone → Zone Settings → Edit**, **Zone → SSL and Certificates → Edit**, and
**Zone → Zone → Read**. The script never prints the token.

On Windows, `go-live.bat` starts the tunnel and server in the foreground
without installing services. `scripts/setup-production.ps1` runs the setup
elevated and re-launches itself if needed.

`.env.production` normally contains:

```env
NODE_ENV=production
PUBLIC_URL=https://streeto.net
PORT=443
HTTP_PORT=80
TRUST_PROXY=1
SESSION_SECRET=<64 random hex chars>
CF_API_TOKEN=<Cloudflare token>
CF_TUNNEL_TOKEN=<written by golive>
```

### 12.3 Verify

```bash
npm run prodcheck
npm run golive -- verify
curl -I https://streeto.net
curl https://streeto.net/api/health
```

If the site is down, check in this order: is the `Cloudflared` service running,
is the `STREETO server` service/process running, and does the tunnel show
connections in the Cloudflare dashboard.

### 12.4 Without a tunnel

Port-forward 80/443, point an `A` record at the public IP, and keep it updated
with `npm run ddns` (needs `CF_API_TOKEN`, `CF_ZONE_ID`, `CF_DNS_NAME`). The
tunnel is preferred because it handles changing IPs and needs no open ports.

### 12.5 Moving to another machine

1. Install Node 22.5+ and clone the repo; run `npm ci`.
2. Copy, over a secure channel:
   - `.env.production`
   - `certs/origin.pem` + `certs/origin-key.pem`
   - `data/streeto.db` (stop the old server and copy its `-wal`/`-shm` files
     too, or use a fresh backup)
   - `data/backups/`
   - `uploads/`
   - `public/downloads/STREETO-android.apk` (or rebuild it)
   - `android/signing/` (keystore backup, only if you build locally)
3. Run `npm run golive` to recreate/point the tunnel and services.
4. `npm run prodcheck`, then start and verify.
5. Never copy `node_modules`; reinstall.

---

## 13. Operations runbook

> **Current host:** Windows, project at `C:\Users\madnjpn\Desktop\streeto`,
> Node 26, public via Cloudflare Tunnel. Update this note after moving the
> installation.

### Start / stop / restart

- **Foreground:** `npm start`; Ctrl+C stops it. The HTTP redirect listener
  closes too.
- **Windows services (installed by golive):** restart `STREETO server` and
  `Cloudflared` via Services or `Restart-Service`.
- **Foreground Windows tunnel:** `go-live.bat` starts/stops both; running it
  again replaces the old server on port 443.
- **After a web deploy:** restart the Node process (templates/server code are
  read at boot). Static JS/CSS are read from disk and need no restart.
- **Before a schema-changing deploy:** take a backup (Admin → Backups), then
  restart; migrations apply automatically.
- **After copying a new APK:** no restart; the API re-hashes the file on demand.
- **After adding a migration:** restart; migrations apply automatically.

On this Windows host the live process is a hidden `node` process. Prefer the
service/foreground flow above rather than killing every `node.exe` on the
machine (other tools may use Node).

For the current hidden setup, stop only the PID listening on 443 after checking
that its command line is this app, then start it again:

```powershell
$p = (Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1).OwningProcess
if ($p) {
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$p").CommandLine
  if ($cmd -match 'server\.js') { Stop-Process -Id $p -Force }
}
Start-Process node `
  -ArgumentList '--env-file=.env.production','server.js' `
  -WorkingDirectory 'C:\Users\madnjpn\Desktop\streeto' `
  -WindowStyle Hidden
```

### Health and versions

```bash
curl -k https://localhost/api/health
curl -k https://localhost/api/app/version
curl https://streeto.net/api/app/version
```

`/api/app/version` is the quickest way to confirm the web version, Android
version/code, APK URL, size and SHA-256 that the update checker will use.

### Backups

- Automatic snapshots: `data/backups`, every 6 h, newest 24 kept.
- Manual/restore: Admin → Backups.
- Copy backups off-machine; test a restore occasionally.
- Include `uploads/` in disaster-recovery copies (the DB stores paths only).

### Logs

- Foreground runs print startup, migrations, mail and server messages to the
  console.
- Installed services log through the OS service manager (Event Viewer /
  journald/launchd).
- No application log file is created by default; use the service manager or
  run in the foreground when debugging.

### Capacity / housekeeping

- Watch disk usage in `uploads/`, `data/` and `data/backups/`.
- Prune orphan uploads with the script, not by hand.
- `sharp` variants multiply disk use; keep `uploads/` backed up.
- SQLite is fine for this single-server workload; do not run multiple app
  processes against the same DB file.

---

## 14. Security and secrets

### Secrets inventory

| Secret | Where it lives | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | `.env.production` | 32+ random chars; rotating logs everyone out. |
| `GEMINI_API_KEY` | `.env.production` | Certificate OCR; rotate if exposed. |
| `MAIL_PASS` | `.env.production` | Gmail App Password. |
| `VAPID_PRIVATE_KEY` | `.env.production` | Web push. |
| Firebase service account | `firebase-service-account.json` (git-ignored) or env | Android FCM. **Secret.** |
| `google-services.json` | `android/app/` (tracked) | Android client config; not a server secret. |
| `CF_API_TOKEN` | `.env.production` | Cloudflare automation. |
| `CF_TUNNEL_TOKEN` | `.env.production` / `go-live.bat` | Tunnel connector. |
| `JINA_API_KEY`, `PROXIFLY_API_KEY` | `.env.production` | Optional parts helpers. |
| Android keystore + passwords | `android/signing/` + GitHub Secrets | **Losing it blocks app updates.** |

`.gitignore` excludes `.env*` (except `.env.example`), `certs/`, `data/`,
`uploads/`, `*.apk`, `*.jks`, `*.keystore`, `android/signing/`,
`firebase-service-account.json` and build output.

### Rules

- Never commit secrets, certificates, the DB, uploads, or the keystore.
- The GitHub repo is public; anything committed is public immediately.
- The Gemini key was previously hardcoded in an older revision — **rotate it**
  if that has not been done.
- Use GitHub Secrets for CI (`ANDROID_KEYSTORE_*`). Do not put them in the
  workflow or source.
- Keep `.env.production`, `certs/`, and `android/signing/` readable only by the
  service account.
- Store the Android signing key/password in a password manager and an
  encrypted off-site backup.
- `TRUST_PROXY=1` trusts exactly one proxy hop. Do not expose the Node port
  directly to the internet while trusting forwarded headers.
- Production cookies are `Secure`, `HttpOnly`, `SameSite=Lax`; HTTPS is
  mandatory. Serving production over plain HTTP makes login silently fail.

### Built-in protections

- Strict CSP, `X-Frame-Options: DENY`, `nosniff`, restrictive referrer and
  permissions policies.
- Session-bound CSRF tokens and an Origin check for cross-origin form posts.
- scrypt password hashing with constant-time verification and timing equalised
  for unknown accounts.
- Upload MIME allowlist, random filenames, size limits, `nosniff`.
- Rate limits for login/register/geocode/search/parts/routes/weather/OCR.
- Admin-only routes and server-side authorization checks.

---

## 15. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `npm start` fails: `.env.production` not found | Run `npm run golive`, or copy `.env.example` to `.env.production` and fill it in. For dev use `node server.js`, not `npm start`. |
| `SESSION_SECRET is required` | Set a 32+ char `SESSION_SECRET` in `.env.production`. |
| Production exits: “No TLS certificate found” | Put `certs/origin.pem` + `certs/origin-key.pem` (Cloudflare) or run `npm run cert` for local HTTPS. |
| Login succeeds but bounces back to `/login` | Production cookie is `Secure` but the origin is plain HTTP. Use HTTPS/Tunnel, and Cloudflare Full (strict). |
| `node:sqlite` not found / syntax error | Node is older than 22.5; upgrade. |
| Port 443/3000 already in use | Another server is running. Stop the specific process/service; `go-live.bat` can replace the old server on 443. |
| Map is blank | Run `npm install` (MapLibre assets are served from `node_modules`), allow tile network access. |
| Certificate OCR returns 503/400 | `GEMINI_API_KEY` missing/invalid, quota exhausted, or the photo is unreadable. Check `/admin` logs/console. |
| Password reset does not send mail | `MAIL_PASS` (App Password) missing; use `MAIL_CAPTURE=1` in dev and read `data/mail-capture/`. |
| Web push does not arrive | VAPID keys missing, site not HTTPS, permission denied, or browser/OS blocked. Web Push is browser-only. |
| Android notifications do not arrive | Enable in Settings → Notifications; allow POST_NOTIFICATIONS; check `google-services.json` and the server FCM service account; confirm `/api/push/device` was called. Doze/Google Play services can delay. |
| Fines lookup fails | `protocols.ge` changed, or no Edge/Chrome; set `BROWSER_PATH`/`CHROME_PATH`/`EDGE_PATH`. |
| Part search fails/timeouts | RockAuto/reader unavailable, or `ROCKAUTO_SERVICE_URL` points at a stopped Python service. |
| PTI status stale/unknown | `pti.ge` unreachable or plate unknown; `PTI_LOOKUP=off` in tests. |
| APK update banner loops / no update | Check `/api/app/version`: `versionCode` must be higher than installed and the APK file must exist. Bump Gradle, rebuild, copy APK. |
| APK won't install over old app | Different signing key (debug vs release) or lower `versionCode`. Uninstall the debug build once; never change the release key. |
| Android CI fails before build | Missing `ANDROID_KEYSTORE_*` secrets or invalid base64. Re-run after fixing secrets. |
| Tunnel 502 | Node process down or TLS mismatch; `curl -k https://localhost:443/api/health`; check `Cloudflared`/`STREETO server`. |
| SQLite “database is locked” | A long write, a manual DB copy, or two processes. Use `busy_timeout`, backups, and one app process. |
| Upload rejected | File over `MAX_UPLOAD_MB` or MIME not allowed; check disk space. |
| New Georgian string shows English | Add it to `ka.js` / `CLIENT_KEYS`, or fill it in Admin → Translations. |
| JS/CSS change not visible | Asset stamp refreshes within 30 s; hard-refresh. Static files do not need a server restart. |
| Changes panel missing an entry | Add it to `src/lib/changelog.js` (top) and translate the items in `ka.js`. |

---

## 16. Known limitations

- **Website-only Android distribution.** No Play Store, no silent auto-update;
  the user taps Update and confirms the Android installer.
- **App-update checks run on launch/settings**, not in the background. The
  separate notification channel uses FCM and works while the app is closed
  (subject to Doze/Google Play services).
- **Web Push is browser-only.** The WebView app uses native FCM notifications
  instead; both are fed by the same notification events.
- **Android notifications need Google Play services and an FCM token.** Devices
  without Play services, or users who deny notification permission, only get
  the in-app activity feed.
- **One server / one SQLite file.** Not horizontally scalable; run a single
  Node process.
- **External services can change or rate-limit:** Nominatim/OpenFreeMap/OSRM,
  pti.ge, protocols.ge, RockAuto/reader, Gemini. Features degrade, the site
  should stay up.
- **Gemini OCR is optional and quota-limited.** The key is a secret; rotate
  keys that were ever in source/history.
- **Part-catalogue translation is a long tail.** The 1,350 generated keys are
  seeded; some Georgian terms may still be missing until translated.
- **Changelog is curated manually.** A release is not “done” until the entry
  and its Georgian translations are added.
- **APK builds are path-filtered** to `android/**` (and the workflow file).
  Web-only pushes run the UI/smoke checks instead; a manual
  `workflow_dispatch` can always build the APK.
- **Local self-signed certificates** trigger browser warnings and cannot be
  used with Cloudflare Full (strict); use an Origin CA cert in production.
- **Demo seed credentials** (`street123`) are not production credentials.
- **The public repo contains no production data**, but it does contain the
  full source. Keep secrets in env/GitHub Secrets and rotate anything exposed.

---

## 17. Handover checklist

### First day

1. Read this README, `android/README.md`, and `src/lib/changelog.js`.
2. Install Node 22.5+; `npm ci`; `node server.js`; open
   `http://localhost:3000`.
3. `npm run seed` (or create an admin with `npm run admin -- create ...`) and
   log in.
4. Run `npm run smoke`; confirm all checks pass.
5. Read `src/app.js`, `src/config.js`, `src/db.js`, one route → model → view,
   and `public/js/version.js`.
6. Get access to `.env.production`, `certs/`, `android/signing/`, the GitHub
   repo/Actions secrets, and the Cloudflare account. Store them securely.
7. Run `npm run prodcheck`; verify `https://streeto.net/api/health` and
   `/api/app/version`.
8. Copy `data/backups/` and `uploads/` off-machine; test a backup restore on a
   spare DB.
9. Make a web-only release (bump web version + changelog + translation) and a
   test APK release to learn the pipeline.

### Data to carry to a new machine

- Source (git clone) and `npm ci`
- `.env.production` (secure transfer)
- `certs/origin.pem`, `certs/origin-key.pem`
- `data/streeto.db` or a fresh backup, `data/backups/`
- `uploads/`
- `public/downloads/STREETO-android.apk` (or rebuild)
- `android/signing/` (keystore + `SIGNING.txt`)
- `firebase-service-account.json` (FCM server key, secure transfer)
- GitHub Secrets are in GitHub, not on disk

### Never commit / never share

`.env` / `.env.production`, `certs/` and keys, `data/`, `uploads/`, `*.apk`,
`android/signing/`, `*.jks`/`*.keystore`, `firebase-service-account.json`,
cookie jars, logs with personal data.

---

## 18. Where to change what

| I want to change… | Look at… |
| --- | --- |
| Brand, nav, footer | `views/partials/nav.ejs`, `views/layout.ejs`, `websitelogo.png`, `favicon.ico` |
| Global CSS / themes | `public/css/style.css` (theme blocks at the top, responsive rules at the bottom) |
| Shared UI contract / tokens / live guide | `public/css/ui-system.css`, `docs/UI_SYSTEM.md`, `views/admin/style-guide.ejs` |
| Notifications, filters and push categories | `src/routes/notifications.js`, `src/lib/notification-prefs.js`, `views/notifications/index.ejs` |
| Background media queue | `src/lib/media-queue.js`, `src/migrations/042_media_jobs.sql`, `/api/health` |
| Public share cards / sitemap | `src/routes/social.js`, `src/lib/og-image.js`, `public/fonts/`, `public/js/share-card.js` |
| Near-you discovery | `src/routes/pages.js`, `views/pages/near.ejs`, `public/js/near.js` |
| UI / accessibility gate | `scripts/ui-check.mjs`, `scripts/ui-visual-check.mjs`, `.github/workflows/ui.yml` |
| Global interactions | `public/js/app.js` |
| Web/Android versions, footer, update banner | `src/lib/app-version.js`, `public/js/version.js`, `views/layout.ejs` |
| Settings update/changes card | `views/profile/settings.ejs`, `src/routes/profile.js` |
| Release notes | `src/lib/changelog.js` + `src/lib/locales/ka.js` |
| Any UI string | `src/lib/locales/ka.js`; client-only keys in `src/lib/client-strings.js`; live overrides in Admin → Translations |
| Wall/posts/comments | `src/routes/wall.js`, `src/models/posts.js`, `views/wall/*`, `public/js/app.js` |
| Builds/voting/awards | `src/routes/builds.js`, `src/models/builds.js`, `views/builds/*` |
| Crews | `src/routes/groups.js`, `src/models/groups.js`, `views/groups/*` |
| Chat | `src/routes/chat.js`, `src/models/chat.js`, `views/chat/*`, `public/js/chat*.js` |
| Meetups/Touge/weather | `src/routes/meetups.js`, `src/models/meetups.js`, `views/meetups/*`, `public/js/touge-route-picker.js`, `public/js/meetup-weather.js` |
| Garage/vehicles/PTI/fines | `src/routes/garage.js`, `src/models/vehicles.js`, `src/lib/pti*.js`, `src/lib/fines.js`, `views/garage/*` |
| Services/parts/RockAuto | `src/routes/services.js`, `src/models/parts.js`, `src/lib/rockauto*.js`, `src/routes/api.js`, `views/services/*`, `public/js/part-search.js` |
| Friends/people | `src/routes/friends.js`, `src/models/friends.js`, `views/friends/*` |
| Notifications/push | `src/models/notifications.js`, `src/lib/push-all.js`, `src/lib/push.js`, `src/lib/fcm.js`, `src/models/devices.js`, `public/js/push*.js`, `views/notifications/*`, `android/.../StreetoMessagingService.java` |
| Auth/password recovery | `src/routes/auth.js`, `src/routes/recover.js`, `src/lib/password.js`, `src/lib/mail.js` |
| Admin console | `src/routes/admin.js`, `views/admin/*`, `public/js/admin*.js` |
| Database/migrations | `src/db.js`, `src/migrations/*.sql`, `src/models/*` |
| Env/config | `src/config.js`, `.env.example`, `.env.production` |
| Server/TLS/startup jobs | `server.js` |
| Static assets/routes/CSP | `src/app.js` |
| Video posters | `src/lib/video-posters.js`, `src/lib/uploads.js`, `scripts/build-video-posters.mjs` (`npm run posters`) |
| Video player / previews | `views/partials/video.ejs`, `public/js/video.js`, `public/css/style.css` |
| Android shell | `android/app/src/main/java/net/streeto/app/MainActivity.java`, `AndroidManifest.xml`, `res/*` |
| Launcher icon | `android/icon-source.png`; run `npm run icons:android` to regenerate every density |
| Android build/signing/CI | `android/app/build.gradle.kts`, `android/build.gradle.kts`, `.github/workflows/android.yml`, `android/README.md` |
| RockAuto Python service | `rockauto-service/` |
| Backups | `src/lib/backup.js`, Admin → Backups |
| Seed/demo data | `scripts/seed.js` |
| Production setup | `scripts/go-live.mjs`, `scripts/setup-production.ps1`, `go-live.bat`, `scripts/prod-check.mjs` |

---

## 19. Conventions and definition of done

### Code conventions

- ES modules, `import`/`export`, no CommonJS in `src`/`public`.
- Server-rendered HTML first; JavaScript is progressive enhancement.
- Validate on the server; never trust client validation.
- Use parameterised SQL and the `run/get/all/tx` helpers.
- Add a migration for schema changes; never edit an applied migration.
- Use `t('English key')` for every user-visible string.
- Use stamped asset paths in views; do not hard-code `/js/`.
- Keep the UI Georgian-first and mobile-first.
- No secrets, real user data, uploads, certs or keystores in the repo.

### Definition of done for a change

1. Works on desktop and phone; Georgian (and English where relevant) checked.
2. Server-side validation and permissions added.
3. Migration added if the schema changed; existing data still works.
4. New strings translated in `ka.js` (and `CLIENT_KEYS` if browser-only).
5. `npm run ui:check`, `npm run ui:visual` and `npm run smoke` pass.
6. Version/changelog updated if users will notice the change.
7. No secrets or ignored files staged (`git status` clean apart from intended
   changes).
8. For Android: `versionCode` bumped, CI signed build verified, APK copied to
   `public/downloads/STREETO-android.apk` when releasing.

### Current release reminder

- Web version: `package.json` → `1.6.0`
- Android version: `android/app/build.gradle.kts` → `1.3.3` (versionCode `12`)
- Release notes: `src/lib/changelog.js`
- Live version check: `https://streeto.net/api/app/version`

---

Ride legal, stay safe. This is a community project — don’t organise anything on
public roads that you wouldn’t want to explain to a police officer.
