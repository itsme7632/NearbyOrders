// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as api from '../api.js';
import type { Product, Service } from '../api.js';
import { OwnerProducts, OwnerServices } from './OwnerCatalog.js';
import { BusinessSettingsScreen } from './OwnerDeliverySettings.js';
import { OwnerScreen } from './OwnerScreen.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  listOwnerServices: vi.fn(),
  listOwnerProducts: vi.fn(),
  updateService: vi.fn(),
  updateProduct: vi.fn(),
  getDeliverySettings: vi.fn(),
}));

const service = (patch: Partial<Service> = {}): Service => ({
  id: 'svc-1',
  name: 'Haircut',
  description: null,
  priceMinor: 50000,
  currency: 'PKR',
  durationMinutes: 30,
  isActive: true,
  ...patch,
});

const product = (patch: Partial<Product> = {}): Product => ({
  id: 'prod-1',
  name: 'Biryani',
  description: null,
  priceMinor: 45000,
  currency: 'PKR',
  imageUrl: null,
  isActive: true,
  ...patch,
});

describe('catalog item layouts (Worker B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listOwnerServices).mockResolvedValue([
      service({ id: 'svc-1', name: 'Haircut with a very long name that should wrap gracefully', isActive: true }),
      service({ id: 'svc-2', name: 'Shave', isActive: false }),
    ]);
    vi.mocked(api.listOwnerProducts).mockResolvedValue([
      product({ id: 'prod-1', name: 'Chicken Biryani Family Pack with Extra Raita and Salad', isActive: true }),
    ]);
  });

  it('service rows put toggle + Edit + Delete on one controls row', async () => {
    const { container } = render(<OwnerServices businessId="biz-1" />);
    await screen.findByText(/Haircut with a very long name/);
    const items = Array.from(container.querySelectorAll('.manage-item'));
    expect(items.length).toBe(2);
    for (const item of items) {
      const controls = item.querySelector('.item-controls');
      expect(controls).toBeTruthy();
      expect(controls!.querySelector('input[type="checkbox"]')).toBeTruthy();
      const names = Array.from(controls!.querySelectorAll('button'), (b) => b.textContent);
      expect(names).toContain('Edit');
      expect(names).toContain('Delete');
      // Edit/Delete stay grouped so they never collide with the toggle.
      expect(controls!.querySelector('.item-controls-actions')).toBeTruthy();
    }
    // Name wraps, price stays right-aligned on the top row.
    const topRow = items[0].querySelector('.item-row');
    expect(topRow!.querySelector('.item-name')).toBeTruthy();
    expect(topRow!.querySelector('.money')).toBeTruthy();
  });

  it('service meta pills render on their own wrapping row', async () => {
    const { container } = render(<OwnerServices businessId="biz-1" />);
    await screen.findByText(/Haircut with a very long name/);
    const meta = container.querySelector('.manage-item .item-meta');
    expect(meta).toBeTruthy();
    expect(meta!.textContent).toContain('30 min');
  });

  it('product rows use the same controls row treatment', async () => {
    const { container } = render(<OwnerProducts businessId="biz-1" />);
    await screen.findByText(/Chicken Biryani Family Pack/);
    const item = container.querySelector('.manage-item');
    const controls = item!.querySelector('.item-controls');
    expect(controls).toBeTruthy();
    expect(controls!.querySelector('input[type="checkbox"]')).toBeTruthy();
    const names = Array.from(controls!.querySelectorAll('button')).map((b) => b.textContent);
    expect(names).toContain('Edit');
    expect(names).toContain('Delete');
  });
});

describe('BusinessSettingsScreen (settings IA)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDeliverySettings).mockResolvedValue({ deliveryEnabled: false, codEnabled: false, deliveryFeeMinor: 0 });
  });

  it('hosts the delivery section and links to the other configuration areas', async () => {
    const onOpen = vi.fn();
    render(<BusinessSettingsScreen businessId="biz-1" onOpen={onOpen} />);
    // Delivery section present; the switch keeps its accessible name.
    expect(await screen.findByRole('checkbox', { name: /offer delivery/i })).toBeTruthy();
    expect(screen.getByText('More settings')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /business payment methods/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/payment-methods');
    fireEvent.click(screen.getByRole('button', { name: /customer payments/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/payments');
    fireEvent.click(screen.getByRole('button', { name: /service advance settings/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/advances');
  });

  it("OwnerScreen 'settings' renders the settings screen; 'delivery' stays the focused screen", async () => {
    render(<OwnerScreen screen="settings" businessId="biz-1" onBack={() => {}} onOpenBooking={() => {}} onOpen={() => {}} />);
    expect(await screen.findByText('More settings')).toBeTruthy();
    cleanup();

    render(<OwnerScreen screen="delivery" businessId="biz-1" onBack={() => {}} onOpenBooking={() => {}} />);
    await screen.findByRole('checkbox', { name: /offer delivery/i });
    expect(screen.queryByText('More settings')).toBeNull();
    cleanup();

    // Without a router, the settings route degrades to the delivery section alone.
    render(<OwnerScreen screen="settings" businessId="biz-1" onBack={() => {}} onOpenBooking={() => {}} />);
    await screen.findByRole('checkbox', { name: /offer delivery/i });
    expect(screen.queryByText('More settings')).toBeNull();
  });
});
