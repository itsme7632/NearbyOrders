# Android brand resources (committed source)

The generated Capacitor `android/` project is gitignored by repository
convention, so the brand resources that must land inside it are versioned
here and installed with:

```sh
npm run android:brand
```

Run it once after `npx cap add android`, and again whenever the native
project is regenerated. The script (`../scripts/sync-android-brand.mjs`):

1. Copies `res/**` into `android/app/src/main/res/`.
2. Rewrites `AppTheme.NoActionBarLaunch` to the Android 12+ SplashScreen API
   (warm-cream `windowSplashScreenBackground`, `@drawable/splash_icon`,
   `postSplashScreenTheme` back to the app theme).
3. Deletes the obsolete default-Capacitor resources it replaces.

## Contents

- `res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher{,_round}.png` —
  legacy launcher icons (API 24–25) + round variants.
- `res/mipmap-anydpi-v26/ic_launcher{,_round}.xml` — adaptive icons
  (API 26+): burgundy background, vector foreground, monochrome layer for
  Android 13+ themed icons.
- `res/drawable/ic_launcher_foreground.xml` — vector pin-and-bag mark.
- `res/drawable/ic_launcher_monochrome.xml` — silhouette for themed icons.
- `res/drawable/splash_icon.xml` + `splash_icon_vector.xml` — 288dp splash
  artwork (burgundy tile + cream mark) wrapped as an animated-vector so the
  platform renders it at full size instead of upscaling a 108dp pre-render.
- `res/values/colors.xml` — brand colors; also provides `colorPrimary`,
  `colorPrimaryDark`, `colorAccent` referenced by the generated `AppTheme`.

Regenerate the PNGs from the SVG masters with
`../scripts/generate-android-icons.py` after any mark change.
