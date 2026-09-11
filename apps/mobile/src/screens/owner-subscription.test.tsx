import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerSubscription } from './OwnerDashboard.js';
import * as api from '../api.js';
import type { Subscription } from '../api.js';

afterEach(cleanup);

const plan = {
  slug: 'nearbyorders-business',
  name: 'NearbyOrders Business',
  description: null,
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
};

const trialSub: Subscription = {
  id: 'sub-1',
  status: 'TRIAL',
  trialStartAt: '2026-09-01T00:00:00.000Z',
  trialEndAt: '2026-10-01T00:00:00.000Z',
  currentPeriodStartAt: '2026-09-01T00:00:00.000Z',
  currentPeriodEndAt: '2026-10-01T00:00:00.000Z',
  cancelledAt: null,
  plan,
};

beforeEach(() => {
  // Spies persist across tests in a file: clear call history so per-test
  // assertions like "not called yet" see only this test's activity.
  vi.clearAllMocks();
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(null);
});

describe('OwnerSubscription (no subscription yet)', () => {
  it('shows the plan price in minor-unit formatting and the trial CTA', async () => {
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('NearbyOrders Business')).toBeTruthy();
    // 299900 minor = Rs 2,999 — integer paisa rendering, no float artifacts.
    expect(screen.getByText('Rs 2,999')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start 30-day free trial' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('starts a trial through the API and reloads the status', async () => {
    vi.spyOn(api, 'startBusinessTrial').mockResolvedValue(trialSub);
    const reloadSpy = vi.spyOn(api, 'getBusinessSubscription');
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start 30-day free trial' }));
    await waitFor(() => expect(api.startBusinessTrial).toHaveBeenCalledWith('biz-1'));
    // The reload happens in a follow-up effect; give React a beat to run it.
    await waitFor(() => expect(reloadSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('shows no payment / upgrade / card UI while no subscription exists', async () => {
    render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByRole('button', { name: 'Start 30-day free trial' });
    expect(screen.queryByText(/pay now/i)).toBeNull();
    expect(screen.queryByText(/upgrade/i)).toBeNull();
    expect(screen.queryByText(/card/i)).toBeNull();
  });
});

describe('OwnerSubscription (live trial)', () => {
  it('shows TRIAL status with trial and period end dates', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(trialSub);
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('Free trial')).toBeTruthy();
    expect(screen.getByText(/Trial ends/)).toBeTruthy();
    expect(screen.getByText(/Current period ends/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeTruthy();
  });

  it('requires confirmation before cancelling, then calls the cancel endpoint', async () => {
    const cancelled: Subscription = { ...trialSub, status: 'CANCELLED', cancelledAt: '2026-09-11T00:00:00.000Z' };
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(trialSub);
    const cancelSpy = vi.spyOn(api, 'cancelBusinessSubscription').mockResolvedValue(cancelled);
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    // Confirmation step first — no accidental cancellation.
    expect(api.cancelBusinessSubscription).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith('biz-1'));
  });

  it('allows keeping the subscription instead of cancelling', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(trialSub);
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep subscription' }));
    expect(api.cancelBusinessSubscription).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Yes, cancel' })).toBeNull();
  });

  it('surfaces API errors without losing the section', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(trialSub);
    vi.spyOn(api, 'cancelBusinessSubscription').mockRejectedValue(
      new api.ApiError(409, 'CONFLICT', 'Already cancelled'),
    );
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(await screen.findByText(/Already cancelled/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep subscription' })).toBeTruthy();
  });
});

describe('OwnerSubscription (terminal states)', () => {
  it('CANCELLED explains continued access until period end and hides cancel', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({
      ...trialSub,
      status: 'CANCELLED',
      cancelledAt: '2026-09-11T00:00:00.000Z',
    });
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.getByText(/access continues until/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel subscription' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start 30-day free trial' })).toBeTruthy();
  });

  it('EXPIRED offers a fresh trial', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...trialSub, status: 'EXPIRED' });
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('Expired')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start 30-day free trial' })).toBeTruthy();
  });
});
