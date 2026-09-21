// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NATIVE_STATUS_BAR_VAR,
  applyNativeStatusBarInset,
  readNativeStatusBarHeight,
} from './statusBar.js';

const androidCapacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
const webCapacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };
const iosCapacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };

describe('readNativeStatusBarHeight', () => {
  it('returns the plugin-measured height on native Android', async () => {
    await expect(
      readNativeStatusBarHeight({
        capacitor: androidCapacitor,
        statusBar: { getInfo: async () => ({ height: 24 }) },
      }),
    ).resolves.toBe(24);
  });

  it('returns null on the plain web build (never touches the plugin)', async () => {
    await expect(readNativeStatusBarHeight({ capacitor: webCapacitor })).resolves.toBeNull();
  });

  it('returns null on native iOS (existing iOS safe-area behavior is preserved)', async () => {
    await expect(
      readNativeStatusBarHeight({
        capacitor: iosCapacitor,
        statusBar: { getInfo: async () => ({ height: 47 }) },
      }),
    ).resolves.toBeNull();
  });

  it('returns null when the plugin reports zero (no fake inset)', async () => {
    await expect(
      readNativeStatusBarHeight({
        capacitor: androidCapacitor,
        statusBar: { getInfo: async () => ({ height: 0 }) },
      }),
    ).resolves.toBeNull();
  });

  it('returns null when the plugin throws (non-fatal)', async () => {
    await expect(
      readNativeStatusBarHeight({
        capacitor: androidCapacitor,
        statusBar: {
          getInfo: async () => {
            throw new Error('no bridge');
          },
        },
      }),
    ).resolves.toBeNull();
  });
});

describe('applyNativeStatusBarInset', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty(NATIVE_STATUS_BAR_VAR);
  });

  it('publishes the measured height as a CSS variable on native Android', async () => {
    await applyNativeStatusBarInset({
      capacitor: androidCapacitor,
      statusBar: { getInfo: async () => ({ height: 28 }) },
    });
    expect(document.documentElement.style.getPropertyValue(NATIVE_STATUS_BAR_VAR)).toBe('28px');
  });

  it('rounds fractional dp values to whole CSS px', async () => {
    await applyNativeStatusBarInset({
      capacitor: androidCapacitor,
      statusBar: { getInfo: async () => ({ height: 23.6 }) },
    });
    expect(document.documentElement.style.getPropertyValue(NATIVE_STATUS_BAR_VAR)).toBe('24px');
  });

  it('leaves the variable unset on web', async () => {
    await applyNativeStatusBarInset({ capacitor: webCapacitor });
    expect(document.documentElement.style.getPropertyValue(NATIVE_STATUS_BAR_VAR)).toBe('');
  });

  it('leaves the variable unset when the height cannot be measured', async () => {
    await applyNativeStatusBarInset({
      capacitor: androidCapacitor,
      statusBar: { getInfo: async () => ({ height: 0 }) },
    });
    expect(document.documentElement.style.getPropertyValue(NATIVE_STATUS_BAR_VAR)).toBe('');
  });

  it('never throws when the plugin exposes no getInfo', async () => {
    await expect(applyNativeStatusBarInset({ capacitor: androidCapacitor, statusBar: {} })).resolves.toBeUndefined();
    expect(document.documentElement.style.getPropertyValue(NATIVE_STATUS_BAR_VAR)).toBe('');
  });
});

describe('safe-area CSS contract (styles.css)', () => {
  // vitest runs from the mobile package root in both node and jsdom envs.
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');

  it('defines --sat as max() of the plugin inset, the env() fallback, and the natively measured height', () => {
    const def = css.match(/--sat:\s*max\(([^;]+)\);/);
    expect(def).not.toBeNull();
    const [, body] = def as RegExpMatchArray;
    expect(body).toContain('var(--safe-area-inset-top, env(safe-area-inset-top, 0px))');
    expect(body).toContain('var(--native-statusbar-height, 0px)');
  });

  it('routes every top inset through --sat (no bare plugin/env top pattern remains)', () => {
    // Strip comments (the --sat doc comment names the sources) and the --sat
    // definition itself; every remaining top inset must go through --sat.
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutSatDef = cssNoComments.replace(/--sat:\s*max\([^;]+\);/g, '');
    expect(withoutSatDef).not.toContain('var(--safe-area-inset-top, env(safe-area-inset-top, 0px))');
  });

  it('applies --sat to the root main container padding', () => {
    // Strip comments: doc prose quotes `main { padding: ... }` snippets.
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const mainRule = cssNoComments.match(/main\s*{[^}]*}/);
    expect(mainRule).not.toBeNull();
    expect(mainRule?.[0]).toContain('var(--sat)');
  });
});
