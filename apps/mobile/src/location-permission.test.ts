import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * checkLocationPermissionState maps the native permission state without
 * prompting. The Capacitor plugin is injected via dynamic import, so these
 * tests stub the module registry per case.
 */
function stubNative(status: { location: string; coarseLocation: string }) {
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true },
  }));
  vi.doMock('@capacitor/geolocation', () => ({
    Geolocation: {
      checkPermissions: vi.fn().mockResolvedValue(status),
      requestPermissions: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  }));
}

function stubWeb() {
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('@capacitor/core');
  vi.doUnmock('@capacitor/geolocation');
});

describe('checkLocationPermissionState', () => {
  it('granted when fine location is granted', async () => {
    stubNative({ location: 'granted', coarseLocation: 'granted' });
    const { checkLocationPermissionState } = await import('./location.js');
    expect(await checkLocationPermissionState()).toBe('granted');
  });

  it('granted when only coarse location is granted (approximate)', async () => {
    stubNative({ location: 'denied', coarseLocation: 'granted' });
    const { checkLocationPermissionState } = await import('./location.js');
    expect(await checkLocationPermissionState()).toBe('granted');
  });

  it('prompt when the OS can still show the dialog', async () => {
    stubNative({ location: 'prompt', coarseLocation: 'prompt' });
    const { checkLocationPermissionState } = await import('./location.js');
    expect(await checkLocationPermissionState()).toBe('prompt');
  });

  it('prompt-with-rationale still counts as promptable', async () => {
    stubNative({ location: 'prompt-with-rationale', coarseLocation: 'prompt' });
    const { checkLocationPermissionState } = await import('./location.js');
    expect(await checkLocationPermissionState()).toBe('prompt');
  });

  it('denied when the OS will not prompt again', async () => {
    stubNative({ location: 'denied', coarseLocation: 'denied' });
    const { checkLocationPermissionState } = await import('./location.js');
    expect(await checkLocationPermissionState()).toBe('denied');
  });

  it('falls back to prompt on web', async () => {
    stubWeb();
    const { checkLocationPermissionState } = await import('./location.js');
    expect(await checkLocationPermissionState()).toBe('prompt');
  });
});
