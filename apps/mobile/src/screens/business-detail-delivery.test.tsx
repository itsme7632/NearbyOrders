// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BusinessDetailScreen } from './BusinessDetail.js';
import { ToastProvider } from '../components/primitives.js';
import * as api from '../api.js';
import type { Business } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusiness: vi.fn(),
  listBusinessReviews: vi.fn(),
}));

vi.mock('../maps/useMapProvider.js', () => ({
  useMapProvider: () => ({
    handle: {
      provider: { setMarkers: vi.fn(), panTo: vi.fn(), setDraggableMarker: vi.fn() },
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
  vi.mocked(api.listBusinessReviews).mockResolvedValue({
    items: [],
    nextCursor: null,
    averageRating: null,
    reviewCount: 0,
  });
});

describe('BusinessDetail delivery capability (Phase 3H)', () => {
  it('renders the authoritative delivery row with fee and COD verbatim', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: 15000 }),
    );
    render(
      <ToastProvider>
        <BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />
      </ToastProvider>,
    );
    await screen.findByText('Gulberg Grill');

    const dt = screen.getByText('Delivery');
    expect(dt.tagName).toBe('DT');
    const dd = dt.parentElement!;
    expect(dd.textContent).toContain('Delivery available');
    // Fee is the server's minor-unit value rendered as money: Rs 150.
    expect(dd.textContent).toMatch(/150/);
    expect(dd.textContent).toContain('Cash on delivery');
  });

  it('renders "Pickup only" when the server says delivery is disabled', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ deliveryEnabled: false, codEnabled: false, deliveryFeeMinor: null }),
    );
    render(
      <ToastProvider>
        <BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />
      </ToastProvider>,
    );
    await screen.findByText('Gulberg Grill');

    const dt = screen.getByText('Delivery');
    expect(dt.parentElement!.textContent).toContain('Pickup only');
    expect(dt.parentElement!.textContent).not.toContain('Cash on delivery');
  });

  it('omits the row entirely when the payload predates the delivery fields', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business());
    render(
      <ToastProvider>
        <BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />
      </ToastProvider>,
    );
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByText('Delivery')).toBeNull();
  });
});
