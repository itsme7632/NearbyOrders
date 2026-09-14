// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { App } from './main.js';
import * as api from './api.js';
import type { Business, Session } from './api.js';
import { getAppMode } from './mode.js';

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.spyOn(api, 'listCategories').mockResolvedValue([
    { id: 'c1', name: 'Food & Restaurants', slug: 'food-restaurants', isActive: true },
  ] as api.Category[]);
  vi.spyOn(api, 'listBusinesses').mockResolvedValue([] as Business[]);
  vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 0 });
  vi.spyOn(api, 'listNotifications').mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, 'listMyBookings').mockResolvedValue([]);
  vi.spyOn(api, 'listOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listMyOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listBusinessOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listBusinessBookings').mockResolvedValue([]);
  vi.spyOn(api, 'listOwnerPayments').mockResolvedValue({ bookingPayments: [], orderPayments: [] });
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(null);
});

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

describe('default mode after login (ownership-aware)', () => {
  it('a customer-only user opens in Customer mode (Home visible, primary nav)', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(customerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([]);
    render(<App />);

    // Business Overview never appears; the customer experience does.
    await screen.findByText('Find the best', undefined, { timeout: 3000 });
    expect(screen.queryByText('Business Overview')).toBeNull();
    expect(document.querySelector('nav[aria-label="Primary"]')).not.toBeNull();
    expect(document.querySelector('nav[aria-label="Business"]')).toBeNull();
    expect(getAppMode()).toBe('CUSTOMER');
  });

  it('a business owner opens DIRECTLY in Business Overview (no customer flash)', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([ownedBusiness]);
    render(<App />);

    await screen.findByText('Business Overview', undefined, { timeout: 3000 });
    // Business chrome replaces customer chrome entirely.
    expect(document.querySelector('nav[aria-label="Business"]')).not.toBeNull();
    expect(document.querySelector('nav[aria-label="Primary"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Explore' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(getAppMode()).toBe('BUSINESS');
    // The selected business is the owner's, not the person's identity.
    expect(screen.getByText('Ahmed Auto Workshop')).toBeTruthy();
  });

  it('an owner whose businesses were all removed falls back to Customer mode', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([]);
    render(<App />);

    await screen.findByText('Find the best', undefined, { timeout: 3000 });
    expect(screen.queryByText('Business Overview')).toBeNull();
    expect(getAppMode()).toBe('CUSTOMER');
  });

  it('an ownership check failure opens Customer mode and never crashes', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockRejectedValue(new api.ApiError(0, 'NETWORK_ERROR', 'offline'));
    render(<App />);

    await screen.findByText('Find the best', undefined, { timeout: 3000 });
    expect(getAppMode()).toBe('CUSTOMER');
  });
});

describe('switching between modes', () => {
  it('owner switches Business → Customer → back, landing on Overview each time', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([ownedBusiness]);
    render(<App />);
    await screen.findByText('Business Overview', undefined, { timeout: 3000 });

    // Profile tab (Business mode) → switch to Customer.
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await screen.findByText('Switch to Customer mode');
    fireEvent.click(screen.getByText('Switch to Customer mode'));

    await waitFor(() => expect(getAppMode()).toBe('CUSTOMER'));
    await screen.findByRole('button', { name: 'Explore' }, { timeout: 3000 });
    expect(document.querySelector('nav[aria-label="Business"]')).toBeNull();
    expect(document.querySelector('nav[aria-label="Primary"]')).not.toBeNull();

    // ... and back: the header entry returns to the Business Overview.
    fireEvent.click(screen.getByRole('button', { name: 'My business' }));
    await waitFor(() => expect(getAppMode()).toBe('BUSINESS'));
    await screen.findByText('Business Overview', undefined, { timeout: 3000 });
    expect(document.querySelector('nav[aria-label="Business"]')).not.toBeNull();
    expect(document.querySelector('nav[aria-label="Primary"]')).toBeNull();
  });
});

describe('data scoping across modes', () => {
  it('customer Orders lists personal orders; business listing stays scoped server-side', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([ownedBusiness]);
    const listOrders = vi.spyOn(api, 'listMyOrders').mockResolvedValue([]);
    const listBusinessOrders = vi.spyOn(api, 'listBusinessOrders').mockResolvedValue([]);

    render(<App />);
    await screen.findByText('Business Overview', undefined, { timeout: 3000 });

    // Owner deliberately switches to Customer mode, then opens their orders.
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await screen.findByText('Switch to Customer mode');
    fireEvent.click(screen.getByText('Switch to Customer mode'));
    await screen.findByRole('button', { name: 'Explore' }, { timeout: 3000 });

    // Customer Orders tab reads the PERSONAL listing (empty here, so the
    // customer-mode empty state renders, never the business wording).
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await screen.findByText('No orders yet', undefined, { timeout: 3000 });
    await waitFor(() => expect(listOrders).toHaveBeenCalled());

    // The business-mode Orders screen itself never opens in customer mode:
    // after switching, the business listing is not consulted again.
    const callsAfterSwitch = listBusinessOrders.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await screen.findByText('No orders yet', undefined, { timeout: 3000 });
    expect(listBusinessOrders.mock.calls.length).toBe(callsAfterSwitch);
  });

  it('business mode Orders fetches the per-business listing only', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([ownedBusiness]);
    const listOrders = vi.spyOn(api, 'listOrders').mockResolvedValue([]);
    const listBusinessOrders = vi.spyOn(api, 'listBusinessOrders').mockResolvedValue([]);

    render(<App />);
    await screen.findByText('Business Overview', undefined, { timeout: 3000 });

    // The Overview's quick-action tile (class-named target); the bottom nav
    // button with the same label is matched separately below.
    fireEvent.click(document.querySelector('.quick-tile .quick-tile-name')!.closest('button')!);
    await screen.findByText('No customer orders yet', undefined, { timeout: 3000 });
    await waitFor(() => expect(listBusinessOrders).toHaveBeenCalledWith('biz-1'));
    expect(listOrders).not.toHaveBeenCalled();
    // Business-mode empty state is business-specific, never the customer one.
    expect(await screen.findByText('No customer orders yet')).toBeTruthy();
    expect(screen.queryByText('Find businesses')).toBeNull();
  });
});

describe('mode persistence across reloads', () => {
  it('session restoration re-applies the ownership default (owner lands on Overview)', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([ownedBusiness]);

    // First login: owner defaults to Business.
    render(<App />);
    await screen.findByText('Business Overview', undefined, { timeout: 3000 });
    expect(window.localStorage.getItem('nearbyorders.mode')).toBe('BUSINESS');
    // Owner deliberately switches to Customer for this session...
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await screen.findByText('Switch to Customer mode');
    fireEvent.click(screen.getByText('Switch to Customer mode'));
    await waitFor(() => expect(getAppMode()).toBe('CUSTOMER'));
    cleanup();

    // ...and a reload (session restoration) re-applies the ownership default:
    // owners always come back to their business dashboard.
    render(<App />);
    await screen.findByText('Business Overview', undefined, { timeout: 3000 });
    expect(getAppMode()).toBe('BUSINESS');
  });
});
