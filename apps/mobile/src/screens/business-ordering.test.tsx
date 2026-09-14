import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BusinessDetailScreen } from './BusinessDetail.js';
import * as api from '../api.js';
import type { Business } from '../api.js';
import { addToCart, clearCart, getCart } from '../cart.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  clearCart();
  vi.restoreAllMocks();
});

const biz = (patch: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  description: null,
  imageUrl: null,
  isVerified: false,
  address: '12 Food Street',
  city: 'Karachi',
  locality: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [{ id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true }],
  ...patch,
});

const withProducts = (b: Business): Business => ({
  ...b,
  products: [
    { id: 'p1', name: 'Chicken Biryani', description: 'Serves 1', priceMinor: 45000, currency: 'PKR', imageUrl: null, isActive: true },
  ],
});

const renderDetail = async (props: Partial<Parameters<typeof BusinessDetailScreen>[0]> = {}) => {
  render(
    <BusinessDetailScreen
      idOrSlug="biz-1"
      onBack={() => {}}
      canOrder
      onOpenCart={() => {}}
      {...props}
    />,
  );
  // The tabbed Business Profile keeps catalog data behind its Products tab.
  fireEvent.click(await screen.findByRole('tab', { name: 'Products' }));
};

describe('add to cart from business detail', () => {
  it('adds an active product and shows the cart notice', async () => {
    vi.spyOn(api, 'getBusiness').mockResolvedValue(withProducts(biz()));
    await renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Chicken Biryani to cart' }));
    expect(await screen.findByText(/Added Chicken Biryani to your cart/)).toBeTruthy();
    expect(getCart()?.items[0].productId).toBe('p1');
    expect(screen.getByText('Go to cart (1)')).toBeTruthy();
  });

  it('does not render add controls when canOrder is false (owners / signed-out)', async () => {
    vi.spyOn(api, 'getBusiness').mockResolvedValue(withProducts(biz()));
    await renderDetail({ canOrder: false, onOpenCart: undefined });

    await screen.findByText('Chicken Biryani');
    expect(screen.queryByRole('button', { name: /Add .* to cart/ })).toBeNull();
    expect(screen.getByText('Sign in as a customer to order')).toBeTruthy();
  });

  it('asks before replacing a cart from another business and never swaps silently', async () => {
    vi.spyOn(api, 'getBusiness').mockResolvedValue(withProducts(biz({ id: 'biz-2', name: 'DHA Glow Salon' })));
    // Cart already holds items from biz-1.
    addToCart({ businessId: 'biz-1', businessName: 'Butt Spices', product: { id: 'p9', name: 'Biryani Platter', priceMinor: 90000, imageUrl: null } });

    await renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Chicken Biryani to cart' }));

    // Conflict dialog, not a silent replace.
    expect(await screen.findByText(/Your cart contains items from/)).toBeTruthy();
    expect(screen.getByText('Clear cart and add')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(getCart()!.businessId).toBe('biz-1');

    // Cancel keeps the original cart untouched.
    fireEvent.click(screen.getByText('Cancel'));
    expect(getCart()!.businessId).toBe('biz-1');

    // Re-add and confirm → cart is replaced with the new business.
    fireEvent.click(screen.getByRole('button', { name: 'Add Chicken Biryani to cart' }));
    fireEvent.click(screen.getByText('Clear cart and add'));
    await waitFor(() => expect(getCart()!.businessId).toBe('biz-2'));
    expect(getCart()!.items.map((i) => i.productId)).toEqual(['p1']);
  });

  it('products section carries no image-URL affordances', async () => {
    vi.spyOn(api, 'getBusiness').mockResolvedValue(withProducts(biz()));
    await renderDetail();
    await screen.findByText('Chicken Biryani');
    expect(screen.queryByText(/image url/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/url/i)).toBeNull();
  });
});
