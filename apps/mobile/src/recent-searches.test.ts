// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { getRecentSearches, recordSearch, clearRecentSearches, MAX_RECENT_SEARCHES } from './recent-searches.js';

beforeEach(() => {
  clearRecentSearches();
});

describe('recent searches (device-local)', () => {
  it('starts empty', () => {
    expect(getRecentSearches()).toEqual([]);
  });

  it('records committed phrases most-recent-first, deduplicated', () => {
    recordSearch('pizza');
    recordSearch('bike repair');
    recordSearch('PIZZA');
    expect(getRecentSearches()).toEqual(['PIZZA', 'bike repair']);
  });

  it('ignores blank phrases and caps the list', () => {
    recordSearch('   ');
    for (let i = 0; i < MAX_RECENT_SEARCHES + 5; i++) recordSearch(`q${i}`);
    const recents = getRecentSearches();
    expect(recents).toHaveLength(MAX_RECENT_SEARCHES);
    expect(recents[0]).toBe(`q${MAX_RECENT_SEARCHES + 4}`);
    expect(recents).not.toContain('q0');
  });

  it('trims long phrases', () => {
    recordSearch('x'.repeat(200));
    expect(getRecentSearches()[0]).toHaveLength(80);
  });

  it('clears on demand', () => {
    recordSearch('pizza');
    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);
  });
});
