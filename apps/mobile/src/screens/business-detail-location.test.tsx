// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { BusinessDetailScreen } from './BusinessDetail.js';
import { ToastProvider } from '../components/primitives.js';
import { BusinessMapContext } from './BusinessMapContext.js';
import * as api from '../api.js';
import type { Business, BusinessHour, Service, Product } from '../api.js';

/** Mirrors the app root: BusinessDetailScreen always renders under ToastProvider. */
const renderDetail = (props: ComponentProps<typeof BusinessDetailScreen>) =>
  render(
    <ToastProvider>
      <BusinessDetailScreen {...props} />
    </ToastProvider>,
  );

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
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.getByText(/1\.2 km away/i)).toBeInTheDocument();
  });

  it('does not invent a distance when none was computed', async () => {
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByText(/away/i)).not.toBeInTheDocument();
  });

  it('falls back to the address line when no distance was computed', async () => {
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.getByText(/Gulberg, Lahore/)).toBeInTheDocument();
  });

  it('offers Directions when real coordinates exist', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ latitude: 31.5204, longitude: 74.3587 }));
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    const directions = await screen.findByRole('link', { name: /directions/i });
    expect(directions.getAttribute('href')).toContain('destination=31.5204,74.3587');
  });

  it('offers Directions via address search when only an address is configured', async () => {
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    const directions = await screen.findByRole('link', { name: /directions/i });
    expect(directions.getAttribute('href')).toContain(encodeURIComponent('12 Food Street, Lahore'));
  });

  it('hides Directions entirely when no usable location data exists', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ address: '', city: '', locality: null }),
    );
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByRole('link', { name: /directions/i })).toBeNull();
  });

  it('renders no location map card when the business has no coordinates (no fake location)', async () => {
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByRole('region', { name: /location/i })).toBeNull();
  });
});

describe('customer map context uses the exact saved coordinates (Phase 12.1)', () => {  // Regression guard: the marker must be created from the authoritative
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

/* ------------------ Phase 2C: trust area + sticky CTA matrix ------------------ */
/* The api mocks from the earlier blocks stay in force (getBusiness /
   listBusinessReviews are mocked at module level above). */

const svc = (patch: Partial<Service> = {}): Service => ({
  id: 'svc-1',
  name: 'Signature Cut',
  description: null,
  priceMinor: 150000,
  currency: 'PKR',
  durationMinutes: 45,
  isActive: true,
  ...patch,
});

const product = (patch: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: 'Chicken Biryani',
  description: null,
  priceMinor: 45000,
  currency: 'PKR',
  imageUrl: null,
  isActive: true,
  ...patch,
});

const allDayHours = (): BusinessHour[] =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    id: `h-${dayOfWeek}`,
    dayOfWeek,
    isClosed: false,
    opensAt: '09:00',
    closesAt: '17:00',
  }));

describe('BusinessDetail sticky CTA matrix (Phase 2C)', () => {
  it('offers Book when the business has bookable services', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ services: [svc()], isOpenNow: true }));
    const onBook = vi.fn();
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}, onBook: onBook});
    const cta = await screen.findByRole('button', { name: 'Book a service' });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    expect(onBook).toHaveBeenCalledWith();
  });

  it('offers Order when orderable and signed in, and opens the Products tab', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ products: [product()], isOpenNow: true }));
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}, canOrder: true, onOpenCart: () => {}});
    const cta = await screen.findByRole('button', { name: 'Order products' });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    // The CTA navigates within the tab system rather than inventing an action.
    await screen.findByText('Chicken Biryani');
  });

  it('prefers Book over Order when both are available', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ services: [svc()], products: [product()], isOpenNow: true }),
    );
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}, onBook: () => {}, canOrder: true, onOpenCart: () => {}});
    await screen.findByRole('button', { name: 'Book a service' });
    expect(screen.queryByRole('button', { name: 'Order products' })).toBeNull();
  });

  it('never shows a Book button when no bookable services exist', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ services: [svc({ isActive: false, durationMinutes: null })] }),
    );
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}, onBook: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByRole('button', { name: 'Book a service' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  });

  it('never shows Order when products are missing or ordering is off', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ products: [product()] }));
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}, canOrder: false});
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByRole('button', { name: 'Order products' })).toBeNull();
    const cta = screen.getByRole('button', { name: 'Unavailable' });
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Sign in as a customer to order/)).toBeTruthy();
  });

  it('shows a disabled Closed CTA when the business is closed and nothing is actionable', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ isOpenNow: false }));
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    const cta = screen.getByRole('button', { name: 'Closed' });
    expect(cta).toBeDisabled();
    expect(screen.getByText('This business is currently closed.')).toBeTruthy();
  });

  it('keeps the sticky Book CTA usable even when the business is closed right now', async () => {
    // Future bookings are still valid; closed-now must not kill the action.
    vi.mocked(api.getBusiness).mockResolvedValue(business({ services: [svc()], isOpenNow: false }));
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}, onBook: () => {}});
    expect(await screen.findByRole('button', { name: 'Book a service' })).toBeEnabled();
  });
});

describe('BusinessDetail trust area (Phase 2C)', () => {
  it('shows rating + review count from the real review data', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ averageRating: 4.5, reviewCount: 12 }));
    vi.mocked(api.listBusinessReviews).mockResolvedValue({
      items: [],
      nextCursor: null,
      averageRating: 4.5,
      reviewCount: 12,
    });
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    const glance = screen.getByRole('region', { name: 'At a glance' });
    expect(within(glance).getByText(/4\.5/)).toBeTruthy();
    expect(within(glance).getByText(/12 reviews/)).toBeTruthy();
  });

  it('shows open state with today’s hours from the real hours payload', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ isOpenNow: true, hours: allDayHours() }));
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    const glance = screen.getByRole('region', { name: 'At a glance' });
    // The hero badge also says "Open now"; scope to the trust block.
    expect(within(glance).getByText('Open now')).toBeTruthy();
    // Today's row comes from the server payload, never invented.
    expect(within(glance).getByText('9:00 AM – 5:00 PM today')).toBeTruthy();
  });

  it('shows booking capability only when bookable services exist', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ services: [svc(), svc({ id: 'svc-2', name: 'Shave', durationMinutes: 20 })] }),
    );
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}, onBook: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.getByText('Online booking')).toBeTruthy();
    expect(screen.getByText('2 services')).toBeTruthy();
  });

  it('hides the booking row when nothing is bookable', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ services: [svc({ isActive: false, durationMinutes: null })] }),
    );
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}, onBook: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByText('Online booking')).toBeNull();
  });

  it('renders key contact rows without duplicating the map-card address', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ phone: '0300 1234567', email: 'hi@gulberg.test' }),
    );
    renderDetail({ idOrSlug: "gulberg-grill", onBack: () => {}});
    await screen.findByText('Gulberg Grill');
    expect(screen.getByText('0300 1234567')).toBeTruthy();
    expect(screen.getByText('hi@gulberg.test')).toBeTruthy();
    // No coordinates → the text address appears once in the trust block.
    expect(screen.getAllByText('12 Food Street')).toHaveLength(1);
  });
});
