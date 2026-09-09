import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_QUANTITY,
  addToCart,
  cartCount,
  cartSubtotal,
  clearCart,
  getCart,
  lineTotal,
  onCartChange,
  removeFromCart,
  replaceWith,
  setQuantity,
} from './cart.js';

const bizA = { businessId: 'biz-a', businessName: 'Butt Spices' };
const bizB = { businessId: 'biz-b', businessName: 'DHA Glow Salon' };

const productA = { id: 'p-biryani', name: 'Chicken Biryani', priceMinor: 45000, imageUrl: null };
const productA2 = { id: 'p-karahi', name: 'Chicken Karahi', priceMinor: 125000, imageUrl: null };
const productB = { id: 'p-facial', name: 'Facial', priceMinor: 250000, imageUrl: null };

beforeEach(() => {
  window.localStorage.clear();
  clearCart();
});

describe('cart basics', () => {
  it('starts empty', () => {
    expect(getCart()).toBeNull();
    expect(cartCount()).toBe(0);
    expect(cartSubtotal()).toBe(0);
  });

  it('adds products and computes integer totals', () => {
    addToCart({ ...bizA, product: productA });
    addToCart({ ...bizA, product: productA2, quantity: 2 });

    const cart = getCart()!;
    expect(cart.businessId).toBe('biz-a');
    expect(cart.items).toHaveLength(2);
    expect(cartCount()).toBe(3);
    // Pure integer math: 45000 + 2×125000.
    expect(cartSubtotal()).toBe(295000);
    expect(lineTotal(cart.items[0])).toBe(45000);
  });

  it('merges repeated adds of the same product by incrementing quantity', () => {
    addToCart({ ...bizA, product: productA });
    addToCart({ ...bizA, product: productA });
    expect(getCart()!.items).toHaveLength(1);
    expect(getCart()!.items[0].quantity).toBe(2);
  });

  it('increases and decreases quantity; removing last item empties the cart', () => {
    addToCart({ ...bizA, product: productA });
    setQuantity('p-biryani', 5);
    expect(getCart()!.items[0].quantity).toBe(5);

    setQuantity('p-biryani', 2);
    expect(getCart()!.items[0].quantity).toBe(2);

    setQuantity('p-biryani', 0);
    expect(getCart()).toBeNull();
  });

  it('removes an individual item and keeps the rest', () => {
    addToCart({ ...bizA, product: productA });
    addToCart({ ...bizA, product: productA2 });
    removeFromCart('p-biryani');
    expect(getCart()!.items.map((i) => i.productId)).toEqual(['p-karahi']);
  });

  it('clamps quantities to the server mirror (1..99)', () => {
    addToCart({ ...bizA, product: productA, quantity: 500 });
    expect(getCart()!.items[0].quantity).toBe(MAX_QUANTITY);
    // Fractional add-quantities floor to a whole unit.
    addToCart({ ...bizA, product: productA2, quantity: 2.9 });
    expect(getCart()!.items[1].quantity).toBe(2);
  });

  it('notifies subscribers on every mutation', () => {
    const spy = vi.fn();
    onCartChange(spy);
    addToCart({ ...bizA, product: productA });
    setQuantity('p-biryani', 3);
    removeFromCart('p-biryani');
    clearCart();
    expect(spy).toHaveBeenCalledTimes(4);
  });
});

describe('single-business protection', () => {
  it('refuses to add from a different business without mutating the cart', () => {
    addToCart({ ...bizA, product: productA });
    const result = addToCart({ ...bizB, product: productB });
    expect(result).toEqual({ added: false, reason: 'different-business' });
    expect(getCart()!.businessId).toBe('biz-a');
    expect(getCart()!.items.map((i) => i.productId)).toEqual(['p-biryani']);
  });

  it('replaceWith swaps the whole cart for the new business', () => {
    addToCart({ ...bizA, product: productA });
    replaceWith({ ...bizB, product: productB });
    expect(getCart()!.businessId).toBe('biz-b');
    expect(getCart()!.items).toHaveLength(1);
    expect(cartSubtotal()).toBe(250000);
  });

  it('clearCart empties everything', () => {
    addToCart({ ...bizA, product: productA });
    clearCart();
    expect(getCart()).toBeNull();
  });
});

describe('persistence', () => {
  it('survives a module-level reload via localStorage', async () => {
    addToCart({ ...bizA, product: productA });
    addToCart({ ...bizA, product: productA2, quantity: 2 });

    // Fresh import = simulates an app restart sharing the same jsdom storage.
    vi.resetModules();
    const fresh = await import('./cart.js');
    expect(fresh.getCart()?.businessId).toBe('biz-a');
    expect(fresh.cartSubtotal()).toBe(295000);
    expect(fresh.cartCount()).toBe(3);
  });

  it('drops corrupt or empty storage safely', async () => {
    window.localStorage.setItem('nearbyorders.cart.v1', '{not json');
    vi.resetModules();
    const fresh = await import('./cart.js');
    expect(fresh.getCart()).toBeNull();

    window.localStorage.setItem('nearbyorders.cart.v1', JSON.stringify({ businessId: 'x', items: [] }));
    vi.resetModules();
    const fresh2 = await import('./cart.js');
    expect(fresh2.getCart()).toBeNull();
  });
});
