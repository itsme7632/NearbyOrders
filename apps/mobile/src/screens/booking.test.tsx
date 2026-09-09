import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BookServiceScreen } from './BookService.js';
import { BookingsScreen, BookingDetailScreen } from './Bookings.js';
import * as api from '../api.js';
import type { Availability, Booking, Business, Service } from '../api.js';

afterEach(cleanup);

const service: Service = {
  id: 'svc-1',
  name: 'Hair Consultation',
  description: 'Quick 30 minute consultation',
  priceMinor: 250000,
  currency: 'PKR',
  durationMinutes: 30,
  isActive: true,
};

const inactiveService: Service = { ...service, id: 'svc-2', name: 'Disabled Service', isActive: false };

const business: Business = {
  id: 'biz-1',
  name: 'DHA Glow Salon',
  slug: 'dha-glow-salon',
  description: null,
  imageUrl: null,
  isVerified: true,
  address: '12 Test Avenue',
  city: 'Lahore',
  locality: 'DHA Phase 5',
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
  services: [service, inactiveService],
  products: [],
};

const availability: Availability = {
  date: '2026-09-10',
  serviceDurationMinutes: 30,
  businessHours: { open: '09:00', close: '21:00' },
  closed: false,
  slots: [
    { start: '09:00', end: '09:30', available: true },
    { start: '09:30', end: '10:00', available: false },
    { start: '10:00', end: '10:30', available: true },
  ],
};

const createdBooking: Booking = {
  id: 'bk-1',
  businessId: 'biz-1',
  businessName: 'DHA Glow Salon',
  businessSlug: 'dha-glow-salon',
  serviceId: 'svc-1',
  serviceName: 'Hair Consultation',
  priceMinor: 250000,
  currency: 'PKR',
  bookingDate: '2026-09-10',
  startTime: '09:00',
  endTime: '09:30',
  status: 'PENDING',
  notes: null,
  createdAt: '2026-09-09T10:00:00.000Z',
};

function mockBusiness(overrides: Partial<Business> = {}) {
  vi.spyOn(api, 'getBusiness').mockResolvedValue({ ...business, ...overrides });
}

