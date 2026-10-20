// @vitest-environment jsdom
/**
 * Business Detail runtime regressions (device report 2026-10-20):
 *
 * - Actions (Overview/Reviews tabs, Call, Directions, Share) must never
 *   navigate the app back to Home: the hash route must stay on the business.
 * - Exactly ONE primary CTA bar may exist; the Services section must not
 *   render a second full-width "Book this service" button duplicating it.
 * - The circular logo's rendered image must actually be clipped round:
 *   styles.css must give .biz-logo-circle img object-fit: cover (contain
 *   showed the source image's own square opaque background as a square
 *   inside the circle).
 * - "+ Add Product" must not be a dead button: signed-out it answers with an
 *   explanation toast instead of doing nothing.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BusinessDetailScreen } from './BusinessDetail.js';
import { ToastProvider } from '../components/primitives.js';
import * as api from '../api.js';
import type { Business } from '../api.js';

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusiness: vi.fn(),
  getMyBusinesses: vi.fn().mockResolvedValue([]),
  listBusinessReviews: vi.fn().mockResolvedValue({ items: [], nextCursor: null, averageRating: 0, reviewCount: 0 }),
  listFeaturedBusinesses: vi.fn().mockResolvedValue([]),
}));

const business = (overrides: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  description: 'Natural spices',
  imageUrl: 'https://cdn.example.com/butt-spices.png',
  categories: [{ id: 'c1', name: 'Food & Restaurants' }],
  city: 'Sheikhupura',
  address: 'Main bazar',
  latitude: 31.49912,
  longitude: 74.326386,
  phone: '+92 300 1234567',
  isVerified: true,
  isOpenNow: true,
  services: [
    { id: 'svc-1', businessId: 'biz-1', name: 'Spice Grinding', priceMinor: 50000, currency: 'PKR', durationMinutes: 30, isActive: true, description: null },
  ],
  products: [
    { id: 'p-1', businessId: 'biz-1', name: 'Red Chilli 250g', priceMinor: 45000, currency: 'PKR', imageUrl: null, description: null, isActive: true },
  ],
  ...overrides,
} as unknown as Business);

const renderDetail = () =>
  render(
    <ToastProvider>
      <BusinessDetailScreen idOrSlug="butt-spices" onBack={() => {}} onBook={() => {}} canOrder onOpenCart={() => {}} />
    </ToastProvider>,
  );

beforeEach(() => {
  window.history.replaceState(null, '', '#/business/butt-spices');
  vi.mocked(api.getBusiness).mockResolvedValue(business());
});

afterEach(cleanup);

describe('BusinessDetail actions never navigate Home', () => {
  it('Overview and Reviews tabs stay on the business route', async () => {
    renderDetail();
    await screen.findByText('Butt Spices');

    fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }));
    expect(window.location.hash).toBe('#/business/butt-spices');
    // Reviews surface replaces the overview content; page identity remains.
    expect(screen.getByText('Butt Spices')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(window.location.hash).toBe('#/business/butt-spices');
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('Call is a tel: link and Directions is a maps link; neither touches the route', async () => {
    renderDetail();
    await screen.findByText('Butt Spices');

    const call = screen.getByText('Call').closest('a');
    expect(call?.getAttribute('href')).toMatch(/^tel:\+?\d+$/);

    const directions = screen.getByText('Directions').closest('a');
    expect(directions?.getAttribute('href')).toContain('google.com/maps');

    fireEvent.click(call!);
    fireEvent.click(directions!);
    expect(window.location.hash).toBe('#/business/butt-spices');
  });

  it('Share stays on the business route', async () => {
    renderDetail();
    await screen.findByText('Butt Spices');
    fireEvent.click(screen.getByText('Share'));
    await Promise.resolve();
    expect(window.location.hash).toBe('#/business/butt-spices');
  });
});

describe('BusinessDetail CTA duplication', () => {
  it('renders exactly one sticky primary CTA bar', async () => {
    const { container } = renderDetail();
    await screen.findByText('Butt Spices');
    expect(container.querySelectorAll('.bd-sticky-bar')).toHaveLength(1);
  });

  it('the Services section has no duplicate full-width "Book this service" button', async () => {
    renderDetail();
    await screen.findByText('Butt Spices');
    // "Book a service" may appear only once on the page: the sticky CTA.
    expect(screen.getAllByText('Book a service')).toHaveLength(1);
    const services = document.getElementById('biz-services');
    expect(services).not.toBeNull();
    expect(services!.textContent).not.toContain('Book this service');
    // Per-service booking still exists.
    expect(screen.getAllByRole('button', { name: 'Book' }).length).toBeGreaterThan(0);
  });
});

describe('+ Add Product is functional, not a dead button', () => {
  it('signed-out click answers with an explanation instead of silence', async () => {
    renderDetail();
    await screen.findByText('Butt Spices');
    fireEvent.click(screen.getByText('+ Add Product'));
    expect(await screen.findByText(/Sign in as the business owner/)).toBeInTheDocument();
    expect(window.location.hash).toBe('#/business/butt-spices');
  });
});

describe('circular logo clipping (styles.css)', () => {
  it('.biz-logo-circle img fills and is clipped by the circle', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(here, '../styles.css'), 'utf8');
    const rule = css.match(/\.biz-logo-circle img \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('object-fit: cover');
    expect(rule![1]).toContain('border-radius: 50%');
    const container = css.match(/\.biz-logo-circle \{([^}]*)\}/);
    expect(container).not.toBeNull();
    expect(container![1]).toContain('overflow: hidden');
    expect(container![1]).toContain('border-radius: 50%');
  });
});
