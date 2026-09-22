// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { OwnerLocation } from './OwnerLocation.js';
import * as api from '../api.js';
import type { BusinessLocation } from '../api.js';
import type { MapProvider } from '../maps/provider.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusinessLocation: vi.fn(),
  updateBusinessLocation: vi.fn(),
  getMyBusinesses: vi.fn(),
}));

const draggableMoves = new Set<(p: { lat: number; lng: number }) => void>();
const mapClicks = new Set<(p: { lat: number; lng: number }) => void>();
const pinPlacements: ({ lat: number; lng: number } | null)[] = [];

const makeProvider = (): MapProvider => ({
  mount: vi.fn(async () => {}),
  unmount: vi.fn(),
  setMarkers: vi.fn(),
  selectMarker: vi.fn(),
  panTo: vi.fn(),
  getCenter: vi.fn(() => ({ lat: 30.3753, lng: 69.3451 })),
  onMapIdle: vi.fn(() => () => {}),
  onMarkerClick: vi.fn(() => () => {}),
  onMapClick: vi.fn((cb) => {
    mapClicks.add(cb);
    return () => mapClicks.delete(cb);
  }),
  onDraggableMarkerMove: vi.fn((cb) => {
    draggableMoves.add(cb);
    return () => draggableMoves.delete(cb);
  }),
  setDraggableMarker: vi.fn((p) => {
    pinPlacements.push(p);
  }),
  getDraggableMarker: vi.fn(() => null),
});

// One provider instance per test: screens hold provider identity across
// renders, so the mock must too (mirrors the real hook's stable lifecycle).
let currentProvider: MapProvider;
let currentGeocode: (q: string) => Promise<{ position: { lat: number; lng: number }; label: string }[]>;

vi.mock('../maps/useMapProvider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../maps/useMapProvider.js')>()),
  useMapProvider: () => ({
    handle: {
      provider: currentProvider,
      geocoding: { geocode: currentGeocode, reverseGeocode: vi.fn(async () => null) },
      ready: true,
      canvasRef: () => {},
      onMapIdle: currentProvider.onMapIdle,
      onMarkerClick: currentProvider.onMarkerClick,
      onMapClick: currentProvider.onMapClick,
      onDraggableMarkerMove: currentProvider.onDraggableMarkerMove,
    },
  }),
}));

vi.mock('../maps/MapCanvas.js', () => ({
  MapCanvas: () => <div data-testid="owner-map-canvas" />,
}));

vi.mock('../location.js', () => ({ requestCustomerLocation: vi.fn() }));

const resetTestProvider = () => {
  currentProvider = makeProvider();
  currentGeocode = vi.fn(async (q: string) =>
    q.toLowerCase().includes('liberty')
      ? [
          { position: { lat: 31.5155, lng: 74.3436 }, label: 'Liberty Market, Gulberg, Lahore' },
          { position: { lat: 31.516, lng: 74.344 }, label: 'Liberty Chowk, Lahore' },
        ]
      : [],
  );
  (globalThis as { __testOwnerProvider?: MapProvider }).__testOwnerProvider = currentProvider;
};

const configured: BusinessLocation = { latitude: 31.5204, longitude: 74.3587, isConfigured: true };
const unconfigured: BusinessLocation = { latitude: null, longitude: null, isConfigured: false };

beforeEach(() => {
  vi.clearAllMocks();
  draggableMoves.clear();
  pinPlacements.length = 0;
  resetTestProvider();
  vi.mocked(api.getMyBusinesses).mockResolvedValue([]);
  vi.mocked(api.updateBusinessLocation).mockResolvedValue(unconfigured);
});

