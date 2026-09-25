// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import type { BusinessSubscriptionState, VerificationState } from '../api.js';
import { OwnerAttentionItems } from './OwnerDashboard.js';

afterEach(cleanup);

const emptyState = (patch: Partial<BusinessSubscriptionState> = {}): BusinessSubscriptionState => ({
  businessId: 'biz-1',
  subscription: null,
  status: null,
  trial: null,
  planNameSnapshot: null,
  planPriceMinorSnapshot: null,
  verificationStatus: null,
  trialStatus: null,
  ...patch,
});

const verifiedState = (status: string): VerificationState =>
  ({
    application: { status, reviewerMessage: null },
    documents: [],
  }) as unknown as VerificationState;

const props = { businessId: 'biz-1', onOpenVerification: () => {}, onOpenSubscription: () => {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'getVerification').mockResolvedValue(verifiedState('APPROVED'));
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(emptyState());
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
});

describe('OwnerAttentionItems (subscription/trial states)', () => {
  it('offers the free trial when the server marks the business ELIGIBLE', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(emptyState({ trialStatus: 'ELIGIBLE' }));
    render(<OwnerAttentionItems {...props} />);
    expect(await screen.findByText('Start your free trial')).toBeTruthy();
    expect(screen.queryByText('Complete verification')).toBeNull();
  });

  it('does not offer the trial once it is used or live', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(emptyState({ trialStatus: 'ACTIVE' }));
    render(<OwnerAttentionItems {...props} />);
    // Wait until the async data has resolved, then assert absence.
    await waitFor(() => expect(vi.mocked(api.listPaymentRequests).mock.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText('Start your free trial')).toBeNull());
    expect(screen.queryByText('Your plan needs attention')).toBeNull();
  });

  it('flags an expired subscription as needing attention', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(
      emptyState({
        subscription: {
          id: 'sub-1',
          status: 'EXPIRED',
          trialStartAt: null,
          trialEndAt: null,
          currentPeriodStartAt: '2026-09-01T00:00:00.000Z',
          currentPeriodEndAt: '2026-10-01T00:00:00.000Z',
          cancelledAt: null,
          planNameSnapshot: 'Growth',
          planPriceMinorSnapshot: 299900,
          plan: null,
        },
        status: 'EXPIRED',
        trialStatus: 'EXPIRED',
      }),
    );
    render(<OwnerAttentionItems {...props} />);
    expect(await screen.findByText('Your plan needs attention')).toBeTruthy();
    expect(screen.getByText('Your subscription has expired')).toBeTruthy();
  });

  it('flags a trial ending within 3 days', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(
      emptyState({
        subscription: {
          id: 'sub-1',
          status: 'TRIAL',
          trialStartAt: '2026-09-20T00:00:00.000Z',
          trialEndAt: '2026-09-24T00:00:00.000Z',
          currentPeriodStartAt: '2026-09-20T00:00:00.000Z',
          currentPeriodEndAt: '2026-09-24T00:00:00.000Z',
          cancelledAt: null,
          planNameSnapshot: 'Growth',
          planPriceMinorSnapshot: 299900,
          plan: null,
        },
        status: 'TRIAL',
        trial: { startsAt: '2026-09-20T00:00:00.000Z', endsAt: '2026-09-24T00:00:00.000Z', daysRemaining: 2 },
        trialStatus: 'ACTIVE',
      }),
    );
    render(<OwnerAttentionItems {...props} />);
    expect(await screen.findByText('Your plan needs attention')).toBeTruthy();
    expect(screen.getByText('Your free trial ends soon')).toBeTruthy();
    expect(screen.queryByText('Start your free trial')).toBeNull();
  });

  it('opens the subscription screen when the trial item is tapped', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(emptyState({ trialStatus: 'ELIGIBLE' }));
    const onOpenSubscription = vi.fn();
    render(<OwnerAttentionItems {...props} onOpenSubscription={onOpenSubscription} />);
    fireEvent.click(await screen.findByText('Start your free trial'));
    expect(onOpenSubscription).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when verification, trial and plan are all healthy', async () => {
    const { container } = render(<OwnerAttentionItems {...props} />);
    await vi.waitFor(() => {
      // Loading resolves to null content when there is nothing to flag.
      expect(container.textContent).toBe('');
    });
  });

  it('reports status so an embedding section can gate its all-clear', async () => {
    const onStatus = vi.fn();
    render(<OwnerAttentionItems {...props} onStatus={onStatus} />);
    // Loading first: an embedding Overview must not show "all caught up" yet.
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ loading: true })));
    // Then loaded with zero items and no error.
    await waitFor(() =>
      expect(onStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ loading: false, error: false, count: 0 }),
      ),
    );
  });

  it('reports errors so an embedding section shows retry instead of all-clear', async () => {
    const onStatus = vi.fn();
    vi.spyOn(api, 'getBusinessSubscription').mockRejectedValue(new Error('boom'));
    render(<OwnerAttentionItems {...props} onStatus={onStatus} />);
    await waitFor(() =>
      expect(onStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ loading: false, error: true }),
      ),
    );
    // The retry callback reloads the failed fetches.
    const retry = onStatus.mock.calls.at(-1)[0].retry as () => void;
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(emptyState());
    retry();
    await waitFor(() =>
      expect(onStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ loading: false, error: false, count: 0 }),
      ),
    );
  });
});
