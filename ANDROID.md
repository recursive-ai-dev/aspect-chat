# Aspect Studio for Android

The Android app is the web app wrapped in a native WebView with [Capacitor](https://capacitorjs.com).
Everything runs on-device; there is no server component. The Android project lives in `android/`
and is built from `dist/` (the normal `vite build` output).

## Build outputs

| Command | Output | Use |
| --- | --- | --- |
| `npm run android:debug` | `release/aspect-chat-<ver>-debug.apk` | Sideload/testing. Debug-signed, installs on any device. |
| `npm run android:release` | `release/aspect-chat-<ver>.apk` | Signed APK for direct distribution (GitHub Releases, F-Droid-style hosting). |
| `npm run android:bundle` | `release/aspect-chat-<ver>.aab` | Signed App Bundle - **the format Google Play requires.** |

Each artifact gets a `.sha256` file next to it. The version (`versionName`) comes from `package.json`;
`versionCode` is `major*10000 + minor*100 + patch` (override with `VERSION_CODE=N`).
**Play rejects an upload whose versionCode is not higher than the previous one**, so bump `package.json`
for every release.

## One-time setup

1. JDK 21 and the Android SDK (platform 36, build-tools 36). Android Studio installs both, or use
   `sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"`.
2. `export ANDROID_HOME=/path/to/android-sdk`
3. `npm ci`

## Create your release signing key (once, keep it forever)

```bash
keytool -genkeypair -v -keystore aspect-studio-upload.jks -storetype PKCS12 \
  -alias aspect-studio -keyalg RSA -keysize 4096 -validity 10000
cp android/keystore.properties.example android/keystore.properties   # then edit it
```

Back up the `.jks` and its passwords somewhere safe (password manager + offline copy).
`keystore.properties` and `*.jks` are gitignored - never commit them. If you enroll in
**Play App Signing** (default for new apps) this is only your *upload* key and Google can reset it
if lost; for APKs you distribute yourself, losing the key means users must uninstall to update.

## Releasing to Google Play

1. Bump `version` in `package.json`.
2. `npm run android:bundle` and upload `release/aspect-chat-<ver>.aab` in Play Console.
3. Play Console requirements you must complete yourself: a developer account, store listing and
   screenshots, a privacy policy URL, the Data Safety form, and content rating. Personal developer
   accounts created after Nov 2023 must also run a closed test with 12+ testers for 14 days before
   production access.

## CI

`.github/workflows/android.yml` (manual or on `v*` tags) always builds the debug APK and, when these
repository secrets exist, also the signed APK and AAB:
`ANDROID_KEYSTORE_BASE64` (`base64 -w0 aspect-chat-upload.jks`), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Behavior on Android - read before shipping

- **Origin is `http://localhost`** (`capacitor.config.json`). Android treats it as a secure context
  (IndexedDB, WebGPU, crypto available) and, unlike `https://localhost`, it can call plain-HTTP model
  servers on your LAN. Do not change `androidScheme` after release: it changes the storage origin
  and users would lose their library.
- **Local model servers** (Ollama, LM Studio, llama.cpp) must be reachable from the phone - use the
  computer's LAN IP (`http://192.168.x.x:11434/v1`), not `localhost`, and enable CORS on the server
  (e.g. `OLLAMA_ORIGINS="*"`). Hosted providers (OpenAI-compatible HTTPS APIs) work as on desktop.
- **The `llama-bridge` / `git-bridge` helpers are desktop Node scripts** and do not run on the phone.
- **In-browser models (WebLLM)** need WebGPU in the device's Android System WebView. It is present on
  recent Android 12+ devices with an up-to-date WebView but not guaranteed; the app's existing
  capability detection decides whether to offer it. Large downloads also need free storage.
- Auto-backup is disabled (`allowBackup=false`) so API keys stored in the app are not copied to cloud backups.
- Pure-web build: no Capacitor plugins are installed, only the `INTERNET` permission is requested.
