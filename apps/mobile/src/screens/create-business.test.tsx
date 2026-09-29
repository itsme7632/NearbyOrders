import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CreateBusinessScreen, validateBusinessForm } from './CreateBusiness.js';
import * as api from '../api.js';
import type { Category } from '../api.js';

afterEach(cleanup);

const categories: Category[] = [
  { id: 'cat-1', name: 'Beauty & Spa', slug: 'beauty-spa', isActive: true },
  { id: 'cat-2', name: 'Food & Dining', slug: 'food-dining', isActive: true },
  { id: 'cat-3', name: 'Hidden', slug: 'hidden', isActive: false },
];

beforeEach(() => {
  vi.spyOn(api, 'listCategories').mockResolvedValue(categories);
  vi.spyOn(api, 'getMyBusinessesWithEntitlement').mockResolvedValue({
    businesses: [],
    entitlement: { usedBusinesses: 0, maxBusinesses: 1, remainingBusinesses: 1 },
  });
  vi.spyOn(api, 'createBusiness').mockResolvedValue({
    id: 'biz-default',
    name: 'Default Business',
    slug: 'default-business',
    description: null,
    imageUrl: null,
    isVerified: false,
    address: '12 Food Street',
    city: 'Karachi',
    locality: null,
    latitude: null,
    longitude: null,
    phone: null,
    email: null,
    currency: 'PKR',
    categories: [],
  });
});

const fillValidForm = () => {
  fireEvent.change(screen.getByPlaceholderText('e.g. DHA Glow Salon'), { target: { value: 'Gulberg Grill' } });
  fireEvent.change(screen.getByDisplayValue('Choose a category…'), { target: { value: 'cat-1' } });
  fireEvent.change(screen.getByPlaceholderText('Street and building'), { target: { value: '12 Food Street' } });
  fireEvent.change(screen.getByPlaceholderText('e.g. Karachi'), { target: { value: 'Karachi' } });
};

