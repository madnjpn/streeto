# STREETO

An underground street-racing social network: a wall, crews, chat (a shared
global channel plus private threads), meetups and a **builds** garage with
weekly voting, built on **Node.js + Express 5 + SQLite** with server-rendered
EJS and vanilla ES-module JavaScript. No build step, no native modules, no API
keys.

```
npm install
npm run seed     # optional: demo drivers, posts, crews, meetups, builds
npm start        # the live server (https://localhost:443)
```

Demo logins created by `npm run seed` all use the password `street123`
(`nightrider`, `burnout_bex`, `kev_boost`, `sara_drift`, `tomas_diesel`,
`mika_gtr`). Log in with a username **or** the matching email.

---

## What's inside

| Area | Highlights |
| --- | --- |
| **Wall** | Text, photo, video, location-pin and SOS posts. Likes, threaded comments (loaded on demand), delete your own posts. `My crew` / `Everyone` scopes. |
| **Builds** | Upload your car with a spec sheet (engine, drivetrain, power, torque, weight, mods) plus up to 8 photos/clips. Public or private garages, one vote per driver per week, and derived `Build of the Week / Month / Year` awards. |
| **People** | Username / name / city / car search, friend requests, accept / decline / cancel, unfriend, mutual-friend counts, suggestions. |
| **Chat** | An open **global channel** every driver shares, plus 1-to-1 threads with anyone. Photo/video attachments, 3-second polling, unread badges. "Delete chat history" hides a private thread for you only; the global channel cannot be deleted. |
| **Crews** | Open / private / invite-only groups. Roles (owner / admin / member), join requests and approvals, invites, crew wall, crew meetups. |
| **Meetups** | Anyone can host. Open, private (approval) or invite-only. Location via street-name search or the device GPS, with one-tap Google Maps directions. Capacity, maybe, invites. |
| **Activity** | Notifications for requests, likes, comments, votes, invites and approvals, plus live nav badges. |

## Android app

`android/` holds a native WebView shell for **https://streeto.net**. GitHub
Actions builds a signed release APK (`.github/workflows/android.yml`) on every
push to `main`, and the login page offers it for download. Distribution is
website-only; there is no Play Store listing.

- package `net.streeto.app`, Android 7.0+ (API 24)
- camera/gallery uploads, GPS, back button, pull-to-refresh
- fixed release signing key stored in GitHub Secrets, so updates install over
  older versions
- rebuild: Actions → **Build Android APK**; copy `app-release.apk` to
  `public/downloads/STREETO-android.apk` for the login-page button

See [android/README.md](android/README.md) for details.

## Setup

Requirements: **Node.js 22.5+** (the app uses the built-in `node:sqlite`).
Node 24/26 recommended. No compiler toolchain needed on any platform.

The live site runs in **production** - there is one environment file
(`.env.production`, git-ignored) and one way to start it:

```bash
npm install
npm run golive          # creates .env.production, sets up Cloudflare, installs the services
npm start               # runs the live server with .env.production
```

`go-live.bat` does the same on Windows without installing anything as a
service - it starts the tunnel connector and the server in the foreground.

### Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTPS port (443 in production) |
| `HTTP_PORT` | `0` | Plain-HTTP port that only redirects to HTTPS (80 in production) |
| `HOST` | `0.0.0.0` | Listen address |
| `NODE_ENV` | `development` | `production` requires `SESSION_SECRET` |
| `SESSION_SECRET` | dev fallback | **Required** in production, min 16 chars |
| `PUBLIC_URL` | - | The address the site is reached on, e.g. `https://streeto.net` |
| `TRUST_PROXY` | `on` in production | Read the real visitor IP from `X-Forwarded-*` (Cloudflare) |
| `CERT_DIR` | `certs` | TLS certificate folder (`origin.pem` wins over `cert.pem`) |
| `CF_API_TOKEN` | - | Cloudflare API token for the dynamic DNS updater |
| `CF_ZONE_ID` | - | The Cloudflare zone id of the domain |
| `CF_DNS_NAME` | - | The DNS record the updater keeps pointed at this machine |
| `DB_PATH` | `data/streeto.db` | SQLite file (WAL mode) |
| `UPLOAD_DIR` | `uploads` | Where photos/videos are stored |
| `MAX_UPLOAD_MB` | `25` | Per-file upload limit |
| `SITE_NAME` | `STREETO` | Branding shown in the UI |
| `BROWSER_PATH` | auto-detected | Edge/Chrome binary used for the fines lookup |
| `FINES_TIMEOUT_MS` | `60000` | How long a fines lookup may take before the browser is killed |
| `PTI_LOOKUP` | `on` | Annual technical-inspection lookup on pti.ge |
| `PTI_TIMEOUT_MS` | `4000` | How long a pti.ge lookup may take |
| `PTI_REFRESH_HOURS` | `24` | Refresh a stored inspection after this many hours |
| `PTI_SCAN_HOURS` | `24` | Background sweep that refreshes every member's stale plates |
| `PTI_BASE_URL` | `https://pti.ge/` | Override the pti.ge base URL (tests use a local stub) |
| `GEMINI_API_KEY` | dev fallback | Google Gemini key used to read registration certificates |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Which Gemini model does the certificate OCR |
| `GEMINI_TIMEOUT_MS` | `60000` | How long to wait for a Gemini reply |

### Certificate OCR
The registration-certificate scanner (`My Ride` → scan a card) runs entirely on
the server. The photo is uploaded to `POST /api/ocr/certificate`, sent to the
**Google Gemini** API with a JSON instruction, and the structured answer is
mapped onto the certificate fields. There is no browser-side OCR and no
third-party OCR service in the loop.

Every text field is read in both spellings. The card prints Georgian and Latin
next to each other (`ბენზინი/Gasoline`), and the app keeps both in the one
field: `Gasoline / ბენზინი`. The photo is deleted from the upload folder as
soon as the fields have been extracted.

Gemini reads **every** field the card prints - there is no field list to
maintain, no `OCR_WANTED_CODES`, no whitelist. The only field that is skipped
is the registration number when the *back* of the card is scanned, because
that corner holds a picture of the plate rather than a printed value.

Models are tried in order: `gemini-2.5-flash`, then `gemini-flash-lite-latest`,
then `gemini-2.5-flash-lite` and `gemini-flash-latest`. The Gemini free tier
counts the daily quota **per model** (20 a day for `gemini-2.5-flash`, far more
for the lite models), so the fallback keeps the scanner working when one model
runs out.

Generate a production secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Scripts

| Command | Does |
| --- | --- |
| `npm start` | Start the live server with `.env.production` |
| `npm run start:prod` | Start with `.env.production` (the live site) |
| `npm run start:prod` | Start the live server with `.env.production` |
| `npm run seed` | Insert demo data (skip if users exist) |
| `npm run seed -- --fresh` | Wipe demo tables, then re-seed |
| `npm run cert` | Regenerate the local self-signed certificate |
| `npm run ddns` | Point the Cloudflare DNS record at this machine's public IP (only needed without a tunnel) |
| `npm run golive` | Prepare everything and go live (Cloudflare, tunnel, services) |
| `npm run prodcheck` | Check the production setup and report what is missing |
| `npm run smoke` | Full HTTP end-to-end test against a throwaway database |

On Windows, `go-live.bat` in the project folder starts the tunnel connector
and the server as foreground processes - double-click it and the site is
live, no service install needed.

`scripts/setup-production.ps1` runs the go-live automation with administrator
rights - it re-launches itself elevated if needed (see *Going live* below).

`npm run smoke` boots the real app on a random port, drives two logged-in
clients through register → post → like → comment → befriend → chat (private and
global) → crew → meetup → build (upload, vote, private visibility, delete),
registration-certificate sync and technical-inspection badges (against a local
pti.ge stub), plus the auth/validation failure cases, and prints a pass/fail
summary. It never touches your real database or calls the real pti.ge.

## Going live (streeto.net behind Cloudflare)

