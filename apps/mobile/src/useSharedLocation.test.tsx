// @vitest-environment jsdom
/**
 * Regression tests for the shared location STORE (root-cause fix 2026-10-20).
 *
 * The previous hook kept per-component state and ran the async restore in
 * the first mounted screen's effect behind that screen's `mounted` ref: if
 * the screen unmounted before the restore settled, the coordinates were
 * dropped, nothing retried, and the app flipped between "Set your location"
 * and "Near you". These tests pin the store semantics:
 *
 * - saved coords seed every subscriber synchronously and identically
 * - a restore result lands even if the first subscriber has unmounted
 * - a failed background refresh never clears valid coords
 * - only an explicit permission DENIAL clears saved coords
 * - requestLocation success updates every subscriber; failure keeps coords
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { useSharedLocation, __resetSharedLocationForTests } from './useSharedLocation.js';
import * as location from './location.js';

vi.mock('./location.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./location.js')>()),
  loadCustomerCoords: vi.fn(),
  saveCustomerCoords: vi.fn(),
  clearCustomerCoords: vi.fn(),
  checkLocationPermissionState: vi.fn(),
  acquirePosition: vi.fn(),
  locationOutcomeHint: vi.fn(),
}));

const GARDEN_TOWN = { lat: 31.51, lng: 74.34, at: 1750000000000 };
const FRESH_FIX = { lat: 31.505, lng: 74.335 };

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

function Probe({ id }: { id: string }) {
  const loc = useSharedLocation();
  return (
    <div>
      <span data-testid={id}>{loc.coords ? `${loc.coords.lat},${loc.coords.lng}` : 'none'}</span>
      <span data-testid={`${id}-notice`}>{loc.locNotice ?? ''}</span>
      <button data-testid={`${id}-retry`} onClick={loc.requestLocation}>
        retry
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.mocked(location.loadCustomerCoords).mockReturnValue(null);
  vi.mocked(location.checkLocationPermissionState).mockResolvedValue('granted');
  vi.mocked(location.locationOutcomeHint).mockReturnValue('Could not get your location. Tap to retry.');
  __resetSharedLocationForTests();
});

afterEach(cleanup);

describe('useSharedLocation store', () => {
  it('seeds every subscriber with the same saved coords, synchronously', async () => {
    vi.mocked(location.loadCustomerCoords).mockReturnValue(GARDEN_TOWN);
    const gps = deferred<{ status: string; coords?: typeof FRESH_FIX }>();
    vi.mocked(location.acquirePosition).mockReturnValue(gps.promise as never);
    __resetSharedLocationForTests();

    render(
      <>
        <Probe id="home" />
        <Probe id="explore" />
      </>,
    );
    // Both screens show the restored fix immediately: no divergence.
    expect(screen.getByTestId('home')).toHaveTextContent('31.51,74.34');
    expect(screen.getByTestId('explore')).toHaveTextContent('31.51,74.34');

    await act(async () => {
      gps.resolve({ status: 'granted', coords: FRESH_FIX });
    });
    // A fresher fix replaces the coords on BOTH screens at once.
    expect(screen.getByTestId('home')).toHaveTextContent('31.505,74.335');
    expect(screen.getByTestId('explore')).toHaveTextContent('31.505,74.335');
    expect(location.saveCustomerCoords).toHaveBeenCalledWith(FRESH_FIX);
  });

  it('restore result lands even if the first subscriber unmounted first', async () => {
    vi.mocked(location.loadCustomerCoords).mockReturnValue(GARDEN_TOWN);
    const gps = deferred<{ status: string; coords?: typeof FRESH_FIX }>();
    vi.mocked(location.acquirePosition).mockReturnValue(gps.promise as never);
    __resetSharedLocationForTests();

    const first = render(<Probe id="first" />);
    first.unmount(); // the screen that triggered restore goes away mid-flight
    render(<Probe id="second" />);

    await act(async () => {
      gps.resolve({ status: 'granted', coords: FRESH_FIX });
    });
    // The old hook dropped this result (mounted ref was false) and no screen
    // ever retried; the store must deliver it to whoever is subscribed now.
    expect(screen.getByTestId('second')).toHaveTextContent('31.505,74.335');
  });

  it('a failed background refresh keeps the valid saved coords and shows no notice', async () => {
    vi.mocked(location.loadCustomerCoords).mockReturnValue(GARDEN_TOWN);
    vi.mocked(location.acquirePosition).mockResolvedValue({ status: 'unavailable' } as never);
    __resetSharedLocationForTests();

    render(<Probe id="home" />);
    await act(async () => {});
    expect(screen.getByTestId('home')).toHaveTextContent('31.51,74.34');
    expect(screen.getByTestId('home-notice')).toHaveTextContent('');
    expect(location.clearCustomerCoords).not.toHaveBeenCalled();
  });

  it('clears saved coords only when the OS reports permission denied', async () => {
    vi.mocked(location.loadCustomerCoords).mockReturnValue(GARDEN_TOWN);
    vi.mocked(location.checkLocationPermissionState).mockResolvedValue('denied');
    __resetSharedLocationForTests();

    render(<Probe id="home" />);
    await act(async () => {});
    expect(screen.getByTestId('home')).toHaveTextContent('none');
    expect(location.clearCustomerCoords).toHaveBeenCalled();
  });

  it('an inconclusive permission check keeps the saved coords', async () => {
    vi.mocked(location.loadCustomerCoords).mockReturnValue(GARDEN_TOWN);
    vi.mocked(location.checkLocationPermissionState).mockResolvedValue('prompt');
    vi.mocked(location.acquirePosition).mockResolvedValue({ status: 'unavailable' } as never);
    __resetSharedLocationForTests();

    render(<Probe id="home" />);
    await act(async () => {});
    expect(screen.getByTestId('home')).toHaveTextContent('31.51,74.34');
  });

  it('requestLocation failure keeps coords and surfaces the retry notice', async () => {
    vi.mocked(location.loadCustomerCoords).mockReturnValue(GARDEN_TOWN);
    vi.mocked(location.acquirePosition)
      .mockResolvedValueOnce({ status: 'unavailable' } as never) // background refresh
      .mockResolvedValueOnce({ status: 'timeout' } as never); // user retry
    __resetSharedLocationForTests();

    render(<Probe id="home" />);
    await act(async () => {});
    fireEvent.click(screen.getByTestId('home-retry'));
    await act(async () => {});
    expect(screen.getByTestId('home')).toHaveTextContent('31.51,74.34');
    expect(screen.getByTestId('home-notice')).toHaveTextContent('Could not get your location');
  });
});
