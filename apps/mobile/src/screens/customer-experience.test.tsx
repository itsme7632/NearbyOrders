// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import type { CustomerAddress, FavoriteEntry, MyReview } from '../api.js';
import { ToastProvider } from '../components/primitives.js';
import {
  SavedBusinessesScreen,
  MyReviewsScreen,
  AddressesScreen,
  HelpScreen,
  TermsScreen,
  PrivacyScreen,
  AboutScreen,
} from './customer-experience.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  listFavorites: vi.fn(),
  saveFavorite: vi.fn(),
  unsaveFavorite: vi.fn(),
  getFavoriteState: vi.fn(),
  listAddresses: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  listMyReviews: vi.fn(),
}));

// The address form's pin section uses the real map; mock the picker with a
// tappable stand-in so these tests exercise the form wiring, not Leaflet.
vi.mock('../components/PinDropPicker.js', () => ({
  PinDropPicker: (props: {
    value: { latitude: number; longitude: number } | null;
    onChange: (v: { latitude: number; longitude: number } | null) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-pin-picker"
      onClick={() => props.onChange({ latitude: 31.5, longitude: 74.3 })}
    >
      mock-pin-picker
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const favEntry = (id: string, name: string): FavoriteEntry => ({
  business: {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    imageUrl: null,
    city: 'Lahore',
    address: '1 Test Street',
    isVerified: true,
    averageRating: 4.5,
    reviewCount: 12,
  },
  savedAt: new Date('2026-09-01T10:00:00Z').toISOString(),
});

describe('SavedBusinessesScreen', () => {
  // Phase 2F: unsave feedback comes from useToast, which needs the provider.
  const renderSaved = () =>
    render(
      <ToastProvider>
        <SavedBusinessesScreen onBack={() => {}} onOpenBusiness={() => {}} />
      </ToastProvider>,
    );

  it('shows an honest empty state when nothing is saved', async () => {
    vi.mocked(api.listFavorites).mockResolvedValue([]);
    renderSaved();
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(api.listFavorites).toHaveBeenCalledTimes(1);
  });

  it('lists saved businesses with the shared BusinessRow treatment and opens them', async () => {
    vi.mocked(api.listFavorites).mockResolvedValue([favEntry('b1', 'Butt Spices'), favEntry('b2', 'Glow Salon')]);
    const open = vi.fn();
    render(
      <ToastProvider>
        <SavedBusinessesScreen onBack={() => {}} onOpenBusiness={open} />
      </ToastProvider>,
    );

    expect(await screen.findByText('Butt Spices')).toBeTruthy();
    expect(screen.getByText('Glow Salon')).toBeTruthy();
    // BusinessRow shows the shared rating chip (star glyph + average).
    expect(screen.getAllByLabelText('Rated 4.5 out of 5')).toHaveLength(2);

    fireEvent.click(screen.getByText('Butt Spices').closest('button')!);
    expect(open).toHaveBeenCalledWith('b1');
  });

  it('unsaves with a success toast and removes the row', async () => {
    vi.mocked(api.listFavorites)
      .mockResolvedValueOnce([favEntry('b1', 'Butt Spices'), favEntry('b2', 'Glow Salon')])
      .mockResolvedValueOnce([favEntry('b2', 'Glow Salon')]);
    vi.mocked(api.unsaveFavorite).mockResolvedValue({ saved: false });
    renderSaved();

    expect(await screen.findByText('Butt Spices')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove Butt Spices from saved/i }));
    await waitFor(() => expect(api.unsaveFavorite).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText('Removed from Saved')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Butt Spices')).toBeNull());
    expect(screen.getByText('Glow Salon')).toBeTruthy();
  });

  it('keeps the row and shows an error toast when unsave fails', async () => {
    vi.mocked(api.listFavorites).mockResolvedValue([favEntry('b1', 'Butt Spices')]);
    vi.mocked(api.unsaveFavorite).mockRejectedValue(new Error('network down'));
    renderSaved();

    expect(await screen.findByText('Butt Spices')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove Butt Spices from saved/i }));
    await waitFor(() => expect(api.unsaveFavorite).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText('Could not remove from Saved. Please try again.')).toBeTruthy();
    // The row stays so the user can retry.
    expect(screen.getByText('Butt Spices')).toBeTruthy();
  });
});

describe('MyReviewsScreen', () => {
  it('renders the empty state and review rows', async () => {
    vi.mocked(api.listMyReviews)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'r1',
          rating: 4,
          comment: 'Great chai',
          createdAt: new Date('2026-09-10T10:00:00Z').toISOString(),
          bookingId: null,
          orderId: 'o1',
          business: { id: 'b1', name: 'Butt Spices', slug: 'butt-spices' },
        } satisfies MyReview,
      ]);

    const { unmount } = render(<MyReviewsScreen onBack={() => {}} onOpenBusiness={() => {}} />);
    expect(await screen.findByText('No reviews yet')).toBeTruthy();
    unmount();

    render(<MyReviewsScreen onBack={() => {}} onOpenBusiness={() => {}} />);
    expect(await screen.findByText('Butt Spices')).toBeTruthy();
    expect(screen.getByText(/Great chai/)).toBeTruthy();
    expect(screen.getByText(/★★★★☆/)).toBeTruthy();
  });
});

