import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'nearbyorders.theme';
const listeners = new Set<(theme: ResolvedTheme) => void>();

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

let preference: ThemePreference = readPreference();
let resolvedTheme: ResolvedTheme = resolveTheme(preference);

function applyTheme(next: ResolvedTheme): void {
  resolvedTheme = next;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
  }
  for (const listener of listeners) listener(next);
}

function applyPreference(next: ThemePreference): void {
  preference = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode / storage disabled: keep the preference in memory */
  }
  applyTheme(resolveTheme(next));
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolvedTheme;
}

export function setThemePreference(next: ThemePreference): void {
  applyPreference(next);
}

/** Apply the stored preference before the first interactive render. */
export function initTheme(): void {
  applyTheme(resolveTheme(preference));
}

/** Keep System mode synchronized with Android/browser appearance changes. */
export function initThemeSystemSync(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (preference === 'system') applyTheme(resolveTheme('system'));
  };
  media.addEventListener?.('change', onChange);
  return () => media.removeEventListener?.('change', onChange);
}

export function useTheme(): {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const [current, setCurrent] = useState<ResolvedTheme>(resolvedTheme);
  const [currentPreference, setCurrentPreference] = useState<ThemePreference>(preference);

  useEffect(() => {
    const update = (theme: ResolvedTheme) => {
      setCurrent(theme);
      setCurrentPreference(preference);
    };
    listeners.add(update);
    return () => listeners.delete(update);
  }, []);

  return { preference: currentPreference, resolvedTheme: current, setPreference: setThemePreference };
}
