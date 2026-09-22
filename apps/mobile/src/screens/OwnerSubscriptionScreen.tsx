import { useState } from 'react';
import {
  getBusinessSubscription,
  listSubscriptionPlans,
  startBusinessTrial,
  cancelBusinessSubscription,
  type Subscription,
  type SubscriptionPlan,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { formatMoney } from '@nearbyorders/shared';
import { CheckIcon, StarIcon } from '../components/icons.js';
import { OwnerPayments } from './OwnerSubscriptionPayments.js';

const SUBSCRIPTION_STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUSPENDED: 'Suspended',
};

/**
 * What the single NearbyOrders Business plan actually includes. Derived only
 * from the plan description stored in the backend ("appear in search, take
 * bookings and orders, and manage your storefront") plus platform
 * capabilities that genuinely exist (catalog showcase, customer reviews).
 * Nothing is invented: there is no priority-support tier, no second plan.
 */
const PLAN_BENEFITS = [
  'Get discovered by more customers',
  'Accept bookings and orders',
  'Showcase your services & products',
  'Customer reviews and ratings',
] as const;

/**
 * Business subscription as a professional pricing page: the trial hero, the
 * one real plan with its honest benefits, the live subscription state, and
 * the manual payment flow. There is exactly one backend plan
 * (PLAN_CATALOG) — tiers are never invented here.
 */