const addr = (patch: Partial<CustomerAddress> = {}): CustomerAddress => ({
  id: patch.id ?? 'a1',
  label: patch.label ?? 'Home',
  recipientName: patch.recipientName ?? 'Ayesha Khan',
  phone: patch.phone ?? null,
  addressText: patch.addressText ?? 'House 12, Street 4, Gulberg III, Lahore',
  latitude: null,
  longitude: null,
  isDefault: patch.isDefault ?? false,
  createdAt: new Date('2026-09-01T10:00:00Z').toISOString(),
  ...patch,
});

describe('AddressesScreen', () => {
  it('creates an address through the form and shows the list after reload', async () => {
    vi.mocked(api.listAddresses).mockResolvedValue([]);
    vi.mocked(api.createAddress).mockResolvedValue(addr({ id: 'new' }));

    render(<AddressesScreen onBack={() => {}} />);
    fireEvent.click(await screen.findByText('Add an address'));

    fireEvent.change(screen.getByPlaceholderText('Home, Work…'), { target: { value: 'Work' } });
    fireEvent.change(screen.getByPlaceholderText('0300…'), { target: { value: '03001234567' } });
    fireEvent.change(screen.getByPlaceholderText('House, street, area, city'), {
      target: { value: 'Office 5, Main Boulevard, Lahore' },
    });
    // recipientName inputs have no placeholder — grab by label text.
    const recipient = screen.getAllByLabelText(/Recipient name/i)[0] as HTMLInputElement;
    fireEvent.change(recipient, { target: { value: 'Ayesha Khan' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() =>
      expect(api.createAddress).toHaveBeenCalledWith({
        label: 'Work',
        recipientName: 'Ayesha Khan',
        phone: '03001234567',
        addressText: 'Office 5, Main Boulevard, Lahore',
      }),
    );
  });

  it('shows saved addresses with default chip and supports set-default', async () => {
    vi.mocked(api.listAddresses).mockResolvedValue([
      addr({ id: 'a1', label: 'Home', isDefault: true }),
      addr({ id: 'a2', label: 'Work', isDefault: false, addressText: 'Office 5, Main Boulevard, Lahore' }),
    ]);
    vi.mocked(api.updateAddress).mockResolvedValue(addr({ id: 'a2', isDefault: true }));

    render(<AddressesScreen onBack={() => {}} />);
    expect(await screen.findByText('Home')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('House 12, Street 4, Gulberg III, Lahore')).toBeTruthy();
    expect(screen.getByText('Office 5, Main Boulevard, Lahore')).toBeTruthy();

    // Work's "Set default" calls the API with isDefault.
    const setDefaultButtons = screen.getAllByText('Set default');
    expect(setDefaultButtons).toHaveLength(1);
    fireEvent.click(setDefaultButtons[0]);
    await waitFor(() => expect(api.updateAddress).toHaveBeenCalledWith('a2', { isDefault: true }));
  });

  it('deletes an address after confirmation-less explicit tap', async () => {
    vi.mocked(api.listAddresses).mockResolvedValue([addr({ id: 'a1' })]);
    vi.mocked(api.deleteAddress).mockResolvedValue({ deleted: true });

    render(<AddressesScreen onBack={() => {}} />);
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(api.deleteAddress).toHaveBeenCalledWith('a1'));
  });

  it('shows the pin hint on address cards that have coordinates', async () => {
    vi.mocked(api.listAddresses).mockResolvedValue([
      addr({ id: 'a1', latitude: 31.5, longitude: 74.3 }),
      addr({ id: 'a2', label: 'Work' }),
    ]);
    render(<AddressesScreen onBack={() => {}} />);
    expect(await screen.findByText('Home')).toBeTruthy();
    expect(screen.getAllByText(/map pin set/i)).toHaveLength(1);
  });

  it('create form offers an optional pin and sends coordinates only when placed', async () => {
    vi.mocked(api.listAddresses).mockResolvedValue([]);
    vi.mocked(api.createAddress).mockResolvedValue(addr({ id: 'new' }));

    render(<AddressesScreen onBack={() => {}} />);
    fireEvent.click(await screen.findByText('Add an address'));

    // The pin section is collapsed by default and never invents coordinates.
    expect(screen.queryByTestId('mock-pin-picker')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /pin on map/i }));
    fireEvent.click(screen.getByTestId('mock-pin-picker'));

    fireEvent.change(screen.getByPlaceholderText('Home, Work…'), { target: { value: 'Home' } });
    fireEvent.change(screen.getByPlaceholderText('House, street, area, city'), {
      target: { value: 'House 12, Street 4, Gulberg III, Lahore' },
    });
    const recipient = screen.getAllByLabelText(/Recipient name/i)[0] as HTMLInputElement;
    fireEvent.change(recipient, { target: { value: 'Ayesha Khan' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() =>
      expect(api.createAddress).toHaveBeenCalledWith({
        label: 'Home',
        recipientName: 'Ayesha Khan',
        phone: null,
        addressText: 'House 12, Street 4, Gulberg III, Lahore',
        coordinates: { latitude: 31.5, longitude: 74.3 },
      }),
    );
  });

  it('editing an address without touching the pin keeps its coordinates', async () => {
    vi.mocked(api.listAddresses).mockResolvedValue([addr({ id: 'a1', latitude: 31.5, longitude: 74.3 })]);
    vi.mocked(api.updateAddress).mockResolvedValue(addr({ id: 'a1' }));

    render(<AddressesScreen onBack={() => {}} />);
    fireEvent.click(await screen.findByText('Edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(api.updateAddress).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ coordinates: { latitude: 31.5, longitude: 74.3 } }),
      ),
    );
  });
});

describe('info pages', () => {
  it('renders the current support and legal pages', () => {
    const { unmount: u1 } = render(<HelpScreen onBack={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Help & support' })).toBeTruthy();
    expect(screen.getByText(/Orders/)).toBeTruthy();
    expect(screen.getByText(/info@nearbyorders\.com/)).toBeTruthy();
    u1();

    const { unmount: u2 } = render(<TermsScreen onBack={() => {}} />);
    expect(screen.getByText(/1\. About NearbyOrders/)).toBeTruthy();
    expect(screen.getByText(/Refunds and cancellations/)).toBeTruthy();
    u2();

    const { unmount: u3 } = render(<PrivacyScreen onBack={() => {}} />);
    expect(screen.getByText(/1\. Information you provide/)).toBeTruthy();
    expect(screen.getByText(/Account deletion/)).toBeTruthy();
    u3();

    const { unmount: u4 } = render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('Find nearby. Book or order.')).toBeTruthy();
    expect(screen.getByText(/Local commerce, built for real neighborhoods/)).toBeTruthy();
    u4();
  });
});
