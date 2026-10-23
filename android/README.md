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
- Thin cyan progress line while pages load

## Build

The signed release APK is built by GitHub Actions (`.github/workflows/android.yml`) on every push to `main` and can be started by hand from **Actions → Build Android APK → Run workflow**.

The build artifact is named **`streeto-release-apk`** and contains `app-release.apk`, signed with the project's release key and verified before upload.

After downloading it, copy `app-release.apk` to
`public/downloads/STREETO-android.apk` so the **STREETO.NET | Android** button
on the login page serves the new build. Distribution is website-only — there is no Play Store listing.

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
- Version: 1.0.1 (versionCode 2)
- Min Android: 7.0 (API 24)
- Target: Android 15 (API 35)
