import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  requestCustomerLocation,
  formatDistanceKm,
  hasCoordinates,
  directionsUrl,
  locationOutcomeHint,
  type PositionAcquirer,
} from './location.js';

const geo = () => (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator;

/** Installs a stubbed navigator.geolocation for one test.
 *  jsdom's navigator is getter-only, so we patch the globalThis property.
 *  `code` present → the production error callback fires with that code;
 *  otherwise the production success callback fires with fixture coordinates. */
const stubGeolocation = (impl: { missing?: boolean; code?: number } = {}) => {
  const nav = geo();
  if (impl.missing) {
    if (nav && 'geolocation' in nav) delete nav.geolocation;
    return;
  }
  const getCurrentPosition = (ok: (p: { coords: { latitude: number; longitude: number } }) => void, err: (e: { code: number }) => void) => {
    if (impl.code !== undefined) err({ code: impl.code });
    else ok({ coords: { latitude: 31.5204, longitude: 74.3587 } });
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get() {
      return { ...(nav ?? {}), geolocation: { getCurrentPosition } };
    },
  });
};

/** Captures the pristine navigator descriptor once for afterEach restore. */
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

describe('customer location service (Phase 11)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    vi.restoreAllMocks();
  });

  it('resolves granted with real coordinates', async () => {
    stubGeolocation();
    const outcome = await requestCustomerLocation(1000);
    expect(outcome.status).toBe('granted');
    if (outcome.status === 'granted') {
      expect(outcome.coords).toEqual({ lat: 31.5204, lng: 74.3587 });
    }
  });

  it('maps a permission rejection to denied — and never invents coordinates', async () => {
    stubGeolocation({ code: 1 });
    const outcome = await requestCustomerLocation(1000);
    expect(outcome.status).toBe('denied');
    expect((outcome as { coords?: unknown }).coords).toBeUndefined();
  });

  it('reports unavailable when geolocation does not exist', async () => {
    stubGeolocation({ missing: true });
    const outcome = await requestCustomerLocation(1000);
    expect(outcome.status).toBe('unavailable');
  });

  it('reports unavailable for position-unavailable errors', async () => {
    stubGeolocation({ code: 2 });
    const outcome = await requestCustomerLocation(1000);
    expect(outcome.status).toBe('unavailable');
  });

  it('returns an error outcome (no throw) when acquisition rejects', async () => {
    const exploding: PositionAcquirer = async () => {
      throw new Error('boom');
    };
    const outcome = await requestCustomerLocation(8000, exploding);
    expect(outcome.status).toBe('error');
    expect(outcome.status === 'error' ? outcome.message : '').toContain('try again');
  });

  it('never resolves granted with non-finite coordinates', async () => {
    const nav = geo();
    if (nav) {
      nav.geolocation = {
        getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
          ok({ coords: { latitude: Number.NaN, longitude: Number.NaN } }),
      };
    }
    const outcome = await requestCustomerLocation(1000);
    expect(outcome.status).not.toBe('granted');
  });
});

describe('distance and directions helpers (Phase 11)', () => {
  it('formats km and meters from server distances', () => {
    expect(formatDistanceKm(1.24)).toBe('1.2 km');
    expect(formatDistanceKm(0.42)).toBe('420 m');
    expect(formatDistanceKm(0)).toBe('0 m');
  });

  it('returns null rather than fabricating output for invalid distances', () => {
    expect(formatDistanceKm(Number.NaN)).toBeNull();
    expect(formatDistanceKm(-1)).toBeNull();
  });

  it('hasCoordinates is true only for real, both-set coordinates', () => {
    expect(hasCoordinates({ latitude: 31.5, longitude: 74.3 })).toBe(true);
    expect(hasCoordinates({ latitude: null, longitude: null })).toBe(false);
    expect(hasCoordinates({ latitude: 31.5, longitude: null })).toBe(false);
    expect(hasCoordinates({})).toBe(false);
  });

  it('directions prefer exact coordinates and fall back to address search', () => {
    expect(directionsUrl({ latitude: 31.5204, longitude: 74.3587 })).toContain('destination=31.5204,74.3587');
    expect(directionsUrl({ address: '12 Food Street', city: 'Karachi' })).toContain(encodeURIComponent('12 Food Street, Karachi'));
  });

  it('directions returns null when nothing usable exists', () => {
    expect(directionsUrl({})).toBeNull();
    expect(directionsUrl({ latitude: null, longitude: null })).toBeNull();
  });

  it('hints exist for every non-granted outcome and none for granted', () => {
    expect(locationOutcomeHint({ status: 'granted', coords: { lat: 0, lng: 0 } })).toBeNull();
    expect(locationOutcomeHint({ status: 'denied' })).toMatch(/denied/i);
    expect(locationOutcomeHint({ status: 'unavailable' })).toMatch(/not available/i);
    expect(locationOutcomeHint({ status: 'error', message: 'x' })).toBe('x');
  });
});
