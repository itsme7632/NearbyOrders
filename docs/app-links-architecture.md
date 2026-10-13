# Website App Links Architecture

NearbyOrders keeps public app-download destinations configurable without requiring a website redeploy.

## Storage

A singleton PostgreSQL row lives in `website_app_settings`. It stores:

- Google Play URL + enabled state
- Direct APK URL + enabled state
- App Store URL + enabled state
- primary CTA platform (`play`, `apk`, or `ios`)
- business onboarding URL
- last update timestamp

The migration creates the row with all destinations disabled and no URLs, so production never starts with fake download links.

## API

Public read-only endpoint:

`GET /api/v1/website/app-links`

Admin endpoints:

- `GET /api/v1/admin/website/app-links`
- `PATCH /api/v1/admin/website/app-links`

Only HTTPS URLs are accepted. An enabled platform must have a valid HTTPS URL. The primary CTA must point to an enabled platform with a URL.

Every admin update is written to the existing audit log as `WEBSITE_APP_LINKS_UPDATED`.

## Static website

The website fetches the public endpoint at load time and hydrates:

- `[data-applink="primary"]` for primary Get App CTAs
- `[data-platform="play"]`
- `[data-platform="apk"]`
- `[data-platform="ios"]`
- `[data-destination="business-onboarding"]`

The static site keeps a five-minute `localStorage` cache. If the API is temporarily unavailable, the last valid cached configuration remains active. If there is no valid cached configuration, unavailable destinations stay disabled.

## Operational rule

No fake/example download URL belongs in production. Until an administrator supplies a real HTTPS destination, that platform remains disabled and the iOS button can truthfully remain `Coming soon`.
