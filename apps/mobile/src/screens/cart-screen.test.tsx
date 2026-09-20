// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as api from '../api.js';
import { addToCart, clearCart } from '../cart.js';
import { CartScreen } from './Cart.js';

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  clearCart();
  vi.clearAllMocks();
});

const biz = { businessId: 'biz-a', businessName: 'Butt Spices' };
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
    vi.spyOn(api, 'getSession').mockReturnValue(null);
    seedCart();
    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onPlaced={() => {}} />);

    expect(screen.getByText('Item subtotal')).toBeTruthy();
    // No delivery fee line for pickup, and no other server fees invented.
    expect(screen.queryByText('Delivery fee')).toBeNull();
    // The emphasized total appears in the summary and again in the footer.
    expect(screen.getAllByText('Total')).toHaveLength(2);
    // Both summary subtotal and emphasized total show the same number.
    expect(screen.getAllByText('Rs 2,950').length).toBeGreaterThanOrEqual(2);
    // Footer restates the total beside the commitment button.
    expect(screen.getByRole('button', { name: /place order/i })).toBeTruthy();
  });

  it('shows a delivery fee line (no invented number) when delivery is chosen', () => {
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([]);
    vi.spyOn(api, 'getSession').mockReturnValue(null);
    seedCart();
    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onPlaced={() => {}} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Delivery' }));
    expect(screen.getByText('Delivery fee')).toBeTruthy();
    expect(screen.getByText('Set by the business')).toBeTruthy();
    // The total is unchanged: only the business can set the delivery fee.
    expect(screen.getAllByText('Rs 2,950').length).toBeGreaterThanOrEqual(2);
  });
});
