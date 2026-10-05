// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { App } from './main.js';
import * as api from './api.js';
import type { Business, Order, Session } from './api.js';

afterEach(cleanup);

/**
 * Order deep-link context safety: /order/:id must render the BUSINESS detail
 * in business mode (never the customer surface) and the customer detail in
 * customer mode. A notification tap that drops the order id or shows the
 * wrong surface is a routing bug this guards against.
 */

const customerSession: Session = {
  accessToken: 'tok-c',
  user: { id: 'u-customer', email: 'ayesha@example.com', role: 'CUSTOMER' },
};

const ownerSession: Session = {
  accessToken: 'tok-o',
  user: { id: 'u-owner', email: 'ahmed@example.com', role: 'BUSINESS_OWNER' },
};

const ownedBusiness = {
  id: 'biz-1',
  name: 'Ahmed Auto Workshop',
  slug: 'ahmed-auto-workshop',
  description: null,
  imageUrl: null,
  isVerified: true,
  address: '1 Workshop Road',
  city: 'Lahore',
  locality: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
  status: 'APPROVED',
} as unknown as Business;

const baseOrder = {
  id: 'ord-123',
  businessId: 'biz-1',
  business: { id: 'biz-1', name: 'Ahmed Auto Workshop' },
  customerId: 'u-customer',
  customer: { firstName: 'Ayesha', lastName: 'Khan', phone: null },
  status: 'PENDING',
  fulfillmentType: 'DELIVERY',
  subtotalMinor: 100000,
  deliveryFeeMinor: 20000,
  totalMinor: 120000,
  currency: 'PKR',
  paymentMethodId: null,
  deliveryAddressLabel: 'Home',
  deliveryAddressText: '12 Main St, Lahore',
  assignedRider: null,
  items: [
    {
      id: 'li-1',
      name: 'Oil change',
      quantity: 1,
      unitPriceMinor: 100000,
      lineTotalMinor: 100000,
    },
  ],
  createdAt: new Date().toISOString(),
} as unknown as Order;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSession').mockReturnValue(customerSession);
  vi.spyOn(api, 'listCategories').mockResolvedValue([]);
  vi.spyOn(api, 'listBusinesses').mockResolvedValue([]);
  vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 0 });
  vi.spyOn(api, 'listNotifications').mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, 'listMyBookings').mockResolvedValue([]);
  vi.spyOn(api, 'listOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listMyOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listBusinessOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listBusinessBookings').mockResolvedValue([]);
  vi.spyOn(api, 'listOwnerPayments').mockResolvedValue({ bookingPayments: [], orderPayments: [] });
  vi.spyOn(api, 'listOrderPayments').mockResolvedValue([]);
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({
    businessId: 'biz-1',
    subscription: null,
    status: null,
    trial: null,
    planNameSnapshot: null,
    planPriceSnapshot: null,
    verificationStatus: null,
    trialStatus: null,
    businessStatus: 'APPROVED',
  } as never);
});

describe('order deep-link context routing', () => {
  it('business mode /order/:id renders the BUSINESS detail (never the customer surface)', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([ownedBusiness]);
    vi.spyOn(api, 'getOrder').mockResolvedValue(baseOrder);
    window.location.hash = '#/order/ord-123';

    render(<App />);

    // Business detail: order number heading + business workflow actions.
    await screen.findByRole('heading', { name: 'Order #ORD123', level: 2 }, { timeout: 5000 });
    // The business detail shows the delivery address block and workflow.
    expect(screen.getByText('Deliver to: 12 Main St, Lahore')).toBeTruthy();
    // Customer-only surfaces must NOT appear: no "submit payment proof" CTA.
    expect(screen.queryByText(/submit payment proof/i)).toBeNull();
  });

  it('customer mode /order/:id renders the customer detail', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(customerSession);
    // Note: the customer screen calls getMyOrder (a module-load alias of
    // getOrder), so both names are mocked.
    vi.spyOn(api, 'getOrder').mockResolvedValue(baseOrder);
    vi.spyOn(api, 'getMyOrder').mockResolvedValue(baseOrder);
    window.location.hash = '#/order/ord-123';

    render(<App />);

    // Customer detail renders an h1 order heading with the customer status hero.
    await screen.findByRole('heading', { name: 'Order #ORD123', level: 1 }, { timeout: 5000 });
    // No business workflow buttons (Accept/Reject live in the business detail).
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('business mode /order/:id for a foreign order shows the not-found state, not a crash', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([ownedBusiness]);
    vi.spyOn(api, 'getOrder').mockRejectedValue(new api.ApiError(404, 'NOT_FOUND', 'Order not found'));
    window.location.hash = '#/order/ord-foreign';

    render(<App />);

    await screen.findByText(/could not load|not found|something went wrong/i, undefined, { timeout: 5000 });
  });
});
