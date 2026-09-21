#!/usr/bin/env node
/**
 * Installs the committed NearbyOrders brand resources into the generated
 * Capacitor Android project.
 *
 * The native `android/` directory is gitignored by repository convention (it is
 * regenerated with `cap add android`), so the brand assets live under the
 * version-controlled `android-brand/res/` tree and this script copies them in.
 *
 * What it does:
 *  1. Copies android-brand/res/** -> android/app/src/main/res/ (overwrite).
 *  2. Rewrites the AppTheme.NoActionBarLaunch style to the Android 12+
 *     SplashScreen API (warm-cream background, brand splash icon), replacing
 *     the legacy Capacitor `android:background @drawable/splash` approach.
 *  3. Removes obsolete default-Capacitor resources the brand replaces:
 *     splash.png files, the white ic_launcher_background vector, the old
 *     robot ic_launcher_foreground vector/PNGs.
 *
 * Usage:  npm run android:brand
 * (Run once after `cap add android`, and again after `cap sync android` if the
 *  native project was regenerated.)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandRes = join(mobileDir, 'android-brand', 'res');
const androidDir = join(mobileDir, 'android');
const mainRes = join(androidDir, 'app', 'src', 'main', 'res');

function fail(msg) {
  console.error(`android:brand: ${msg}`);
  process.exit(1);
}

if (!existsSync(brandRes)) fail(`brand source tree not found: ${brandRes}`);
if (!existsSync(androidDir)) {
  fail(
    'generated android/ project not found. Run `npx cap add android` first, then re-run this script.',
  );
}
if (!existsSync(mainRes)) fail(`unexpected android project layout, missing: ${mainRes}`);

// 1. Copy brand resources in.
cpSync(brandRes, mainRes, { recursive: true });
console.log(`copied ${brandRes} -> ${mainRes}`);

// 2. Rewrite the launch theme to the Android 12+ SplashScreen API.
const stylesPath = join(mainRes, 'values', 'styles.xml');
const styles = readFileSync(stylesPath, 'utf8');
const launchStyle = /<style name="AppTheme\.NoActionBarLaunch"[^>]*>[\s\S]*?<\/style>/;
const replacement = `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/splash_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`;
if (!launchStyle.test(styles)) {
  fail(`could not find AppTheme.NoActionBarLaunch in ${stylesPath}; refusing to guess`);
}
writeFileSync(stylesPath, styles.replace(launchStyle, replacement));
console.log('rewrote AppTheme.NoActionBarLaunch to the Android 12+ SplashScreen API');

// 3. Remove obsolete default-Capacitor resources.
const obsolete = [
  'drawable/splash.png',
  'drawable/ic_launcher_background.xml',
  'values/ic_launcher_background.xml',
  'drawable-v24/ic_launcher_foreground.xml',
];
for (const rel of obsolete) {
  const p = join(mainRes, rel);
  if (existsSync(p)) {
    rmSync(p);
    console.log(`removed obsolete ${rel}`);
  }
}
// drawable-<qualifier>/splash.png variants (port/land, all densities)
for (const entry of readdirSync(mainRes, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('drawable-')) {
    const p = join(mainRes, entry.name, 'splash.png');
    if (existsSync(p)) {
      rmSync(p);
      console.log(`removed obsolete ${entry.name}/splash.png`);
    }
  }
}
// stale default foreground PNGs superseded by the vector foreground
for (const entry of readdirSync(mainRes, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('mipmap-') && !entry.name.includes('anydpi')) {
    for (const name of ['ic_launcher_foreground.png']) {
      const p = join(mainRes, entry.name, name);
      if (existsSync(p)) {
        rmSync(p);
        console.log(`removed obsolete ${entry.name}/${name}`);
      }
    }
  }
}

console.log('android:brand: done');
