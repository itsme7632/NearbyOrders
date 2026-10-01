// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import * as api from '../api.js';
import { addToCart, clearCart } from '../cart.js';
import { CartScreen } from './Cart.js';

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  clearCart();
  vi.clearAllMocks();
});

const biz = { businessId: 'biz-a', businessName: 'Butt Spices', name: 'Butt Spices' };
const productA = { id: 'p-biryani', name: 'Chicken Biryani', priceMinor: 45000, imageUrl: null };
const productB = { id: 'p-karahi', name: 'Chicken Karahi', priceMinor: 125000, imageUrl: null };

function seedCart() {
  addToCart({ ...biz, product: productA });
  addToCart({ ...biz, product: productB, quantity: 2 });
  // Subtotal: 45000 + 2×125000 = 295000 minor = Rs 2,950.
}

describe('CartScreen checkout pricing', () => {
  it('separates item subtotal and an emphasized total, with no invented fees', () => {
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([]);
    vi.spyOn(api, 'getBusiness').mockResolvedValue({ ...biz, id: biz.businessId, slug: 'butt-spices', status: 'APPROVED' as const, description: null, imageUrl: null, isVerified: true, address: '', city: '', locality: null, latitude: null, longitude: null, phone: null, email: null, currency: 'PKR', categories: [], deliveryEnabled: true, deliveryFeeMinor: 15000 });
    vi.spyOn(api, 'getSession').mockReturnValue(null);
    seedCart();
    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);

    expect(screen.getByText('Order total')).toBeTruthy();
    expect(screen.queryByText('Delivery fee')).toBeNull();
    expect(screen.getAllByText('Rs 2,950').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /place order/i })).toBeTruthy();
  });

  it('updates quantity immediately when the plus control is tapped', () => {
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([]);
    vi.spyOn(api, 'getBusiness').mockResolvedValue({ ...biz, id: biz.businessId, slug: 'butt-spices', status: 'APPROVED' as const, description: null, imageUrl: null, isVerified: true, address: '', city: '', locality: null, latitude: null, longitude: null, phone: null, email: null, currency: 'PKR', categories: [], deliveryEnabled: true, deliveryFeeMinor: 15000 });
    seedCart();
    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);
    const plus = screen.getByRole('button', { name: 'Increase quantity of Chicken Biryani' });
    fireEvent.click(plus);
    expect(within(screen.getByLabelText('Quantity of Chicken Biryani')).getByText('2')).toBeTruthy();
    expect(screen.getAllByText('Rs 900').length).toBeGreaterThan(0);
  });

  it('shows the configured delivery fee and total before placing a delivery order', async () => {
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([]);
    vi.spyOn(api, 'getBusiness').mockResolvedValue({ ...biz, id: biz.businessId, slug: 'butt-spices', status: 'APPROVED' as const, description: null, imageUrl: null, isVerified: true, address: '', city: '', locality: null, latitude: null, longitude: null, phone: null, email: null, currency: 'PKR', categories: [], deliveryEnabled: true, deliveryFeeMinor: 15000 });
    vi.spyOn(api, 'getSession').mockReturnValue(null);
    seedCart();
    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Delivery' }));
    expect(within(screen.getByRole('region', { name: 'Order summary' })).getByText('Delivery')).toBeTruthy();
    expect(await screen.findByText('Rs 150')).toBeTruthy();
    expect(await screen.findByText('Rs 3,100')).toBeTruthy();
  });
});
