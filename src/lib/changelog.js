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
    version: '1.4.1',
    date: '2026-10-25',
    scope: 'both',
    items: [
      'The Service Provider checkbox keeps its normal size on iOS.',
      'Android now asks for camera permission for the certificate scanner.',
      'The certificate scanner uses the native camera picker on iOS and WebView.',
      'Add vehicle now opens from a direct link and works without the live scanner.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-25',
    scope: 'web',
    items: [
      'Notifications have filters, mark-all-read and per-category push settings.',
      'Video processing runs in a durable background queue, so uploads return immediately.',
      'Builds, meetups and Touge routes have public share cards with generated preview images.',
      'A sitemap and robots file make public pages discoverable.',
      'Near you finds meetups, crews and drivers by city or current location.',
      'Web UI checks cover 390 and 1440 layouts, WCAG and Georgian long strings.',
      'Android CI now builds only when Android files change.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-24',
    scope: 'web',
    items: [
      'One shared UI system now keeps buttons, avatars, headers and text consistent on web, Android and the future iOS app.',
      'A live UI style guide is available in the admin console.',
      'Controls and safe areas are ready for notched phones.',
      'The top bar keeps only the Activity bell; Chat stays in the floating launcher and Meetups in the menus.',
      'Desktop, mobile and WebView now share one set of layout and component rules.',
    ],
  },
  {
    version: '1.2.5',
    date: '2026-10-24',
    scope: 'web',
    items: [
      'Small-screen layout fixes for partner logos, filters and action buttons.',
      'Activity, search results and pin-drop text wraps instead of being cut off.',
      'Registration certificates fit the screen in Fines.',
      'Route maps keep both pins visible on a phone.',
      'Footer links stay clear of the chat and menu buttons.',
    ],
  },
  {
    version: '1.2.4',
    date: '2026-10-24',
    scope: 'web',
    items: [
      'Video cards now have a play cover, duration badge and hover preview.',
      'Uploads are converted to browser-safe H.264/AAC MP4.',
      'Video thumbnails are WebP.',
    ],
  },
  {
    version: '1.2.3',
    date: '2026-10-24',
    scope: 'web',
    items: [
      'Video posts now show a real thumbnail before playback.',
    ],
  },
  {
    version: '1.2.2',
    date: '2026-10-24',
    scope: 'web',
    items: [
      'A one-time post-login prompt offers to turn on notifications.',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-10-24',
    scope: 'android',
    items: [
      'STREETO.NET signature at the bottom of the splash screen.',
    ],
  },
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
