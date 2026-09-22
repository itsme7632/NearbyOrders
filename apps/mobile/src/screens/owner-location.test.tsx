// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerLocation } from './OwnerLocation.js';
import * as api from '../api.js';
import type { Business, BusinessLocation } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusinessLocation: vi.fn(),
  updateBusinessLocation: vi.fn(),
  getMyBusinesses: vi.fn(),
}));

const business = (patch: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  description: null,
  imageUrl: null,
  isVerified: false,
  address: '12 Food Street',
  city: 'Karachi',
  locality: 'Saddar',
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
  ...patch,
});

const location = (patch: Partial<BusinessLocation> = {}): BusinessLocation => ({
  latitude: null,
  longitude: null,
  isConfigured: false,
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusinessLocation).mockResolvedValue(location());
  vi.mocked(api.getMyBusinesses).mockResolvedValue([business()]);
});

describe('OwnerLocation management (Phase 11)', () => {
  it('shows an honest not-configured state before the owner sets coordinates', async () => {
    render(<OwnerLocation businessId="biz-1" />);
    await screen.findByText(/set your exact business location/i);
    expect(screen.getByText(/drag the pin to your entrance/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear location/i })).toBeNull();
  });

  it('shows the configured state with a clear option when coordinates exist', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(location({ latitude: 31.5204, longitude: 74.3587, isConfigured: true }));
    render(<OwnerLocation businessId="biz-1" />);
    expect(await screen.findByText(/your location is set/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear location/i })).toBeInTheDocument();
  });

  it('hydrates saved coordinates into the inputs', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(location({ latitude: 31.5204, longitude: 74.3587, isConfigured: true }));
    render(<OwnerLocation businessId="biz-1" />);
    const lat = (await screen.findByLabelText('Latitude')) as HTMLInputElement;
    const lng = screen.getByLabelText('Longitude') as HTMLInputElement;
    await waitFor(() => {
      expect(lat.value).toBe('31.5204');
      expect(lng.value).toBe('74.3587');
    });
  });

  it('saves valid coordinates through the ownership-checked endpoint', async () => {
    vi.mocked(api.updateBusinessLocation).mockResolvedValue(location({ latitude: 24.86, longitude: 67.0011, isConfigured: true }));
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.change(await screen.findByLabelText('Latitude'), { target: { value: '24.86' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '67.0011' } });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));
    await screen.findByText(/location saved/i);
    expect(api.updateBusinessLocation).toHaveBeenCalledWith('biz-1', { latitude: 24.86, longitude: 67.0011 });
  });

  it('rejects an out-of-range latitude client-side without calling the API', async () => {
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.change(await screen.findByLabelText('Latitude'), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '67' } });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));
    await screen.findByText(/latitude must be between/i);
    expect(api.updateBusinessLocation).not.toHaveBeenCalled();
  });

  it('rejects non-numeric input', async () => {
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.change(await screen.findByLabelText('Latitude'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '67' } });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));
    await screen.findByText(/latitude must be a number/i);
    expect(api.updateBusinessLocation).not.toHaveBeenCalled();
  });

  it('requires both coordinates before saving', async () => {
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.change(await screen.findByLabelText('Latitude'), { target: { value: '24.86' } });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));
    await screen.findByText(/enter longitude/i);
    expect(api.updateBusinessLocation).not.toHaveBeenCalled();
  });

  it('clears the location (removing it from nearby distance results)', async () => {
    vi.mocked(api.getBusinessLocation).mockResolvedValue(location({ latitude: 31.5204, longitude: 74.3587, isConfigured: true }));
    vi.mocked(api.updateBusinessLocation).mockResolvedValue(location());
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /clear location/i }));
    await screen.findByText(/location cleared/i);
    expect(api.updateBusinessLocation).toHaveBeenCalledWith('biz-1', { latitude: null, longitude: null });
  });

  it('surfaces a save error from the API without fake success', async () => {
    vi.mocked(api.updateBusinessLocation).mockRejectedValue(new Error('You do not own this business.'));
    render(<OwnerLocation businessId="biz-1" />);
    fireEvent.change(await screen.findByLabelText('Latitude'), { target: { value: '24.86' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '67.0011' } });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));
    await screen.findByText(/you do not own this business/i);
    expect(screen.queryByText(/location saved/i)).toBeNull();
  });
});
