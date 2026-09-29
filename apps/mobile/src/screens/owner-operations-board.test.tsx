import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerOrders, nextAction, boardColumn, orderNo } from './OwnerOrders.js';
import { AssignRiderModal } from './AssignRiderModal.js';
import { RiderForm } from './RiderForm.js';
import { OwnerRiders } from './OwnerRiders.js';
import * as api from '../api.js';
import type { Order, Rider } from '../api.js';

afterEach(cleanup);

const business = { id: 'biz-1', name: 'Test Kitchen', slug: 'test-kitchen', imageUrl: null };

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'ord-1',
  status: 'PENDING',
  subtotalMinor: 50000,
  totalMinor: 50000,
  currency: 'PKR',
  fulfillmentType: 'PICKUP',
  createdAt: '2026-09-29T10:00:00.000Z',
  notes: null,
  business,
  customer: { firstName: 'Ali', lastName: 'Raza' },
  items: [{ id: 'i-1', productId: 'p-1', name: 'Biryani', unitPriceMinor: 25000, quantity: 2, lineTotalMinor: 50000 }],
  ...overrides,
});

const makeRider = (overrides: Partial<Rider> = {}): Rider => ({
  id: 'rider-1',
  businessId: 'biz-1',
  name: 'Ahmed Khan',
  phone: '03001234567',
  photoUrl: null,
  note: null,
  isActive: true,
  createdAt: '2026-09-29T09:00:00.000Z',
  updatedAt: '2026-09-29T09:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

/* ---------------- board grouping ---------------- */

describe('boardColumn', () => {
  it('groups PENDING and ACCEPTED into NEW', () => {
    expect(boardColumn('PENDING')).toBe('NEW');
    expect(boardColumn('ACCEPTED')).toBe('NEW');
  });
  it('groups PREPARING, READY, OUT_FOR_DELIVERY into their own columns', () => {
    expect(boardColumn('PREPARING')).toBe('PREPARING');
    expect(boardColumn('READY')).toBe('READY');
    expect(boardColumn('OUT_FOR_DELIVERY')).toBe('OUT_FOR_DELIVERY');
  });
  it('groups DELIVERED and COMPLETED into COMPLETED', () => {
    expect(boardColumn('DELIVERED')).toBe('COMPLETED');
    expect(boardColumn('COMPLETED')).toBe('COMPLETED');
  });
});

/* ---------------- next actions ---------------- */

describe('nextAction', () => {
  it('PENDING → Accept', () => {
    const a = nextAction(makeOrder({ status: 'PENDING' }));
    expect(a).toMatchObject({ kind: 'status', status: 'ACCEPTED', label: 'Accept' });
  });
  it('ACCEPTED → Start preparing', () => {
    const a = nextAction(makeOrder({ status: 'ACCEPTED' }));
    expect(a).toMatchObject({ kind: 'status', status: 'PREPARING', label: 'Start preparing' });
  });
  it('PREPARING → Mark ready', () => {
    const a = nextAction(makeOrder({ status: 'PREPARING' }));
    expect(a).toMatchObject({ kind: 'status', status: 'READY', label: 'Mark ready' });
  });
  it('READY pickup → Complete', () => {
    const a = nextAction(makeOrder({ status: 'READY', fulfillmentType: 'PICKUP' }));
    expect(a).toMatchObject({ kind: 'status', status: 'COMPLETED', label: 'Complete' });
  });
  it('READY delivery without rider → Assign rider', () => {
    const a = nextAction(makeOrder({ status: 'READY', fulfillmentType: 'DELIVERY' }));
    expect(a).toMatchObject({ kind: 'assign-rider', label: 'Assign rider' });
  });
  it('READY delivery with rider → Out for delivery', () => {
    const a = nextAction(
      makeOrder({
        status: 'READY',
        fulfillmentType: 'DELIVERY',
        assignedRider: { id: 'r-1', name: 'Ahmed', photoUrl: null },
      }),
    );
    expect(a).toMatchObject({ kind: 'status', status: 'OUT_FOR_DELIVERY', label: 'Out for delivery' });
  });
  it('OUT_FOR_DELIVERY → Mark delivered', () => {
    const a = nextAction(makeOrder({ status: 'OUT_FOR_DELIVERY', fulfillmentType: 'DELIVERY' }));
    expect(a).toMatchObject({ kind: 'status', status: 'DELIVERED', label: 'Mark delivered' });
  });
  it('terminal statuses have no action', () => {
    expect(nextAction(makeOrder({ status: 'DELIVERED' }))).toBeNull();
    expect(nextAction(makeOrder({ status: 'COMPLETED' }))).toBeNull();
    expect(nextAction(makeOrder({ status: 'CANCELLED' }))).toBeNull();
  });
});

/* ---------------- operations board rendering ---------------- */

describe('OwnerOrders operations board', () => {
  it('renders columns with grouped orders', async () => {
    const orders = [
      makeOrder({ id: 'ord-1', status: 'PENDING' }),
      makeOrder({ id: 'ord-2', status: 'PREPARING' }),
      makeOrder({ id: 'ord-3', status: 'READY', fulfillmentType: 'DELIVERY', deliveryAddressText: '12 Main St' }),
      makeOrder({ id: 'ord-4', status: 'OUT_FOR_DELIVERY', fulfillmentType: 'DELIVERY' }),
      makeOrder({ id: 'ord-5', status: 'DELIVERED', fulfillmentType: 'DELIVERY' }),
    ];
    render(<OwnerOrders businessId="biz-1" orders={orders} />);
    expect(screen.getByLabelText('Operations board')).toBeTruthy();
    for (const title of ['New', 'Preparing', 'Ready', 'Out for delivery', 'Completed']) {
      // Column headers are h3; status badges are spans with the same text.
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    // Delivery address shown on the delivery card.
    expect(screen.getByText('12 Main St')).toBeTruthy();
  });

  it('shows Assign rider for READY delivery without rider, and rider name when assigned', async () => {
    const orders = [
      makeOrder({ id: 'ord-1', status: 'READY', fulfillmentType: 'DELIVERY' }),
      makeOrder({
        id: 'ord-2',
        status: 'READY',
        fulfillmentType: 'DELIVERY',
        assignedRider: { id: 'r-1', name: 'Ahmed Khan', phone: '03001234567', photoUrl: null },
      }),
    ];
    render(<OwnerOrders businessId="biz-1" orders={orders} />);
    expect(screen.getByRole('button', { name: 'Assign rider' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Out for delivery' })).toBeTruthy();
    expect(screen.getByText('Rider: Ahmed Khan')).toBeTruthy();
  });

  it('shows fulfillment badge per card', async () => {
    const orders = [
      makeOrder({ id: 'ord-1', fulfillmentType: 'PICKUP' }),
      makeOrder({ id: 'ord-2', fulfillmentType: 'DELIVERY' }),
    ];
    render(<OwnerOrders businessId="biz-1" orders={orders} />);
    expect(screen.getAllByText('Pickup').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delivery').length).toBeGreaterThan(0);
  });

  it('accept action calls setOrderStatus and reloads', async () => {
    const setStatus = vi.spyOn(api, 'setOrderStatus').mockResolvedValue(makeOrder({ status: 'ACCEPTED' }));
    const orders = [makeOrder({ id: 'ord-1', status: 'PENDING' })];
    render(<OwnerOrders businessId="biz-1" orders={orders} />);
    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('ord-1', 'ACCEPTED'));
  });
});

/* ---------------- AssignRiderModal ---------------- */

describe('AssignRiderModal', () => {
  const order = makeOrder({ id: 'ord-1', status: 'READY', fulfillmentType: 'DELIVERY' });

  it('lists ACTIVE riders only - inactive riders never appear', async () => {
    vi.spyOn(api, 'listRiders').mockResolvedValue([
      makeRider({ id: 'r-1', name: 'Active Ahmed', isActive: true }),
      makeRider({ id: 'r-2', name: 'Inactive Imran', isActive: false }),
    ]);
    render(<AssignRiderModal businessId="biz-1" order={order} onClose={() => {}} onAssigned={() => {}} />);
    await waitFor(() => expect(screen.getByText('Active Ahmed')).toBeTruthy());
    expect(screen.queryByText('Inactive Imran')).toBeNull();
  });

  it('assign calls the API and triggers onAssigned', async () => {
    const assign = vi.spyOn(api, 'assignRider').mockResolvedValue(order);
    vi.spyOn(api, 'listRiders').mockResolvedValue([makeRider()]);
    const onAssigned = vi.fn();
    render(<AssignRiderModal businessId="biz-1" order={order} onClose={() => {}} onAssigned={onAssigned} />);
    await waitFor(() => expect(screen.getByText('Ahmed Khan')).toBeTruthy());
    fireEvent.click(screen.getByText('Assign'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('ord-1', 'rider-1'));
    expect(onAssigned).toHaveBeenCalled();
  });

  it('shows empty state when no active riders', async () => {
    vi.spyOn(api, 'listRiders').mockResolvedValue([makeRider({ isActive: false })]);
    render(<AssignRiderModal businessId="biz-1" order={order} onClose={() => {}} onAssigned={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No active riders/)).toBeTruthy());
  });
});

/* ---------------- RiderForm ---------------- */

describe('RiderForm', () => {
  it('requires name and phone', async () => {
    const onSubmit = vi.fn();
    render(<RiderForm saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Add rider'));
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(screen.getByText('Phone is required')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed values with defaults', async () => {
    const onSubmit = vi.fn();
    render(<RiderForm saving={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Ahmed  ' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '03001234567' } });
    fireEvent.click(screen.getByText('Add rider'));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Ahmed',
        phone: '03001234567',
        photoUrl: null,
        note: null,
        isActive: true,
      }),
    );
  });

  it('prefills initial values in edit mode', async () => {
    render(
      <RiderForm initial={makeRider({ name: 'Old Name', note: 'Night shift' })} saving={false} error={null} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Old Name');
    expect(screen.getByText('Save changes')).toBeTruthy();
  });
});

/* ---------------- OwnerRiders ---------------- */

describe('OwnerRiders', () => {
  it('lists active riders before inactive ones', async () => {
    vi.spyOn(api, 'listRiders').mockResolvedValue([
      makeRider({ id: 'r-1', name: 'Zed Inactive', isActive: false }),
      makeRider({ id: 'r-2', name: 'Amy Active', isActive: true }),
    ]);
    render(<OwnerRiders businessId="biz-1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Amy Active')).toBeTruthy());
    const items = screen.getAllByText(/Amy Active|Zed Inactive/);
    // Active section header comes before inactive in the DOM.
    const html = document.body.innerHTML;
    expect(html.indexOf('Amy Active')).toBeLessThan(html.indexOf('Zed Inactive'));
    expect(items.length).toBe(2);
  });

  it('shows phone, note, and badges per rider', async () => {
    vi.spyOn(api, 'listRiders').mockResolvedValue([
      makeRider({ name: 'Ahmed', phone: '03001112222', note: 'Evenings only', isActive: true }),
    ]);
    render(<OwnerRiders businessId="biz-1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('03001112222')).toBeTruthy());
    expect(screen.getByText('Note: Evenings only')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('deactivate calls updateRider with isActive false', async () => {
    vi.spyOn(api, 'listRiders').mockResolvedValue([makeRider({ id: 'r-1' })]);
    const update = vi.spyOn(api, 'updateRider').mockResolvedValue(makeRider({ isActive: false }));
    render(<OwnerRiders businessId="biz-1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Deactivate')).toBeTruthy());
    fireEvent.click(screen.getByText('Deactivate'));
    await waitFor(() => expect(update).toHaveBeenCalledWith('biz-1', 'r-1', { isActive: false }));
  });
});

/* ---------------- orderNo ---------------- */

describe('orderNo', () => {
  it('produces a short uppercase id', () => {
    expect(orderNo(makeOrder({ id: 'abcdef12-3456-7890-abcd-ef1234567890' }))).toBe('#567890');
  });
});
