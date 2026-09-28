// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import * as api from '../api.js';
import type { Business, BusinessSubscriptionState, OwnerAnalytics, OwnerOverview, Subscription, VerificationState } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getMyBusinesses: vi.fn(),
  getOwnerOverview: vi.fn(),
  getOwnerAnalytics: vi.fn(),
  getBusinessSubscription: vi.fn(),
  listPaymentRequests: vi.fn(),
  getVerification: vi.fn(),
}));

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
  averageRating: 4.5,
  reviewCount: 12,
  ...patch,
});

const overview = (patch: Partial<OwnerOverview> = {}): OwnerOverview => ({
  business: { id: 'biz-1', name: 'Butt Spices', status: 'APPROVED', isVerified: false, currency: 'PKR', imageUrl: null },
  today: { orders: 2, bookings: 1, revenueMinor: 45500 },
  needsAttention: { pendingOrders: 1, pendingBookings: 1, pendingPayments: 2 },
  upcomingBookings: [],
  recentOrders: [],
  recentBookings: [],
  profileMissing: ['phone', 'image'],
  ...patch,
});

const analytics = (period: string): OwnerAnalytics => ({
  period: period as OwnerAnalytics['period'],
  window: { from: '2026-09-19', to: '2026-09-19' },
  orders: { total: 4, completed: 3, cancelled: 1, revenueMinor: 120000 },
  bookings: { total: 2, completed: 1, cancelled: 0, revenueMinor: 30000 },
  catalog: { activeServices: 3, activeProducts: 5 },
});

const subscription = (patch: Partial<Subscription> = {}): Subscription => ({
  id: 'sub-1',
  status: 'ACTIVE',
  trialStartAt: null,
  trialEndAt: null,
  currentPeriodStartAt: '2026-09-01T00:00:00.000Z',
  currentPeriodEndAt: '2026-10-01T00:00:00.000Z',
  cancelledAt: null,
  planNameSnapshot: 'Growth',
  planPriceMinorSnapshot: 299900,
  plan: {
    slug: 'nearbyorders-business',
    name: 'Growth',
    description: null,
    monthlyPriceMinor: 299900,
    currency: 'PKR',
    trialDays: 30,
    benefits: [],
    billingInterval: 'MONTHLY',
    displayOrder: 2,
    isHighlighted: true,
  },
  ...patch,
});

const subscriptionState = (patch: Partial<BusinessSubscriptionState> = {}): BusinessSubscriptionState => ({
  businessId: 'biz-1',
  subscription: subscription(),
  status: 'ACTIVE',
  trial: null,
  planNameSnapshot: 'Growth',
  planPriceMinorSnapshot: 299900,
  verificationStatus: null,
  trialStatus: null,
  businessStatus: 'APPROVED',
  ...patch,
});

const renderHome = async (props: Record<string, unknown> = {}) => {
  const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
  return render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} {...props} />);
};

