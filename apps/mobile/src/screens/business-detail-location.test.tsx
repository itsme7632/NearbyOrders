// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BusinessDetailScreen } from './BusinessDetail.js';
import { BusinessMapContext } from './BusinessMapContext.js';
import * as api from '../api.js';
import type { Business } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusiness: vi.fn(),
  listBusinessReviews: vi.fn(),
}));

// Map provider is mocked at the seam: the map-context card must pass the
// business's authoritative coordinates to the provider untouched.
const setMarkers = vi.fn();
const panTo = vi.fn();
const setDraggableMarker = vi.fn();
vi.mock('../maps/useMapProvider.js', () => ({
  useMapProvider: () => ({
    handle: {
      provider: { setMarkers, panTo, setDraggableMarker },
      geocoding: {},
      ready: true,
      canvasRef: () => {},
      onMapIdle: () => () => {},
      onMarkerClick: () => () => {},
      onMapClick: () => () => {},
      onDraggableMarkerMove: () => () => {},
    },
  }),
}));
vi.mock('../maps/MapCanvas.js', () => ({ MapCanvas: () => null }));

const business = (patch: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Gulberg Grill',
  slug: 'gulberg-grill',
  description: null,
  imageUrl: null,
  isVerified: false,
  address: '12 Food Street',
  city: 'Lahore',
  locality: 'Gulberg',
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  currency: 'PKR',
  averageRating: null,
  reviewCount: 0,
  categories: [{ id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true }],
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusiness).mockResolvedValue(business());
  vi.mocked(api.listBusinessReviews).mockResolvedValue({
    items: [],
    nextCursor: null,
    averageRating: null,
    reviewCount: 0,
  });
});

describe('BusinessDetail location display (Phase 11)', () => {
  it('shows real distance only when the server sent one AND coordinates are configured', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ distanceKm: 1.24, latitude: 31.5204, longitude: 74.3587 }));
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.getByText(/1\.2 km away/i)).toBeInTheDocument();
  });

  it('does not invent a distance when none was computed', async () => {
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByText(/away/i)).not.toBeInTheDocument();
  });

  it('falls back to the address line when no distance was computed', async () => {
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.getByText(/Gulberg, Lahore/)).toBeInTheDocument();
  });

  it('offers Directions when real coordinates exist', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ latitude: 31.5204, longitude: 74.3587 }));
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    const directions = await screen.findByRole('link', { name: /directions/i });
    expect(directions.getAttribute('href')).toContain('destination=31.5204,74.3587');
  });

  it('offers Directions via address search when only an address is configured', async () => {
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    const directions = await screen.findByRole('link', { name: /directions/i });
    expect(directions.getAttribute('href')).toContain(encodeURIComponent('12 Food Street, Lahore'));
  });

  it('hides Directions entirely when no usable location data exists', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ address: '', city: '', locality: null }),
    );
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByRole('link', { name: /directions/i })).toBeNull();
  });

  it('renders no location map card when the business has no coordinates (no fake location)', async () => {
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByRole('region', { name: /location/i })).toBeNull();
  });
});

describe('customer map context uses the exact saved coordinates (Phase 12.1)', () => {
  // Regression guard: the marker must be created from the authoritative
  // backend coordinates, never a rounded or substituted value.
  const SAVED = { latitude: 31.520412, longitude: 74.358723 };

  it('creates the marker from the exact saved coordinates', () => {
    render(<BusinessMapContext business={business(SAVED)} placeLabel="Gulberg, Lahore" />);

    expect(setMarkers).toHaveBeenCalledTimes(1);
    const markers = setMarkers.mock.calls[0][0];
    expect(markers).toHaveLength(1);
    expect(markers[0].position).toEqual({ lat: 31.520412, lng: 74.358723 });
    // The camera centers on the same authoritative coordinates.
    expect(panTo).toHaveBeenCalledWith({ lat: 31.520412, lng: 74.358723 }, 15);
    // The display-only marker must never be draggable on the customer side.
    expect(setDraggableMarker).toHaveBeenCalledWith(null);
    expect(screen.getByText(/12 Food Street/)).toBeTruthy();
  });
});