The site is served from one machine on your home network. A **Cloudflare
Tunnel** carries the traffic, so the machine dials out to Cloudflare and no
port has to be opened in the router:

```
visitor ──HTTPS──▶ Cloudflare (streeto.net) ──tunnel──▶ cloudflared ──HTTPS──▶ localhost:443 ──▶ Node app
```

Because the tunnel makes an outgoing connection, a changing public IP does
not matter - there is no A record to keep up to date and nothing to forward.

### 1. Cloudflare dashboard

1. **Add the site** - Cloudflare → *Add a site* → `streeto.net` → Free plan →
   point the registrar at the two nameservers Cloudflare gives you. Wait until
   the zone shows *Active*.
2. **Tunnel** - *Networking → Tunnels* → *Create tunnel* → name it
   `streeto.net` → pick **cloudflared**. Add two routes (*Published
   application*):
   - `streeto.net` → `https://localhost:443`
   - `www.streeto.net` → `https://localhost:443`

   In *Additional application settings → TLS*, set **Origin Server Name** to
   `streeto.net` and turn on **Disable TLS certificate verification**
   (cloudflared on Windows cannot use the system root pool, and the Origin CA
   is not a public root).
3. **Origin certificate** - *SSL/TLS → Origin Server → Create Certificate*:
   - Private key and CSR → *Generate private key and CSR with Cloudflare*
   - Hostnames: `streeto.net` and `*.streeto.net`
   - Validity: 15 years

   Save the **certificate** as `certs/origin.pem` and the **private key** as
   `certs/origin-key.pem`. The server prefers that pair over the local
   self-signed one.
4. **SSL mode** - *SSL/TLS → Overview* → **Full (strict)**.
5. **Always use HTTPS** - *SSL/TLS → Edge Certificates → Settings* → turn on
   *Always Use HTTPS*.
6. **WebSockets** - *Network → WebSockets* → on (it is by default). The chat
   dock needs it.

### 2. Your machine

The whole thing is one command:

```bash
npm run golive          # prepare, configure Cloudflare, install the services
npm run golive -- check # only report what is missing
npm run golive -- verify # is the public site answering?
```

On Windows there is also **`go-live.bat`** - double-click it and it starts
both foreground processes (the cloudflared connector in a small window and the
server in the main one), so the site is live without any service install.
Running it twice is safe: it stops the old server and keeps the tunnel.

`npm run golive` is **idempotent** - it fills in whatever is missing and
leaves the rest alone, so it is also the script to run after moving the
project to another PC or a server. It:

1. installs the dependencies and writes `.env.production` (with a freshly
   generated `SESSION_SECRET`),
2. asks Cloudflare for an **Origin CA certificate** - the key is generated on
   your machine and never leaves it,
3. finds your zone, creates or reuses the **tunnel**, points its routes at
   `https://localhost:443`, and makes sure the DNS records follow,
4. sets **SSL mode = Full (strict)** and **Always Use HTTPS**,
5. installs the `cloudflared` connector and registers both the connector and
   the app as services that start with the machine.

The last step needs administrator rights. On Windows run it once from an
elevated PowerShell window (it re-launches itself elevated if needed):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-production.ps1
```

On Linux and macOS the same `npm run golive` writes a systemd unit or a
launchd agent - use `sudo` for the systemd case.

The script needs one Cloudflare API token in `.env.production`:

```bash
CF_API_TOKEN=<token>
```

Create it at *Cloudflare → My Profile → API Tokens → Create Token → Custom
token* with these permissions: **Account → Cloudflare Tunnel → Edit**,
**Zone → DNS → Edit**, **Zone → Zone Settings → Edit**, **Zone → SSL and
Certificates → Edit** and **Zone → Zone → Read**. The token is only ever read
from the file - the script never prints it.

`.env.production` holds the production settings and is git-ignored. It ships
with `PUBLIC_URL=https://streeto.net`, `PORT=443`, `HTTP_PORT=80` and
`TRUST_PROXY=1` already filled in, plus a freshly generated `SESSION_SECRET`.

