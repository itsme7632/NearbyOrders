// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { addToCart, clearCart } from '../cart.js';
import { CartPill } from './CartPill.js';

const biz = { businessId: 'biz-a', businessName: 'Butt Spices' };
const product = { id: 'p-1', name: 'Chicken Biryani', priceMinor: 45000, imageUrl: null };

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  clearCart();
});

describe('CartPill', () => {
  it('renders nothing when the cart is empty', () => {
    const { container } = render(<CartPill onViewCart={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the item count and the formatted subtotal when the cart has items', () => {
    addToCart({ ...biz, product });
    addToCart({ ...biz, product, quantity: 2 });
    render(<CartPill onViewCart={() => {}} />);

    expect(screen.getByText('3 items')).toBeTruthy();
    // 3 × 45000 minor = Rs 1,350, formatted by the app's Money formatter.
    expect(screen.getByText('Rs 1,350')).toBeTruthy();
    expect(screen.getByRole('button', { name: /view cart/i })).toBeTruthy();
  });

  it('calls onViewCart when the pill is tapped', () => {
    addToCart({ ...biz, product });
    const onViewCart = vi.fn();
    render(<CartPill onViewCart={onViewCart} />);

    fireEvent.click(screen.getByRole('button', { name: /view cart/i }));
    expect(onViewCart).toHaveBeenCalledTimes(1);
  });

  it('disappears when the cart is emptied', () => {
    addToCart({ ...biz, product });
    const { container } = render(<CartPill onViewCart={() => {}} />);
    expect(screen.getByText('1 item')).toBeTruthy();

    // Cart mutations happen outside React events, so flush with act().
    act(() => {
      clearCart();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('updates the subtotal live as the cart changes', () => {
    addToCart({ ...biz, product });
    render(<CartPill onViewCart={() => {}} />);
    expect(screen.getByText('Rs 450')).toBeTruthy();

    act(() => {
      addToCart({ ...biz, product });
    });
    expect(screen.getByText('Rs 900')).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
  });
});
