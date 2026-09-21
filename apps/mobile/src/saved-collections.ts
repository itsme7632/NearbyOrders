/**
 * Saved collections (Phase 3A): a lightweight, local-first organization layer
 * over the server-side favorites API.
 *
 * The favorites API remains the source of truth for WHAT is saved (and
 * existing save/unsave behavior is untouched). Collections only organize
 * already-saved businesses into user-named lists ("Food", "Places to try").
 * They are intentionally not a backend system: no sync, no sharing, no
 * social graph — just local shelves for the signed-in user.
 *
 * Storage is namespaced per user id so collections never leak across
 * accounts on a shared device. Memberships referencing businesses that are
 * no longer saved are pruned on load (a business removed from Saved silently
 * leaves every collection).
 */

import type { Business, FavoriteEntry } from './api.js';

export type SavedCollection = {
  id: string;
  name: string;
  createdAt: string;
};

type PersistedState = {
  version: 1;
  collections: SavedCollection[];
  /** collectionId -> saved business ids. */
  members: Record<string, string[]>;
};

export const MAX_COLLECTIONS = 20;
export const MAX_COLLECTION_NAME = 40;

const EMPTY: PersistedState = { version: 1, collections: [], members: {} };

export const collectionsStorageKey = (userId: string) => `nearbyorders.collections.${userId}`;

/**
 * Storage accessor. Prefers window.localStorage; falls back to a
 * module-level in-memory map when localStorage is unavailable (private
 * browsing, SSR-ish contexts, plain node unit tests). The in-memory fallback
 * keeps the feature working for the session instead of crashing.
 */
const memoryFallback = new Map<string, string>();
/** Test seam + the unit under test for storage probing. */
export function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.getItem(collectionsStorageKey('__probe__'));
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return {
    getItem: (k) => (memoryFallback.has(k) ? memoryFallback.get(k)! : null),
    setItem: (k, v) => void memoryFallback.set(k, v),
    removeItem: (k) => void memoryFallback.delete(k),
  };
}

function readState(userId: string): PersistedState {
  try {
    const key = collectionsStorageKey(userId);
    // A failed localStorage write lands in memoryFallback (see writeState);
    // prefer it so this session's changes stay visible even when the disk
    // write failed.
    const raw = memoryFallback.has(key) ? memoryFallback.get(key)! : storage().getItem(key);
    if (!raw) return { ...EMPTY, collections: [], members: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.collections)) return { ...EMPTY, collections: [], members: {} };
    const collections = parsed.collections
      .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      .map((c) => ({ id: c.id, name: c.name.slice(0, MAX_COLLECTION_NAME), createdAt: c.createdAt ?? '' }));
    const members: Record<string, string[]> = {};
    const ids = new Set(collections.map((c) => c.id));
    if (parsed.members && typeof parsed.members === 'object') {
      for (const [cid, list] of Object.entries(parsed.members)) {
        if (ids.has(cid) && Array.isArray(list)) members[cid] = list.filter((b) => typeof b === 'string');
      }
    }
    return { version: 1, collections, members };
  } catch {
    return { ...EMPTY, collections: [], members: {} };
  }
}

