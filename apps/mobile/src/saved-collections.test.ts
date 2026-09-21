// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  businessesInCollection,
  clearCollectionsForTests,
  collectionCounts,
  collectionIdsForBusiness,
  createCollection,
  deleteCollection,
  listCollections,
  pruneCollections,
  storage,
  toggleBusinessInCollection,
  MAX_COLLECTION_NAME,
} from './saved-collections.js';

const USER = 'user-collections-test';

beforeEach(() => {
  clearCollectionsForTests(USER);
});

describe('saved collections (local-first)', () => {
  it('starts empty and creates collections oldest-first', () => {
    expect(listCollections(USER)).toEqual([]);
    const a = createCollection(USER, 'Food');
    const b = createCollection(USER, 'Places to try');
    expect(listCollections(USER).map((c) => c.name)).toEqual(['Food', 'Places to try']);
    expect(a.id).not.toBe(b.id);
  });

  it('rejects blank names, duplicates, and over-long names', () => {
    expect(() => createCollection(USER, '   ')).toThrow('Give the collection a name');
    createCollection(USER, 'Food');
    expect(() => createCollection(USER, 'food')).toThrow('already have a collection');
    const long = createCollection(USER, 'x'.repeat(MAX_COLLECTION_NAME + 10));
    expect(long.name).toHaveLength(MAX_COLLECTION_NAME);
  });

  it('toggles membership and reports which shelves hold a business', () => {
    const food = createCollection(USER, 'Food');
    const services = createCollection(USER, 'Services');
    expect(toggleBusinessInCollection(USER, food.id, 'biz-1')).toBe(true);
    expect(toggleBusinessInCollection(USER, services.id, 'biz-1')).toBe(true);
    expect(collectionIdsForBusiness(USER, 'biz-1')).toEqual(expect.arrayContaining([food.id, services.id]));
    expect(toggleBusinessInCollection(USER, food.id, 'biz-1')).toBe(false);
    expect(collectionIdsForBusiness(USER, 'biz-1')).toEqual([services.id]);
    expect(businessesInCollection(USER, services.id)).toEqual(['biz-1']);
  });

  it('throws for unknown collections instead of inventing one', () => {
    expect(() => toggleBusinessInCollection(USER, 'nope', 'biz-1')).toThrow('no longer exists');
  });

  it('deleting a collection keeps the business saved (only the shelf goes)', () => {
    const food = createCollection(USER, 'Food');
    toggleBusinessInCollection(USER, food.id, 'biz-1');
    deleteCollection(USER, food.id);
    expect(listCollections(USER)).toEqual([]);
    expect(collectionCounts(USER)).toEqual({});
  });

  it('prunes memberships for businesses that left Saved', () => {
    const food = createCollection(USER, 'Food');
    toggleBusinessInCollection(USER, food.id, 'biz-1');
    toggleBusinessInCollection(USER, food.id, 'biz-2');
    pruneCollections(USER, ['biz-2']);
    expect(businessesInCollection(USER, food.id)).toEqual(['biz-2']);
  });

  it('isolates collections per user id', () => {
    createCollection(USER, 'Food');
    expect(listCollections('someone-else')).toEqual([]);
  });

  it('survives corrupt storage without crashing', () => {
    storage().setItem('nearbyorders.collections.' + USER, '{not json');
    expect(listCollections(USER)).toEqual([]);
  });

  it('keeps session state in memory when the disk write fails (quota)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      const food = createCollection(USER, 'Food');
      // The write failed, but the session still sees the collection because
      // writeState fell back to memory and readState prefers it.
      expect(listCollections(USER).map((c) => c.name)).toEqual(['Food']);
      expect(toggleBusinessInCollection(USER, food.id, 'biz-1')).toBe(true);
      expect(businessesInCollection(USER, food.id)).toEqual(['biz-1']);
    } finally {
      spy.mockRestore();
      clearCollectionsForTests(USER);
    }
  });
});
