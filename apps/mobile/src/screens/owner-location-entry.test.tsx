// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import type { Business } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getMyBusinesses: vi.fn(),
  listBusinessOrders: vi.fn().mockResolvedValue([]),
  listBusinessBookings: vi.fn().mockResolvedValue([]),
  listBusinessReviews: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listOwnerPayments: vi.fn().mockResolvedValue({ bookingPayments: [], orderPayments: [] }),
  getBusinessSubscription: vi.fn().mockResolvedValue(null),
}));

vi.mock('../useCartCount.js', () => ({ useCartCount: () => 0 }));

const biz = (patch: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  status: 'APPROVED',
  description: null,
  imageUrl: null,
  isVerified: false,
  address: '12 Food Street',
  city: 'Karachi',
  locality: null,
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
  ...patch,
});

describe('business location entry point (Phase 12.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the live Business Overview hub exposes the Location management entry', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    const row = await screen.findByText('Location');
    expect(row).toBeTruthy();
    // The subtitle tells the owner what it is for, so the entry is discoverable.
    expect(screen.getByText(/Set your address and pin on map/)).toBeTruthy();
  });

  it('navigates to the selected business location screen when tapped', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    const onOpen = vi.fn();
    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={onOpen} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    fireEvent.click(await screen.findByText('Location'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/location'));
  });

  it('targets the currently selected business when several are owned', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([
      biz({ id: 'biz-a', name: 'Karachi Kebabs' }),
      biz({ id: 'biz-b', name: 'Lahore Lassi' }),
    ]);
    const onOpen = vi.fn();
    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={onOpen} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    // Switch to the second business, then open Location.
    fireEvent.click(await screen.findByRole('button', { name: 'Lahore Lassi' }));
    fireEvent.click(await screen.findByText('Location'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/owner/biz-b/location'));
    expect(onOpen).not.toHaveBeenCalledWith('/owner/biz-a/location');
  });
});
