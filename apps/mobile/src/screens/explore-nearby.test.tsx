// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import { ExploreScreen } from './Explore.js';
import { requestCustomerLocation, type LocationOutcome } from '../location.js';
import type { Business } from '../api.js';

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
  // The first-use explainer gate is tested separately; these tests exercise
  // the location flow itself, so simulate the already-decided state.
  checkLocationPermissionState: vi.fn().mockResolvedValue('granted'),
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
const denied: LocationOutcome = { status: 'denied' };
const unavailable: LocationOutcome = { status: 'unavailable' };
const errorOutcome: LocationOutcome = { status: 'error', message: 'GPS is acting up' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listCategories).mockResolvedValue([
    { id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true },
  ]);
  vi.mocked(api.listBusinesses).mockResolvedValue([base()]);
  vi.mocked(api.listNearbyBusinesses).mockResolvedValue([base({ name: 'Nearby Bistro', id: 'biz-2' })]);
  // ExploreScreen only calls /search when advanced filters are active; the
  // default keeps the suite hermetic if that ever changes.
  vi.mocked(api.searchMarketplace).mockResolvedValue({ results: [], nextCursor: null, total: 0, sort: 'relevance' });
  vi.mocked(requestCustomerLocation).mockResolvedValue(granted);
});

describe('Explore Near You discovery (Phase 11)', () => {
  it('shows the default All businesses list without requesting location', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(requestCustomerLocation).not.toHaveBeenCalled();
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
    expect(screen.getByText('All businesses')).toBeInTheDocument();
  });

  it('granted: switches to nearby mode and uses server-authoritative distance', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText('Nearby Bistro');
    expect(requestCustomerLocation).toHaveBeenCalledTimes(1);
    expect(api.listNearbyBusinesses).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 31.5204, lng: 74.3587, radiusKm: 25 }),
    );
    expect(screen.getByText('Near you')).toBeInTheDocument();
    expect(screen.getByText(/closest first/i)).toBeInTheDocument();
  });

  it('denied: keeps default discovery, no fabricated location', async () => {
    vi.mocked(requestCustomerLocation).mockResolvedValue(denied);
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText(/location permission was denied/i);
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
    expect(screen.getByText('Gulberg Grill')).toBeInTheDocument();
  });

  it('unavailable: keeps default discovery', async () => {
    vi.mocked(requestCustomerLocation).mockResolvedValue(unavailable);
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText(/not available on this device/i);
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
  });

  it('error: shows the error message, keeps default discovery', async () => {
    vi.mocked(requestCustomerLocation).mockResolvedValue(errorOutcome);
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText('GPS is acting up');
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
  });

  it('tapping the active chip exits nearby mode and restores the default list', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText('Nearby Bistro');
    fireEvent.click(screen.getByRole('button', { name: /near you/i }));
    await waitFor(() => expect(screen.getByText('Gulberg Grill')).toBeInTheDocument());
    expect(screen.getByText('All businesses')).toBeInTheDocument();
  });

  it('empty nearby results show an honest empty state', async () => {
    vi.mocked(api.listNearbyBusinesses).mockResolvedValue([]);
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText('Nothing nearby yet');
    expect(screen.getByText(/no businesses within 25 km/i)).toBeInTheDocument();
  });
});
