import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerBookingsScreen, OwnerBookingDetailScreen, customerName, durationMinutesLabel } from './OwnerBookings.js';
import * as api from '../api.js';
import type { Booking, Business } from '../api.js';

afterEach(cleanup);

const business: Business = {
  id: 'biz-1',
  name: 'DHA Glow Salon',
  slug: 'dha-glow-salon',
  description: null,
  imageUrl: null,
  isVerified: true,
  address: '12 Test Avenue',
  city: 'Lahore',
  locality: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
};

const customer = { id: 'u-1', email: 'ayesha@test.local', firstName: 'Ayesha', lastName: 'Khan' };

const makeBooking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'bk-1',
  businessId: 'biz-1',
  businessName: 'DHA Glow Salon',
  businessSlug: 'dha-glow-salon',
  serviceId: 'svc-1',
  serviceName: 'Cake Tasting Session',
  priceMinor: 150000,
  currency: 'PKR',
  bookingDate: '2026-09-10',
  startTime: '09:30',
  endTime: '10:00',
  status: 'PENDING',
  notes: 'Two guests, chocolate cake please.',
  createdAt: '2026-09-09T10:00:00.000Z',
  customer,
  ...overrides,
});

const pending = makeBooking();
const confirmed = makeBooking({ id: 'bk-2', status: 'CONFIRMED' });
const completed = makeBooking({ id: 'bk-3', status: 'COMPLETED' });

function mockOwnerApis(bookings: Booking[]) {
  vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([business]);
  vi.spyOn(api, 'listBusinessBookings').mockResolvedValue(bookings);
}

beforeEach(() => {
  vi.spyOn(api, 'getBooking').mockResolvedValue(pending);
  vi.spyOn(api, 'setBookingStatus').mockImplementation((_id, status) => Promise.resolve(makeBooking({ status })));
});