`TRUST_PROXY=1` makes the app read the real visitor IP from
`X-Forwarded-For` - without it every visitor would look like Cloudflare to
the rate limiter.

Nothing has to be forwarded in the router, and no dynamic DNS is needed - the
tunnel handles a changing IP on its own.

### 3. Check it works

```bash
npm run prodcheck                       # local configuration
npm run golive -- verify                # end-to-end check
curl -I https://streeto.net             # the public site
```

If the site does not come up, work through it in this order: is the
`Cloudflared` service running, is the `STREETO server` task running, and does
the tunnel show four registered connections in the dashboard.

### Without a tunnel

The same app also works with plain port forwarding - forward 80 and 443 to
the machine, point an `A` record at the public IP and keep it updated with
`npm run ddns` (which needs `CF_API_TOKEN`, `CF_ZONE_ID` and `CF_DNS_NAME` in
`.env.production`). The tunnel is simpler because it needs neither.

## How it's built

```
server.js                 HTTP listener + graceful shutdown
src/
  app.js                  express app: security headers, session, routes, layout
  config.js               env loading + validation
  db.js                   node:sqlite handle, query helpers, migration runner
  migrations/001_init.sql the whole schema
  migrations/002_builds_and_channels.sql  builds, voting, awards, chat channels
  lib/
    password.js           scrypt hashing (constant-time verify)
    validate.js           username / password / email / coords rules
    uploads.js            multer disk storage with a strict mime allowlist
    fines.js              headless-browser lookup of protocols.ge fines
    pti.js                pti.ge annual-inspection lookup + badge state
    geocode.js            Nominatim proxy (street search + reverse), throttled
    periods.js            ISO week / month / year keys for the build contest
    post-form.js          turns a composer submission into a post row
    presence.js           who is online right now (sockets + last_seen)
    format.js             template helpers (escaping, time-ago, labels)
    http.js               JSON/redirect/paging helpers
    session-store.js      express-session store backed by SQLite
    how-it-works-seed.js  the starting copy of the manual page
    scan-keys.js          finds every translatable string in the code
  middleware/
    auth.js               current user, flashes, route guards, error handler
    csrf.js               session-bound CSRF tokens
    rate-limit.js         in-memory limiter for login/register/geocode
  models/                 users, posts, friends, groups, chat, builds, meetups,
                          notifications, translations, howitworks
  routes/                 auth, wall, profile, friends, chat, builds, groups,
                          meetups, notifications, search, api, pages
views/                    EJS: layout + partials + one folder per area
public/
  websitelogo.png         the STREETO wordmark (topbar, footer, hero, auth) - drop a new file here to replace it
  css/style.css           the whole dark/neon design system
  js/app.js               menus, likes, comments, composer, badges, lightbox,
                          build voting + gallery
  js/chat.js              chat polling + send
  js/map-picker.js        MapLibre map picker (search + GPS pin)
  js/map-style.js         the minimal dark basemap style (roads + 3D buildings)scripts/seed.js           demo data (incl. generated build cover art)
scripts/smoke.js          end-to-end test
```

### Design decisions

- **`node:sqlite` instead of `better-sqlite3`** — no native compilation, so
  `npm install` works everywhere. WAL mode plus a busy timeout keep concurrent
  reads and writes smooth.
- **scrypt instead of bcrypt** — ships with Node's `crypto`, so the same
  zero-native-dependency rule holds. Hashes are self-describing
  (`scrypt$N$r$p$salt$hash`) so parameters can be raised later.
- **Server-rendered EJS** — the HTML is the app. Small vanilla ES modules layer
  on interactivity (likes, comments, chat, maps) without a framework or build.
- **Polling, not WebSockets** — the chat thread polls every 3s and the nav
  badges every 20s. Simpler to run, no extra dependency.
- **The dictionary lives in the database** — `src/lib/locales/ka.js` seeds the
  `translations` table on boot, and from then on the table is the truth. An
  admin can correct any Georgian string from the console and it is live on
  the next request, with no redeploy. The English source text stays the key,
  so a translation can never break a template. The same idea runs through the
  "How it works" page: its sections and lines are rows, so an admin can add,
  retitle, reorder or delete them, and a deleted line takes its Georgian
  translation with it (unless the same English text is still used somewhere
  else in the code).
