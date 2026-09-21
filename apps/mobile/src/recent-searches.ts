/**
 * Recent searches (Phase 3B): a tiny device-local history of committed
 * search phrases. No account, no network, no analytics — just the phrases
 * the user typed on this device, so repeat searches are one tap. Cleared
 * explicitly by the user; never read anywhere else.
 */

const STORAGE_KEY = 'nearbyorders.recentSearches';
export const MAX_RECENT_SEARCHES = 8;

function readRaw(): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeRaw(items: string[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT_SEARCHES)));
  } catch {
    /* private mode etc: recents just don't persist */
  }
}

/** Most recent first, deduplicated (case-insensitive). */
export function getRecentSearches(): string[] {
  return readRaw();
}

/** Records a committed (non-empty) search phrase. */
export function recordSearch(raw: string): void {
  const q = raw.trim().slice(0, 80);
  if (!q) return;
  const rest = readRaw().filter((s) => s.toLowerCase() !== q.toLowerCase());
  writeRaw([q, ...rest].slice(0, MAX_RECENT_SEARCHES));
}

export function clearRecentSearches(): void {
  writeRaw([]);
}
