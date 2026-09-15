// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BusinessDetailScreen } from './BusinessDetail.js';
import * as api from '../api.js';
import type { Business } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusiness: vi.fn(),
  listBusinessReviews: vi.fn(),
}));

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
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.getByText(/1\.2 km away/i)).toBeInTheDocument();
  });

  it('does not invent a distance when none was computed', async () => {
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByText(/away/i)).not.toBeInTheDocument();
  });

  it('falls back to the address line when no distance was computed', async () => {
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.getByText(/Gulberg, Lahore/)).toBeInTheDocument();
  });

  it('offers Directions when real coordinates exist', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ latitude: 31.5204, longitude: 74.3587 }));
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    const directions = await screen.findByRole('link', { name: /directions/i });
    expect(directions.getAttribute('href')).toContain('destination=31.5204,74.3587');
  });

  it('offers Directions via address search when only an address is configured', async () => {
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    const directions = await screen.findByRole('link', { name: /directions/i });
    expect(directions.getAttribute('href')).toContain(encodeURIComponent('12 Food Street, Lahore'));
  });

  it('hides Directions entirely when no usable location data exists', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      business({ address: '', city: '', locality: null }),
    );
    render(<BusinessDetailScreen idOrSlug="gulberg-grill" onBack={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.queryByRole('link', { name: /directions/i })).toBeNull();
  });
});
