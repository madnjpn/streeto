# STREETO Android

A thin, native Android shell around **https://streeto.net** — the full web app in a WebView.

## What it does

- Loads `https://streeto.net` in a full-screen WebView
- Stays inside the app for `streeto.net` links; other links open in the browser
- Native back button (browser history, then exit)
- Pull to refresh
- File uploads from gallery **or camera**
- Geolocation permission for the map / “Use my GPS”
- Cookies persist between launches (stay logged in)
- Offline screen with a retry button
- Animated launch screen: the S mark settles in, the STREETO wordmark rises, and a cyan line draws in; the Android 12 system splash uses the same S mark
- Thin cyan progress line while pages load
- In-app update check: **Settings → App & updates** shows the web and app versions, and the shell downloads a newer signed APK, checks its SHA-256 and opens the installer
- A dismissible update banner appears when a newer release is being served

## Launcher icon

The source artwork is `android/icon-source.png` (a square PNG). Regenerate all
densities with:

```bash
npm run icons:android
```

This writes the legacy square icons, the circular API 24/25 round icons, the
432 px adaptive background, the transparent adaptive foreground and the
transparent white `streeto_mark.png` used by the splash screen. Commit the
generated resources under `app/src/main/res/`. To use a different source:

```bash
node scripts/build-android-icons.mjs path/to/icon.png
```

## Splash screen

- `res/layout/activity_main.xml` has a full-screen `#splash` overlay above the
  WebView.
- `res/drawable/splash_bg.xml` is the dark background with a maroon radial
  glow; `splash_line.xml` is the cyan underline.
- `res/drawable-nodpi/streeto_mark.png` is generated from the icon source by
  `npm run icons:android` — replace the icon source and rerun to update both
  the launcher icon and the splash mark.
- `MainActivity.startSplash()` runs the intro animation; `hideSplash()` fades
  the overlay out when the first page finishes (minimum 1.2 s, 10 s safety).
- Android 12+ uses the same mark as the system splash icon in
  `res/values-v31/themes.xml`.
- To tune the look, edit the two drawables and the durations in
  `startSplash()`; no other files need to change.

## Build

The signed release APK is built by GitHub Actions (`.github/workflows/android.yml`) on every push to `main` and can be started by hand from **Actions → Build Android APK → Run workflow**.

The build artifact is named **`streeto-release-apk`** and contains `app-release.apk`, signed with the project's release key and verified before upload.

After downloading it, copy `app-release.apk` to
`public/downloads/STREETO-android.apk` so the **STREETO.NET | Android** button
on the login page serves the new build. Distribution is website-only — there is no Play Store listing.

### Versions

The site reads the Android `versionCode` and `versionName` from
`app/build.gradle.kts`, and the web version from the root `package.json`.
The download button and the in-app update check always use whatever APK is at
`public/downloads/STREETO-android.apk`; its SHA-256 is computed on the fly for
the native update check.

### Release checklist

1. Bump the versions:
   - Android: `versionCode` and `versionName` in `app/build.gradle.kts`
   - Web: `npm version <version> --no-git-tag-version`
2. Add a new entry at the **top** of `src/lib/changelog.js`:
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
3. Add the Georgian translation for **every new string** to
   `src/lib/locales/ka.js`, using the same English key.
4. If the Android shell changed: push, download the signed APK artifact and
   copy it to `public/downloads/STREETO-android.apk`.
5. Restart the server and verify `https://streeto.net/api/app/version` and the
   **Settings → App & updates → Changes** panel.

### Signing

Release builds are signed with the keystore held in these repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The keystore and password are kept locally in `android/signing/` (git-ignored)
and in the GitHub secrets above. **Keep them safe** — without them you cannot
update installed copies of the app; users would have to uninstall and reinstall.

Before each release, increase `versionCode` (and usually `versionName`) in `app/build.gradle.kts`. Installed apps only accept an update with the same signing key and a higher `versionCode`.

> The earlier debug APK was signed with a different key. Existing testers must uninstall it once, then install the signed release.

### Local build (optional)

```bash
cd android
gradle assembleRelease
```

Without the `KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and
`KEY_PASSWORD` environment variables the APK is unsigned. The signed
release APK lands in `android/app/build/outputs/apk/release/app-release.apk`.

## Install

Copy the APK to the phone and open it (allow “Install unknown apps” for the file manager / browser you used), or:

```bash
adb install -r app-release.apk
```

## App details

- Package: `net.streeto.app`
- Version: 1.1.3 (versionCode 5)
- Min Android: 7.0 (API 24)
- Target: Android 15 (API 35)
