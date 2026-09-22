import { useState } from 'react';
import {
  getBusinessSubscription,
  listSubscriptionPlans,
  listPaymentRequests,
  applyTrial,
  type PaymentRequest,
  type Subscription,
  type BusinessSubscriptionState,
  type SubscriptionPlan,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { StarIcon } from '../components/icons.js';
import { OwnerChoosePlan } from './OwnerChoosePlanScreen.js';
import { OwnerPayments } from './OwnerSubscriptionPayments.js';

const SUBSCRIPTION_STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUSPENDED: 'Suspended',
};

/**
 * Business subscription: the live plan state, trial application for the
 * selected plan, plan management, and the manual payment flow. Every number
 * (price, trial days, renewal date) comes from the API — trial terms are
 * never hard-coded, and submitting payment proof never claims activation:
 * the NearbyOrders team reviews every request.
 */
export function OwnerSubscription(props: { businessId: string; businessName?: string }) {
  const subscription = useAsyncData<BusinessSubscriptionState | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);
  const plans = useAsyncData<SubscriptionPlan[]>(() => listSubscriptionPlans(), []);
  const requests = useAsyncData<PaymentRequest[]>(() => listPaymentRequests(props.businessId), [props.businessId]);
  const [choosingPlan, setChoosingPlan] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trialNotice, setTrialNotice] = useState<string | null>(null);

  if (subscription.loading || plans.loading) return <Loading label="Loading subscription…" />;
  if (subscription.error) return <ErrorState message={subscription.error} onRetry={subscription.reload} />;
  if (plans.error) return <ErrorState message={plans.error} onRetry={plans.reload} />;

  const state = subscription.data;
  const sub = state?.subscription ?? null;
  const activePlans = (plans.data ?? []).filter((p) => p.isActive);
  // The working plan: the subscription's plan when one exists, else the
  // owner's explicit choice, else the highlighted catalog plan. Never an
  // arbitrary first row.
  const plan =
    sub?.plan ??
    activePlans.find((p) => p.slug === selectedSlug) ??
    activePlans.find((p) => p.isHighlighted) ??
    activePlans[0] ??
    null;
  if (!plan) {
    return (
      <EmptyState
        icon={<StarIcon size={22} />}
        title="No plans available right now"
        body="There are no subscription plans to show at the moment. Pull to refresh or try again later."
        action={
          <Button
            onClick={() => {
              subscription.reload();
              plans.reload();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }
  const isLive = sub?.status === 'TRIAL' || sub?.status === 'ACTIVE';
  // Trial eligibility is server-computed (trialStatus): ELIGIBLE means the
  // business may start its one trial; ACTIVE/EXPIRED/CONVERTED means the
  // trial was already used; anything else means not available right now.
  const trialStatus = state?.trialStatus ?? null;
  const trialWindow = state?.trial ?? null;
  const trialDaysLeft =
    trialWindow?.daysRemaining ??
    (sub?.status === 'TRIAL' && sub.trialEndAt
      ? Math.max(0, Math.ceil((new Date(sub.trialEndAt).getTime() - Date.now()) / 86_400_000))
      : null);
  const renewalDate = sub ? new Date(sub.currentPeriodEndAt).toLocaleDateString() : null;

  const latestRequest = (requests.data ?? [])[0] ?? null;
  const paymentStatus = latestRequest
    ? latestRequest.status === 'PENDING'
      ? 'Payment under review by the NearbyOrders team'
      : latestRequest.status === 'APPROVED'
        ? `Last payment approved${latestRequest.reviewedAt ? ` on ${new Date(latestRequest.reviewedAt).toLocaleDateString()}` : ''}`
        : latestRequest.status === 'REJECTED'
          ? 'Last payment was rejected (see history)'
          : 'Last payment request was cancelled'
    : 'No payments submitted yet';

  // Only the server's explicit ineligible verdict hides the CTA. With no
  // trial status yet there is no signal either way, so the trial stays
  // offered and applyTrial's 403/409 carries the server's reason.
  const ineligibilityReason =
    trialStatus && trialStatus !== 'ELIGIBLE'
      ? trialStatus === 'ACTIVE' || trialStatus === 'EXPIRED' || trialStatus === 'CONVERTED'
        ? 'Your free trial has already been used for this business.'
        : 'A free trial is not available for this business right now.'
      : null;

  const startTrial = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setTrialNotice(null);
    try {
      const result = await applyTrial(props.businessId, plan.slug);
      setTrialNotice(
        `Free trial started. It ends on ${result.trialEndAt ? new Date(result.trialEndAt).toLocaleDateString() : 'the end of the trial period'}. Add a payment before then to stay active.`,
      );
      subscription.reload();
    } catch (e) {
      // 403 NOT_ELIGIBLE / 409 ALREADY_SUBSCRIBED lands here with the
      // server's reason — surfaced verbatim, never invented.
      setError(e instanceof Error ? e.message : 'Could not start the free trial');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {error ? <ErrorState message={error} /> : null}
      {trialNotice ? (
        <p className="save-ok" role="status">
          {trialNotice}
        </p>
      ) : null}

      {/* Current plan state. */}
      <section className="sub-plan-card" aria-label="Current plan">
        <div className="sub-plan-head">
          <span className="sub-plan-name">{plan.name}</span>
          <span className="sub-plan-price">
            <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
            <span className="muted"> /month</span>
          </span>
        </div>
        {plan.description ? <p className="muted" style={{ marginTop: 6 }}>{plan.description}</p> : null}
        <p className="sub-state-line" role="status">
          <span className={`badge ${!sub ? 'badge-neutral' : sub.status === 'TRIAL' || sub.status === 'ACTIVE' ? 'badge-open' : sub.status === 'SUSPENDED' ? 'badge-warn' : 'badge-closed'}`}>
            {sub ? SUBSCRIPTION_STATUS_LABEL[sub.status] : 'No subscription'}
          </span>
          {sub?.status === 'TRIAL' && trialDaysLeft !== null ? (
            <span>
              {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} remaining (trial ends{' '}
              {trialWindow?.endsAt ? new Date(trialWindow.endsAt).toLocaleDateString() : 'soon'})
            </span>
          ) : null}
          {sub?.status === 'ACTIVE' && renewalDate ? <span>Renews {renewalDate}</span> : null}
        </p>
        <div className="pay-details" style={{ marginTop: 10 }}>
          <div className="pay-detail-row">
            <span className="pay-detail-label">Payment status</span>
            <span className="pay-detail-value">{paymentStatus}</span>
          </div>
          {latestRequest?.status === 'REJECTED' && latestRequest.rejectionReason ? (
            <div className="pay-detail-row">
              <span className="pay-detail-label">Rejection reason</span>
              <span className="pay-detail-value">{latestRequest.rejectionReason}</span>
            </div>
          ) : null}
        </div>
      </section>

      {/* Trial application. */}
      {!isLive ? (
        <section className="sub-plan-card" aria-label="Free trial" style={{ marginTop: 12 }}>
          <h3 className="sub-plan-name" style={{ fontSize: 15 }}>
            {plan.trialDays}-day free trial
          </h3>
          <p className="muted" style={{ marginTop: 4 }}>
            Try all features free for {plan.trialDays} days. No payment required now.
          </p>
          {ineligibilityReason ? (
            <p className="hint" role="status">
              {ineligibilityReason}
            </p>
          ) : (
            <Button full disabled={busy} onClick={startTrial} >
              {busy ? 'Starting…' : `Start ${plan.trialDays}-day free trial`}
            </Button>
          )}
        </section>
      ) : null}

      {/* Plan management: pick the plan the trial and the payment flow use. */}
      <section aria-label="Manage plan" style={{ marginTop: 12 }}>
        {choosingPlan ? (
          <OwnerChoosePlan
            businessId={props.businessId}
            onBack={() => setChoosingPlan(false)}
            onSelect={(p) => {
              setSelectedSlug(p.slug);
              setChoosingPlan(false);
            }}
          />
        ) : (
          <Button full variant="secondary" onClick={() => setChoosingPlan(true)}>
            Manage plan
          </Button>
        )}
      </section>

      {/* Manual payment flow: pay-in details, receipt submission, history.
          Rendered for every subscription state — an expired business pays the
          same way as a fresh one. */}
      <section aria-label="Subscription payments" style={{ marginTop: 16 }}>
        <div className="section-head-v3">
          <h2>Payments</h2>
        </div>
        <OwnerPayments
          businessId={props.businessId}
          planPriceMinor={plan.monthlyPriceMinor}
          planCurrency={plan.currency}
          planName={plan.name}
          requests={requests.data ?? null}
          requestsLoading={requests.loading}
          requestsError={requests.error}
          onRequestsReload={requests.reload}
        />
      </section>
    </div>
  );
}
