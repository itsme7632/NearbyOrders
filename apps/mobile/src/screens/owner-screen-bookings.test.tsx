import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerScreen } from './OwnerScreen.js';
import * as api from '../api.js';
import type { Booking, Business } from '../api.js';
import { todayPkt } from '../time.js';

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
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
};

const customer = { id: 'u-1', email: 'ayesha@test.local', firstName: 'Ayesha', lastName: 'Khan' };

const booking: Booking = {
  id: 'bk-1',
  businessId: 'biz-1',
  businessName: 'DHA Glow Salon',
  businessSlug: 'dha-glow-salon',
  serviceId: 'svc-1',
  serviceName: 'Cake Tasting Session',
  priceMinor: 150000,
  currency: 'PKR',
  bookingDate: todayPkt(),
  startTime: '09:30',
  endTime: '10:00',
  status: 'PENDING',
  notes: null,
  createdAt: '2026-09-09T10:00:00.000Z',
  customer,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'listBusinessBookings').mockResolvedValue([booking]);
  vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([business]);
});

describe('OwnerScreen bookings management', () => {
  it('opens the tapped booking instead of navigating back to the overview', async () => {
    const onOpenBooking = vi.fn();
    const onBack = vi.fn();
    render(<OwnerScreen screen="bookings" businessId="biz-1" onBack={onBack} onOpenBooking={onOpenBooking} />);

    // The pending booking card appears in the Incoming group.
    const card = await screen.findByRole('button', { name: /Ayesha Khan/ });
    fireEvent.click(card);

    // The booking detail opens with the tapped booking's id…
    expect(onOpenBooking).toHaveBeenCalledTimes(1);
    expect(onOpenBooking).toHaveBeenCalledWith('bk-1');
    // …and the management screen does NOT treat the tap as "back".
    expect(onBack).not.toHaveBeenCalled();
  });

  it('keeps the back link wired to onBack (overview), independent of booking taps', async () => {
    const onOpenBooking = vi.fn();
    const onBack = vi.fn();
    render(<OwnerScreen screen="bookings" businessId="biz-1" onBack={onBack} onOpenBooking={onOpenBooking} />);

    await screen.findByRole('button', { name: /Ayesha Khan/ });
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenBooking).not.toHaveBeenCalled();
  });

  it('still renders the unknown-screen fallback', async () => {
    render(<OwnerScreen screen="nope" businessId="biz-1" onBack={() => {}} onOpenBooking={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Unknown screen\./)).toBeInTheDocument());
  });
});
