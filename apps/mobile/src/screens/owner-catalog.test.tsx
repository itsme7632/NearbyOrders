// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as api from '../api.js';
import type { Product, Service } from '../api.js';
import { OwnerProducts, OwnerServices } from './OwnerCatalog.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  listOwnerServices: vi.fn(),
  listOwnerProducts: vi.fn(),
  updateProduct: vi.fn(),
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

describe('OwnerServices catalog UX (Phase 3F)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listOwnerServices).mockResolvedValue([
      service({ id: 'svc-1', name: 'Haircut', isActive: true }),
      service({ id: 'svc-2', name: 'Shave', isActive: false }),
    ]);
  });

  it('shows a count and filters by active status', async () => {
    render(<OwnerServices businessId="biz-1" />);
    expect(await screen.findByText('Haircut')).toBeTruthy();
    expect(screen.getByText('· 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    expect(screen.queryByText('Haircut')).toBeNull();
    expect(screen.getByText('Shave')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Haircut')).toBeTruthy();
    expect(screen.getByText('Shave')).toBeTruthy();
  });

  it('shows an honest empty state when the filter matches nothing', async () => {
    vi.mocked(api.listOwnerServices).mockResolvedValue([
      service({ id: 'svc-1', name: 'Haircut', isActive: true }),
      service({ id: 'svc-2', name: 'Trim', isActive: true }),
    ]);
    render(<OwnerServices businessId="biz-1" />);
    await screen.findByText('Haircut');

    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    expect(screen.getByText('No inactive services')).toBeTruthy();
    expect(screen.queryByText('Haircut')).toBeNull();
  });
});

describe('OwnerProducts catalog UX (Phase 3F)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listOwnerProducts).mockResolvedValue([
      product({ id: 'prod-1', name: 'Biryani', isActive: true }),
      product({ id: 'prod-2', name: 'Kebab', isActive: false }),
    ]);
  });

  it('shows a count and filters by availability', async () => {
    render(<OwnerProducts businessId="biz-1" />);
    expect(await screen.findByText('Biryani')).toBeTruthy();
    expect(screen.getByText('· 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unavailable' }));
    expect(screen.queryByText('Biryani')).toBeNull();
    expect(screen.getByText('Kebab')).toBeTruthy();
  });

  it('surfaces toggle failures instead of swallowing them', async () => {
    vi.mocked(api.listOwnerProducts).mockResolvedValue([product({ isActive: true })]);
    vi.mocked(api.updateProduct).mockRejectedValue(new Error('Network down'));
    render(<OwnerProducts businessId="biz-1" />);
    await screen.findByText('Biryani');
    // Toggle is a labeled checkbox; flip it off and the failure must be visible.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Available' }));
    expect(await screen.findByText('Network down')).toBeTruthy();
  });
});
