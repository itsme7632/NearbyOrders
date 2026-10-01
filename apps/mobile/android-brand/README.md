# Android brand resources (committed source)

The generated Capacitor `android/` project is gitignored by repository
convention, so the brand resources that must land inside it are versioned
here and installed with:

```sh
npm run android:brand
```

Run it once after `npx cap add android`, and again whenever the native
project is regenerated. The script (`../scripts/sync-android-brand.mjs`):

1. Copies `res/**` into `android/app/src/main/res/` (overwrite).
2. Rewrites `AppTheme.NoActionBarLaunch` to the Android 12+ SplashScreen API
   (porcelain `windowSplashScreenBackground`, `@drawable/splash_icon`,
   `postSplashScreenTheme` back to the app theme).
3. Deletes the obsolete default-Capacitor resources it replaces.

## Contents

- `res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher{,_round}.png` —
  legacy launcher icons (API 24–25) + round variants: porcelain tile with the
  N+O mark.
- `res/mipmap-anydpi-v26/ic_launcher{,_round}.xml` — adaptive icons
  (API 26+): porcelain background, vector foreground, monochrome layer for
  Android 13+ themed icons.
- `res/drawable/ic_launcher_foreground.xml` — vector N+O mark (108dp).
- `res/drawable/ic_launcher_monochrome.xml` — white silhouette for themed icons.
- `res/drawable/splash_icon.xml` + `splash_icon_vector.xml` + `res/animator/*` —
  288dp splash artwork (the N+O mark large on transparent over the porcelain
  window background) with the approved N → O choreography: the N draws in
  over 0–300ms, then the O ring + welds fade in over 250–700ms.
- `res/values/colors.xml` — Atlas Refined brand colors; also provides
  `colorPrimary`, `colorPrimaryDark`, `colorAccent` referenced by the
  generated `AppTheme`.

Regenerate everything from the locked geometry with
`../scripts/generate-brand-assets.py` (SVG + XML), then
`../scripts/generate-android-icons.py` (PNGs), after any mark change —
or simply `npm run brand:assets`.
