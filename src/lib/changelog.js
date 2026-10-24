/**
 * Release notes shown in Settings → App & updates → Changes.
 *
 * One entry per user-facing release, newest first. `scope` says whether the
 * release changed the website, the Android shell or both. The strings are
 * English source keys, translated through t() when the page is rendered.
 *
 * Add the new entry at the top when releasing. Keep the date in ISO form.
 */
export const CHANGELOG = [
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
