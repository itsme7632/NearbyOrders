import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { OwnerPromotions } from './OwnerPromotionsScreen.js';
import * as api from '../api.js';
import type { Promotion, PromotionRequest } from '../api.js';

afterEach(cleanup);

const promotions: Promotion[] = [
  {
    id: 'promo-1',
    slug: 'homepage-spotlight',
    name: 'Homepage spotlight',
    description: 'Feature your business on the customer home screen for a week.',
    benefits: ['Top placement for 7 days', 'Badge on your listing'],
    priceMinor: 499900,
    currency: 'PKR',
    durationDays: 7,
    requirements: 'An approved verification and at least 3 photos.',
    displayOrder: 0,
  },
  {
    id: 'promo-2',
    slug: 'category-boost',
    name: 'Category boost',
    description: null,
    benefits: [],
    priceMinor: 199900,
    currency: 'PKR',
    durationDays: 30,
    requirements: null,
    displayOrder: 1,
  },
];

const pendingRequest: PromotionRequest = {
  id: 'req-1',
  promotionId: 'promo-1',
  promotionName: 'Homepage spotlight',
  note: null,
  status: 'PENDING',
  submittedAt: '2026-09-10T00:00:00.000Z',
  reviewedAt: null,
  rejectionReason: null,
};

let promotionsSpy: MockInstance<() => Promise<Promotion[]>>;
let requestsSpy: MockInstance<(businessId: string) => Promise<PromotionRequest[]>>;
let requestSpy: MockInstance<(businessId: string, body: { promotionId: string; note?: string }) => Promise<PromotionRequest>>;

beforeEach(() => {
  vi.clearAllMocks();
  promotionsSpy = vi.spyOn(api, 'listPromotions').mockResolvedValue(promotions);
  requestsSpy = vi.spyOn(api, 'listPromotionRequests').mockResolvedValue([]);
  requestSpy = vi
    .spyOn(api, 'requestPromotion')
    .mockResolvedValue({ ...pendingRequest, promotionId: 'promo-2', id: 'req-2' });
});

describe('OwnerPromotions (catalog)', () => {
  it('renders live promotions with price, duration, benefits, and requirements', async () => {
    render(<OwnerPromotions businessId="biz-1" />);
    const spotlight = await screen.findByRole('region', { name: 'Homepage spotlight' });
    expect(spotlight.textContent).toContain('Feature your business on the customer home screen');
    expect(spotlight.textContent).toContain('7 days');
    expect(spotlight.textContent).toContain('Top placement for 7 days');
    expect(spotlight.textContent).toContain('An approved verification and at least 3 photos.');
    expect(await screen.findByRole('region', { name: 'Category boost' })).toBeTruthy();
  });

  it('shows an honest empty state when there are no active promotions', async () => {
    promotionsSpy.mockResolvedValue([]);
    render(<OwnerPromotions businessId="biz-1" />);
    expect(await screen.findByText('No promotions right now')).toBeTruthy();
    expect(screen.getByText(/There are no active promotions at the moment/)).toBeTruthy();
  });

  it('surfaces catalog load errors with a retry', async () => {
    promotionsSpy.mockRejectedValue(new api.ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API.'));
    render(<OwnerPromotions businessId="biz-1" />);
    expect(await screen.findByText(/Cannot reach the NearbyOrders API/)).toBeTruthy();
    promotionsSpy.mockResolvedValue(promotions);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Homepage spotlight' })).toBeTruthy();
  });
});

describe('OwnerPromotions (request flow)', () => {
  it('requests a promotion with an optional note and confirms honestly', async () => {
    render(<OwnerPromotions businessId="biz-1" />);
    const boost = await screen.findByRole('region', { name: 'Category boost' });
    fireEvent.click(
      within(boost).getByRole('button', { name: 'Request this promotion' }),
    );
    fireEvent.change(screen.getByLabelText('Note for the team (optional)'), {
      target: { value: 'Please start after Eid.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(requestSpy).toHaveBeenCalledWith('biz-1', {
        promotionId: 'promo-2',
        note: 'Please start after Eid.',
      }),
    );
    expect(await screen.findByText(/Request received\. The NearbyOrders team will review it/)).toBeTruthy();
  });

  it('sends the request without a note when the field is left blank', async () => {
    render(<OwnerPromotions businessId="biz-1" />);
    const boost = await screen.findByRole('region', { name: 'Category boost' });
    fireEvent.click(
      within(boost).getByRole('button', { name: 'Request this promotion' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(requestSpy).toHaveBeenCalledWith('biz-1', { promotionId: 'promo-2' }),
    );
  });

  it('shows the pending state for an already-requested promotion', async () => {
    requestsSpy.mockResolvedValue([pendingRequest]);
    render(<OwnerPromotions businessId="biz-1" />);
    const spotlight = await screen.findByRole('region', { name: 'Homepage spotlight' });
    expect(spotlight.textContent).toContain('Request pending');
    expect(spotlight.textContent).toContain('Your request is with the NearbyOrders team');
    expect(
      within(spotlight).queryByRole('button', {
        name: 'Request this promotion',
      }),
    ).toBeNull();
  });

  it('shows the rejection reason and allows requesting again', async () => {
    requestsSpy.mockResolvedValue([
      { ...pendingRequest, promotionId: 'promo-2', id: 'req-2', status: 'REJECTED', rejectionReason: 'Photos missing.' },
    ]);
    render(<OwnerPromotions businessId="biz-1" />);
    const boost = await screen.findByRole('region', { name: 'Category boost' });
    expect(boost.textContent).toContain('Rejected');
    expect(boost.textContent).toContain('Photos missing.');
    expect(
      within(boost).getByRole('button', { name: 'Request this promotion' }),
    ).toBeTruthy();
  });

  it('surfaces request API errors without losing the catalog', async () => {
    requestSpy.mockRejectedValue(new api.ApiError(409, 'ALREADY_REQUESTED', 'You already requested this promotion.'));
    render(<OwnerPromotions businessId="biz-1" />);
    const boost = await screen.findByRole('region', { name: 'Category boost' });
    fireEvent.click(
      within(boost).getByRole('button', { name: 'Request this promotion' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/You already requested this promotion\./)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Homepage spotlight' })).toBeTruthy();
  });
});
