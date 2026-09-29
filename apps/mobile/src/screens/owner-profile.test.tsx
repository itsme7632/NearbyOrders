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
  latitude: null,
  longitude: null,
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

describe('pending image pick uploads through the registered provider (P1)', () => {
  const pickState = (file: File): ImageUploaderState => ({
    pending: { file, previewUrl: null, name: file.name, bytes: file.size, type: file.type },
    removeSaved: false,
  });

  it('registers a real image storage provider for the business on mount', async () => {
    const { getImageStorageProvider, setImageStorageProvider } = await import('../upload.js');
    setImageStorageProvider(null);
    renderProfile();
    await waitFor(() => expect(getImageStorageProvider()).not.toBeNull());
    expect(getImageStorageProvider()?.name).toBe('NearbyOrders API image storage');
    setImageStorageProvider(null);
  });

  it('uploads a pending pick first, then saves the returned URL', async () => {
    const { setImageStorageProvider } = await import('../upload.js');
    renderProfile();
    // Swap the real provider for a controlled mock AFTER mount (the screen
    // registers the real one in an effect).
    const upload = vi.fn().mockResolvedValue({ url: '/api/v1/images/uploads/abc123.png' });
    setImageStorageProvider({ name: 'test', upload });
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    const uploader = screen.getByLabelText('Business logo', { selector: 'input' });
    fireEvent.change(uploader, { target: { files: [file] } });

    // Save is available with a pending pick now that storage is connected.
    const save = screen.getByText('Save profile') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ file }));
    await waitFor(() => expect(api.updateBusiness).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.updateBusiness).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.imageUrl).toBe('/api/v1/images/uploads/abc123.png');
    expect(pickState(file).pending?.name).toBe('logo.png');
    setImageStorageProvider(null);
  });

  it('a failed upload aborts the save and never touches the stored image', async () => {
    const { setImageStorageProvider } = await import('../upload.js');
    renderProfile();
    setImageStorageProvider({ name: 'test', upload: vi.fn().mockRejectedValue(new Error('network down')) });
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Business logo', { selector: 'input' }), { target: { files: [file] } });
    fireEvent.click(screen.getByText('Save profile'));

    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
    expect(api.updateBusiness).not.toHaveBeenCalled();
    setImageStorageProvider(null);
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

describe('business-switch image isolation (wrong-image-after-save regression)', () => {
  const businessB: Business = {
    ...baseBusiness,
    id: 'biz-2',
    name: 'Second Business',
    slug: 'second-business',
    imageUrl: '/api/v1/images/uploads/bbb222.png',
  };

  it('clears a pending image pick when switching businesses', async () => {
    const { setImageStorageProvider } = await import('../upload.js');
    const { rerender } = render(<OwnerProfile business={baseBusiness} onSaved={() => {}} />);
    // Swap the real provider for a controlled mock AFTER mount.
    const upload = vi.fn().mockResolvedValue({ url: '/api/v1/images/uploads/aaa111.png' });
    setImageStorageProvider({ name: 'test', upload });

    // Pick an image while editing Business A.
    const fileA = new File(['a'], 'a-logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Business logo', { selector: 'input' }), {
      target: { files: [fileA] },
    });
    // The pick is pending (uploader reports it via onChange).
    await waitFor(() => expect(screen.getByText('Save profile')).toBeTruthy());

    // Switch to Business B without saving: the component receives a new
    // business prop but does not remount (no key on OwnerProfile).
    rerender(<OwnerProfile business={businessB} onSaved={() => {}} />);

    // Save Business B. The stale pending pick from A must NOT be uploaded
    // or saved to B.
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(api.updateBusiness).toHaveBeenCalled());

    // updateBusiness must have been called for Business B...
    const calls = vi.mocked(api.updateBusiness).mock.calls;
    const bCall = calls.find(([id]) => id === 'biz-2');
    expect(bCall).toBeTruthy();
    // ...without the imageUrl from Business A's pending pick.
    const payload = bCall?.[1] as Record<string, unknown>;
    expect(payload.imageUrl).toBeUndefined();
    // The upload must not have been called for Business A's file.
    expect(upload).not.toHaveBeenCalled();
    setImageStorageProvider(null);
  });

  it('clears a remove-saved-image flag when switching businesses', async () => {
    const { rerender } = render(<OwnerProfile business={businessB} onSaved={() => {}} />);
    // Mark Business B's saved image for removal (via the uploader's remove button).
    // The uploader remounts on business switch, but the parent flag must reset too.
    rerender(<OwnerProfile business={baseBusiness} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(api.updateBusiness).toHaveBeenCalled());
    const calls = vi.mocked(api.updateBusiness).mock.calls;
    const aCall = calls.find(([id]) => id === 'biz-1');
    expect(aCall).toBeTruthy();
    // Business A has no image; the remove flag from B must not clear A's (null) image
    // or otherwise leak — the payload must not contain imageUrl at all.
    const payload = aCall?.[1] as Record<string, unknown>;
    expect(payload.imageUrl).toBeUndefined();
  });
});
