// @vitest-environment jsdom
/**
 * App-level Business Detail flow (device report 2026-10-20):
 *
 * - Opening a business from Home lands on the ONE Business Detail route.
 * - The default section is PRODUCTS (product-first), not Overview.
 * - In-page actions (Overview / Reviews toggles) never change the route:
 *   the app must not fall back to Home.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { App } from './main.js';
import * as api from './api.js';
import type { Business, Session } from './api.js';

afterEach(cleanup);

const customerSession: Session = {
  accessToken: 'tok-c',
  user: { id: 'u-customer', email: 'ayesha@example.com', role: 'CUSTOMER' },
};

const business = {
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  description: 'Natural spices',
  imageUrl: null,
  isVerified: true,
  address: 'Main bazar',
  city: 'Sheikhupura',
  locality: null,
  latitude: 31.49912,
  longitude: 74.326386,
  phone: '+92 300 1234567',
  email: null,
  currency: 'PKR',
  isOpenNow: true,
  categories: [{ id: 'c1', name: 'Food & Restaurants', slug: 'food-restaurants', isActive: true }],
  services: [
    { id: 'svc-1', businessId: 'biz-1', name: 'Spice Grinding', priceMinor: 50000, currency: 'PKR', durationMinutes: 30, isActive: true, description: null },
  ],
  products: [
    { id: 'p-1', businessId: 'biz-1', name: 'Red Chilli 250g', priceMinor: 45000, currency: 'PKR', imageUrl: null, description: null, isActive: true },
  ],
} as unknown as Business;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSession').mockReturnValue(customerSession);
  vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([]);
  vi.spyOn(api, 'listCategories').mockResolvedValue([
    { id: 'c1', name: 'Food & Restaurants', slug: 'food-restaurants', isActive: true },
  ] as api.Category[]);
  vi.spyOn(api, 'listBusinesses').mockResolvedValue([business]);
  vi.spyOn(api, 'listNearbyBusinesses').mockResolvedValue([business]);
  vi.spyOn(api, 'getBusiness').mockResolvedValue(business);
  vi.spyOn(api, 'listBusinessReviews').mockResolvedValue({ items: [], nextCursor: null, averageRating: 5, reviewCount: 1 } as never);
  vi.spyOn(api, 'listFeaturedBusinesses').mockResolvedValue([]);
  vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 0 });
  vi.spyOn(api, 'listNotifications').mockResolvedValue({ items: [], nextCursor: null } as never);
  vi.spyOn(api, 'listMyOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listMyBookings').mockResolvedValue([]);
  vi.spyOn(api, 'listFavorites').mockResolvedValue([]);
  vi.spyOn(api, 'getFavoriteState').mockResolvedValue({ saved: false } as never);
  vi.spyOn(api, 'whoami').mockResolvedValue({ id: 'u-customer', email: 'ayesha@example.com', role: 'CUSTOMER', firstName: 'Ayesha', lastName: null } as never);
});

describe('Home → Business Detail (product-first, in-page actions stay put)', () => {
  it('opens the business route with Products as the default section', async () => {
    render(<App />);
    const card = await screen.findByRole('button', { name: /Butt Spices/ }, { timeout: 4000 });
    fireEvent.click(card);

    // The one Business Detail route.
    expect(window.location.hash).toBe('#/business/biz-1');
    await screen.findByText('Red Chilli 250g');
    // Product-first: catalog visible, Overview content absent by default.
    expect(document.getElementById('biz-products')).not.toBeNull();
    expect(screen.queryByText('About')).toBeNull();
    expect(document.querySelector('.bd-sticky-bar')).toBeNull();
  });

  it('Overview/Reviews toggles never leave the business route', async () => {
    render(<App />);
    const card = await screen.findByRole('button', { name: /Butt Spices/ }, { timeout: 4000 });
    fireEvent.click(card);
    await screen.findByText('Red Chilli 250g');

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(window.location.hash).toBe('#/business/biz-1');
    expect(screen.getByText('About')).toBeInTheDocument();
    // Still the detail page, not Home: the Home hero is absent.
    expect(screen.queryByText('Find the best')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }));
    expect(window.location.hash).toBe('#/business/biz-1');
    expect(screen.queryByText('About')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(window.location.hash).toBe('#/business/biz-1');
    expect(document.getElementById('biz-products')).not.toBeNull();
  });
});
