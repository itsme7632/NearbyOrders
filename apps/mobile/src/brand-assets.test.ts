/**
 * Brand asset regression tests — Concept 3B "Meridian N" (approved 2026-09-25, LOCKED).
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
const EMBER = '#E23A2E';
const PORCELAIN = '#F2F5F7';

// Locked Meridian N geometry (1000x1000 grid) — byte-exact path data.
const LEFT_STEM = 'M220,80 h69.7 v620.5 h-69.7 Z';
const EMBER_DIAG = 'M220,80 L385.3,80 L711.6,623.8 L612.6,920.1 Z';
const RIGHT_STEM = 'M701.1,80 L779.9,80 L779.9,550.6 L701.1,613.3 Z';

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

  it('mark.svg carries the locked geometry and palette', () => {
    const svg = read(join(brandDir, 'mark.svg'));
    expect(svg).toContain('viewBox="0 0 1000 1000"');
    expect(svg).toContain(`d="${LEFT_STEM}"`);
    expect(svg).toContain(`d="${EMBER_DIAG}"`);
    expect(svg).toContain(`d="${RIGHT_STEM}"`);
    expect(svg).toContain(`fill="${SLATE}"`);
    expect(svg).toContain(`fill="${EMBER}"`);
    expect(svg).not.toContain('linearGradient');
    expect(svg).not.toContain('radialGradient');
  });

  it('mark-on-dark.svg keeps identical geometry, porcelain stems', () => {
    const svg = read(join(brandDir, 'mark-on-dark.svg'));
    expect(svg).toContain(`d="${LEFT_STEM}"`);
    expect(svg).toContain(`d="${EMBER_DIAG}"`);
    expect(svg).toContain(`d="${RIGHT_STEM}"`);
    expect(svg).toContain(`fill="${PORCELAIN}"`);
    expect(svg).toContain(`fill="${EMBER}"`);
  });

  it('logo.svg lockup: Bricolage Grotesque wordmark, Nearby slate + Orders ember', () => {
    const svg = read(join(brandDir, 'logo.svg'));
    expect(svg).toContain('Bricolage Grotesque');
    expect(svg).toContain('Nearby');
    expect(svg).toContain('Orders');
    expect(svg).toContain(`fill="${SLATE}"`);
    expect(svg).toContain(`fill="${EMBER}"`);
  });

  it('icon-launcher.svg is a porcelain tile with the mark', () => {
    const svg = read(join(brandDir, 'icon-launcher.svg'));
    expect(svg).toContain('viewBox="0 0 108 108"');
    expect(svg).toContain(`fill="${PORCELAIN}"`);
    expect(svg).toContain(EMBER_DIAG);
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
    expect(html).not.toContain('mark-on-light');
    expect(html).not.toContain('#5C1310');
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

  it('ic_launcher_foreground.xml carries the Meridian N in brand colors', () => {
    const xml = read(join(androidRes, 'drawable', 'ic_launcher_foreground.xml'));
    expect(xml).toContain('viewportWidth="108"');
    expect(xml).toContain(SLATE);
    expect(xml).toContain(EMBER);
    // Three paths: left stem, ember diagonal, right stem.
    expect(xml.match(/<path/g)?.length).toBe(3);
  });

  it('ic_launcher_monochrome.xml is a single-color silhouette', () => {
    const xml = read(join(androidRes, 'drawable', 'ic_launcher_monochrome.xml'));
    expect(xml).toContain('#FFFFFF');
    expect(xml).not.toContain(SLATE);
    expect(xml).not.toContain(EMBER);
    expect(xml.match(/<path/g)?.length).toBe(3);
  });

  it('splash uses the Meridian N on the porcelain window background', () => {
    const vector = read(join(androidRes, 'drawable', 'splash_icon_vector.xml'));
    expect(vector).toContain('viewportWidth="288"');
    expect(vector).toContain(SLATE);
    expect(vector).toContain(EMBER);
    const wrapper = read(join(androidRes, 'drawable', 'splash_icon.xml'));
    expect(wrapper).toContain('@drawable/splash_icon_vector');
    const colors = read(join(androidRes, 'values', 'colors.xml'));
    expect(colors).toContain(`<color name="splash_background">${PORCELAIN}</color>`);
    expect(colors).toContain(`<color name="ic_launcher_background">${PORCELAIN}</color>`);
    expect(colors).toContain(`<color name="colorPrimary">${SLATE}</color>`);
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
