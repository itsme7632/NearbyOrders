import { useState } from 'react';
import {
  getBusinessSubscription,
  startBusinessTrial,
  cancelBusinessSubscription,
  type Subscription,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Loading, Money } from '../components/ui.js';
import { formatMoney } from '@nearbyorders/shared';
import { OwnerPayments } from './OwnerSubscriptionPayments.js';

const SUBSCRIPTION_STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUSPENDED: 'Suspended',
};

export function OwnerSubscription(props: { businessId: string; businessName?: string }) {
  const subscription = useAsyncData<Subscription | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<Subscription>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      subscription.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (subscription.loading) return <Loading label="Loading subscription…" />;
  if (subscription.error) return <ErrorState message={subscription.error} onRetry={subscription.reload} />;

  const sub = subscription.data;
  const plan = sub?.plan;
  const isLive = sub?.status === 'TRIAL' || sub?.status === 'ACTIVE';
  const periodEnd = sub ? new Date(sub.currentPeriodEndAt).toLocaleDateString() : null;
  const trialEnd = sub?.trialEndAt ? new Date(sub.trialEndAt).toLocaleDateString() : null;

  return (
    <section className="card" aria-label="Subscription">
      <h2>Subscription</h2>
      {error ? <ErrorState message={error} /> : null}
      {!plan ? (
        <>
          <p className="muted">
            NearbyOrders Business makes your business discoverable with bookings, orders and reviews.
          </p>
          <div className="sub-plan-head">
            <span className="sub-plan-name">NearbyOrders Business</span>
            <Money minor={299900} />
            <span className="muted"> /month after a 30-day free trial</span>
          </div>
          <p className="hint">You have not started a trial yet. Your data stays intact either way.</p>
          <Button full disabled={busy} onClick={() => act(() => startBusinessTrial(props.businessId))}>
            {busy ? 'Starting…' : 'Start 30-day free trial'}
          </Button>
        </>
      ) : (
        <>
          <div className="sub-plan-head">
            <span className="sub-plan-name">{plan.name}</span>
            <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
            <span className="muted"> /month</span>
          </div>
          <p className={`badge ${isLive ? 'badge-open' : 'badge-closed'}`}>
            {SUBSCRIPTION_STATUS_LABEL[sub!.status]}
          </p>
          <ul className="sub-facts">
            {sub!.status === 'TRIAL' && trialEnd ? <li>Trial ends {trialEnd}</li> : null}
            {sub!.status === 'TRIAL' ? <li>After the trial: {formatMoney(plan.monthlyPriceMinor, plan.currency)} /month</li> : null}
            {periodEnd ? <li>Current period ends {periodEnd}</li> : null}
            {sub!.status === 'CANCELLED' && sub!.cancelledAt ? (
              <li>Cancelled: access continues until {periodEnd}</li>
            ) : null}
            {sub!.status === 'EXPIRED' ? <li>Ended. Start again any time.</li> : null}
          </ul>
          {isLive ? (
            confirmingCancel ? (
              <div className="btn-row" role="alert">
                <Button
                  sm
                  variant="danger"
                  disabled={busy}
                  onClick={() => act(() => cancelBusinessSubscription(props.businessId))}
                >
                  {busy ? 'Cancelling…' : 'Yes, cancel'}
                </Button>
                <Button sm variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(false)}>
                  Keep subscription
                </Button>
              </div>
            ) : (
              <div className="btn-row">
                <Button sm variant="danger" onClick={() => setConfirmingCancel(true)} disabled={busy}>
                  Cancel subscription
                </Button>
              </div>
            )
          ) : (
            <Button full disabled={busy} onClick={() => act(() => startBusinessTrial(props.businessId))}>
              {busy ? 'Starting…' : 'Start 30-day free trial'}
            </Button>
          )}
        </>
      )}
      {/* Manual payment flow (Phase 7B): pay-in details, receipt submission
          and history. Rendered for every subscription state — an expired or
          cancelled business pays the same way as a fresh one. */}
      <OwnerPayments businessId={props.businessId} />
    </section>
  );
}
