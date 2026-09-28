# Android Release Guide (NearbyOrders)

## App Identity

| Field | Value |
|---|---|
| Application ID | `pk.nearbyorders.app` |
| App name | NearbyOrders |
| Min SDK | 24 (Android 7.0) |
| Target SDK | 36 |
| Current versionCode | 1 |
| Current versionName | 1.0 |

**Do not change the application ID** after the first Play Store upload —
it is the permanent identity of the app.

## Versioning

- Bump `versionCode` (integer, monotonically increasing) for every release
  uploaded to Play Store, including internal test tracks.
- Bump `versionName` (user-visible, e.g. `1.0.1`) to describe the release.
- Location: `apps/mobile/android/app/build.gradle` (`versionCode`, `versionName`).

## Release Signing

**No keystore is committed to the repository. Never commit one.**

### Creating the release keystore (one-time, on a secure machine)

```sh
keytool -genkeypair -v \
  -keystore nearbyorders-release.keystore \
  -alias nearbyorders \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass '<STRONG_STORE_PASSWORD>' \
  -keypass '<STRONG_KEY_PASSWORD>' \
  -dname "CN=NearbyOrders, OU=Mobile, O=NearbyOrders"
```

Back up securely (see `docs/backup-recovery.md` §3):
- the `.keystore` file itself
- store password
- key alias
- key password

**Losing the keystore means you can never update the Play Store app.**
Google Play App Signing can mitigate this (see below).

### Configuring signing (local release build)

Create `apps/mobile/android/keystore.properties` (git-ignored — verify it is
not tracked before adding secrets):

```properties
storeFile=/absolute/path/to/nearbyorders-release.keystore
storePassword=<STORE_PASSWORD>
keyAlias=nearbyorders
keyPassword=<KEY_PASSWORD>
```

Then add a `signingConfigs.release` block to `apps/mobile/android/app/build.gradle`
referencing these properties, and set `buildTypes.release.signingConfig` to it.
(Deliberately not committed in P5: the properties file path is machine-specific.)

### CI signing (recommended for Play Store)

Use encrypted CI secrets — never plaintext in the repo:

| Secret | Content |
|---|---|
| `ANDROID_KEYSTORE_B64` | base64 of the `.keystore` file |
| `ANDROID_STORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

CI job outline:
1. `echo "$ANDROID_KEYSTORE_B64" | base64 -d > release.keystore`
2. Write `keystore.properties` from secrets.
3. `./gradlew :app:bundleRelease` (AAB for Play Store).
4. Optionally `./gradlew :app:assembleRelease` (APK for direct distribution).
5. Upload artifacts; **do not** log secret values.

### Google Play App Signing

Recommended: let Play generate and guard the final signing key
(Play Console → App → Setup → App signing). You then upload an AAB signed
with your *upload key*. If the upload key is lost, Play support can reset it —
but the app-signing key can never be recovered, so Play managing it is safer.

## Building the Release

Prerequisites: Android SDK, JDK 17, the production API URL.

```sh
cd apps/mobile

# 1. Point the app at the production API (baked in at build time)
export VITE_API_BASE_URL="https://<production-api>/api/v1"

# 2. Build the web bundle
pnpm build

# 3. Sync to the Android project
npx cap sync android

# 4. Build (from apps/mobile/android)
cd android
./gradlew :app:bundleRelease   # → app/build/outputs/bundle/release/app-release.aab (Play Store)
./gradlew :app:assembleRelease # → app/build/outputs/apk/release/app-release.apk (direct install)
```

Rename outputs for distribution:
- `NearbyOrders-release.aab`
- `NearbyOrders-release.apk`

## Pre-Release Checklist

- [ ] `versionCode` bumped
- [ ] `versionName` updated
- [ ] Built with the **production** `VITE_API_BASE_URL` (not localhost)
- [ ] Release signed with the production keystore (not debug)
- [ ] Installed the signed APK on the Xiaomi test device; smoke-tested
      (launch → signup → login → explore → order → booking)
- [ ] Verified the app talks to the production API, not staging/localhost

## What P5 Did / Did Not Do

- Documented the full signing and build procedure above.
- Did **not** create a keystore, did **not** commit any signing secrets,
  did **not** upload anything to Play Store.
