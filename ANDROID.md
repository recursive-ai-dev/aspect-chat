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

Each validated artifact gets `.sha256` and `.build.json` files next to it. Packaging checks APK
signatures, 16KB alignment, application identity/version/SDK levels and debuggability. App Bundles
undergo ZIP CRC, required-entry, bundletool and JAR-signature checks. Build metadata records the
source commit, working-tree state and tool versions; it does not certify startup on every device.
The version (`versionName`) comes from `package.json`;
`versionCode` is `major*10000 + minor*100 + patch` (override with `VERSION_CODE=N`).
Automatic mapping requires minor/patch below 100 and a positive code no larger than 2,100,000,000.
Prerelease/build suffixes require an explicit code, as do larger version components. Always choose
an increasing explicit code for every distributed prerelease.
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

`.github/workflows/android.yml` checks Android-related pull requests, `main`, manual runs and `v*`
tags. It runs JavaScript tests, build/version-code boundary tests, app JVM tests, lint and
instrumentation compilation before packaging. Manual/tag runs also build signed APK/AAB when these
repository secrets exist:
`ANDROID_KEYSTORE_BASE64` (`base64 -w0 aspect-chat-upload.jks`), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Release signing is validated before building; partial properties/environment configuration fails
with credential-free diagnostics. Pull requests never receive signing credentials.

For local native verification after `npm run android:sync`:

```bash
npm run test:android-build
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
./gradlew :app:connectedDebugAndroidTest   # requires a running emulator or device
```

Instrumentation covers app launch/recreation, unchanged storage origin, bridge binary staging,
document-provider byte round trips with injected picker results, cancellation/failure cleanup,
FileProvider path restrictions and backup exclusions. Vendor picker UI and physical-device behavior
still require testing on those devices.

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
- Automatic backup is disabled; explicit Android 12+ rules exclude both cloud backup and device
  transfer of all app storage domains, including the WebView profile containing API keys.
- A small native `DocumentExport` bridge saves library JSON, `.aspect` ZIP and HTML exports through
  Android's **Create document** picker. It stages bounded chunks in private cache, writes only to
  the chosen document, and cleans up on success/cancellation/failure. No storage permission is
  requested. Native exports are limited to 50MiB.
- Imports reject archives with more than 1,000 entries, entries over 15MiB, total decoded bytes over
  50MiB or unsafe paths. Imported Aspects and their knowledge files commit in one transaction.
- `INTERNET` remains the only requested platform capability; no camera, location or broad storage
  permission is requested. Captured image uploads expose only the app's private Pictures directory.
- Tools fail safely on obsolete WebViews that expose the legacy native bridge inside sandboxed
  frames. Update Android System WebView to use tools there. Scoped tool fetches require direct URLs
  because automatic redirects could bypass approved destinations.

## Android 1.0.1 changes and release limits

This release repairs native exports, protects recovery/migration from stale-data overwrites, makes
imports/restores durable, prevents chat/tool ownership races and rejects imported render caches.
It also bounds discovery/settings/ZIP expansion, completes streaming at terminal events, preserves
fallback session credentials and prevents `~` session memory from entering saved/exported data.

Weather now queries [Open-Meteo](https://open-meteo.com/en/docs) and its
[geocoding API](https://open-meteo.com/en/docs/geocoding-api), with normal per-tool network approval.
Results include source/time/units and the matched place. No location permission is used; only the
city or coordinates explicitly passed to the tool are sent. See Open-Meteo's usage terms for hosted
API limits and commercial use; geographic matches can be ambiguous.
Existing Aspects keep their saved tool code. Remove older Weather tools and add the current
Weather tool from **System Tools** to replace the previous demonstration implementation.

The sprint environment has no configured release signing key locally or in repository secrets.
The debug APK is installable for testing. Any attached **unsigned** release APK/AAB is for inspection
or subsequent authorized signing, and cannot be installed/submitted directly. Release build types
retain the existing native shrinker configuration; Vite assets are production optimized.

To reproduce unsigned inspection builds without bypassing the signed packaging commands:

```bash
npm run android:sync
cd android
./gradlew --no-daemon :app:assembleRelease :app:bundleRelease :app:validateReleaseBundle
```

Outputs remain under `app/build/outputs/`; their filenames alone do not establish signing.
The release assets name unsigned copies explicitly and include SHA-256 and build metadata.