export function OwnerSubscription(props: { businessId: string; businessName?: string }) {
  const subscription = useAsyncData<Subscription | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);
  const plans = useAsyncData<SubscriptionPlan[]>(() => listSubscriptionPlans(), []);
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

  if (subscription.loading || plans.loading) return <Loading label="Loading subscription…" />;
  if (subscription.error) return <ErrorState message={subscription.error} onRetry={subscription.reload} />;
  if (plans.error) return <ErrorState message={plans.error} onRetry={plans.reload} />;

  const sub = subscription.data;
  // The plan shown comes from the live subscription when one exists, else
  // from the public plan catalog — the price is never hard-coded here.
  const plan = sub?.plan ?? plans.data?.[0] ?? null;
  // No subscription and no plan in the catalog: say so honestly instead of
  // inventing trial terms or a price for the hero below.
  if (!plan) {
    return (
      <EmptyState
        icon={<StarIcon size={22} />}
        title="No plans available right now"
        body="Subscription plans couldn't be loaded. Pull to refresh or try again later — nothing has been invented here."
        action={<Button onClick={() => { subscription.reload(); plans.reload(); }}>Retry</Button>}
      />
    );
  }
  const isLive = sub?.status === 'TRIAL' || sub?.status === 'ACTIVE';
  const periodEnd = sub ? new Date(sub.currentPeriodEndAt).toLocaleDateString() : null;
  const trialDaysLeft =
    sub?.status === 'TRIAL' && sub.trialEndAt
      ? Math.max(0, Math.ceil((new Date(sub.trialEndAt).getTime() - Date.now()) / 86_400_000))
      : null;

  return (
    <div>
      {error ? <ErrorState message={error} /> : null}

      {/* Intro: what NearbyOrders Business is. */}
      <section aria-label="About NearbyOrders Business">
        <h2 className="sub-page-title">{plan.name}</h2>
        <p className="muted" style={{ marginTop: 2 }}>
          {plan.description ?? 'Get discovered, accept bookings and orders, and grow your local business.'}
        </p>
      </section>

      {/* Trial hero: shown until the business is on a live plan. */}
      {!isLive ? (
        <section className="sub-trial-hero" aria-label="Free trial">
          <span className="sub-trial-icon" aria-hidden>
            <StarIcon size={22} />
          </span>
          <span className="sub-trial-main">
            <span className="sub-trial-title">{`${plan.trialDays}-day free trial`}</span>
            <span className="sub-trial-sub">Try all features free{plan ? ` for ${plan.trialDays} days` : ''}. No payment required now.</span>
          </span>
        </section>
      ) : null}

      {/* The plan card: the one real plan, its honest benefits, and the CTA
          or live state. */}
      {plan ? (
        <section className="sub-plan-card" aria-label="Plan">
          <div className="sub-plan-head">
            <span className="sub-plan-name">{plan.name}</span>
            <span className="sub-plan-price">
              <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
              <span className="muted"> /month</span>
            </span>
          </div>
          {!isLive ? <p className="hint">after {plan.trialDays}-day free trial</p> : null}
          <ul className="sub-benefits">
            {PLAN_BENEFITS.map((b) => (
              <li key={b}>
                <CheckIcon size={15} />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {!sub ? (
            <Button full disabled={busy} onClick={() => act(() => startBusinessTrial(props.businessId))}>
              {busy ? 'Starting…' : `Start ${plan.trialDays}-day free trial`}
            </Button>
          ) : sub.status === 'TRIAL' ? (
            <>
              <p className="sub-state-line" role="status">
                <span className="badge badge-open">{SUBSCRIPTION_STATUS_LABEL.TRIAL}</span>
                <span>
                  {trialDaysLeft !== null
                    ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} remaining — then ${formatMoney(plan.monthlyPriceMinor, plan.currency)} /month`
                    : `Trial in progress — then ${formatMoney(plan.monthlyPriceMinor, plan.currency)} /month`}
                </span>
              </p>
              <CancelControl
                busy={busy}
                confirming={confirmingCancel}
                onAsk={() => setConfirmingCancel(true)}
                onKeep={() => setConfirmingCancel(false)}
                onConfirm={() => act(() => cancelBusinessSubscription(props.businessId))}
              />
            </>
          ) : sub.status === 'ACTIVE' ? (
            <>
              <p className="sub-state-line" role="status">
                <span className="badge badge-open">{SUBSCRIPTION_STATUS_LABEL.ACTIVE}</span>
                <span>{periodEnd ? `Renews ${periodEnd}` : 'Active'}</span>
              </p>
              <CancelControl
                busy={busy}
                confirming={confirmingCancel}
                onAsk={() => setConfirmingCancel(true)}
                onKeep={() => setConfirmingCancel(false)}
                onConfirm={() => act(() => cancelBusinessSubscription(props.businessId))}
              />
            </>
          ) : (
            <>
              <p className="sub-state-line" role="status">
                <span className={`badge ${sub.status === 'SUSPENDED' ? 'badge-warn' : 'badge-closed'}`}>
                  {SUBSCRIPTION_STATUS_LABEL[sub.status]}
                </span>
                <span>
                  {sub.status === 'CANCELLED' && periodEnd
                    ? `Access continues until ${periodEnd}`
                    : sub.status === 'SUSPENDED'
                      ? 'Payment verification in progress'
                      : 'Ended. Start again any time.'}
                </span>
              </p>
              <Button full disabled={busy} onClick={() => act(() => startBusinessTrial(props.businessId))}>
                {busy ? 'Starting…' : `Start ${plan.trialDays}-day free trial`}
              </Button>
            </>
          )}
        </section>
      ) : (
        <ErrorState message="Plan information is unavailable right now." onRetry={plans.reload} />
      )}

      {/* Manual payment flow (Phase 7B): pay-in details, receipt submission
          and history. Rendered for every subscription state — an expired or
          cancelled business pays the same way as a fresh one. */}
      <section aria-label="Subscription payments" style={{ marginTop: 16 }}>
        <div className="section-head-v3">
          <h2>Payments</h2>
        </div>
        <OwnerPayments businessId={props.businessId} />
      </section>
    </div>
  );
}

function CancelControl(props: {
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  if (!props.confirming) {
    return (
      <div className="btn-row" style={{ marginTop: 10 }}>
        <Button sm variant="ghost" onClick={props.onAsk} disabled={props.busy}>
          Cancel subscription
        </Button>
      </div>
    );
  }
  return (
    <div className="btn-row" role="alert" style={{ marginTop: 10 }}>
      <Button sm variant="danger" disabled={props.busy} onClick={props.onConfirm}>
        {props.busy ? 'Cancelling…' : 'Yes, cancel'}
      </Button>
      <Button sm variant="ghost" disabled={props.busy} onClick={props.onKeep}>
        Keep subscription
      </Button>
    </div>
  );
}