- **The manual is edited in place** — the admin console shows every article
  and every line of the manual with its English and its Georgian side by side,
  and the lines are dragged into place. The English text of a line *is* its
  translation key, so writing the manual and filling in the Translations
  console are the same thing. The public page and the editor share one
  partial, so what the admin writes is exactly what the visitors get.
- **New wording is never forgotten** — `src/lib/scan-keys.js` reads the
  templates, the server and the browser scripts on every boot and makes sure
  every string they translate has a row, with an empty value when there is no
  Georgian yet. Anything the site asks for at runtime that the scanner cannot
  see (a label out of a table, a word from the database) is registered the
  first time it is rendered. So a new feature shows up in the admin's
  translation list by itself, and the console marks the ones still waiting.
- **Replies, mentions and reactions** — a comment can be answered (the reply
  hangs under it and the person who wrote it gets a notification), `@name`
  works in comments and in the chat and turns into a link, a chat message can
  be answered with a swipe, and a long press (or a right click) opens an emoji
  strip. The mention picker is one module (`public/js/mentions.js`) shared by
  the comment box and the chat box.
- **MapLibre GL + OpenFreeMap** — maps with no API key. The basemap is a custom
  minimal dark style: roads, road names, water and 3D-extruded buildings, with
  no satellite imagery and no landuse clutter. Tiles are vector (OpenMapTiles
  schema) so the buildings can be extruded. Street search and reverse geocoding
  go through a small server-side Nominatim proxy so the browser talks only to
  this app (and the tile server), and requests are throttled and cached.
  "Get directions" hands off to Google Maps with the destination already set.
  A saved spot keeps the zoom it was picked at, so the shared map opens on
  the same view. The pin itself is the author's avatar - the street name
  is already in the card header and footer, so it would be a duplicate.
- **Two chat channels, one table** — `conversations.kind` is `dm` or `global`.
  The global channel is created by migration 002, every new account is added to
  it on register, and it can never be deleted.
- **Online friends** — the green dot on an avatar comes from two signals: a
  socket is open for that member, and they made a request in the last minute
  (`users.last_seen`). Either one is enough, so the dot is right even when the
  socket handshake does not carry the session.
- **The provider name is never typed in** — ticking *I offer car services*
  declares the intent and unlocks the **Claim** button (the route checks it
  too). The name itself is taken from the listing the member owns or verified,
  so it always matches a real shop.
- **Delete-chat means delete-for-me** — a per-user `cleared_at` marker hides a
  private thread from your inbox while the other person keeps their history;
  the thread returns if they write again.
- **Derived, idempotent build awards** — votes are one-per-driver-per-ISO-week
  (`build_votes` is keyed on `(user_id, week)`). `recomputeAwards()` replays the
  history into `build_awards`: the most-voted build of a finished week is Build
  of the Week, four weekly wins inside one calendar month upgrade it to Build of
  the Month, and a build whose yearly win count beats the rest of the field's
  average takes Build of the Year. Nothing is hand-written, so the leaderboards
  can always be rebuilt from votes alone.

### Security notes

- Strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`,
  `no-referrer`-ish referrer policy and a `Permissions-Policy` that allows
  geolocation only for this origin.
- Session-bound CSRF tokens on every mutating route, verified *after* multer so
  multipart posts are covered too. Fetch calls send `x-csrf-token`.
- Cross-origin form posts are rejected by an Origin check.
- Uploads are stored with random filenames, filtered by mime type, and served
  with `nosniff`.
- Passwords are hashed with scrypt; login timing is equalised for missing
  accounts.

## Roadmap ideas

- WebSocket chat instead of polling
- Push notifications / email digests
- Event photos and a post-meetup recap
- Convoy mode: live location sharing during a run
- Route planning with waypoints on the map

---

Ride legal, stay safe. This is a demo project — don't organise anything on
public roads that you wouldn't want to explain to a police officer.
