/**
 * Release notes shown in Settings → App & updates → Changes.
 *
 * One entry per user-facing release, newest first. `scope` says whether the
 * release changed the website, the Android shell or both. The strings are
 * English source keys, translated through t() when the page is rendered.
 *
 * When releasing: add the new entry at the top (version, ISO date, scope and
 * the English strings), then add the Georgian translation for every new
 * string to src/lib/locales/ka.js.
 */
export const CHANGELOG = [
  {
    version: '1.2.0',
    date: '2026-10-24',
    scope: 'both',
    items: [
      'Activity avatars stay round and centred on mobile.',
      'Mute a chat by swiping right; delete is still a left swipe. Mouse drags work too.',
      'Browser and Android notifications for messages, friend requests, comments, likes and activity.',
      'Near-realtime Android notifications through Firebase Cloud Messaging.',
    ],
  },
  {
    version: '1.1.3',
    date: '2026-10-24',
    scope: 'android',
    items: [
      'Animated splash screen.',
    ],
  },
  {
    version: '1.1.2',
    date: '2026-10-24',
    scope: 'android',
    items: [
      'New STREETO launcher icon.',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-10-24',
    scope: 'web',
    items: [
      'A Changes panel in Settings lists what was updated.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-24',
    scope: 'both',
    items: [
      'In-app update check with a native APK downloader.',
      'Web and Android versions in the footer.',
      'SHA-256 verification before installing an update.',
      'Georgian messages in the Android shell.',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-10-23',
    scope: 'android',
    items: [
      'First signed release with a permanent signing key.',
      'Website-only distribution.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-23',
    scope: 'android',
    items: [
      'STREETO for Android: full-screen WebView, camera and gallery uploads, GPS, pull-to-refresh and an offline screen.',
    ],
  },
];

export default { CHANGELOG };