describe('OwnerBookingsScreen', () => {
  it('groups bookings into Incoming, Upcoming and History', async () => {
    mockOwnerApis([completed, confirmed, pending]);
    render(<OwnerBookingsScreen onOpenBooking={() => {}} />);

    expect(await screen.findByRole('region', { name: 'Incoming' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Upcoming' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'History' })).toBeTruthy();
    // The customer name appears once per card (3 bookings in total).
    expect(screen.getAllByText('Ayesha Khan')).toHaveLength(3);
    expect(screen.getByText('Waiting for your response')).toBeTruthy();
  });

  it('shows the empty state when the business has no bookings', async () => {
    mockOwnerApis([]);
    render(<OwnerBookingsScreen onOpenBooking={() => {}} />);

    expect(await screen.findByText('No bookings yet')).toBeTruthy();
    expect(screen.getByText(/When customers book your services/)).toBeTruthy();
  });

  it('opens the booking detail when a card is tapped', async () => {
    mockOwnerApis([pending]);
    const onOpen = vi.fn();
    render(<OwnerBookingsScreen onOpenBooking={onOpen} />);

    fireEvent.click(await screen.findByText('Ayesha Khan'));
    expect(onOpen).toHaveBeenCalledWith('bk-1');
  });
});

describe('OwnerBookingDetailScreen', () => {
  it('shows customer, service, time, duration, price and note for a pending booking', async () => {
    render(<OwnerBookingDetailScreen bookingId="bk-1" onBack={() => {}} />);

    expect(await screen.findByText('Ayesha Khan')).toBeTruthy();
    // Service shows as subtitle and in the summary list.
    expect(screen.getAllByText('Cake Tasting Session')).toHaveLength(2);
    expect(screen.getByText('ayesha@test.local')).toBeTruthy();
    expect(screen.getByText('30 minutes')).toBeTruthy();
    expect(screen.getByText('Two guests, chocolate cake please.')).toBeTruthy();
    expect(screen.getByText('Waiting for your response.')).toBeTruthy();
    expect(screen.getByText('Accept booking')).toBeTruthy();
    expect(screen.getByText('Reject booking')).toBeTruthy();
  });

  it('accepts a pending booking via the authoritative API', async () => {
    render(<OwnerBookingDetailScreen bookingId="bk-1" onBack={() => {}} />);

    fireEvent.click(await screen.findByText('Accept booking'));
    await waitFor(() => expect(api.setBookingStatus).toHaveBeenCalledWith('bk-1', 'CONFIRMED'));
    await waitFor(() => expect(screen.getByText('Upcoming booking.')).toBeTruthy());
    // Confirmed bookings show completion, not acceptance.
    expect(screen.queryByText('Accept booking')).toBeNull();
    expect(screen.getByText('Mark completed')).toBeTruthy();
  });

  it('rejects a pending booking only after confirmation', async () => {
    render(<OwnerBookingDetailScreen bookingId="bk-1" onBack={() => {}} />);

    fireEvent.click(await screen.findByText('Reject booking'));
    expect(screen.getByText('Reject this booking? This cannot be undone.')).toBeTruthy();
    expect(api.setBookingStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Yes, reject it'));
    await waitFor(() => expect(api.setBookingStatus).toHaveBeenCalledWith('bk-1', 'REJECTED'));
    await waitFor(() => expect(screen.getByText('This booking was declined.')).toBeTruthy());
  });

  it('completes a confirmed booking after confirmation', async () => {
    vi.spyOn(api, 'getBooking').mockResolvedValue(confirmed);
    render(<OwnerBookingDetailScreen bookingId="bk-2" onBack={() => {}} />);

    fireEvent.click(await screen.findByText('Mark completed'));
    expect(screen.getByText('Mark this booking as completed?')).toBeTruthy();

    fireEvent.click(screen.getByText('Yes, complete it'));
    await waitFor(() => expect(api.setBookingStatus).toHaveBeenCalledWith('bk-2', 'COMPLETED'));
    await waitFor(() => expect(screen.getByText('This booking is completed.')).toBeTruthy());
    expect(screen.queryByText('Mark completed')).toBeNull();
  });

  it('handles a stale/conflicted booking with a clear message and refresh', async () => {
    vi.spyOn(api, 'setBookingStatus').mockRejectedValue(
      new api.ApiError(409, 'INVALID_TRANSITION', 'Cannot change a cancelled booking to confirmed'),
    );
    render(<OwnerBookingDetailScreen bookingId="bk-1" onBack={() => {}} />);

    fireEvent.click(await screen.findByText('Accept booking'));
    expect(await screen.findByText('This booking has already been updated. Please refresh.')).toBeTruthy();
    expect(screen.getByText('Refresh booking')).toBeTruthy();
  });

  it('shows terminal statuses without action buttons', async () => {
    vi.spyOn(api, 'getBooking').mockResolvedValue(makeBooking({ status: 'CANCELLED' }));
    render(<OwnerBookingDetailScreen bookingId="bk-1" onBack={() => {}} />);

    expect(await screen.findByText('This booking was cancelled by the customer.')).toBeTruthy();
    expect(screen.queryByText('Accept booking')).toBeNull();
    expect(screen.queryByText('Reject booking')).toBeNull();
    expect(screen.queryByText('Mark completed')).toBeNull();
  });
});

describe('display helpers', () => {
  it('customerName falls back to email then a generic label', () => {
    expect(customerName({ id: 'u', email: 'a@b.c', firstName: 'Sara', lastName: null })).toBe('Sara');
    expect(customerName({ id: 'u', email: 'a@b.c', firstName: null, lastName: null })).toBe('a@b.c');
    expect(customerName(undefined)).toBe('Customer');
  });

  it('durationMinutesLabel derives duration from start/end', () => {
    expect(durationMinutesLabel('09:30', '10:00')).toBe('30 minutes');
    expect(durationMinutesLabel('10:00', '11:30')).toBe('90 minutes');
    expect(durationMinutesLabel('10:00', '10:00')).toBe('—');
  });
});