function writeState(userId: string, state: PersistedState): void {
  const key = collectionsStorageKey(userId);
  const raw = JSON.stringify(state);
  try {
    storage().setItem(key, raw);
    // A previous failed write may have left a stale snapshot in memory;
    // storage is authoritative again, so drop it.
    memoryFallback.delete(key);
  } catch {
    // Quota/blocked storage: the write would otherwise be silently lost and
    // the next read would revert the UI. Keep this session's state in memory
    // so collections keep working until reload; they just won't persist.
    memoryFallback.set(key, raw);
  }
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

/** All collections for the user, oldest first. */
export function listCollections(userId: string): SavedCollection[] {
  return readState(userId).collections;
}

/** Creates a collection; throws a user-facing message when invalid. */
export function createCollection(userId: string, rawName: string): SavedCollection {
  const name = rawName.trim().slice(0, MAX_COLLECTION_NAME);
  if (!name) throw new Error('Give the collection a name first.');
  const state = readState(userId);
  if (state.collections.length >= MAX_COLLECTIONS) throw new Error(`You can keep up to ${MAX_COLLECTIONS} collections.`);
  if (state.collections.some((c) => c.name.toLowerCase() === name.toLowerCase()))
    throw new Error('You already have a collection with that name.');
  const collection: SavedCollection = { id: newId(), name, createdAt: new Date().toISOString() };
  state.collections.push(collection);
  state.members[collection.id] = [];
  writeState(userId, state);
  return collection;
}

/** Deletes a collection. Businesses stay saved — only the shelf disappears. */
export function deleteCollection(userId: string, collectionId: string): void {
  const state = readState(userId);
  state.collections = state.collections.filter((c) => c.id !== collectionId);
  delete state.members[collectionId];
  writeState(userId, state);
}

/** Ids of the collections that currently contain the business. */
export function collectionIdsForBusiness(userId: string, businessId: string): string[] {
  const state = readState(userId);
  return state.collections.filter((c) => (state.members[c.id] ?? []).includes(businessId)).map((c) => c.id);
}

/** Adds or removes one business from one collection; returns the new membership. */
export function toggleBusinessInCollection(userId: string, collectionId: string, businessId: string): boolean {
  const state = readState(userId);
  if (!state.collections.some((c) => c.id === collectionId)) throw new Error('That collection no longer exists.');
  const current = state.members[collectionId] ?? [];
  const has = current.includes(businessId);
  state.members[collectionId] = has ? current.filter((b) => b !== businessId) : [...current, businessId];
  writeState(userId, state);
  return !has;
}

/** Businesses currently filed in a collection, in filing order. */
export function businessesInCollection(userId: string, collectionId: string): string[] {
  return readState(userId).members[collectionId] ?? [];
}

/** Counts of filed businesses per collection id. */
export function collectionCounts(userId: string): Record<string, number> {
  const state = readState(userId);
  const out: Record<string, number> = {};
  for (const c of state.collections) out[c.id] = (state.members[c.id] ?? []).length;
  return out;
}

/**
 * Drops memberships for businesses that are no longer saved (e.g. after an
 * unsave). Call after the favorites list loads.
 */
export function pruneCollections(userId: string, savedBusinessIds: string[]): void {
  const state = readState(userId);
  const keep = new Set(savedBusinessIds);
  let changed = false;
  for (const cid of Object.keys(state.members)) {
    const next = (state.members[cid] ?? []).filter((b) => keep.has(b));
    if (next.length !== (state.members[cid] ?? []).length) {
      state.members[cid] = next;
      changed = true;
    }
  }
  if (changed) writeState(userId, state);
}

/** Test seam: clears all collection state for the user. */
export function clearCollectionsForTests(userId: string): void {
  const key = collectionsStorageKey(userId);
  memoryFallback.delete(key);
  try {
    storage().removeItem(key);
  } catch {
    /* noop */
  }
}

/* ------------------------------------------------------------------ */

/**
 * The favorites API returns a display subset of the business; adapt it to the
 * full Business shape BusinessRow expects (absent fields stay null/empty —
 * never invented). Lives here (not in a screen module) so both the Saved
 * screen and the collections UI can share it without a component import
 * cycle. Re-exported from customer-experience.tsx for existing importers.
 */
export function favoriteToBusiness(f: FavoriteEntry['business']): Business {
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    description: null,
    imageUrl: f.imageUrl,
    isVerified: f.isVerified,
    address: f.address,
    city: f.city,
    locality: null,
    latitude: null,
    longitude: null,
    phone: null,
    email: null,
    currency: 'PKR',
    categories: [],
    averageRating: f.averageRating,
    reviewCount: f.reviewCount,
  };
}
