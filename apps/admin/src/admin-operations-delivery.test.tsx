// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  listOrders: vi.fn(),
  listBookings: vi.fn(),
}));

async function renderInto(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  return container;
}

const flush = () => act(async () => {});

const customer = {
  id: 'cust1',
  email: 'customer@example.com',
  firstName: 'Ayesha',
  lastName: 'Khan',
};

const order = (patch: Record<string, unknown> = {}) => ({
  id: 'order-12345678',
  status: 'READY',
  subtotalMinor: 150000,
  deliveryFeeMinor: 0,
  totalMinor: 150000,
  currency: 'PKR',
  fulfillmentType: 'PICKUP',
  deliveryAddressText: null,
  assignedRider: null,
  riderAssignedAt: null,
  createdAt: '2026-09-28T10:00:00.000Z',
  business: { id: 'biz1', name: 'Spice House' },
  customer,
  ...patch,
});

const booking = (patch: Record<string, unknown> = {}) => ({
  id: 'booking-12345678',
  status: 'CONFIRMED',
  bookingDate: '2026-10-02',
  startAt: '2026-10-02T09:00:00.000Z',
  amountDueMinor: 200000,
  amountPaidMinor: 0,
  servicePriceMinor: 200000,
  totalDurationMinutes: 60,
  currency: 'PKR',
  createdAt: '2026-09-28T10:00:00.000Z',
  business: { id: 'biz1', name: 'Style Salon' },
  service: { id: 'svc1', name: 'Haircut' },
  serviceItems: [],
  customer,
  ...patch,
});

describe('admin order delivery visibility', () => {
  it('shows fulfillment type and new delivery statuses in the orders table', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listOrders).mockResolvedValue([
      order({ id: 'order-delivery-1', fulfillmentType: 'DELIVERY', status: 'OUT_FOR_DELIVERY' }),
      order({ id: 'order-pickup-1', fulfillmentType: 'PICKUP', status: 'READY' }),
    ]);
    const { Orders } = await import('./screen-operations.js');
    const c = await renderInto(<Orders />);
    await flush();
    expect(c.textContent).toContain('Delivery');
    expect(c.textContent).toContain('Pickup');
    // statusLabel converts OUT_FOR_DELIVERY to "Out For Delivery"
    expect(c.textContent).toContain('Out For Delivery');
    expect(c.textContent).toContain('Ready');
  });

  it('shows the rider name in the table and drawer without any phone number', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listOrders).mockResolvedValue([
      order({
        id: 'order-rider-1',
        fulfillmentType: 'DELIVERY',
        status: 'OUT_FOR_DELIVERY',
        deliveryAddressText: 'House 12, Street 4, DHA Phase 5',
        assignedRider: { id: 'rider1', name: 'Bilal Ahmed', photoUrl: null },
        riderAssignedAt: '2026-09-28T11:00:00.000Z',
      }),
    ]);
    const { Orders } = await import('./screen-operations.js');
    const c = await renderInto(<Orders />);
    await flush();
    expect(c.textContent).toContain('Rider: Bilal Ahmed');
    // Open the drawer.
    const view = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'View');
    expect(view).toBeTruthy();
    await act(async () => {
      view!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(c.textContent).toContain('Bilal Ahmed');
    expect(c.textContent).toContain('House 12, Street 4, DHA Phase 5');
    // Privacy: admin responses never carry a rider phone; the UI must not render one.
    expect(c.textContent).not.toMatch(/03\d{2}[- ]?\d{7}/);
    expect(c.textContent).not.toContain('phone');
  });

  it('shows "Not assigned" and no delivery address for pickup orders', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listOrders).mockResolvedValue([order()]);
    const { Orders } = await import('./screen-operations.js');
    const c = await renderInto(<Orders />);
    await flush();
    const view = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'View');
    await act(async () => {
      view!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(c.textContent).toContain('Not assigned');
    expect(c.textContent).not.toContain('Delivery address');
  });

  it('includes delivery status tabs for OUT_FOR_DELIVERY and DELIVERED', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listOrders).mockResolvedValue([order({ status: 'DELIVERED', fulfillmentType: 'DELIVERY' })]);
    const { Orders } = await import('./screen-operations.js');
    const c = await renderInto(<Orders />);
    await flush();
    expect(c.textContent).toContain('Out For Delivery');
    expect(c.textContent).toContain('Delivered');
  });
});

describe('admin multi-service booking visibility', () => {
  it('lists all services with individual prices and durations plus combined totals', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listBookings).mockResolvedValue([
      booking({
        id: 'booking-multi-1',
        service: null,
        servicePriceMinor: 350000,
        totalDurationMinutes: 90,
        serviceItems: [
          { id: 'item1', serviceId: 'svc1', name: 'Haircut', priceMinor: 200000, durationMinutes: 60 },
          { id: 'item2', serviceId: 'svc2', name: 'Beard trim', priceMinor: 150000, durationMinutes: 30 },
        ],
      }),
    ]);
    const { Bookings } = await import('./screen-operations.js');
    const c = await renderInto(<Bookings />);
    await flush();
    // Table shows joined service names.
    expect(c.textContent).toContain('Haircut, Beard trim');
    // Drawer shows each service with price and duration, plus combined totals.
    const view = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'View');
    await act(async () => {
      view!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(c.textContent).toContain('Haircut');
    expect(c.textContent).toContain('Beard trim');
    expect(c.textContent).toContain('2 services');
    expect(c.textContent).toContain('90 min');
    // Combined price 350000 minor = Rs 3,500 (fmtMoney formatting may vary).
    expect(c.textContent).toContain('3,500');
  });

  it('falls back to legacy service fields for single-service bookings', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listBookings).mockResolvedValue([booking()]);
    const { Bookings } = await import('./screen-operations.js');
    const c = await renderInto(<Bookings />);
    await flush();
    expect(c.textContent).toContain('Haircut');
    const view = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'View');
    await act(async () => {
      view!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(c.textContent).toContain('Haircut');
    expect(c.textContent).toContain('60 min');
  });
});
