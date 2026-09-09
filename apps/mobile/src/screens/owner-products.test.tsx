import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerProducts, parsePriceToMinor, validateProductForm } from './OwnerDashboard.js';
import * as api from '../api.js';
import type { Product } from '../api.js';

afterEach(cleanup);

const product = (patch: Partial<Product> = {}): Product => ({
  id: 'prod-1',
  name: 'Chicken Biryani',
  description: 'Serves 1',
  priceMinor: 45000,
  currency: 'PKR',
  imageUrl: null,
  isActive: true,
  ...patch,
});

beforeEach(() => {
  vi.spyOn(api, 'listProducts').mockResolvedValue([product()]);
  vi.spyOn(api, 'updateProduct').mockResolvedValue(product());
  vi.spyOn(api, 'createProduct').mockResolvedValue(product());
  vi.spyOn(api, 'deleteProduct').mockResolvedValue(undefined);
});

describe('parsePriceToMinor (integer minor-unit money)', () => {
  it('accepts major-unit rupee strings and converts to integer minor units', () => {
    expect(parsePriceToMinor('450')).toBe(45000);
    expect(parsePriceToMinor('450.50')).toBe(45050);
    expect(parsePriceToMinor(' 1,250 ')).toBe(125000);
  });

  it('rejects invalid money instead of rounding silently', () => {
    expect(parsePriceToMinor('')).toBeNull();
    expect(parsePriceToMinor('abc')).toBeNull();
    expect(parsePriceToMinor('-5')).toBeNull();
    expect(parsePriceToMinor('0')).toBeNull();
    expect(parsePriceToMinor('450.999')).toBeNull(); // 3 decimals would be rounded
    expect(parsePriceToMinor('NaN')).toBeNull();
    expect(parsePriceToMinor('Infinity')).toBeNull();
    expect(parsePriceToMinor('1e12')).toBeNull();
  });
});

describe('validateProductForm', () => {
  it('requires a non-empty, sensible-length name', () => {
    expect(validateProductForm({ name: '   ', price: '450', description: '' }).name).toMatch(/required/);
    expect(validateProductForm({ name: 'B', price: '450', description: '' }).name).toMatch(/at least 2/);
    expect(validateProductForm({ name: `${'x'.repeat(121)}`, price: '450', description: '' }).name).toMatch(/at most 120/);
  });

  it('requires a valid price and caps description length', () => {
    expect(validateProductForm({ name: 'Biryani', price: '', description: '' }).price).toMatch(/valid price/);
    expect(validateProductForm({ name: 'Biryani', price: '-1', description: '' }).price).toMatch(/valid price/);
    expect(validateProductForm({ name: 'Biryani', price: '450', description: 'x'.repeat(1001) }).description).toMatch(/at most 1000/);
  });
});

describe('OwnerProducts', () => {
  it('shows the empty state when the business has no products', async () => {
    vi.spyOn(api, 'listProducts').mockResolvedValue([]);
    render(<OwnerProducts businessId="biz-1" />);

    expect(await screen.findByText('No products yet')).toBeTruthy();
    expect(screen.getByText(/Add your first product/)).toBeTruthy();
    expect(screen.getByText('+ Add product')).toBeTruthy();
  });

  it('lists products with price, availability, and an edit control', async () => {
    render(<OwnerProducts businessId="biz-1" />);

    expect(await screen.findByText('Chicken Biryani')).toBeTruthy();
    // Money formatting is locale-dependent (en-PK ICU); match on the value.
    expect(screen.getByText(/450/)).toBeTruthy();
    // Availability appears on the row badge (the toggle label also reads Available).
    expect(document.querySelector('.product-available')?.textContent).toBe('Available');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('renders a thumbnail placeholder, never an image-URL input', async () => {
    render(<OwnerProducts businessId="biz-1" />);

    await screen.findByText('Chicken Biryani');
    expect(screen.queryByLabelText(/image url/i)).toBeNull();
    expect(screen.queryByText(/image url/i)).toBeNull();
    // The add form offers a real upload affordance, not a URL field.
    fireEvent.click(screen.getByText('+ Add product'));
    expect(screen.getByText('Upload image')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/url/i)).toBeNull();
  });

  it('marks the row when a product is unavailable', async () => {
    vi.spyOn(api, 'listProducts').mockResolvedValue([product({ isActive: false })]);
    const { container } = render(<OwnerProducts businessId="biz-1" />);

    await screen.findByText('Chicken Biryani');
    // The badge (not the toggle label) carries the availability state.
    expect(container.querySelector('.product-unavailable')?.textContent).toBe('Unavailable');
  });

  it('sends integer priceMinor on edit save and surfaces field validation', async () => {
    render(<OwnerProducts businessId="biz-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByDisplayValue('Chicken Biryani');
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText(/Product name is required/)).toBeTruthy();
    expect(api.updateProduct).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Product name', { selector: 'input' }), {
      target: { value: 'Chicken Karahi' },
    });
    fireEvent.change(screen.getByLabelText('Price (PKR)', { selector: 'input' }), { target: { value: '1250' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(1));
    expect(api.updateProduct).toHaveBeenCalledWith('prod-1', expect.objectContaining({ priceMinor: 125000 }));
  });

  it('toggles availability via the API and reloads', async () => {
    render(<OwnerProducts businessId="biz-1" />);

    const toggle = await screen.findByRole('checkbox');
    fireEvent.click(toggle);

    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith('prod-1', { isActive: false }));
  });

  it('shows the friendly PRODUCT_IN_USE message instead of a raw failure', async () => {
    vi.spyOn(api, 'updateProduct').mockRejectedValue(
      new api.ApiError(409, 'PRODUCT_IN_USE', 'This product is part of an order and cannot be deleted. Disable it instead.'),
    );
    render(<OwnerProducts businessId="biz-1" />);

    const toggle = await screen.findByRole('checkbox');
    fireEvent.click(toggle);
    expect(await screen.findByText(/Disable it instead/)).toBeTruthy();
    expect(api.deleteProduct).not.toHaveBeenCalled();
  });

  it('requires confirmation before delete and calls the API', async () => {
    render(<OwnerProducts businessId="biz-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    // Nothing deleted before the explicit confirm.
    expect(api.deleteProduct).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this product?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(api.deleteProduct).toHaveBeenCalledWith('prod-1'));
  });

  it('surfaces the PRODUCT_IN_USE guidance when delete is refused', async () => {
    vi.spyOn(api, 'deleteProduct').mockRejectedValue(
      new api.ApiError(409, 'PRODUCT_IN_USE', 'This product is part of an order and cannot be deleted. Disable it instead.'),
    );
    render(<OwnerProducts businessId="biz-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(await screen.findByText(/Disable it instead/)).toBeTruthy();
  });

  it('blocks creating while a device pick is pending (no fake upload success)', async () => {
    render(<OwnerProducts businessId="biz-1" />);

    fireEvent.click(await screen.findByText('+ Add product'));
    const file = new File(['x'], 'dish.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Product image', { selector: 'input' }), { target: { files: [file] } });

    const create = screen.getByText('Create product') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByText(/Save is unavailable while a new photo is selected/i)).toBeTruthy();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it('renders the honest storage notice from the upload abstraction', async () => {
    render(<OwnerProducts businessId="biz-1" />);

    fireEvent.click(await screen.findByText('+ Add product'));
    expect(
      screen.getByText(/Image storage is not connected yet/i),
    ).toBeTruthy();
  });
});
