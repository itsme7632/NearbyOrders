import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * theme.ts reads the stored preference at module import, so every case
 * re-imports a fresh module against a stubbed window/document.
 */
function setupDom(systemDark: boolean) {
  const store = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const style: Record<string, string> = {};
  const mediaListeners = new Set<(e: { matches: boolean }) => void>();
  let matches = systemDark;
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
    matchMedia: (q: string) => ({
      matches,
      media: q,
      addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => {
        mediaListeners.add(fn);
      },
      removeEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => {
        mediaListeners.delete(fn);
      },
    }),
  };
  (globalThis as any).document = { documentElement: { dataset, style } };
  return {
    store,
    dataset,
    style,
    fireSystemChange(dark: boolean) {
      matches = dark;
      mediaListeners.forEach((fn) => fn({ matches: dark }));
    },
  };
}

async function loadTheme() {
  vi.resetModules();
  return await import('./theme.js');
}

describe('theme preference (Appearance setting)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('defaults to system and resolves from the OS setting', async () => {
    const dom = setupDom(true);
    const theme = await loadTheme();
    expect(theme.getThemePreference()).toBe('system');
    theme.initTheme();
    expect(dom.dataset.theme).toBe('dark');
  });

  it('system resolves to light when the OS is light', async () => {
    const dom = setupDom(false);
    const theme = await loadTheme();
    theme.initTheme();
    expect(dom.dataset.theme).toBe('light');
  });

  it('explicit dark/light apply immediately and persist', async () => {
    const dom = setupDom(false);
    const theme = await loadTheme();
    theme.initTheme();
    theme.setThemePreference('dark');
    expect(dom.dataset.theme).toBe('dark');
    expect(dom.store.get('nearbyorders.theme')).toBe('dark');
    theme.setThemePreference('light');
    expect(dom.dataset.theme).toBe('light');
    expect(dom.store.get('nearbyorders.theme')).toBe('light');
  });

  it('survives a restart: initTheme re-applies the stored preference', async () => {
    const dom = setupDom(false);
    let theme = await loadTheme();
    theme.setThemePreference('dark');
    // simulate a fresh app start with the same storage
    theme = await loadTheme();
    theme.initTheme();
    expect(dom.dataset.theme).toBe('dark');
  });

  it('system mode follows OS changes without a restart', async () => {
    const dom = setupDom(false);
    const theme = await loadTheme();
    theme.initTheme();
    expect(dom.dataset.theme).toBe('light');
    const off = theme.initThemeSystemSync();
    dom.fireSystemChange(true);
    expect(dom.dataset.theme).toBe('dark');
    off();
  });

  it('system sync does not override an explicit choice', async () => {
    const dom = setupDom(false);
    const theme = await loadTheme();
    theme.setThemePreference('light');
    const off = theme.initThemeSystemSync();
    dom.fireSystemChange(true);
    expect(dom.dataset.theme).toBe('light');
    off();
  });
});
