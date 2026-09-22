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
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
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

  it('fires a single update on a rapid save double-tap', async () => {
    vi.mocked(api.listOwnerServices).mockResolvedValue([service({ id: 'svc-1', name: 'Haircut', isActive: true })]);
    let resolveUpdate!: (v: Service | PromiseLike<Service>) => void;
    vi.mocked(api.updateService).mockImplementation(
      () => new Promise((res) => { resolveUpdate = res; }),
    );
    render(<OwnerServices businessId="biz-1" />);
    await screen.findByText('Haircut');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Second tap while the update is still in flight: the in-flight guard
    // must drop it even though the button was not yet disabled.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateService).toHaveBeenCalledTimes(1);

    resolveUpdate(service({ id: 'svc-1' }));
    await screen.findByText('Haircut'); // list reloaded after save
    expect(api.updateService).toHaveBeenCalledTimes(1);
  });

  it('creates exactly one service on a rapid create double-tap', async () => {
    vi.mocked(api.listOwnerServices).mockResolvedValue([]);
    let resolveCreate!: (v: Service | PromiseLike<Service>) => void;
    vi.mocked(api.createService).mockImplementation(
      () => new Promise((res) => { resolveCreate = res; }),
    );
    render(<OwnerServices businessId="biz-1" />);
    await screen.findByText('No services yet');

    fireEvent.click(screen.getByRole('button', { name: '+ Add service' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Manicure' } });
    fireEvent.change(screen.getByLabelText('Price (PKR)'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(api.createService).toHaveBeenCalledTimes(1);

    resolveCreate(service({ id: 'svc-3', name: 'Manicure' }));
    await screen.findByText('No services yet');
    expect(api.createService).toHaveBeenCalledTimes(1);
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
