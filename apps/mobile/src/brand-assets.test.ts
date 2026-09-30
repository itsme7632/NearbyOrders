/**
 * Brand asset regression tests — N+O identity (Phase 9 geometry approved and
 * FROZEN 2026-09-30; Phase 9B production color application).
 *
 * Verifies the canonical vector sources, their published web copies, the
 * Android resource tree, and the splash/theme wiring. These tests guard the
 * final brand: if the geometry, palette, or pipeline references change, the
 * suite fails loudly instead of shipping a silent rebrand.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const mobileDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = join(mobileDir, 'brand');
const publicBrandDir = join(mobileDir, 'public', 'brand');
const androidRes = join(mobileDir, 'android-brand', 'res');

const SLATE = '#16222E';
const SLATE_DEEP = '#0F1822';
const EMBER = '#E23A2E';
const PORCELAIN = '#F2F5F7';

// Frozen N+O geometry (120x120 grid) — byte-exact path data.
const N_LEFT = 'M29 90 L29 30 L52.17 52.42';
const N_RIGHT = 'M67.83 67.58 L91 90 L91 30';
const O_RING = 'M50 60 A10 10 0 1 1 70 60 A10 10 0 1 1 50 60 Z';
const WELD_0 =
  'M49.09 39.70 L57.00 47.35 L55.69 47.74 L54.43 48.25 L53.23 48.90 L52.11 49.67 L51.07 50.55 L50.14 51.53 L49.30 52.61 L48.59 53.77 L48.00 55.00 L47.54 56.28 C50.12 47.65 55.56 45.96 49.09 39.70 Z';

function read(p: string): string {
  return readFileSync(p, 'utf8');
}

/** Read PNG width/height from the IHDR chunk (no image deps needed). */
function pngSize(p: string): { width: number; height: number } {
  const b = readFileSync(p);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe('brand canonical sources', () => {
  const sources = [
    'mark.svg',
    'mark-on-dark.svg',
    'logo.svg',
    'logo-on-dark.svg',
    'icon-launcher.svg',
    'icon-foreground.svg',
    'icon-monochrome.svg',
  ];
  it.each(sources)('brand/%s exists and is non-empty', (f) => {
    const p = join(brandDir, f);
    expect(existsSync(p), p).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(200);
  });

  it('mark.svg carries the frozen geometry and production palette', () => {
    const svg = read(join(brandDir, 'mark.svg'));
    expect(svg).toContain('viewBox="0 0 120 120"');
    expect(svg).toContain(`d="${N_LEFT}"`);
    expect(svg).toContain(`d="${N_RIGHT}"`);
    // N is stroked, not filled.
    expect(svg).toContain(`stroke="${SLATE}"`);
    expect(svg).toContain('stroke-width="14"');
    // O ring + welds in ember.
    expect(svg).toContain('<circle cx="60" cy="60" r="10"');
    expect(svg).toContain(`stroke="${EMBER}"`);
    expect(svg).toContain('stroke-width="6"');
    expect(svg).toContain(`d="${WELD_0}"`);
    expect(svg).toContain(`fill="${EMBER}"`);
    expect(svg).not.toContain('linearGradient');
    expect(svg).not.toContain('radialGradient');
    // Seven elements: 2 N sub-paths, ring, 4 weld slivers.
    expect(svg.match(/<path|<circle/g)?.length).toBe(7);
    // No generic black anywhere in the brand.
    expect(svg).not.toContain('#000000');
    expect(svg).not.toContain('#000"');
  });

  it('mark-on-dark.svg keeps identical geometry, porcelain N', () => {
    const svg = read(join(brandDir, 'mark-on-dark.svg'));
    expect(svg).toContain(`d="${N_LEFT}"`);
    expect(svg).toContain(`d="${N_RIGHT}"`);
    expect(svg).toContain('<circle cx="60" cy="60" r="10"');
    expect(svg).toContain(`stroke="${PORCELAIN}"`);
    expect(svg).toContain(`stroke="${EMBER}"`);
    expect(svg).toContain(`d="${WELD_0}"`);
  });

  it('logo.svg lockup: Bricolage Grotesque wordmark, Nearby slate + Orders ember', () => {
    const svg = read(join(brandDir, 'logo.svg'));
    expect(svg).toContain('Bricolage Grotesque');
    expect(svg).toContain('Nearby');
    expect(svg).toContain('Orders');
    expect(svg).toContain(`fill="${SLATE}"`);
    expect(svg).toContain(`fill="${EMBER}"`);
    expect(svg).toContain(`d="${N_LEFT}"`);
  });

  it('icon-launcher.svg is a porcelain tile with the mark', () => {
    const svg = read(join(brandDir, 'icon-launcher.svg'));
    expect(svg).toContain('viewBox="0 0 108 108"');
    expect(svg).toContain(`fill="${PORCELAIN}"`);
    expect(svg).toContain(N_LEFT);
    expect(svg).toContain(EMBER);
  });

  it('icon-monochrome.svg is a single-color white silhouette', () => {
    const svg = read(join(brandDir, 'icon-monochrome.svg'));
    expect(svg).toContain('#FFFFFF');
    expect(svg).not.toContain(SLATE);
    expect(svg).not.toContain(EMBER);
    expect(svg).toContain(N_LEFT);
  });
});

describe('published web copies', () => {
  const copies: Array<[string, string]> = [
    ['mark.svg', 'nearbyorders-mark.svg'],
    ['mark-on-dark.svg', 'nearbyorders-mark-on-dark.svg'],
    ['logo.svg', 'nearbyorders-logo.svg'],
    ['logo-on-dark.svg', 'nearbyorders-logo-on-dark.svg'],
  ];
  it.each(copies)('public/brand/%s is a verbatim copy of brand/%s', (src, dst) => {
    const a = read(join(brandDir, src));
    const b = read(join(publicBrandDir, dst));
    expect(b).toBe(a);
  });

  it('public/favicon.svg matches the launcher tile', () => {
    expect(read(join(mobileDir, 'public', 'favicon.svg')))
      .toBe(read(join(brandDir, 'icon-launcher.svg')));
  });

  it('index.html wires the new favicon and slate theme-color', () => {
    const html = read(join(mobileDir, 'index.html'));
    expect(html).toContain('href="/brand/nearbyorders-mark.svg"');
    expect(html).toContain('content="#16222e"');
  });
});

describe('android brand resources', () => {
  const densities: Array<[string, number]> = [
    ['mipmap-mdpi', 48],
    ['mipmap-hdpi', 72],
    ['mipmap-xhdpi', 96],
    ['mipmap-xxhdpi', 144],
    ['mipmap-xxxhdpi', 192],
  ];
  it.each(densities)('%s launcher PNGs exist at %spx', (d, px) => {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const p = join(androidRes, d, name);
      expect(existsSync(p), p).toBe(true);
      const { width, height } = pngSize(p);
      expect(width).toBe(px);
      expect(height).toBe(px);
    }
  });

  it.each(['ic_launcher.xml', 'ic_launcher_round.xml'])(
    'mipmap-anydpi-v26/%s wires background + foreground + monochrome',
    (f) => {
      const xml = read(join(androidRes, 'mipmap-anydpi-v26', f));
      expect(xml).toContain('@color/ic_launcher_background');
      expect(xml).toContain('@drawable/ic_launcher_foreground');
      expect(xml).toContain('@drawable/ic_launcher_monochrome');
    },
  );

  it('ic_launcher_foreground.xml carries the N+O in brand colors', () => {
    const xml = read(join(androidRes, 'drawable', 'ic_launcher_foreground.xml'));
    expect(xml).toContain('viewportWidth="108"');
    expect(xml).toContain(SLATE);
    expect(xml).toContain(EMBER);
    // pathData stays byte-identical to the approved 120-grid geometry.
    expect(xml).toContain(`android:pathData="${N_LEFT}"`);
    expect(xml).toContain(`android:pathData="${N_RIGHT}"`);
    expect(xml).toContain(`android:pathData="${O_RING}"`);
  });

  it('ic_launcher_monochrome.xml is a single-color silhouette', () => {
    const xml = read(join(androidRes, 'drawable', 'ic_launcher_monochrome.xml'));
    expect(xml).toContain('#FFFFFF');
    expect(xml).not.toContain(SLATE);
    expect(xml).not.toContain(EMBER);
  });

  it('splash uses the N+O on the porcelain window background', () => {
    const vector = read(join(androidRes, 'drawable', 'splash_icon_vector.xml'));
    expect(vector).toContain('viewportWidth="288"');
    expect(vector).toContain(SLATE);
    expect(vector).toContain(EMBER);
    expect(vector).toContain(`android:pathData="${N_LEFT}"`);
    // Named targets for the N -> O choreography.
    expect(vector).toContain('android:name="n_path_l"');
    expect(vector).toContain('android:name="n_path_r"');
    expect(vector).toContain('android:name="o_group"');
    const wrapper = read(join(androidRes, 'drawable', 'splash_icon.xml'));
    expect(wrapper).toContain('@drawable/splash_icon_vector');
    expect(wrapper).toContain('@animator/n_draw');
    expect(wrapper).toContain('@animator/o_fade');
    const nDraw = read(join(androidRes, 'animator', 'n_draw.xml'));
    expect(nDraw).toContain('trimPathEnd');
    expect(nDraw).toContain('android:duration="300"');
    const oFade = read(join(androidRes, 'animator', 'o_fade.xml'));
    expect(oFade).toContain('android:propertyName="alpha"');
    expect(oFade).toContain('android:startOffset="250"');
    const colors = read(join(androidRes, 'values', 'colors.xml'));
    expect(colors).toContain(`<color name="splash_background">${PORCELAIN}</color>`);
    expect(colors).toContain(`<color name="ic_launcher_background">${PORCELAIN}</color>`);
    expect(colors).toContain(`<color name="colorPrimary">${SLATE}</color>`);
    expect(colors).toContain(`<color name="colorPrimaryDark">${SLATE_DEEP}</color>`);
    expect(colors).toContain(`<color name="colorAccent">${EMBER}</color>`);
  });

  it('sync script installs the splash icon into the launch theme', () => {
    const script = read(join(mobileDir, 'scripts', 'sync-android-brand.mjs'));
    expect(script).toContain('@drawable/splash_icon');
    expect(script).toContain('windowSplashScreenBackground');
  });

  it('icon generator reads the new launcher master', () => {
    const script = read(join(mobileDir, 'scripts', 'generate-android-icons.py'));
    expect(script).toContain('brand/icon-launcher.svg');
  });
});
