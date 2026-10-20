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

// Stateful shared-location mock: tests mutate `sharedLoc` to simulate grants.
// The request/clear fns apply the same state transitions the real hook
// performs (grant -> coords set, clear -> coords cleared); tests that need
// the component to react to a transition re-render after invoking them,
// since the module mock has no React state of its own.
export const sharedLoc = {
  coords: null as { lat: number; lng: number } | null,
  locating: false,
  locNotice: null as string | null,
  hasLocation: false,
  requestLocation: vi.fn(),
  clearLocation: vi.fn(),
};
vi.mock('../useSharedLocation.js', () => ({
  useSharedLocation: vi.fn(() => sharedLoc),
  __resetSharedLocationForTests: vi.fn(),
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
  // Reset shared location state
  sharedLoc.coords = null;
  sharedLoc.locating = false;
  sharedLoc.locNotice = null;
  sharedLoc.hasLocation = false;
  // Simulate the real hook: a grant sets shared coords, clearing removes them.
  sharedLoc.requestLocation = vi.fn(() => {
    sharedLoc.coords = { lat: 31.5204, lng: 74.3587 };
    sharedLoc.hasLocation = true;
  });
  sharedLoc.clearLocation = vi.fn(() => {
    sharedLoc.coords = null;
    sharedLoc.hasLocation = false;
    sharedLoc.locating = false;
  });
  vi.mocked(api.listCategories).mockResolvedValue([
    { id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true },
  ]);
  vi.mocked(api.listBusinesses).mockResolvedValue([base()]);
  vi.mocked(api.listNearbyBusinesses).mockResolvedValue([base({ name: 'Nearby Bistro', id: 'biz-2' })]);
  // ExploreScreen only calls /search when advanced filters are active; the
  // default keeps the suite hermetic if that ever changes.
  vi.mocked(api.searchMarketplace).mockResolvedValue({ results: [], nextCursor: null, total: 0, sort: 'relevance' });
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
    sharedLoc.coords = { lat: 31.5204, lng: 74.3587 };
    sharedLoc.hasLocation = true;
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Nearby Bistro');
    expect(api.listNearbyBusinesses).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 31.5204, lng: 74.3587, radiusKm: 25 }),
    );
    expect(screen.getByText('Near you')).toBeInTheDocument();
    expect(screen.getByText(/closest first/i)).toBeInTheDocument();
  });

  it('denied: keeps default discovery, no fabricated location', async () => {
    sharedLoc.locNotice = 'Location permission was denied.';
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText(/location permission was denied/i);
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
    expect(screen.getByText('Gulberg Grill')).toBeInTheDocument();
  });

  it('unavailable: keeps default discovery', async () => {
    sharedLoc.locNotice = 'Could not get your location.';
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText(/could not get your location/i);
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
  });

  it('error: shows the error message, keeps default discovery', async () => {
    sharedLoc.locNotice = 'GPS is acting up';
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    await screen.findByText('GPS is acting up');
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
  });

  it('tapping the active chip exits the nearby VIEW and restores the default list, without clearing the shared location', async () => {
    // Start from the granted shared state (same setup as the passing
    // "granted" test): the rising-edge effect switches to nearby mode.
    sharedLoc.coords = { lat: 31.5204, lng: 74.3587 };
    sharedLoc.hasLocation = true;
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Nearby Bistro');
    // The chip toggles this screen's view only. It must NEVER clear the
    // shared location (that was the on-device flip bug: Home and Search
    // lost the fix too).
    fireEvent.click(screen.getByRole('button', { name: /near you/i }));
    expect(sharedLoc.clearLocation).not.toHaveBeenCalled();
    expect(sharedLoc.coords).toEqual({ lat: 31.5204, lng: 74.3587 });
    await waitFor(() => expect(screen.getByText('Gulberg Grill')).toBeInTheDocument());
    expect(screen.getByText('All businesses')).toBeInTheDocument();
    // And the view can go straight back to nearby without a new GPS fix,
    // because the coordinates were never destroyed.
    fireEvent.click(screen.getByRole('button', { name: /near you/i }));
    await screen.findByText('Nearby Bistro');
  });

  it('empty nearby results show an honest empty state', async () => {
    vi.mocked(api.listNearbyBusinesses).mockResolvedValue([]);
    sharedLoc.coords = { lat: 31.5204, lng: 74.3587 };
    sharedLoc.hasLocation = true;
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Nothing nearby yet');
    expect(screen.getByText(/no businesses within 25 km/i)).toBeInTheDocument();
  });

  it('clicking Near you requests location through the shared hook', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /near you/i }));
    // The explainer gate is async; the shared hook is the single path to GPS.
    await waitFor(() => expect(sharedLoc.requestLocation).toHaveBeenCalled());
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
  });
});
