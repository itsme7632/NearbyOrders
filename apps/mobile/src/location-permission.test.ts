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

describe('acquireViaCapacitorPlugin options', () => {
  it('requests high accuracy with a generous timeout', async () => {
    const getCurrentPosition = vi.fn().mockResolvedValue({
      coords: { latitude: 31.51, longitude: 74.34 },
    });
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock('@capacitor/geolocation', () => ({
      Geolocation: {
        checkPermissions: vi.fn().mockResolvedValue({ location: 'granted', coarseLocation: 'granted' }),
        requestPermissions: vi.fn(),
        getCurrentPosition,
      },
    }));
    const { acquireViaCapacitorPlugin } = await import('./location.js');
    const geo = {
      checkPermissions: vi.fn().mockResolvedValue({ location: 'granted', coarseLocation: 'granted' }),
      requestPermissions: vi.fn(),
      getCurrentPosition,
    };
    const outcome = await acquireViaCapacitorPlugin(geo, 8000);
    expect(outcome.status).toBe('granted');
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        enableHighAccuracy: true,
        maximumAge: 60000,
      })
    );
    const opts = getCurrentPosition.mock.calls[0][0];
    expect(opts.timeout).toBeGreaterThanOrEqual(20000);
  });

  it('classifies timeout as unavailable (not denied)', async () => {
    const geo = {
      checkPermissions: vi.fn().mockResolvedValue({ location: 'granted', coarseLocation: 'granted' }),
      requestPermissions: vi.fn(),
      getCurrentPosition: vi.fn().mockRejectedValue({ code: 'OS-PLUG-GLOC-0010', message: 'Could not obtain location in time.' }),
    };
    const { acquireViaCapacitorPlugin } = await import('./location.js');
    const outcome = await acquireViaCapacitorPlugin(geo, 8000);
    expect(outcome.status).toBe('unavailable');
  });

  it('classifies location services disabled as unavailable', async () => {
    const geo = {
      checkPermissions: vi.fn().mockResolvedValue({ location: 'granted', coarseLocation: 'granted' }),
      requestPermissions: vi.fn(),
      getCurrentPosition: vi.fn().mockRejectedValue({ code: 'OS-PLUG-GLOC-0007', message: 'Location services are not enabled.' }),
    };
    const { acquireViaCapacitorPlugin } = await import('./location.js');
    const outcome = await acquireViaCapacitorPlugin(geo, 8000);
    expect(outcome.status).toBe('unavailable');
  });
});