beforeEach(() => {
  vi.spyOn(api, 'getAvailability').mockResolvedValue(availability);
  vi.spyOn(api, 'createBooking').mockResolvedValue(createdBooking);
  vi.spyOn(api, 'listMyBookings').mockResolvedValue([createdBooking]);
  vi.spyOn(api, 'getBooking').mockResolvedValue(createdBooking);
  vi.spyOn(api, 'cancelMyBooking').mockResolvedValue({ ...createdBooking, status: 'CANCELLED' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BookServiceScreen', () => {
  it('renders service selection and blocks inactive services', async () => {
    mockBusiness();
    const onBook = vi.fn();
    render(<BookServiceScreen businessId="biz-1" onBack={() => {}} onDone={onBook} />);

    await screen.findByText('Hair Consultation');
    const disabled = screen.getByText('Disabled Service').closest('button')!;
    expect(disabled).toBeDisabled();
    // No availability request before a service is chosen.
    expect(api.getAvailability).not.toHaveBeenCalled();
  });

  it('selects a service, shows backend slots, and skips taken ones', async () => {
    mockBusiness();
    render(<BookServiceScreen businessId="biz-1" onBack={() => {}} onDone={() => {}} />);

    fireEvent.click(await screen.findByText('Hair Consultation'));
    await waitFor(() => expect(api.getAvailability).toHaveBeenCalledWith('biz-1', 'svc-1', expect.any(String)));

    const taken = await screen.findByText('9:30 AM');
    expect(taken).toBeDisabled();
    expect(screen.getByText('9:00 AM')).toBeEnabled();
    expect(screen.getByText('10:00 AM')).toBeEnabled();
  });

  it('shows a friendly closed-day message', async () => {
    mockBusiness();
    vi.spyOn(api, 'getAvailability').mockResolvedValue({ ...availability, closed: true, slots: [] });
    render(<BookServiceScreen businessId="biz-1" preselectedServiceId="svc-1" onBack={() => {}} onDone={() => {}} />);

    expect(await screen.findByText('Closed on this day')).toBeTruthy();
  });

  it('shows the fully-booked state when no slots are available', async () => {
    mockBusiness();
    vi.spyOn(api, 'getAvailability').mockResolvedValue({
      ...availability,
      slots: availability.slots.map((s) => ({ ...s, available: false })),
    });
    render(<BookServiceScreen businessId="biz-1" preselectedServiceId="svc-1" onBack={() => {}} onDone={() => {}} />);

    expect(await screen.findByText('Fully booked')).toBeTruthy();
  });

  it('creates a booking from the summary', async () => {
    mockBusiness();
    const onDone = vi.fn();
    render(<BookServiceScreen businessId="biz-1" preselectedServiceId="svc-1" onBack={() => {}} onDone={onDone} />);

    fireEvent.click(await screen.findByText('9:00 AM'));
    expect(await screen.findByText('Confirm your booking')).toBeTruthy();
    expect(screen.getByText('Hair Consultation')).toBeTruthy();
    expect(screen.getByText('30 minutes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(api.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-1', serviceId: 'svc-1', startTime: '09:00' }),
    ));
    expect(await screen.findByText('Booking requested')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'View my bookings' }));
    expect(onDone).toHaveBeenCalledWith(createdBooking);
  });

  it('recovers gracefully when the slot was taken (SLOT_TAKEN race)', async () => {
    mockBusiness();
    vi.spyOn(api, 'createBooking').mockRejectedValue(new api.ApiError(409, 'SLOT_TAKEN', 'That time slot was just booked.'));
    const reloadSpy = vi.spyOn(api, 'getAvailability');
    render(<BookServiceScreen businessId="biz-1" preselectedServiceId="svc-1" onBack={() => {}} onDone={() => {}} />);

    fireEvent.click(await screen.findByText('9:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByText(/That time was just booked/)).toBeTruthy();
    // Back on slot selection and availability refreshed.
    await waitFor(() => expect(reloadSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('Available times')).toBeTruthy();
    expect(api.createBooking).toHaveBeenCalledTimes(1);
  });

  it('shows a friendly message on network failure', async () => {
    mockBusiness();
    vi.spyOn(api, 'getAvailability').mockRejectedValue(new api.ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API.'));
    render(<BookServiceScreen businessId="biz-1" preselectedServiceId="svc-1" onBack={() => {}} onDone={() => {}} />);

    expect(await screen.findByText(/Cannot reach the NearbyOrders API/)).toBeTruthy();
  });

  it('shows an empty state when the business has no bookable services', async () => {
    mockBusiness({ services: [inactiveService] });
    render(<BookServiceScreen businessId="biz-1" onBack={() => {}} onDone={() => {}} />);

    expect(await screen.findByText('Nothing to book yet')).toBeTruthy();
  });
});

describe('BookingsScreen', () => {
  it('groups upcoming and past bookings', async () => {
    const today = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const future: Booking = { ...createdBooking, id: 'bk-future', bookingDate: today, startTime: '18:00', endTime: '18:30' };
    const past: Booking = { ...createdBooking, id: 'bk-past', bookingDate: '2026-01-05', status: 'COMPLETED' };
    vi.spyOn(api, 'listMyBookings').mockResolvedValue([past, future]);

    render(<BookingsScreen onOpenBooking={() => {}} onExplore={() => {}} />);

    expect(await screen.findByText('Upcoming')).toBeTruthy();
    expect(screen.getByText('Past')).toBeTruthy();
    // Both groups render the same fixture service name — one card each.
    expect(screen.getAllByText('Hair Consultation')).toHaveLength(2);
  });

  it('shows an empty state without bookings', async () => {
    vi.spyOn(api, 'listMyBookings').mockResolvedValue([]);
    render(<BookingsScreen onOpenBooking={() => {}} onExplore={() => {}} />);

    expect(await screen.findByText('No bookings yet')).toBeTruthy();
  });

  it('hides the cancelled booking from upcoming', async () => {
    const today = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    vi.spyOn(api, 'listMyBookings').mockResolvedValue([{ ...createdBooking, bookingDate: today, status: 'CANCELLED' }]);
    render(<BookingsScreen onOpenBooking={() => {}} onExplore={() => {}} />);

    await screen.findByText('Past');
    expect(screen.queryByText('Upcoming')).toBeNull();
  });
});

describe('BookingDetailScreen', () => {
  it('shows booking details with status and allows cancelling a pending booking', async () => {
    render(<BookingDetailScreen bookingId="bk-1" onBack={() => {}} />);

    expect(await screen.findByRole('heading', { name: 'DHA Glow Salon' })).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('9:00 AM – 9:30 AM')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));

    await waitFor(() => expect(api.cancelMyBooking).toHaveBeenCalledWith('bk-1'));
    expect(await screen.findByText('This booking was cancelled.')).toBeTruthy();
  });

  it('does not offer cancellation for completed bookings', async () => {
    vi.spyOn(api, 'getBooking').mockResolvedValue({ ...createdBooking, status: 'COMPLETED' });
    render(<BookingDetailScreen bookingId="bk-1" onBack={() => {}} />);

    expect(await screen.findByText('Completed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull();
  });

  it('handles a too-late cancel conflict without breaking', async () => {
    vi.spyOn(api, 'cancelMyBooking').mockRejectedValue(new api.ApiError(409, 'INVALID_TRANSITION', 'nope'));
    render(<BookingDetailScreen bookingId="bk-1" onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));

    expect(await screen.findByText('This booking can no longer be cancelled.')).toBeTruthy();
  });
});