describe('business overview (redesigned hub)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getOwnerAnalytics).mockImplementation(async (_id: string, period: 'today' | 'week' | 'month') => analytics(period));
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview());
    vi.mocked(api.getBusinessSubscription).mockResolvedValue(subscriptionState());
    vi.mocked(api.listPaymentRequests).mockResolvedValue([]);
    // Verification healthy: the Overview's attention layer renders nothing.
    vi.mocked(api.getVerification).mockResolvedValue({
      application: { status: 'APPROVED', reviewerMessage: null },
      documents: [],
    } as unknown as VerificationState);
  });

  it('renders no in-screen app header: the shell owns the owner header', async () => {
    const onOpen = vi.fn();
    const { container } = await renderHome({ onOpen });
    await screen.findByText('Total bookings'); // page loaded
    // The shell (main.tsx) renders the single owner app header; the screen
    // must not render its own top bar or a second bell.
    expect(container.querySelector('.owner-topbar')).toBeNull();
    expect(container.querySelector('.app-header')).toBeNull();
    expect(container.querySelector('.bell-btn')).toBeNull();
  });

  it('greets the owner and names the operating business', async () => {
    await renderHome();
    expect(await screen.findByText(/Good (morning|afternoon|evening),/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Butt Spices!' })).toBeTruthy();
    // Supporting line reflects the live attention counts (1+1+2 = 4), after the overview loads.
    expect(await screen.findByText('4 items need your attention today.')).toBeTruthy();
  });

  it('shows a visibility line under the greeting when nothing needs attention', async () => {
    vi.mocked(api.getOwnerOverview).mockResolvedValue(
      overview({ needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 } }),
    );
    await renderHome();
    expect(await screen.findByText('Your business is live and visible to customers.')).toBeTruthy();
  });

  it('shows the live approval status of the business', async () => {
    await renderHome();
    const region = await screen.findByRole('region', { name: 'Business status' });
    expect(region).toHaveTextContent('Business active');
    expect(region).toHaveTextContent('visible to customers');
  });

  it('shows a pending state for an unapproved business', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz({ status: 'PENDING' })]);
    await renderHome();
    const region = await screen.findByRole('region', { name: 'Business status' });
    expect(region).toHaveTextContent('Pending approval');
    expect(region).toHaveTextContent('once approved');
  });

  it('shows the plan section with the real plan from the server, once', async () => {
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    await screen.findByText('Growth'); // plan card loaded, not the skeleton
    const region = screen.getByRole('region', { name: 'Your plan' });
    expect(region).toHaveTextContent('Growth');
    expect(region).toHaveTextContent('Active');
    // Single entry point: one Manage plan button, no separate Subscription row.
    expect(screen.getAllByRole('button', { name: 'Manage plan' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Subscription/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manage plan' }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/subscription');
  });

  it('renders this-month metrics verbatim from the server, never invented', async () => {
    await renderHome();
    await screen.findByText('Total bookings'); // loaded tiles, not the skeleton
    const region = screen.getByRole('region', { name: 'Performance' });
    // Bookings tile: server month total.
    expect(region).toHaveTextContent('Total bookings');
    expect(region).toHaveTextContent('This month');
    // Rating tile: the business record's real rating and review count.
    expect(region).toHaveTextContent('4.5');
    expect(region).toHaveTextContent('(12 reviews)');
    // Revenue tile: orders + bookings revenue from the server, integer paisa.
    expect(region).toHaveTextContent('Revenue');
    expect(screen.getByText('Rs 1,500')).toBeTruthy(); // 120000 + 30000 minor
    // The overview asks for exactly the month window for this business.
    await waitFor(() => expect(api.getOwnerAnalytics).toHaveBeenCalledWith('biz-1', 'month'));
  });

  it('shows an honest empty state when the business has no rating yet', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz({ averageRating: null, reviewCount: 0 })]);
    await renderHome();
    // Wait for the loaded tiles, not the loading skeleton's empty region.
    await screen.findByText('Avg. rating');
    const region = screen.getByRole('region', { name: 'Performance' });
    expect(region).toHaveTextContent('No reviews yet');
    expect(region).not.toHaveTextContent('4.5');
  });

  it('leads with needs-attention and each item opens its queue', async () => {
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    await screen.findByRole('button', { name: /1 order waiting for your accept or reject/i });

    fireEvent.click(screen.getByRole('button', { name: /1 order waiting for your accept or reject/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/orders');
    fireEvent.click(screen.getByRole('button', { name: /1 booking waiting for your confirm or decline/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/bookings');
    fireEvent.click(screen.getByRole('button', { name: /2 payment proofs awaiting verification/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/payments');
  });

  it('shows a calm all-caught-up state when nothing needs attention', async () => {
    vi.mocked(api.getOwnerOverview).mockResolvedValue(
      overview({ needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 } }),
    );
    await renderHome();
    expect(await screen.findByText(/all caught up/i)).toBeTruthy();
    expect(screen.getByText(/Nothing needs your attention right now/)).toBeTruthy();
  });

  it('surfaces verification warnings in the needs-attention layer', async () => {
    vi.mocked(api.getVerification).mockResolvedValue({
      application: { status: 'CHANGES_REQUESTED', reviewerMessage: null },
      documents: [],
    } as unknown as VerificationState);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(
      overview({ needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 } }),
    );
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    const region = await screen.findByRole('region', { name: 'Needs attention' });
    // The verification warning comes from its own async fetch inside the
    // attention layer, so wait for it like the queue rows above.
    const row = await within(region).findByRole('button', { name: /Complete verification/ });
    expect(row).toHaveTextContent('The review team asked for changes');
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/verification');
  });

  it('lists honest profile gaps linked to the right management screens', async () => {
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    fireEvent.click(await screen.findByText('Add a contact phone number'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/profile'));
    fireEvent.click(screen.getByText('Add a business image'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/profile'));
  });

  it('shows no gaps section when the profile is complete', async () => {
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview({ profileMissing: [] }));
    await renderHome();
    await screen.findByText('Total bookings'); // metrics loaded
    expect(screen.queryByText('Complete your profile')).toBeNull();
  });

  it('offers four quick actions, each opening its destination', async () => {
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    await screen.findByText('Total bookings'); // page loaded
    const region = screen.getByRole('region', { name: 'Quick actions' });
    const click = (name: string | RegExp, path: string) => {
      const btn = within(region).getByRole('button', { name });
      fireEvent.click(btn);
      expect(onOpen).toHaveBeenCalledWith(path);
    };
    click('Edit profile', '/owner/biz-1/profile');
    click('Services', '/owner/biz-1/services');
    click('Products', '/owner/biz-1/products');
    click('Orders', '/owner/biz-1/orders');
  });

  it('groups management into Manage, Catalog, Grow, and Account', async () => {
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    await screen.findByText('Total bookings'); // page loaded

    const manage = screen.getByRole('region', { name: 'Manage' });
    const catalog = screen.getByRole('region', { name: 'Catalog' });
    const grow = screen.getByRole('region', { name: 'Grow' });
    const account = screen.getByRole('region', { name: 'Account' });

    const clickIn = (region: HTMLElement, name: string | RegExp, path: string) => {
      fireEvent.click(within(region).getByRole('button', { name }));
      expect(onOpen).toHaveBeenCalledWith(path);
    };

    clickIn(manage, /Business profile/, '/owner/biz-1/profile');
    clickIn(manage, /Location/, '/owner/biz-1/location');
    clickIn(manage, /Business hours/, '/owner/biz-1/hours');

    clickIn(catalog, /Services/, '/owner/biz-1/services');
    clickIn(catalog, /Products \/ Menu/, '/owner/biz-1/products');

    clickIn(grow, /Verification/, '/owner/biz-1/verification');
    clickIn(grow, /Promotions/, '/owner/biz-1/promotions');
    clickIn(grow, /Reviews/, '/owner/biz-1/reviews');

    // Account is a single entry into Business settings — the Overview stays a
    // command center, not a settings directory.
    clickIn(account, /Business settings/, '/owner/biz-1/settings');
    expect(within(account).queryAllByRole('button').length).toBe(1);
  });

  it('shows the business switcher only when the owner has several businesses', async () => {
    await renderHome();
    await screen.findByText('Total bookings'); // metrics loaded
    expect(screen.queryByRole('group', { name: 'Switch business' })).toBeNull();

    cleanup();
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz(), biz({ id: 'biz-2', name: 'Second Shop', slug: 'second-shop' })]);
    await renderHome();
    expect(await screen.findByRole('group', { name: 'Switch business' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Second Shop' })).toBeTruthy();
  });

  it('announces a just-created business with its real approval state', async () => {
    await renderHome({ justCreatedName: 'Butt Spices', justCreatedStatus: 'PENDING' });
    const banner = await screen.findByText(/has been created/);
    const card = banner.closest('.created-banner');
    expect(card).toBeTruthy();
    expect(card).toHaveTextContent('Butt Spices');
    expect(card).toHaveTextContent('once approved');
  });

  it('shows today\'s activity from the live overview, with tappable rows', async () => {
    const onOpenOrder = vi.fn();
    const onOpenBooking = vi.fn();
    vi.mocked(api.getOwnerOverview).mockResolvedValue(
      overview({
        today: { orders: 2, bookings: 1, revenueMinor: 45500 },
        upcomingBookings: [
          { id: 'bk-9', serviceName: 'Haircut', customerName: 'Ayesha Khan', date: '2026-09-24', startTime: '14:00', status: 'CONFIRMED' },
        ],
        recentOrders: [
          {
            id: 'ord-111111',
            status: 'PENDING',
            subtotalMinor: 250000,
            currency: 'PKR',
            fulfillmentType: 'PICKUP',
            createdAt: '2026-09-24T09:30:00.000Z',
            notes: null,
            business: { id: 'biz-1', name: 'Butt Spices', slug: 'butt-spices' },
            customer: { firstName: 'Sara', lastName: 'Ahmed' },
            items: [],
          },
        ],
        needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 },
      }),
    );
    await renderHome({ onOpenOrder, onOpenBooking });
    const region = await screen.findByRole('region', { name: 'Today' });
    // Today's counts and collected revenue, verbatim from the server.
    const tiles = region.querySelectorAll('.metric-tile-num');
    expect(tiles[0]).toHaveTextContent('2');
    expect(tiles[1]).toHaveTextContent('1');
    expect(within(region).getByText('Rs 455')).toBeTruthy();
    // Upcoming booking and recent order rows open their details.
    fireEvent.click(within(region).getByRole('button', { name: /Ayesha Khan/ }));
    expect(onOpenBooking).toHaveBeenCalledWith('bk-9');
    fireEvent.click(within(region).getByRole('button', { name: /Sara Ahmed/ }));
    expect(onOpenOrder).toHaveBeenCalledWith('ord-111111');
  });

  it('shows an honest quiet-day state when there is no activity today', async () => {
    vi.mocked(api.getOwnerOverview).mockResolvedValue(
      overview({
        today: { orders: 0, bookings: 0, revenueMinor: 0 },
        upcomingBookings: [],
        recentOrders: [],
        recentBookings: [],
        needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 },
      }),
    );
    await renderHome();
    const region = await screen.findByRole('region', { name: 'Today' });
    expect(within(region).getByText(/No orders or bookings yet today/)).toBeTruthy();
  });
});