describe('CreateBusinessScreen', () => {
  it('renders all fields with categories loaded', async () => {
    render(<CreateBusinessScreen onBack={() => {}} onCreated={() => {}} onUpgrade={() => {}} />);

    expect(await screen.findByText('Business name')).toBeTruthy();
    expect(screen.getByText('Category')).toBeTruthy();
    expect(screen.getByText('Phone')).toBeTruthy();
    expect(screen.getByText('Address')).toBeTruthy();
    expect(screen.getByText('City')).toBeTruthy();
    // Inactive categories are not offered at all.
    expect(screen.queryByRole('option', { name: 'Hidden' })).toBeNull();
  });

  it('blocks submission and shows validation errors for invalid input', async () => {
    render(<CreateBusinessScreen onBack={() => {}} onCreated={() => {}} onUpgrade={() => {}} />);

    fireEvent.click(await screen.findByText('Create business'));
    expect(await screen.findByText('Business name must be at least 2 characters.')).toBeTruthy();
    expect(screen.getByText('Choose the category that fits your business.')).toBeTruthy();
    expect(api.createBusiness).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone format but accepts Pakistani +92 numbers', async () => {
    render(<CreateBusinessScreen onBack={() => {}} onCreated={() => {}} onUpgrade={() => {}} />);
    await screen.findByText('Business name');

    fillValidForm();
    fireEvent.change(screen.getByPlaceholderText('+92 300 1234567'), { target: { value: 'not-a-phone' } });
    fireEvent.click(screen.getByText('Create business'));
    expect(await screen.findByText('Enter a valid phone number, e.g. +92 300 1234567.')).toBeTruthy();
    expect(api.createBusiness).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('+92 300 1234567'), { target: { value: '+92 300 1234567' } });
    fireEvent.click(screen.getByText('Create business'));
    await waitFor(() => expect(api.createBusiness).toHaveBeenCalled());
  });

  it('submits a valid form and calls onCreated with the new business', async () => {
    vi.spyOn(api, 'createBusiness').mockResolvedValue({
      id: 'biz-new',
      name: 'Gulberg Grill',
      slug: 'gulberg-grill',
      description: null,
      imageUrl: null,
      isVerified: false,
      address: '12 Food Street',
      city: 'Karachi',
      locality: null,
      phone: null,
      email: null,
      currency: 'PKR',
      categories: [categories[0]!],
    } as api.Business);
    const onCreated = vi.fn();
    render(<CreateBusinessScreen onBack={() => {}} onCreated={onCreated} onUpgrade={() => {}} />);

    await screen.findByText('Business name');
    fillValidForm();
    fireEvent.click(screen.getByText('Create business'));

    // Third argument is the server-returned status (mock has none → undefined).
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('biz-new', 'Gulberg Grill', undefined));
    expect(api.createBusiness).toHaveBeenCalledWith({
      name: 'Gulberg Grill',
      categoryIds: ['cat-1'],
      description: undefined,
      phone: undefined,
      address: '12 Food Street',
      city: 'Karachi',
    });
  });

  it('surfaces API errors and prevents double submission while saving', async () => {
    let resolve!: (v: api.Business) => void;
    vi.spyOn(api, 'createBusiness').mockImplementation(
      () => new Promise<api.Business>((res) => (resolve = res)),
    );
    render(<CreateBusinessScreen onBack={() => {}} onCreated={() => {}} onUpgrade={() => {}} />);

    await screen.findByText('Business name');
    fillValidForm();
    fireEvent.click(screen.getByText('Create business'));
    expect(await screen.findByText('Creating…')).toBeTruthy();

    // Second click while saving is a no-op.
    fireEvent.click(screen.getByText('Creating…'));
    expect(api.createBusiness).toHaveBeenCalledTimes(1);

    resolve({
      id: 'biz-new',
      name: 'Gulberg Grill',
      slug: 'gulberg-grill',
      description: null,
      imageUrl: null,
      isVerified: false,
      address: '12 Food Street',
      city: 'Karachi',
      locality: null,
      latitude: null,
      longitude: null,
      phone: null,
      email: null,
      currency: 'PKR',
      categories: [],
    });
  });

  it('maps a 403 API response to a friendly message', async () => {
    vi.spyOn(api, 'createBusiness').mockRejectedValue(new api.ApiError(403, 'FORBIDDEN', 'Insufficient permissions'));
    render(<CreateBusinessScreen onBack={() => {}} onCreated={() => {}} onUpgrade={() => {}} />);

    await screen.findByText('Business name');
    fillValidForm();
    fireEvent.click(screen.getByText('Create business'));

    expect(await screen.findByText('Only business accounts can list a business.')).toBeTruthy();
  });

  it('shows the limit notice (no form) when the plan has no remaining slots', async () => {
    vi.spyOn(api, 'getMyBusinessesWithEntitlement').mockResolvedValue({
      businesses: [],
      entitlement: { usedBusinesses: 3, maxBusinesses: 3, remainingBusinesses: 0 },
    });
    const onUpgrade = vi.fn();
    render(<CreateBusinessScreen onBack={() => {}} onCreated={() => {}} onUpgrade={onUpgrade} />);

    expect(await screen.findByText('Business limit reached')).toBeTruthy();
    expect(screen.getByText(/you are using 3 of 3/i)).toBeTruthy();
    // The form is replaced, not just disabled.
    expect(screen.queryByText('Create business')).toBeNull();
    expect(api.createBusiness).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Upgrade plan'));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('does not show an upgrade option when a slot is available', async () => {
    render(<CreateBusinessScreen onBack={() => {}} onCreated={() => {}} onUpgrade={() => {}} />);

    await screen.findByText('Business name');
    expect(screen.queryByText('Business limit reached')).toBeNull();
    expect(screen.queryByText('Upgrade plan')).toBeNull();
  });

  it('handles BUSINESS_LIMIT_REACHED from the server even when the UI believed a slot was free', async () => {
    // Entitlement read says one slot remains…
    vi.spyOn(api, 'getMyBusinessesWithEntitlement').mockResolvedValue({
      businesses: [],
      entitlement: { usedBusinesses: 2, maxBusinesses: 3, remainingBusinesses: 1 },
    });
    // …but the server rejects with the authoritative numbers.
    vi.spyOn(api, 'createBusiness').mockRejectedValue(
      new api.ApiError(403, 'BUSINESS_LIMIT_REACHED', 'limit', { maxBusinesses: 3, used: 3 }),
    );
    render(<CreateBusinessScreen onBack={() => {}} onCreated={() => {}} onUpgrade={() => {}} />);

    await screen.findByText('Business name');
    fillValidForm();
    fireEvent.click(screen.getByText('Create business'));

    // The server numbers win over the stale entitlement read.
    expect(await screen.findByText('Business limit reached')).toBeTruthy();
    expect(screen.getByText(/you are using 3 of 3/i)).toBeTruthy();
    expect(screen.getByText('Upgrade plan')).toBeTruthy();
  });
});

describe('validateBusinessForm', () => {
  const valid = { name: 'Gulberg Grill', ownerName: '', categoryId: 'cat-1', description: '', phone: '', address: '12 Food Street', city: 'Karachi' };

  it('accepts a valid form with no errors', () => {
    expect(validateBusinessForm(valid)).toEqual({});
  });

  it('accepts an optional owner name', () => {
    expect(validateBusinessForm({ ...valid, ownerName: 'Muhammad Butt' })).toEqual({});
  });

  it('flags a too-short owner name', () => {
    expect(validateBusinessForm({ ...valid, ownerName: 'X' })).toEqual({ ownerName: 'Enter your full name.' });
  });

  it('flags each invalid field', () => {
    const errors = validateBusinessForm({ ...valid, name: 'G', categoryId: '', address: 'x', city: '', phone: 'abc', description: 'x'.repeat(2001) });
    expect(Object.keys(errors).sort()).toEqual(['address', 'categoryId', 'city', 'description', 'name', 'phone']);
  });
});
