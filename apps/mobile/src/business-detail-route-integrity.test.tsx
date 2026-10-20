// @vitest-environment jsdom
/**
 * Business Detail route integrity (device report 2026-10-20, round 4).
 *
 * ROOT CAUSE of "any interaction on Business Detail returns Home":
 * parseHash falls through to the tabs route for ANY unrecognized hash, and
 * useRoute applied every hashchange unconditionally. A non-route fragment
 * reaching the router (the app shell's own skip anchor wrote #app-content)
 * therefore navigated Home mid-interaction. Reproduced deterministically
 * before the fix; these tests pin the corrected behavior:
 *
 * - A stray fragment hashchange NEVER changes the route.
 * - The skip control no longer writes to the URL at all.
 * - Clicking/scrolling/tapping normal Business Detail content (empty areas,
 *   logo, headings, product/service cards, Overview, Reviews, Save) never
 *   changes the route, from Home, Explore, and Search entry points.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
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
  hours: [],
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
  vi.spyOn(api, 'searchMarketplace').mockResolvedValue({
    results: [{
      type: 'business', id: 'biz-1', businessId: 'biz-1', businessName: 'Butt Spices',
      businessSlug: 'butt-spices', name: 'Butt Spices', description: 'Natural spices',
      distanceKm: null, averageRating: 5, reviewCount: 1, score: 400, imageUrl: null,
      city: 'Sheikhupura', locality: null, isVerified: true, isOpenNow: true,
      categories: [{ id: 'c1', name: 'Food & Restaurants', slug: 'food-restaurants' }],
      sampleServices: [],
    }],
    nextCursor: null, total: 1, sort: 'relevance',
  } as never);
  vi.spyOn(api, 'getBusiness').mockResolvedValue(business);
  vi.spyOn(api, 'listBusinessReviews').mockResolvedValue({ items: [], nextCursor: null, averageRating: 5, reviewCount: 1 } as never);
  vi.spyOn(api, 'listFeaturedBusinesses').mockResolvedValue([]);
  vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 0 });
  vi.spyOn(api, 'listNotifications').mockResolvedValue({ items: [], nextCursor: null } as never);
  vi.spyOn(api, 'listMyOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listMyBookings').mockResolvedValue([]);
  vi.spyOn(api, 'listFavorites').mockResolvedValue([]);
  vi.spyOn(api, 'getFavoriteState').mockResolvedValue({ saved: false } as never);
  vi.spyOn(api, 'saveFavorite').mockResolvedValue({ saved: true } as never);
  vi.spyOn(api, 'whoami').mockResolvedValue({ id: 'u-customer', email: 'ayesha@example.com', role: 'CUSTOMER', firstName: 'Ayesha', lastName: null } as never);
});

const HASH = '#/business/biz-1';
const expectStillOnDetail = () => {
  expect(window.location.hash).toBe(HASH);
  expect(document.querySelector('.biz-detail')).not.toBeNull();
};

const openFromHome = async () => {
  render(<App />);
  const card = await screen.findByRole('button', { name: /Butt Spices/ }, { timeout: 4000 });
  fireEvent.click(card);
  await screen.findByText('Red Chilli 250g');
  expectStillOnDetail();
};

describe('Business Detail route integrity', () => {
  it('a stray non-route fragment never navigates away (the reproduced bug)', async () => {
    await openFromHome();
    act(() => {
      window.location.hash = 'app-content';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expectStillOnDetail();
    // The URL is repaired back to the real route.
    expect(window.location.hash).toBe(HASH);
    // Other stray fragments are equally inert.
    act(() => {
      window.location.hash = 'some-random-anchor';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expectStillOnDetail();
  });

  it('the shell skip control does not touch the URL', async () => {
    await openFromHome();
    const skip = document.querySelector('.skip-link') as HTMLElement;
    expect(skip).not.toBeNull();
    expect(skip.tagName).toBe('BUTTON');
    fireEvent.click(skip);
    expectStillOnDetail();
  });

  it('the exact reported sequence stays on the business route', async () => {
    await openFromHome();
    // Overview -> Reviews -> back to the products default.
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expectStillOnDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }));
    expectStillOnDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expectStillOnDetail();
    expect(document.getElementById('biz-products')).not.toBeNull();
    // Scroll, then tap the product card area and the headings.
    fireEvent.scroll(window);
    fireEvent.click(screen.getByText('Products'));
    expectStillOnDetail();
    fireEvent.click(screen.getByText('Red Chilli 250g'));
    expectStillOnDetail();
    fireEvent.click(screen.getByText('Services'));
    expectStillOnDetail();
    fireEvent.click(screen.getByText('Spice Grinding'));
    expectStillOnDetail();
    // Save toggles in place.
    fireEvent.click(screen.getByRole('button', { name: 'Save this business' }));
    expectStillOnDetail();
    // Empty area + logo + name.
    const detail = document.querySelector('.biz-detail')!;
    fireEvent.click(detail);
    expectStillOnDetail();
    fireEvent.click(screen.getByRole('heading', { name: 'Butt Spices' }));
    expectStillOnDetail();
  });

  it('clicking every element on the page never changes the route', async () => {
    await openFromHome();
    const detail = document.querySelector('.biz-detail')!;
    const count = detail.querySelectorAll('*').length;
    for (let i = 0; i < count; i++) {
      const fresh = document.querySelector('.biz-detail');
      if (!fresh) throw new Error(`Business Detail unmounted after click #${i}`);
      const els = fresh.querySelectorAll('*');
      const el = els[Math.min(i, els.length - 1)] as HTMLElement;
      fireEvent.click(el);
      fireEvent.pointerDown(el);
      if (window.location.hash !== HASH) {
        throw new Error(`Route changed after clicking element #${i} (${el.tagName}.${String(el.className).split(' ')[0]})`);
      }
    }
    expectStillOnDetail();
  });

  it('entry from Explore: interactions and stray fragments stay on the route', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /Butt Spices/ }, { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /^Explore/ }));
    const card = await screen.findByRole('button', { name: /Butt Spices/ }, { timeout: 4000 });
    fireEvent.click(card);
    await screen.findByText('Red Chilli 250g');
    expectStillOnDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expectStillOnDetail();
    act(() => {
      window.location.hash = 'app-content';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expectStillOnDetail();
  });

  it('entry from Search: interactions stay on the route', async () => {
    render(<App />);
    const searchEntry = await screen.findByRole('button', { name: /Search businesses/ }, { timeout: 4000 });
    fireEvent.click(searchEntry);
    const input = await screen.findByPlaceholderText(/Try .*bike repair/);
    fireEvent.change(input, { target: { value: 'Butt' } });
    const row = await screen.findByRole('button', { name: /Butt Spices/ }, { timeout: 4000 });
    fireEvent.click(row);
    await screen.findByText('Red Chilli 250g');
    expectStillOnDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }));
    expectStillOnDetail();
    // Back to the products default (Overview toggles off), then the service.
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expectStillOnDetail();
    fireEvent.click(screen.getByText('Spice Grinding'));
    expectStillOnDetail();
  });
});
