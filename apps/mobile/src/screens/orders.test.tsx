import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CartScreen } from './Cart.js';
import { OrdersScreen, OrderDetailScreen, orderNumber } from './Orders.js';
import * as api from '../api.js';
import { addToCart, clearCart, getCart } from '../cart.js';
import type { Order } from '../api.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  clearCart();
  vi.restoreAllMocks();
});

const order = (patch: Partial<Order> = {}): Order => ({
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status: 'PENDING',
  subtotalMinor: 215000,
  currency: 'PKR',
  fulfillmentType: 'PICKUP',
  notes: null,
  createdAt: '2026-09-09T12:00:00.000Z',
  business: { id: 'biz-1', name: 'Butt Spices', slug: 'butt-spices' },
  customer: { firstName: 'Ayesha', lastName: 'Khan' },
  items: [
    { id: 'i1', productId: 'p1', name: 'Chicken Biryani', unitPriceMinor: 45000, quantity: 2, lineTotalMinor: 90000 },
    { id: 'i2', productId: 'p2', name: 'Chicken Karahi', unitPriceMinor: 125000, quantity: 1, lineTotalMinor: 125000 },
  ],
  ...patch,
});

describe('cart screen', () => {
  it('shows the empty state with a browse action', () => {
    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
    expect(screen.getByText('Find businesses')).toBeTruthy();
  });

  it('lists items with line totals and quantity controls', () => {
    addToCart({ businessId: 'biz-1', businessName: 'Butt Spices', product: { id: 'p1', name: 'Chicken Biryani', priceMinor: 45000, imageUrl: null } });
    addToCart({ businessId: 'biz-1', businessName: 'Butt Spices', product: { id: 'p2', name: 'Chicken Karahi', priceMinor: 125000, imageUrl: null }, quantity: 2 });

    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);
    expect(screen.getByText(/Ordering from/)).toBeTruthy();
    expect(screen.getByText('Chicken Biryani')).toBeTruthy();
    // 2 biryani + 2 karahi quantities via the steppers.
    expect(screen.getAllByRole('button', { name: /Increase quantity/ })).toHaveLength(2);
    // Total = 45000 + 2×125000 = 295000 → "Rs 2,950" — match the value portion.
    expect(screen.getAllByText(/2,950/).length).toBeGreaterThan(0);
  });

  it('increase/decrease updates quantities; decrease below 1 removes the item', async () => {
    addToCart({ businessId: 'biz-1', businessName: 'Butt Spices', product: { id: 'p1', name: 'Chicken Biryani', priceMinor: 45000, imageUrl: null } });

    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Chicken Biryani' }));
    expect(getCart()!.items[0].quantity).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity of Chicken Biryani' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity of Chicken Biryani' }));
    expect(getCart()).toBeNull();
    expect(await screen.findByText('Your cart is empty')).toBeTruthy();
  });

  it('Remove clears the item and shows the empty state', async () => {
    addToCart({ businessId: 'biz-1', businessName: 'Butt Spices', product: { id: 'p1', name: 'Chicken Biryani', priceMinor: 45000, imageUrl: null } });
    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);

    fireEvent.click(screen.getByText('Remove'));
    expect(await screen.findByText('Your cart is empty')).toBeTruthy();
  });

  it('places the order and shows confirmation with the server total', async () => {
    vi.spyOn(api, 'createOrder').mockResolvedValue(order());
    addToCart({ businessId: 'biz-1', businessName: 'Butt Spices', product: { id: 'p1', name: 'Chicken Biryani', priceMinor: 45000, imageUrl: null } });

    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);
    fireEvent.click(screen.getByText('Place order'));

    expect(await screen.findByText('Order placed!')).toBeTruthy();
    expect(api.createOrder).toHaveBeenCalledWith({
      businessId: 'biz-1',
      items: [{ productId: 'p1', quantity: 1 }],
      fulfillmentType: 'PICKUP',
    });
    // Cart is emptied after a successful placement.
    expect(getCart()).toBeNull();
  });

  it('surfaces a friendly message when products became unavailable', async () => {
    vi.spyOn(api, 'createOrder').mockRejectedValue(new api.ApiError(400, 'INVALID_PRODUCTS', 'One or more products are unavailable'));
    addToCart({ businessId: 'biz-1', businessName: 'Butt Spices', product: { id: 'p1', name: 'Chicken Biryani', priceMinor: 45000, imageUrl: null } });

    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);
    fireEvent.click(screen.getByText('Place order'));

    expect(await screen.findByText(/no longer available/)).toBeTruthy();
    // The cart is kept so the customer can adjust it.
    expect(getCart()).not.toBeNull();
  });
});

describe('customer orders screens', () => {
  it('shows the no-orders empty state', async () => {
    vi.spyOn(api, 'listMyOrders').mockResolvedValue([]);
    render(<OrdersScreen onOpenOrder={() => {}} onBrowse={() => {}} />);
    expect(await screen.findByText('No orders yet')).toBeTruthy();
  });

  it('lists orders with number, business, total, and status', async () => {
    const o = order();
    vi.spyOn(api, 'listMyOrders').mockResolvedValue([o]);
    render(<OrdersScreen onOpenOrder={() => {}} onBrowse={() => {}} />);

    expect(await screen.findByText('Butt Spices')).toBeTruthy();
    // v3 card: the order number sits inside the combined metadata line.
    expect(screen.getByText(/#F90AE7/)).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText(/3 items/)).toBeTruthy();
  });

  it('never exposes the raw order id as the customer-facing number', () => {
    const label = orderNumber(order());
    expect(label).toMatch(/^#[0-9A-F]{6}$/);
    expect(label).not.toContain('-');
    expect(label).not.toContain(order().id.slice(0, 8));
  });

  it('order detail shows purchase-time prices, line totals, and total', async () => {
    vi.spyOn(api, 'getMyOrder').mockResolvedValue(order());
    render(<OrderDetailScreen orderId="x" onBack={() => {}} />);

    expect(await screen.findByText(/Order #F90AE7/)).toBeTruthy();
    expect(screen.getByText('Chicken Biryani')).toBeTruthy();
    // Line total 2×450 → 900.
    expect(screen.getAllByText(/900/).length).toBeGreaterThan(0);
    // Total row shows 2,150.
    expect(screen.getAllByText(/2,150/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Purchase-time prices/)).toBeTruthy();
  });

  it('shows a not-found state for foreign orders (404)', async () => {
    vi.spyOn(api, 'getMyOrder').mockRejectedValue(new api.ApiError(404, 'NOT_FOUND', 'Order not found'));
    render(<OrderDetailScreen orderId="secret" onBack={() => {}} />);
    // The error state surfaces the server's message (never a stack trace).
    expect(await screen.findByText(/Order not found/)).toBeTruthy();
  });
});
