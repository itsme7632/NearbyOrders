import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerDashboardScreen } from './OwnerDashboard.js';
import { OwnerProfile } from './OwnerProfile.js';
import { validateHours } from './OwnerHours.js';
import * as api from '../api.js';
import type { Business, HourInput } from '../api.js';
import type { ImageUploaderState } from '../components/ImageUploader.js';

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
    const payload = vi.mocked(api.updateBusiness).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        name: 'Butt Spices',
        description: null,
        phone: null,
        email: null,
        locality: null,
        address: '12 Food Street',
        city: 'Karachi',
        categoryIds: ['cat-1'],
      }),
    );
    // Product-wide image rule: the profile no longer sends a URL value by
    // default (no user-facing image URL field exists; uploads are separate).
    expect(payload.imageUrl).toBeUndefined();
    expect(await screen.findByText('Saved ✓')).toBeTruthy();
  });

  it('persists removal of the saved image by sending imageUrl: null', async () => {
    const withImage = { ...baseBusiness, imageUrl: 'https://cdn.test/logo.png' };
    render(<OwnerProfile business={withImage} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText(/Image will be removed/)).toBeTruthy();

    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(api.updateBusiness).toHaveBeenCalledTimes(1));
    expect(api.updateBusiness).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ imageUrl: null }),
    );
  });

  it('shows no image-URL input anywhere in the profile form', () => {
    render(<OwnerProfile business={{ ...baseBusiness, imageUrl: 'https://cdn.test/logo.png' }} onSaved={() => {}} />);
    expect(screen.getByRole('button', { name: 'Change image' })).toBeTruthy();
    expect(screen.queryByText(/image URL/i)).toBeNull();
    expect(screen.queryByLabelText(/image url/i)).toBeNull();
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

describe('pending image pick blocks an un-storable save (no fake uploads)', () => {
  const pickState = (file: File): ImageUploaderState => ({
    pending: { file, previewUrl: null, name: file.name, bytes: file.size },
    removeSaved: false,
  });

  it('disables saving while a device pick is pending and explains why', () => {
    // jsdom cannot open the real file dialog; drive the input directly.
    render(<OwnerProfile business={baseBusiness} onSaved={() => {}} />);
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    const uploader = screen.getByLabelText('Business logo', { selector: 'input' });
    fireEvent.change(uploader, { target: { files: [file] } });

    const save = screen.getByText('Save profile') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/Save is unavailable while a new photo is selected/i)).toBeTruthy();
    expect(api.updateBusiness).not.toHaveBeenCalled();
    expect(pickState(file).pending?.name).toBe('logo.png');
  });

  it('rejects unsupported file types and oversized files', async () => {
    const { pickImageFile, IMAGE_MAX_BYTES } = await import('../upload.js');
    const rejectedType = pickImageFile(new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect('reason' in rejectedType && rejectedType.reason).toBe('Choose a JPG, PNG or WebP image.');
    const big = new File([new ArrayBuffer(IMAGE_MAX_BYTES + 1)], 'big.png', { type: 'image/png' });
    const rejectedSize = pickImageFile(big);
    expect('reason' in rejectedSize && rejectedSize.reason).toMatch(/5 MB or smaller/);
    const ok = pickImageFile(new File(['x'], 'ok.jpg', { type: 'image/jpeg' }));
    expect('file' in ok).toBe(true);
  });
});

describe('opening-hours client validation', () => {
  const day = (dayOfWeek: number, patch: Partial<HourInput> = {}): HourInput => ({
    dayOfWeek,
    isClosed: false,
    opensAt: '09:00',
    closesAt: '18:00',
    ...patch,
  });

  it('accepts a fully valid week and closed days', () => {
    const week: HourInput[] = [
      day(1),
      day(2),
      day(3),
      day(4),
      day(5),
      day(6, { closesAt: '23:00' }),
      day(0, { isClosed: true, opensAt: undefined, closesAt: undefined }),
    ];
    expect(validateHours(week)).toEqual({});
  });

  it('rejects closing before or equal to opening', () => {
    expect(validateHours([day(1, { opensAt: '18:00', closesAt: '09:00' })])).toEqual({
      1: 'Closing time must be after opening time.',
    });
    expect(validateHours([day(2, { opensAt: '10:00', closesAt: '10:00' })]))
      .toEqual({ 2: 'Closing time must be after opening time.' });
  });

  it('rejects missing or malformed times on open days', () => {
    expect(validateHours([day(3, { opensAt: undefined })])).toEqual({
      3: 'Set an opening and closing time for open days.',
    });
    expect(validateHours([day(4, { closesAt: '25:99' })])).toEqual({
      4: 'Set an opening and closing time for open days.',
    });
  });
});

describe('post-creation banner reflects the server status', () => {
  it.each([
    ['APPROVED', "It's now visible to customers."],
    ['PENDING', 'It will appear in customer search once approved.'],
  ])('shows the %s wording', async (status, expected) => {
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([{ ...baseBusiness, status }]);
    render(
      <OwnerDashboardScreen onBack={() => {}} onOpen={() => {}} justCreatedName="Butt Spices" justCreatedStatus={status} />,
    );
    // The banner only renders after the business list has loaded, so awaiting
    // its unique text avoids racing the loading spinner.
    const banner = await screen.findByText(/has been created\./, {}, { timeout: 5000 });
    expect(banner.textContent).toContain('Butt Spices');
    expect(banner.textContent).toContain(expected);
  });
});
