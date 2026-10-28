/**
 * Seed the database with a small, believable slice of the network so the
 * UI has something to show on a fresh install.
 *
 *   npm run seed            # add demo data (skips if users already exist)
 *   npm run seed -- --fresh # wipe demo tables first, then seed
 *
 * All demo accounts share the password: street123
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { db, run, get, tx } from '../src/db.js';
import config from '../src/config.js';
import { hashPassword } from '../src/lib/password.js';
import * as users from '../src/models/users.js';
import * as posts from '../src/models/posts.js';
import * as friends from '../src/models/friends.js';
import * as groups from '../src/models/groups.js';
import * as chat from '../src/models/chat.js';
import * as builds from '../src/models/builds.js';
import * as meetups from '../src/models/meetups.js';
import { notify } from '../src/models/notifications.js';
import { currentWeek } from '../src/lib/periods.js';

const PASSWORD = 'street123';
const FRESH = process.argv.includes('--fresh');

const PEOPLE = [
  {
    username: 'nightrider',
    email: 'nightrider@streeto.test',
    display_name: 'Maya "Nightrider" Cole',
    car: '1995 Nissan Skyline R33',
    city: 'Yokohama',
    bio: 'Touge on weekends, wrenching on weekdays. Keep it on the mountain.',
  },
  {
    username: 'burnout_bex',
    email: 'bex@streeto.test',
    display_name: 'Bex Halvorsen',
    car: '1999 Honda Civic EK9',
    city: 'Bergen',
    bio: 'Vtec kicked in. Coffee kicked in harder.',
  },
  {
    username: 'kev_boost',
    email: 'kev@streeto.test',
    display_name: 'Kevin Ruiz',
    car: '1993 Mazda RX-7 FD',
    city: 'Los Angeles',
    bio: 'Rotary life. Always low on oil, always smiling.',
  },
  {
    username: 'sara_drift',
    email: 'sara@streeto.test',
    display_name: 'Sara Okafor',
    car: '1998 Toyota Supra MK4',
    city: 'Manchester',
    bio: 'Sideways is the fastest way around a corner.',
  },
  {
    username: 'tomas_diesel',
    email: 'tomas@streeto.test',
    display_name: 'Tomas Lindqvist',
    car: '2004 Subaru Impreza WRX',
    city: 'Stockholm',
    bio: 'AWD and gravel. Bring spare wheels.',
  },
  {
    username: 'mika_gtr',
    email: 'mika@streeto.test',
    display_name: 'Mika Tanaka',
    car: '2000 Nissan Silvia S15',
    city: 'Osaka',
    bio: 'Lights, camera, clutch kick.',
  },
];

/* ── demo cover images ──────────────────────────────────────────
 * A tiny PNG writer so seeded builds have real gallery images
 * without shipping binary fixtures. Solid gradients, no deps.
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b;
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const lit = l / 100;
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;
  let rgb = [0, 0, 0];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
}

/** Write a gradient PNG into the uploads dir and return its filename. */
function writeCover(hue, width = 720, height = 450) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const buffer = makePng(width, height, (x, y) => {
    const base = hslToRgb(hue + x * 0.06, 52, 8 + 20 * (1 - y / height));
    const diagonal = Math.abs(x / width - y / height);
    const boost = diagonal < 0.08 ? 46 : 0;
    const stripe = (x + y) % 90 < 3 ? 18 : 0;
    return [
      Math.min(255, base[0] + boost + stripe),
      Math.min(255, base[1] + boost + stripe),
      Math.min(255, base[2] + boost + stripe),
    ];
  });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.png`;
  fs.writeFileSync(path.join(config.uploadDir, name), buffer);
  return name;
}

function wipe() {
  // Child rows go first so the foreign keys stay happy; sessions are
  // left alone so a running dev server keeps you logged in. The shared
  // global channel row survives - only its history is cleared.
  const tables = [
    'notifications', 'build_awards', 'build_votes', 'build_media', 'builds',
    'meetup_attendees', 'meetups', 'messages', 'comments', 'post_likes',
    'posts', 'group_members', 'groups', 'friendships', 'users',
  ];
  tx(() => {
    run(`DELETE FROM conversations WHERE kind = 'dm'`);
    for (const table of tables) run(`DELETE FROM ${table}`);
    run(`DELETE FROM sqlite_sequence WHERE name <> ''`);
  });
  console.log('[seed] wiped demo tables');
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600_000).toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z');
}

async function main() {
  const existing = get('SELECT COUNT(*) AS n FROM users').n;
  if (existing && !FRESH) {
    console.log(`[seed] ${existing} users already present - nothing to do. Use --fresh to reset.`);
    return;
  }
  if (FRESH) wipe();

  const passwordHash = await hashPassword(PASSWORD);

  /* ── people ─────────────────────────────────────────────────── */
  const byHandle = {};
  tx(() => {
    for (const person of PEOPLE) {
      const created = users.createUser({
        username: person.username,
        email: person.email,
        passwordHash,
        displayName: person.display_name,
      });
      run(
        `UPDATE users SET bio = ?, car = ?, city = ? WHERE id = ?`,
        person.bio,
        person.car,
        person.city,
        created.id,
      );
      byHandle[person.username] = created.id;
      chat.joinGlobal(created.id);
    }
  });
  console.log(`[seed] created ${PEOPLE.length} drivers (password: ${PASSWORD})`);

  /* ── the founding admin ─────────────────────────────────────── */
  const admin = users.createUser({
    username: 'admin',
    email: 'streeto.official@gmail.com',
    passwordHash,
    displayName: 'STREETO Admin',
  });
  run(
    `UPDATE users SET city = ?, bio = ?, is_admin = 1 WHERE id = ?`,
    'HQ',
    'Keeper of the keys. Promotes drivers, moderates the feed, runs the backups.',
    admin.id,
  );
  byHandle.admin = admin.id;
  chat.joinGlobal(admin.id);
  console.log(`[seed] created the founding admin (username: admin, password: ${PASSWORD})`);

  const [maya, bex, kev, sara, tomas, mika] = PEOPLE.map((p) => byHandle[p.username]);

  /* ── friendships ────────────────────────────────────────────── */
  const friendPairs = [
    [maya, bex], [maya, kev], [maya, sara],
    [bex, sara], [kev, tomas], [sara, mika], [tomas, mika],
  ];
  for (const [a, b] of friendPairs) {
    const sent = friends.sendRequest(a, b);
    if (sent.ok && !sent.accepted && sent.id) friends.acceptRequest(sent.id, b);
  }
  // One request still waiting, so the "friends" badge has something in it.
  friends.sendRequest(tomas, bex);
  console.log('[seed] friendships + 1 pending request');

  /* ── wall posts ─────────────────────────────────────────────── */
  const wall = [
    { u: maya, body: 'Touge run tonight. Leaving the 7-Eleven at 11pm, three cars max, no hero stuff.', type: 'text' },
    { u: kev, body: 'Fresh set of R888s mounted. The FD is finally hooking up in second.', type: 'text' },
    { u: sara, body: 'Street meet at the docks this Saturday - bring the loud ones.', type: 'text' },
    { u: tomas, body: 'Gravel recce done. The forest road is dry and empty, perfect for an AWD meetup.', type: 'text' },
    {
      u: bex,
      body: 'Someone left a jack and a torque wrench at the last canyon meet. Claim it.',
      type: 'location',
      place: 'Sognefjellet Pass',
      address: 'Sognefjellet, Norway',
      lat: 61.5189,
      lng: 7.8554,
    },
    {
      u: mika,
      body: 'Daikoku PA is filling up already. Come through.',
      type: 'location',
      place: 'Daikoku Futo PA',
      address: 'Daikoku Futo, Yokohama, Japan',
      lat: 35.4589,
      lng: 139.6747,
    },
    {
      u: maya,
      body: 'Blew a coolant hose halfway up the mountain - anyone near Hakone with a tow strap?',
      type: 'emergency',
      place: 'Hakone Turnpike',
      address: 'Hakone, Kanagawa, Japan',
      lat: 35.2127,
      lng: 139.0247,
    },
  ];
  const postIds = [];
  tx(() => {
    for (const post of wall) {
      postIds.push(
        posts.createPost({
          userId: post.u,
          body: post.body,
          postType: post.type,
          placeName: post.place ?? null,
          address: post.address ?? null,
          lat: post.lat ?? null,
          lng: post.lng ?? null,
        }),
      );
    }
  });
  console.log(`[seed] created ${postIds.length} wall posts`);

  /* ── likes + comments ───────────────────────────────────────── */
  tx(() => {
    const likes = [
      [postIds[0], bex], [postIds[0], kev], [postIds[0], mika],
      [postIds[1], maya], [postIds[1], tomas],
      [postIds[2], sara, false], // placeholder, filtered below
      [postIds[3], maya], [postIds[5], kev], [postIds[5], sara],
      [postIds[6], bex], [postIds[6], tomas],
    ];
    for (const [postId, userId, keep] of likes) {
      if (keep === false) continue;
      posts.toggleLike(postId, userId);
    }

    posts.addComment({ postId: postIds[0], userId: bex, body: 'In. I will bring the GoPro.' });
    posts.addComment({ postId: postIds[0], userId: kev, body: 'Give me 20 minutes, RX-7 is warming up.' });
    posts.addComment({ postId: postIds[1], userId: maya, body: 'Those tyres are worth more than my car.' });
    posts.addComment({ postId: postIds[6], userId: tomas, body: 'That is a two hour drive for me - try the local crew first.' });
    posts.addComment({ postId: postIds[6], userId: sara, body: 'Post your exact pin, someone will be close.' });
  });
  console.log('[seed] likes + comments');

  /* ── crews ──────────────────────────────────────────────────── */
  const crews = [
    {
      name: 'Night Runners',
      description: 'Touge and canyon runs. Open to anyone who keeps it safe on public roads.',
      privacy: 'open',
      owner: maya,
      members: [bex, kev, sara, mika],
    },
    {
      name: 'Dockside Drift',
      description: 'Weekend slide sessions at the docks. Private - request to join.',
      privacy: 'private',
      owner: sara,
      members: [maya, bex],
    },
    {
      name: 'Rotary Only',
      description: 'Invite only. If you know, you know.',
      privacy: 'invite',
      owner: kev,
      members: [mika],
    },
  ];
  const crewIds = {};
  for (const crew of crews) {
    const created = groups.createGroup({
      name: crew.name,
      description: crew.description,
      privacy: crew.privacy,
      ownerId: crew.owner,
    });
    crewIds[crew.name] = created.id;
    for (const member of crew.members) {
      if (crew.privacy === 'invite') groups.invite(created.id, member);
      else groups.join(created, member);
    }
  }
  console.log(`[seed] created ${crews.length} crews`);

  // A couple of posts inside the open crew.
  tx(() => {
    posts.createPost({
      userId: bex,
      groupId: crewIds['Night Runners'],
      body: 'Route for Friday: coast road out, mountain pass back. Meeting at the usual car park.',
      postType: 'text',
    });
    posts.createPost({
      userId: sara,
      groupId: crewIds['Night Runners'],
      body: 'The back straight is freshly resurfaced. Grip for days.',
      postType: 'text',
    });
  });

  /* ── chat ───────────────────────────────────────────────────── */
  const convo = chat.ensureConversation(maya, bex);
  tx(() => {
    chat.sendMessage({ conversationId: convo.id, senderId: maya, body: 'You still coming tonight?' });
    chat.sendMessage({ conversationId: convo.id, senderId: bex, body: 'Yeah, just finishing the alignment.' });
    chat.sendMessage({ conversationId: convo.id, senderId: maya, body: 'Bring the jack, mine is at the shop.' });
  });
  const convo2 = chat.ensureConversation(kev, mika);
  tx(() => {
    chat.sendMessage({ conversationId: convo2.id, senderId: mika, body: 'Rotary meet next month - you in?' });
    chat.sendMessage({ conversationId: convo2.id, senderId: kev, body: 'Would not miss it.' });
  });
  chat.markRead(convo.id, maya);

  // The open global channel everyone shares.
  const global = chat.globalChannel();
  if (global) {
    tx(() => {
      chat.sendMessage({ conversationId: global.id, senderId: sara, body: 'Who is out tonight? Sky is clear over the docks.' });
      chat.sendMessage({ conversationId: global.id, senderId: mika, body: 'Working late, might catch the second run.' });
      chat.sendMessage({ conversationId: global.id, senderId: tomas, body: 'Gravel road was graded last week - it is fast right now.' });
    });
  }
  console.log('[seed] chat threads + global channel');

  /* ── meetups ────────────────────────────────────────────────── */
  const meetupSeeds = [
    {
      hostId: maya,
      title: 'Midnight Mountain Run',
      description: 'Chill pace, clean lines, no crossing the centre line. Coffee at the top.',
      placeName: 'Hakone Turnpike',
      address: 'Hakone, Kanagawa, Japan',
      lat: 35.2127,
      lng: 139.0247,
      startsAt: hoursFromNow(30),
      privacy: 'open',
      capacity: 12,
      category: 'touge',
      routeStartLat: 35.2127,
      routeStartLng: 139.0247,
      routeStartName: 'Hakone Turnpike',
      routeEndLat: 35.2451,
      routeEndLng: 139.0182,
      routeEndName: 'Lake Ashi overlook',
      routeDistanceKm: 14.2,
    },
    {
      hostId: sara,
      title: 'Dockside Slide Session',
      description: 'Cone layout on the east lot. Bring spare wheels and a helmet.',
      placeName: 'Trafford Park Docks',
      address: 'Trafford Park, Manchester, UK',
      lat: 53.4672,
      lng: -2.3319,
      startsAt: hoursFromNow(78),
      privacy: 'private',
      capacity: 20,
    },
    {
      hostId: tomas,
      title: 'Gravel Recce - Forest Road',
      description: 'AWD only. We drive the stage, then decide if it is worth a timed run.',
      placeName: 'Tyresta Forest',
      address: 'Tyresta, Stockholm, Sweden',
      lat: 59.1818,
      lng: 18.2372,
      startsAt: hoursFromNow(120),
      privacy: 'open',
      capacity: 8,
    },
    {
      hostId: kev,
      title: 'Rotary Owners Night',
      description: 'Invite only - parking lot meet, then food.',
      placeName: 'Daikoku Futo PA',
      address: 'Daikoku Futo, Yokohama, Japan',
      lat: 35.4589,
      lng: 139.6747,
      startsAt: hoursFromNow(200),
      privacy: 'invite',
      capacity: 6,
    },
  ];
  for (const seed of meetupSeeds) {
    const created = meetups.createMeetup(seed);
    if (seed.privacy === 'invite') {
      meetups.setStatus(created.id, mika, 'invited');
    }
    if (seed.privacy === 'private') {
      meetups.setStatus(created.id, bex, 'requested');
    }
  }
  console.log(`[seed] created ${meetupSeeds.length} meetups`);

  /* ── builds + the weekly vote ───────────────────────────────── */
  const buildSeeds = [
    {
      key: 'skyline', owner: 'nightrider', hue: 195,
      title: 'Midnight Skyline', make: 'Nissan', model: 'Skyline R33 GT-R', year: 1995,
      engine: 'RB26DETT 2.6 twin turbo', drivetrain: 'AWD', transmission: '5-speed manual',
      power_hp: 420, torque_nm: 392, weight_kg: 1560,
      mods: 'Turbo-back exhaust, HKS coilovers, big brake kit, Nitto NT01 semi-slicks, boost controller.',
      description: 'Bought it stock and slowly turned it into the reliable touge car it is today. Nothing showy - it just never breaks.',
      visibility: 'public',
    },
    {
      key: 'rx7', owner: 'kev_boost', hue: 12,
      title: 'Rotary Reaper', make: 'Mazda', model: 'RX-7 FD', year: 1993,
      engine: '13B-REW twin turbo', drivetrain: 'RWD', transmission: '5-speed manual',
      power_hp: 380, torque_nm: 320, weight_kg: 1280,
      mods: 'Single turbo conversion, front-mount intercooler, Apexi ECU, welded diff, Bride buckets.',
      description: 'Rebuilt the engine twice, learned a lot, spent too much. Sounds like nothing else on the road.',
      visibility: 'public',
    },
    {
      key: 'supra', owner: 'sara_drift', hue: 285,
      title: 'Supra Mk4 - street and track', make: 'Toyota', model: 'Supra MK4', year: 1998,
      engine: '2JZ-GTE 3.0 twin turbo', drivetrain: 'RWD', transmission: '6-speed manual',
      power_hp: 520, torque_nm: 610, weight_kg: 1580,
      mods: 'Big single turbo, forged internals, 6-pot front brakes, roll cage, 18s with R888R.',
      description: 'Weekend track toy that still takes me to work on Mondays.',
      visibility: 'public',
    },
    {
      key: 'civic', owner: 'burnout_bex', hue: 92,
      title: 'Budget Hero EK9', make: 'Honda', model: 'Civic EK9', year: 1999,
      engine: 'B16B VTEC 1.6', drivetrain: 'FWD', transmission: '5-speed manual',
      power_hp: 185, torque_nm: 160, weight_kg: 1080,
      mods: 'Intake, header, 4.7 final drive, LSD, coilovers, stripped interior.',
      description: 'Cheap, light and loud. Embarrasses much faster cars in the corners.',
      visibility: 'public',
    },
    {
      key: 'wrx', owner: 'tomas_diesel', hue: 38,
      title: 'WRX gravel spec', make: 'Subaru', model: 'Impreza WRX', year: 2004,
      engine: 'EJ205 2.0 flat-four turbo', drivetrain: 'AWD', transmission: '5-speed manual',
      power_hp: 250, torque_nm: 320, weight_kg: 1420,
      mods: 'Rally coilovers, skid plates, gravel tyres, hydraulic handbrake, mud flaps.',
      description: 'Built for forest roads. Stone chips are a badge of honour.',
      visibility: 'public',
    },
    {
      key: 'silvia', owner: 'mika_gtr', hue: 330,
      title: 'S15 garage queen', make: 'Nissan', model: 'Silvia S15', year: 2000,
      engine: 'SR20DET 2.0 turbo', drivetrain: 'RWD', transmission: '6-speed manual',
      power_hp: 400, torque_nm: 420, weight_kg: 1240,
      mods: 'HKS GT-RS turbo, Nismo clutch, Work wheels, fresh paint.',
      description: 'Kept private while I finish the build. Will share it when it is ready.',
      visibility: 'private',
    },
  ];

  const buildIds = {};
  tx(() => {
    for (const seed of buildSeeds) {
      const id = builds.createBuild({
        userId: byHandle[seed.owner],
        title: seed.title,
        make: seed.make,
        model: seed.model,
        year: seed.year,
        engine: seed.engine,
        drivetrain: seed.drivetrain,
        transmission: seed.transmission,
        powerHp: seed.power_hp,
        torqueNm: seed.torque_nm,
        weightKg: seed.weight_kg,
        mods: seed.mods,
        description: seed.description,
        visibility: seed.visibility,
        cover: null,
      });
      buildIds[seed.key] = id;

      const cover = writeCover(seed.hue);
      run('UPDATE builds SET cover = ? WHERE id = ?', cover, id);
      builds.addMedia({ buildId: id, userId: byHandle[seed.owner], mediaType: 'photo', mediaPath: cover, position: 0 });
      if (seed.visibility === 'public') {
        const detail = writeCover(seed.hue + 26, 720, 450);
        builds.addMedia({ buildId: id, userId: byHandle[seed.owner], mediaType: 'photo', mediaPath: detail, position: 1 });
      }
    }
  });
  console.log(`[seed] created ${buildSeeds.length} builds with covers`);

  // Vote history: a clean run of weekly wins so the week, month and
  // year awards all appear, plus a live contest for the current week.
  const voteRows = [
    ['2025-W44', 'rx7', ['nightrider', 'burnout_bex', 'sara_drift', 'tomas_diesel', 'mika_gtr']],
    ['2025-W45', 'skyline', ['burnout_bex', 'kev_boost', 'sara_drift', 'tomas_diesel']],
    ['2025-W45', 'rx7', ['mika_gtr']],
    ['2025-W46', 'skyline', ['burnout_bex', 'kev_boost', 'sara_drift', 'tomas_diesel']],
    ['2025-W46', 'rx7', ['mika_gtr']],
    ['2025-W47', 'skyline', ['burnout_bex', 'kev_boost', 'sara_drift', 'tomas_diesel']],
    ['2025-W47', 'rx7', ['mika_gtr']],
    ['2025-W48', 'skyline', ['burnout_bex', 'kev_boost', 'sara_drift', 'tomas_diesel']],
    ['2025-W48', 'rx7', ['mika_gtr']],
    ['2025-W49', 'rx7', ['nightrider', 'burnout_bex', 'sara_drift', 'tomas_diesel', 'mika_gtr']],
    ['2025-W50', 'rx7', ['nightrider', 'burnout_bex', 'sara_drift', 'tomas_diesel', 'mika_gtr']],
  ];
  const liveWeek = currentWeek();
  voteRows.push([liveWeek, 'supra', ['nightrider', 'burnout_bex', 'tomas_diesel']]);
  voteRows.push([liveWeek, 'civic', ['kev_boost', 'mika_gtr']]);

  tx(() => {
    for (const [week, buildKey, voters] of voteRows) {
      for (const handle of voters) {
        run(
          `INSERT OR REPLACE INTO build_votes (build_id, user_id, week) VALUES (?, ?, ?)`,
          buildIds[buildKey],
          byHandle[handle],
          week,
        );
      }
    }
  });
  builds.recomputeAwards();

  const fame = ['week', 'month', 'year'].map((kind) => {
    const award = builds.recentAwards(kind, 1)[0];
    return award ? `${kind}=${award.period}` : `${kind}=-`;
  });
  console.log(`[seed] build votes + awards (${fame.join(', ')})`);

  /* ── a few notifications so the bell is not empty ────────────── */
  tx(() => {
    notify({ userId: maya, actorId: bex, type: 'comment', entityId: postIds[0], url: `/posts/${postIds[0]}`, text: 'Bex commented on your post.' });
    notify({ userId: maya, actorId: kev, type: 'like', entityId: postIds[0], url: `/posts/${postIds[0]}`, text: 'Kevin liked your post.' });
    notify({ userId: bex, actorId: tomas, type: 'friend_request', entityId: null, url: '/friends', text: 'Tomas sent you a friend request.' });
    notify({ userId: maya, actorId: sara, type: 'build_vote', entityId: buildIds.skyline, url: `/builds/${buildIds.skyline}`, text: 'Sara voted for your build.' });
  });

  console.log('\n[seed] done.');
  console.log('  Log in as nightrider@streeto.test / street123 (or any demo handle)');
  console.log('  Handles: ' + PEOPLE.map((p) => p.username).join(', '));
  console.log(`  Admin:   streeto.official@gmail.com / ${PASSWORD} (full access at /admin)`);
  console.log('  Try /builds for the garage, voting and the hall of fame.');
}

main()
  .then(() => {
    db.close();
  })
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
    try { db.close(); } catch { /* ignore */ }
  });
