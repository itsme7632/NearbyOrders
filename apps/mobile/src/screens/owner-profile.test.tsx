import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerDashboardScreen, OwnerProfile } from './OwnerDashboard.js';
import * as api from '../api.js';
import type { Business } from '../api.js';

afterEach(cleanup);

const baseBusiness: Business = {
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  status: 'PENDING',
  description: null,
  imageUrl: null,
  isVerified: false,
  address: '12 Food Street',
  city: 'Karachi',
  locality: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [{ id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true }],
};

beforeEach(() => {
  vi.spyOn(api, 'listCategories').mockResolvedValue([
    { id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true },
    { id: 'cat-2', name: 'Beauty & Salon', slug: 'beauty-salon', isActive: true },
  ]);
  vi.spyOn(api, 'updateBusiness').mockResolvedValue({ ...baseBusiness, name: 'Butt Spices Updated' });
});

const renderProfile = () =>
  render(<OwnerProfile business={baseBusiness} onSaved={() => {}} />);

describe('OwnerProfile save contract', () => {
  it('sends trimmed required fields and null for cleared optional fields', async () => {
    renderProfile();
    fireEvent.change(screen.getByDisplayValue('Butt Spices'), { target: { value: '  Butt Spices  ' } });
    fireEvent.click(screen.getByText('Save profile'));

    await waitFor(() => expect(api.updateBusiness).toHaveBeenCalledTimes(1));
    expect(api.updateBusiness).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        name: 'Butt Spices',
        description: null,
        phone: null,
        email: null,
        locality: null,
        imageUrl: null,
        address: '12 Food Street',
        city: 'Karachi',
        categoryIds: ['cat-1'],
      }),
    );
    expect(await screen.findByText('Saved ✓')).toBeTruthy();
  });

  it('blocks invalid input locally with field-specific messages and does not call the API', async () => {
    renderProfile();
    fireEvent.change(screen.getByDisplayValue('Butt Spices'), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('Save profile'));

    expect(await screen.findByText(/Business name must be at least 2 characters/)).toBeTruthy();
    expect(api.updateBusiness).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone locally before any request', async () => {
    renderProfile();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: 'not-a-phone' } });
    fireEvent.click(screen.getByText('Save profile'));

    expect(await screen.findByText(/valid phone number/)).toBeTruthy();
    expect(api.updateBusiness).not.toHaveBeenCalled();
  });

  it('rejects an invalid email locally before any request', async () => {
    renderProfile();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByText('Save profile'));

    expect(await screen.findByText(/valid email/)).toBeTruthy();
    expect(api.updateBusiness).not.toHaveBeenCalled();
  });

  it('sends a filled optional value instead of null when provided', async () => {
    renderProfile();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: ' +92 300 1234567 ' } });
    fireEvent.click(screen.getByText('Save profile'));

    await waitFor(() => expect(api.updateBusiness).toHaveBeenCalledTimes(1));
    expect(api.updateBusiness).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ phone: '+92 300 1234567' }),
    );
  });

  it('prevents duplicate submission while saving', async () => {
    let resolve!: (v: Business) => void;
    vi.spyOn(api, 'updateBusiness').mockImplementation(() => new Promise<Business>((res) => (resolve = res)));
    renderProfile();
    fireEvent.click(screen.getByText('Save profile'));
    expect(await screen.findByText('Saving…', {}, { timeout: 5000 })).toBeTruthy();

    fireEvent.click(screen.getByText('Saving…'));
    expect(api.updateBusiness).toHaveBeenCalledTimes(1);

    resolve(baseBusiness);
    await waitFor(() => expect(screen.getByText('Saved ✓')).toBeTruthy());
  });

  it('surfaces the server error message when the API rejects the save', async () => {
    vi.spyOn(api, 'updateBusiness').mockRejectedValue(
      new api.ApiError(400, 'VALIDATION_ERROR', 'email: Invalid email'),
    );
    renderProfile();
    fireEvent.click(screen.getByText('Save profile'));

    expect(await screen.findByText(/email: Invalid email/)).toBeTruthy();
  });
});

describe('post-creation banner reflects the server status', () => {
  it.each([
    ['APPROVED', "It's now visible to customers."],
    ['PENDING', 'It will appear in customer search once approved.'],
  ])('shows the %s wording', async (status, expected) => {
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([{ ...baseBusiness, status }]);
    render(
      <OwnerDashboardScreen onBack={() => {}} justCreatedName="Butt Spices" justCreatedStatus={status} />,
    );
    // Wait for the dashboard to finish loading before reading the banner.
    // Locate by the banner's unique text: a loading spinner also uses
    // role="status" and mounts/unmounts racily under load.
    await screen.findByRole('heading', { name: 'Butt Spices' }, { timeout: 5000 });
    const banner = await screen.findByText(/has been created\./, {}, { timeout: 5000 });
    expect(banner.textContent).toContain('Butt Spices');
    expect(banner.textContent).toContain(expected);
  });
});