describe('OwnerLocation map picker (Phase 12)', () => {
  it('places the pin at the saved location and pans to it when configured', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(configured);
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByRole('button', { name: /save location/i });
    const provider = (globalThis as { __testOwnerProvider?: MapProvider }).__testOwnerProvider!;
    await waitFor(() => {
      expect(provider.setDraggableMarker).toHaveBeenCalledWith({ lat: 31.5204, lng: 74.3587 });
      expect(provider.panTo).toHaveBeenCalledWith({ lat: 31.5204, lng: 74.3587 }, 15);
    });
    expect(screen.getByRole('status', { name: '' })).toBeTruthy();
  });

  it('does not fabricate a pin when the location is not configured', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByRole('button', { name: /save location/i });
    const provider = (globalThis as { __testOwnerProvider?: MapProvider }).__testOwnerProvider!;
    await waitFor(() => expect(provider.setDraggableMarker).toHaveBeenCalledWith(null));
    // And it never invents city-centre coordinates in the fields.
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('');
  });

  it('dragging the pin updates the coordinate fields (pin is the source of truth)', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByRole('button', { name: /save location/i });
    draggableMoves.forEach((cb) => cb({ lat: 31.5155, lng: 74.3436 }));
    await waitFor(() => {
      expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('31.515500');
      expect((screen.getByLabelText('Longitude') as HTMLInputElement).value).toBe('74.343600');
    });
  });

  it('tapping the map drops the pin there and fills the coordinate fields', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByRole('button', { name: /save location/i });
    mapClicks.forEach((cb) => cb({ lat: 31.5497, lng: 74.3436 }));
    await waitFor(() => {
      expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('31.549700');
      expect((screen.getByLabelText('Longitude') as HTMLInputElement).value).toBe('74.343600');
    });
    expect(pinPlacements).toContainEqual({ lat: 31.5497, lng: 74.3436 });
  });

  it('address search: picking a result fills the fields and drops the pin there', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByRole('button', { name: /save location/i });
    fireEvent.change(screen.getByLabelText('Search address'), { target: { value: 'Liberty Market Lahore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const result = await screen.findByRole('button', { name: /liberty market, gulberg, lahore/i });
    fireEvent.click(result);
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('31.515500');
    expect((screen.getByLabelText('Longitude') as HTMLInputElement).value).toBe('74.343600');
    const provider = (globalThis as { __testOwnerProvider?: MapProvider }).__testOwnerProvider!;
    expect(provider.setDraggableMarker).toHaveBeenCalledWith({ lat: 31.5155, lng: 74.3436 });
    await screen.findByText(/liberty market, gulberg, lahore/i);
  });

  it('address search with no matches shows an honest error', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByRole('button', { name: /save location/i });
    fireEvent.change(screen.getByLabelText('Search address'), { target: { value: 'zzz-nowhere' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText(/no places matched that search/i);
  });

  /** Fires a pin drag through React's act so state updates flush like a real drag. */
  const dragPin = (lat: number, lng: number) => {
    act(() => {
      draggableMoves.forEach((cb) => cb({ lat, lng }));
    });
  };

  it('save after pin placement sends the pin coordinates and reports real success only', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    vi.mocked(api.updateBusinessLocation).mockResolvedValue({ latitude: 31.5155, longitude: 74.3436, isConfigured: true });
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByRole('button', { name: /save location/i });
    dragPin(31.5155, 74.3436);
    await waitFor(() => expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('31.515500'));
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));
    await screen.findByText(/location saved/i);
    expect(api.updateBusinessLocation).toHaveBeenCalledWith('biz-1', { latitude: 31.5155, longitude: 74.3436 });
  });

  it('save API failure surfaces the error, never a fake success', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    vi.mocked(api.updateBusinessLocation).mockRejectedValue(new Error('You do not own this business.'));
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByRole('button', { name: /save location/i });
    dragPin(31.5155, 74.3436);
    await waitFor(() => expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('31.515500'));
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));
    await screen.findByText(/you do not own this business/i);
    expect(screen.queryByText(/location saved/i)).toBeNull();
  });

  it('clear removes the pin and reports the cleared state', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(configured);
    vi.mocked(api.updateBusinessLocation).mockResolvedValue(unconfigured);
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /clear location/i }));
    await screen.findByText(/location cleared/i);
    expect(api.updateBusinessLocation).toHaveBeenCalledWith('biz-1', { latitude: null, longitude: null });
    const provider = (globalThis as { __testOwnerProvider?: MapProvider }).__testOwnerProvider!;
    await waitFor(() => expect(provider.setDraggableMarker).toHaveBeenCalledWith(null));
  });

  it('use-my-location fills the fields from the device position', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    const loc = await import('../location.js');
    vi.mocked(loc.requestCustomerLocation).mockResolvedValue({ status: 'granted', coords: { lat: 31.52, lng: 74.35 } });
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /use my location/i }));
    await waitFor(() => {
      expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('31.520000');
    });
    expect((screen.getByLabelText('Longitude') as HTMLInputElement).value).toBe('74.350000');
    expect(await screen.findByText(/pinned location/i)).toBeTruthy();
  });

  it('a denied location permission shows calm guidance, never a fake pin', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(unconfigured);
    const loc = await import('../location.js');
    vi.mocked(loc.requestCustomerLocation).mockResolvedValue({ status: 'denied' });
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /use my location/i }));
    await screen.findByText(/location permission was denied/i);
    // No coordinates are fabricated when permission is denied.
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('');
  });
});
