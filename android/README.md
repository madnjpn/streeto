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

The APK is built by GitHub Actions (`.github/workflows/android.yml`) on every push to `main` and can be started by hand from **Actions → Build Android APK → Run workflow**.

The build artifact is named **`streeto-debug-apk`** and contains `app-debug.apk`.

After downloading it, copy `app-debug.apk` to
`public/downloads/STREETO-android.apk` so the **STREETO.NET | Android** button
on the login page serves the new build.

### Local build (optional)

```bash
cd android
gradle assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.

## Install

Copy the APK to the phone and open it (allow “Install unknown apps” for the file manager / browser you used), or:

```bash
adb install -r app-debug.apk
```

## App details

- Package: `net.streeto.app`
- Min Android: 7.0 (API 24)
- Target: Android 15 (API 35)
