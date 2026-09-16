# Push notifications (Phase 13)

Real device push on top of the existing in-app notification system. In-app
notifications remain the source of history; push is an **additional delivery
channel** that never gates or blocks a business transaction.

```
Application event
  → in-app notification (existing createNotifications)
  → push dispatch (apps/api/src/push.ts, after the transaction commits)
  → all active devices of the target user
```

## Server

- `PushProvider` interface (`apps/api/src/push.ts`): provider-specific code is
  fully isolated; booking/order/payment code only calls
  `dispatchPushNotifications`, which never throws.
- `FcmPushProvider`: Firebase Cloud Messaging HTTP v1. Auth is a signed JWT
  (RS256 via node:crypto) — no SDK dependency. Android today; iOS rides the
  same FCM-APNs bridge once Apple credentials exist.
- `NoopPushProvider`: used when credentials are absent. Reports
  `unconfigured`; nothing pretends to be delivered. In-app notifications keep
  working in every environment.
- Failures: `404/410` (and FCM `UNREGISTERED` details) mark the token
  **invalid → deactivated once**, so bad tokens are never retried. `429/5xx`
  are transient; tokens stay active. Dispatch results are honest:
  `sent | invalid-token | failed | unconfigured | skipped-preferences | no-devices`.

### Provider configuration (env, never committed)

| Variable | Meaning |
| --- | --- |
| `FCM_PROJECT_ID` | Firebase project id |
| `FCM_SERVICE_ACCOUNT_B64` | base64 of the full Firebase service-account JSON |

Without both, push is a safe no-op. Set them via the deployment environment
(Freebuff: Settings → Environment, or `freebuff-deploy env set`).

## Device registration API (all authenticated)

- `POST /api/v1/push/devices` — `{ platform: 'android'|'ios'|'web', pushToken, deviceId? }`.
  Unique `pushToken` makes it idempotent; a re-registered token (even after
  reinstall under a different user) is re-pointed at the current user and
  re-activated. Response never contains the token.
- `GET /api/v1/push/devices` — caller's own devices (no tokens).
- `DELETE /api/v1/push/devices/:id` — deactivate one of the caller's devices
  (404 for anyone else's). Multi-device: logging out one device never
  deactivates others.

## Notification preferences

`GET/PUT /api/v1/notifications/preferences` with per-category switches:
`bookings, orders, payments, reviews, businessActivity, account`. A missing
row means **all on** — silence is never the default. Dispatch filters by
these categories; the in-app history is unchanged (it stays complete).

## Events wired to push

Bookings (created → owner, accepted/rejected/completed → customer, cancelled →
owner), orders (created → owner, accepted/rejected/preparing/ready/completed →
customer, cancelled → owner), payments (submitted → owner, verified/rejected →
customer), subscriptions (approved/rejected → owner), and the new
`REVIEW_CREATED` event (→ owner; also persisted in-app). Deep links are
**server-generated** (`deepLinkFor`): `/booking/:id`, `/order/:id`,
`/owner/subscription`, review → business reviews. The client only accepts
known-safe route shapes and falls back to `/notifications`.

## Mobile

- `apps/mobile/src/push.ts`: permission check → (request) → FCM register →
  token; dynamic plugin import keeps it out of the web bundle; web reports
  `unavailable` honestly.
- `usePushRegistration`: runs once per signed-in session (never on the first
  anonymous screen), silent on denied/unavailable/error — the app stays fully
  usable without notifications.
- Foreground: the existing in-app notification UI + unread badge remain the
  surface; no duplicate native banner spam.
- Tap (`pushNotificationActionPerformed`) → `handlePushDeepLink` → the same
  routes as in-app notifications; stale ids land on the standard 404-safe
  detail screens, never a crash.

## Android

- `POST_NOTIFICATIONS` permission added (Android 13+ runtime permission; the
  plugin's permission request covers it).
- `google-services.json` is **not committed**. The Gradle config already
  applies the google-services plugin only when the file exists; drop the
  Firebase console file at `apps/mobile/android/app/google-services.json`
  before building a push-enabled APK. Without it the app builds and runs,
  with in-app notifications only.

## iOS (honest status)

The repository contains **no iOS Capacitor project** yet (`apps/mobile/ios`
absent). The full server-side and JS architecture is platform-ready:
preferences, device registry, and FCM dispatch work for `platform: 'ios'`
tokens as soon as (1) `npx cap add ios` is run on macOS, and (2) APNs
credentials are uploaded to Firebase. Both require Apple Developer account
access that cannot be performed from this repository. Do not treat iOS push
as production-configured until those external steps exist.

## Admin visibility

`GET /api/v1/admin/dashboard` now includes `pushDevices: { total, active,
android, ios, web }` — counts only, never tokens.

## Development/testing

Tests inject a fake provider via `setPushProvider()` (in `apps/api/src/push.ts`);
`dispatchPushNotifications` then exercises preference filtering, invalid-token
deactivation, and multi-device fan-out deterministically without network.
