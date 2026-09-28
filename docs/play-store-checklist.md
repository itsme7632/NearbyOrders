# Play Store Readiness Checklist (NearbyOrders)

**Status in P5:** Nothing submitted. This is the checklist for the future
submission step.

## App Identity (confirmed)

- [x] App name: **NearbyOrders**
- [x] Package ID: **pk.nearbyorders.app** (immutable after first upload)
- [ ] App icon: launcher assets exist in `apps/mobile/android/` — verify they
      render correctly at all densities on a real device before submission

## Binary

- [ ] Release AAB built per `docs/android-release.md`
- [ ] `versionCode` bumped, `versionName` set for this release
- [ ] Signed with the production keystore (or upload key with Play App Signing)
- [ ] Built with production `VITE_API_BASE_URL`

## Store Listing (owner input required)

- [ ] Short description (80 chars)
- [ ] Full description
- [ ] Screenshots: phone (min 2, 16:9 or 9:16) — capture from the Xiaomi device
- [ ] Feature graphic (1024 × 500)
- [ ] App category (e.g. Shopping / Business)
- [ ] Contact email / support URL
- [ ] Privacy policy URL — **required**. Must describe data collected
      (accounts, location, orders, images). Do not invent claims; have the
      owner review the actual data flows first.

## Policy & Compliance

- [ ] **Data Safety form**: declare location, personal info, photos/media,
      app activity. Must match actual behavior — location is used for nearby
      discovery; images are business/product photos.
- [ ] **App access / reviewer instructions**: provide a demo customer account
      and a demo business-owner account so reviewers can exercise login-gated
      flows. Document them in the Play Console (not in the repo).
- [ ] **Content rating** questionnaire (Everyone / Teen etc. per answers).
- [ ] **Target SDK**: 36 (already configured) — meets Play's target-API requirements.
- [ ] Permissions review: location (foreground only — verify no background
      location permission is declared), camera/gallery (image uploads),
      notifications, internet.

## Pre-Submission QA

- [ ] Install the exact AAB/APK artifact on the Xiaomi test device
- [ ] Full smoke test against the **production** API (§13 of the P5 brief)
- [ ] Verify no localhost/staging URLs are baked in

## Owner Decisions Still Needed

1. Final store description copy (short + full).
2. Privacy policy URL (must exist before submission).
3. Support contact email/URL.
4. Whether to use Google Play App Signing (recommended: yes).
5. Screenshot/feature-graphic creative.
6. Content-rating answers and Data Safety declarations (must reflect reality).
