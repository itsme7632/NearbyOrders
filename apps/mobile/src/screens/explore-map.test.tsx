// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import { ExploreScreen } from './Explore.js';
import { requestCustomerLocation, type LocationOutcome } from '../location.js';
import type { Business } from '../api.js';
import type { LatLng, MapProvider } from '../maps/provider.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  listNearbyBusinesses: vi.fn(),
  listBusinesses: vi.fn(),
  listCategories: vi.fn(),
  searchMarketplace: vi.fn(),
}));

vi.mock('../location.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../location.js')>()),
  requestCustomerLocation: vi.fn(),
}));

/**
 * Map provider is mocked at the factory seam: Explore's map view must work
 * against the abstraction, not Leaflet. The stub records marker/pan calls so
 * tests can assert honest rendering (no fabricated markers).
 */
const markerCalls: { markers: { id: string; position: LatLng }[]; selected?: string | null }[] = [];
const panCalls: LatLng[] = [];
const idleListeners = new Set<(center: LatLng) => void>();
let fakeCenter: LatLng = { lat: 31.5204, lng: 74.3587 };

const makeProvider = (): MapProvider => ({
  mount: vi.fn(async () => {}),
  unmount: vi.fn(),
  setMarkers: vi.fn((markers: { id: string; position: LatLng }[], selected?: string | null) => {
    markerCalls.push({ markers: markers.map((m) => ({ id: m.id, position: m.position })), selected });
  }),
  selectMarker: vi.fn(),
  panTo: vi.fn((p) => {
    panCalls.push(p);
  }),
  getCenter: vi.fn(() => fakeCenter),
  onMapIdle: vi.fn((cb) => {
    idleListeners.add(cb);
    return () => idleListeners.delete(cb);
  }),
  onMarkerClick: vi.fn(() => () => {}),
  onMapClick: vi.fn(() => () => {}),
  onDraggableMarkerMove: vi.fn(() => () => {}),
  setDraggableMarker: vi.fn(),
  getDraggableMarker: vi.fn(() => null),
});

vi.mock('../maps/useMapProvider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../maps/useMapProvider.js')>()),
  useMapProvider: () => {
    const provider = makeProvider();
    (globalThis as { __testProvider?: MapProvider }).__testProvider = provider;
    return {
      handle: {
        provider,
        geocoding: { geocode: vi.fn(async () => []), reverseGeocode: vi.fn(async () => null) },
        ready: true,
        canvasRef: () => {},
        onMapIdle: provider.onMapIdle,
        onMarkerClick: provider.onMarkerClick,
        onMapClick: provider.onMapClick,
        onDraggableMarkerMove: provider.onDraggableMarkerMove,
      },
    };
  },
}));

vi.mock('../maps/MapCanvas.js', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}));

const base = (patch: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Gulberg Grill',
  slug: 'gulberg-grill',
  description: null,
  imageUrl: null,
  isVerified: false,
  address: '12 Food Street',
  city: 'Lahore',
  locality: 'Gulberg',
  latitude: 31.5204,
  longitude: 74.3587,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [{ id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true }],
  ...patch,
});

const granted: LocationOutcome = { status: 'granted', coords: { lat: 31.5204, lng: 74.3587 } };

beforeEach(() => {
  vi.clearAllMocks();
  markerCalls.length = 0;
  panCalls.length = 0;
  idleListeners.clear();
  fakeCenter = { lat: 31.5204, lng: 74.3587 };
  vi.mocked(api.listCategories).mockResolvedValue([
    { id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true },
  ]);
  vi.mocked(api.listBusinesses).mockResolvedValue([base()]);
  vi.mocked(api.listNearbyBusinesses).mockResolvedValue([
    base({ name: 'Nearby Bistro', id: 'biz-2' }),
    base({ name: 'Unmapped Studio', id: 'biz-3', latitude: null, longitude: null }),
  ]);
  // ExploreScreen only calls /search when advanced filters are active; the
  // default keeps the suite hermetic if that ever changes.
  vi.mocked(api.searchMarketplace).mockResolvedValue({ results: [], nextCursor: null, total: 0, sort: 'relevance' });
  vi.mocked(requestCustomerLocation).mockResolvedValue(granted);
});

