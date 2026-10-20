// @vitest-environment jsdom
/**
 * Regression: BusinessDetail must render the business's imageUrl in the
 * circular logo container when it exists, not the initial fallback.
 *
 * Root cause was a chicken-and-egg in heroFit state: the logo only rendered
 * when heroFit === 'contain', but heroFit started as 'cover' and was only
 * set to 'contain' after the image loaded — which never happened.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { BusinessDetailScreen } from './BusinessDetail.js';
import { ToastProvider } from '../components/primitives.js';
import * as api from '../api.js';
import type { Business } from '../api.js';

const renderDetail = (props: ComponentProps<typeof BusinessDetailScreen>) =>
  render(
    <ToastProvider>
      <BusinessDetailScreen {...props} />
    </ToastProvider>,
  );

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusiness: vi.fn(),
  listBusinessReviews: vi.fn().mockResolvedValue({ items: [], nextCursor: null, averageRating: 0, reviewCount: 0 }),
  listFeaturedBusinesses: vi.fn().mockResolvedValue([]),
}));

const baseBusiness = (overrides: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  description: 'Natural spices',
  imageUrl: null,
  categories: [{ id: 'c1', name: 'Food & Restaurants' }],
  city: 'Sheikhupura',
  isVerified: true,
  isOpenNow: false,
  services: [],
  products: [],
  ...overrides,
} as Business);

describe('BusinessDetail logo rendering', () => {
  it('renders the image (not the initial) when imageUrl exists', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(
      baseBusiness({ imageUrl: 'https://cdn.example.com/butt-spices.png' })
    );
    const { container } = renderDetail({ idOrSlug: 'butt-spices', onBack: () => {} });
    await screen.findByText('Butt Spices');
    // The circular logo container should contain an img, not the "B" initial.
    const logoCircle = container.querySelector('.biz-logo-circle');
    expect(logoCircle).toBeInTheDocument();
    expect(logoCircle?.querySelector('img')).toBeInTheDocument();
    expect(logoCircle?.querySelector('.biz-logo-initial')).toBeNull();
  });

  it('falls back to the initial when imageUrl is null', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(baseBusiness({ imageUrl: null }));
    renderDetail({ idOrSlug: 'butt-spices', onBack: () => {} });
    await screen.findByText('Butt Spices');
    expect(screen.getByText('B', { selector: '.biz-logo-initial' })).toBeInTheDocument();
  });

  it('shows Overview and Reviews in the upper nav (not a 4-tab bar)', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(baseBusiness());
    renderDetail({ idOrSlug: 'butt-spices', onBack: () => {} });
    await screen.findByText('Butt Spices');
    const nav = screen.getByRole('tablist', { name: 'Business information' });
    expect(nav).toBeInTheDocument();
    // Only Overview and Reviews — no Services/Products tabs.
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reviews' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Services' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Products' })).toBeNull();
  });

  it('renders Products section with + Add Product button', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(baseBusiness());
    renderDetail({ idOrSlug: 'butt-spices', onBack: () => {} });
    await screen.findByText('Butt Spices');
    expect(screen.getByText('+ Add Product')).toBeInTheDocument();
  });
});
