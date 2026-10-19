// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  saveCustomerCoords,
  loadCustomerCoords,
  clearCustomerCoords,
  restoreCustomerCoords,
} from './location.js';

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe('customer coordinate persistence', () => {
  it('saves and loads coordinates', () => {
    saveCustomerCoords({ lat: 31.51, lng: 74.34 });
    const loaded = loadCustomerCoords();
    expect(loaded?.lat).toBe(31.51);
    expect(loaded?.lng).toBe(74.34);
  });

  it('returns null when nothing is stored', () => {
    expect(loadCustomerCoords()).toBeNull();
  });

  it('rejects invalid coordinates', () => {
    window.localStorage.setItem('no_customer_coords', JSON.stringify({ lat: 999, lng: 74.34 }));
    expect(loadCustomerCoords()).toBeNull();
    window.localStorage.setItem('no_customer_coords', JSON.stringify({ lat: 'x', lng: 74.34 }));
    expect(loadCustomerCoords()).toBeNull();
  });

  it('clears stored coordinates', () => {
    saveCustomerCoords({ lat: 31.51, lng: 74.34 });
    clearCustomerCoords();
    expect(loadCustomerCoords()).toBeNull();
  });

  it('restores only when permission is granted', async () => {
    saveCustomerCoords({ lat: 31.51, lng: 74.34 });
    // Mock the permission check to return 'granted'
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock('@capacitor/geolocation', () => ({
      Geolocation: {
        checkPermissions: vi.fn().mockResolvedValue({ location: 'granted', coarseLocation: 'granted' }),
      },
    }));
    const { restoreCustomerCoords: restore } = await import('./location.js');
    const result = await restore();
    expect(result?.lat).toBe(31.51);
  });

  it('discards persisted coords when permission is not granted', async () => {
    saveCustomerCoords({ lat: 31.51, lng: 74.34 });
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock('@capacitor/geolocation', () => ({
      Geolocation: {
        checkPermissions: vi.fn().mockResolvedValue({ location: 'denied', coarseLocation: 'denied' }),
      },
    }));
    const { restoreCustomerCoords: restore, loadCustomerCoords: load } = await import('./location.js');
    const result = await restore();
    expect(result).toBeNull();
    expect(load()).toBeNull(); // cleared
  });
});