const enterNearbyMap = async () => {
  render(<ExploreScreen onOpenBusiness={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
  await screen.findByText('Nearby Bistro');
  fireEvent.click(screen.getByRole('radio', { name: 'Map' }));
  await screen.findByTestId('map-canvas');
};

describe('Explore map view (Phase 12)', () => {
  it('switches between list and map, rendering the same result set', async () => {
    await enterNearbyMap();
    // Map rendered with markers for located businesses only.
    const last = markerCalls.at(-1)!;
    expect(last.markers.map((m) => m.id)).toEqual(['biz-2']); // biz-3 has no coordinates
    // Back to list: business cards visible again.
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    await waitFor(() => expect(screen.getByText('Nearby Bistro')).toBeInTheDocument());
  });

  it('never fabricates markers for businesses without coordinates', async () => {
    await enterNearbyMap();
    const allIds = markerCalls.flatMap((c) => c.markers.map((m) => m.id));
    expect(allIds).not.toContain('biz-3');
  });

  it('marker selection is reflected and opens Business Detail from the preview', async () => {
    const onOpen = vi.fn();
    render(<ExploreScreen onOpenBusiness={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText('Nearby Bistro');
    fireEvent.click(screen.getByRole('radio', { name: 'Map' }));
    await screen.findByTestId('map-canvas');

    const provider = (globalThis as { __testProvider?: MapProvider }).__testProvider!;
    // Simulate a marker tap through the provider callback.
    const clickCb = vi.mocked(provider.onMarkerClick).mock.calls[0][0];
    clickCb('biz-2');
    const preview = await screen.findByRole('dialog', { name: /nearby bistro preview/i });
    expect(preview).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onOpen).toHaveBeenCalledWith('biz-2');
  });

  it('search-this-area re-queries nearby at the visible map center', async () => {
    await enterNearbyMap();
    expect(api.listNearbyBusinesses).toHaveBeenCalledTimes(1);
    // The user pans: idle fires with a new center far from the search center.
    fakeCenter = { lat: 33.6844, lng: 73.0479 }; // Islamabad, ~370 km away
    idleListeners.forEach((cb) => cb(fakeCenter));
    const searchButton = await screen.findByRole('button', { name: /search this area/i });
    fireEvent.click(searchButton);
    await waitFor(() =>
      expect(api.listNearbyBusinesses).toHaveBeenLastCalledWith(
        expect.objectContaining({ lat: 33.6844, lng: 73.0479 }),
      ),
    );
  });

  it('does not show search-this-area when the map has not moved', async () => {
    await enterNearbyMap();
    idleListeners.forEach((cb) => cb({ lat: 31.5204, lng: 74.3587 }));
    expect(screen.queryByRole('button', { name: /search this area/i })).toBeNull();
  });

  it('radius control changes the server query', async () => {
    await enterNearbyMap();
    fireEvent.click(await screen.findByRole('radio', { name: '5 km' }));
    await waitFor(() =>
      expect(api.listNearbyBusinesses).toHaveBeenLastCalledWith(
        expect.objectContaining({ radiusKm: 5 }),
      ),
    );
    expect(screen.getByText(/within 5 km/i)).toBeInTheDocument();
  });

  it('map is only offered in nearby mode with a location', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByRole('radio', { name: 'Map' })).toBeNull();
  });

  it('empty map results show an honest empty state', async () => {
    vi.mocked(api.listNearbyBusinesses).mockResolvedValue([]);
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Map' }));
    await screen.findByText(/no businesses with map locations in this area yet/i);
  });
});
