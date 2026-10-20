// @vitest-environment jsdom
/**
 * Distance integrity regressions (device report 2026-10-20: a business card
 * showed "0 m · Sheikhupura" while the phone was in Garden Town, Lahore and
 * the business's configured coordinates are ~1.77 km away).
 *
 * Rules pinned here:
 * - distance is computed from TWO DIFFERENT coordinate pairs (device fix vs
 *   the business's configured coordinates)
 * - missing user coordinates can never produce "0 m"
 * - a server value claiming ~0 while the known pairs are far apart is
 *   impossible and loses to the local haversine
 * - a business's city/address fields never become a distance or a location
 */
import { describe, expect, it } from 'vitest';
import { distanceKmBetween, displayDistanceKm, formatDistanceKm } from './location.js';

const GARDEN_TOWN = { lat: 31.51, lng: 74.34 }; // device fix (test phone)
const BUTT_SPICES = { latitude: 31.49912, longitude: 74.326386 }; // business coords (production API)

describe('distanceKmBetween', () => {
  it('computes a real non-zero distance between two different coordinate pairs', () => {
    const km = distanceKmBetween(GARDEN_TOWN, { lat: BUTT_SPICES.latitude, lng: BUTT_SPICES.longitude });
    expect(km).toBeGreaterThan(1.5);
    expect(km).toBeLessThan(2.0);
  });

  it('is zero only for genuinely identical pairs', () => {
    expect(distanceKmBetween(GARDEN_TOWN, GARDEN_TOWN)).toBe(0);
  });
});

describe('displayDistanceKm', () => {
  it('never shows "0 m" when the server claims 0 but the pairs are far apart', () => {
    const km = displayDistanceKm({ distanceKm: 0, ...BUTT_SPICES }, GARDEN_TOWN);
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(1.5);
    expect(formatDistanceKm(km!)).not.toBe('0 m');
    expect(formatDistanceKm(km!)).toBe('1.8 km');
  });

  it('missing user coordinates cannot produce "0 m"', () => {
    // No server value and no user fix: no distance at all, never 0.
    expect(displayDistanceKm({ ...BUTT_SPICES }, null)).toBeNull();
    expect(displayDistanceKm({ distanceKm: undefined, ...BUTT_SPICES }, null)).toBeNull();
    expect(displayDistanceKm({ distanceKm: null, ...BUTT_SPICES }, null)).toBeNull();
  });

  it('a business city never becomes a distance or a location', () => {
    // The business record carries city "Sheikhupura" but no coordinates and
    // no server distance: nothing displayable may be derived from the city.
    const km = displayDistanceKm(
      { city: 'Sheikhupura', distanceKm: undefined, latitude: null, longitude: null } as never,
      GARDEN_TOWN,
    );
    expect(km).toBeNull();
  });

  it('trusts the server value when it agrees with the coordinate pairs', () => {
    expect(displayDistanceKm({ distanceKm: 1.77, ...BUTT_SPICES }, GARDEN_TOWN)).toBe(1.77);
  });

  it('falls back to the local haversine when the server sent no distance but both pairs are known', () => {
    const km = displayDistanceKm({ distanceKm: undefined, ...BUTT_SPICES }, GARDEN_TOWN);
    expect(km).toBeGreaterThan(1.5);
    expect(km).toBeLessThan(2.0);
  });

  it('shows metres (not "0 m") for a genuinely close business', () => {
    const near = { latitude: 31.5105, longitude: 74.3405 }; // ~70 m away
    const km = displayDistanceKm({ distanceKm: 0.07, ...near }, GARDEN_TOWN);
    expect(formatDistanceKm(km!)).toBe('70 m');
  });
});
