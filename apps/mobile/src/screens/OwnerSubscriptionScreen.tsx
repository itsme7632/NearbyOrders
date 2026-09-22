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
import { CheckIcon, ChevronRightIcon, StarIcon } from '../components/icons.js';
import { OwnerChoosePlan } from './OwnerChoosePlanScreen.js';
import { OwnerPayments } from './OwnerSubscriptionPayments.js';

const SUBSCRIPTION_STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUSPENDED: 'Suspended',
};

/** Small gift glyph for the trial banner (no icon asset needed). */
function GiftGlyph() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
      <path d="M12 8v13" />
      <path d="M12 8c-4 0-5.5-1-6.5-2.5C4.7 4 6 3 7.2 3.6 8.9 4.5 12 8 12 8z" />
      <path d="M12 8c4 0 5.5-1 6.5-2.5C19.3 4 18 3 16.8 3.6 15.1 4.5 12 8 12 8z" />
    </svg>
  );
}

/** Scrolls to a section on this long screen; guarded for non-DOM test envs. */
function scrollToSection(id: string) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Business subscription: the live plan catalog (every number — price, trial
 * days, renewal date — comes from the API), the server-decided free trial,
 * plan management rows, and the manual payment flow. Submitting payment
 * proof never claims activation: the NearbyOrders team reviews every
 * request.
 */
export function OwnerSubscription(props: { businessId: string; businessName?: string }) {
  const subscription = useAsyncData<BusinessSubscriptionState | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);
  const plans = useAsyncData<SubscriptionPlan[]>(() => listSubscriptionPlans(), []);
  const requests = useAsyncData<PaymentRequest[]>(() => listPaymentRequests(props.businessId), [props.businessId]);
  const [choosingPlan, setChoosingPlan] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [paySignal, setPaySignal] = useState(0);
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
  // owner's explicit choice, else the highlighted catalog plan, else the
  // first row as a last resort. Never an arbitrary pick.
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

  // Defensive: the payment history must be an array before indexing or
  // passing it down — a non-array wire shape must never throw during render.
  const requestList = Array.isArray(requests.data) ? requests.data : [];
  const latestRequest = requestList[0] ?? null;
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

  const intervalSuffix = plan.billingInterval === 'MONTHLY' ? 'month' : plan.billingInterval.toLowerCase();
  const statusBadgeClass = !sub
    ? 'badge-neutral'
    : sub.status === 'TRIAL' || sub.status === 'ACTIVE'
      ? 'badge-open'
      : sub.status === 'SUSPENDED'
        ? 'badge-warn'
        : 'badge-closed';

  return (
    <div className="sub-screen">
      {/* The OwnerScreen chrome renders the page title ("Business
          Subscription"); this is the supporting heading line. */}
      <p className="sub-lede">Choose the right plan for your business</p>

      {error ? <ErrorState message={error} /> : null}
      {trialNotice ? (
        <p className="save-ok" role="status">
          {trialNotice}
        </p>
      ) : null}

      {/* My subscription: the current plan state, all from the server. */}
      <section className="sub-section" aria-label="My subscription">
        <h2 className="sub-section-title">My subscription</h2>
        <div className="sub-plan-card">
          <div className="sub-plan-head">
            <span className="sub-plan-name">{plan.name}</span>
            <span className="sub-plan-price">
              <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
              <span className="muted"> /{intervalSuffix}</span>
            </span>
          </div>
          {plan.description ? <p className="sub-plan-desc">{plan.description}</p> : null}
          <p className="sub-state-line" role="status">
            <span className={`badge ${statusBadgeClass}`}>
              {sub ? SUBSCRIPTION_STATUS_LABEL[sub.status] : 'No subscription'}
            </span>
            {sub?.status === 'TRIAL' && trialDaysLeft !== null ? (
              <span>
                {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} remaining (trial ends{' '}
                {trialWindow?.endsAt ? new Date(trialWindow.endsAt).toLocaleDateString() : 'soon'})
              </span>
            ) : null}
            {sub?.status === 'ACTIVE' && renewalDate ? <span>Renews {renewalDate}</span> : null}
            {sub && sub.status !== 'TRIAL' && sub.status !== 'ACTIVE' && renewalDate ? (
              <span>Ended {renewalDate}</span>
            ) : null}
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
        </div>
      </section>

      {/* Free trial: server-authoritative. The banner shows only while the
          trial is actually offerable; the trial days always come from the
          working plan, never from client constants. */}
      {!isLive ? (
        ineligibilityReason ? (
          <p className="hint sub-note" role="status">
            {ineligibilityReason}
          </p>
        ) : (
          <section className="sub-trial-card" aria-label="Free trial">
            <div className="sub-trial-hero">
              <span className="sub-trial-icon" aria-hidden>
                <GiftGlyph />
              </span>
              <div className="sub-trial-main">
                <span className="sub-trial-title">{plan.trialDays}-day free trial</span>
                <span className="sub-trial-sub">
                  Try all features free for {plan.trialDays} days. No payment required now.
                </span>
              </div>
            </div>
            <Button full disabled={busy} onClick={startTrial}>
              {busy ? 'Starting…' : `Start ${plan.trialDays}-day free trial`}
            </Button>
            <p className="sub-trial-fine">
              The trial includes everything in the {plan.name} plan. The team activates it on our side after you apply.
            </p>
          </section>
        )
      ) : null}

      {/* Live plan catalog: every card renders from the server. The
          highlighted plan (server flag) gets the Recommended badge and the
          stronger card treatment; the subscription's own plan gets the
          Current plan state. */}
      <section className="sub-section" aria-label="Available plans" id="sub-plans">
        <h2 className="sub-section-title">Plans</h2>
        <div className="sub-plan-list">
          {activePlans.map((p) => {
            const isCurrent = sub?.plan?.slug === p.slug;
            const isWorking = !sub && plan.slug === p.slug;
            return (
              <article
                key={p.id}
                aria-label={p.name}
                className={`sub-plan-card sub-plan-option${p.isHighlighted ? ' sub-plan-featured' : ''}`}
              >
                <div className="sub-plan-top">
                  <span className="sub-plan-name">{p.name}</span>
                  <span className="sub-plan-badges">
                    {p.isHighlighted ? <span className="badge-rec">Recommended</span> : null}
                    {isCurrent ? <span className="badge badge-open">Current plan</span> : null}
                    {isWorking && !isCurrent ? <span className="badge badge-neutral">Selected</span> : null}
                  </span>
                </div>
                {p.description ? <p className="sub-plan-desc">{p.description}</p> : null}
                <p className="sub-plan-price">
                  <Money minor={p.monthlyPriceMinor} currency={p.currency} />
                  <span className="muted">
                    {' '}
                    /{p.billingInterval === 'MONTHLY' ? 'month' : p.billingInterval.toLowerCase()}
                  </span>
                </p>
                {p.trialDays > 0 ? (
                  <p className="sub-plan-trial">{p.trialDays}-day free trial included</p>
                ) : null}
                {(p.benefits ?? []).length > 0 ? (
                  <ul className="sub-benefits">
                    {(p.benefits ?? []).map((b) => (
                      <li key={b}>
                        <CheckIcon size={14} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!sub && !isCurrent && !isWorking && !ineligibilityReason ? (
                  <Button variant="secondary" full onClick={() => setSelectedSlug(p.slug)}>
                    Choose {p.name}
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {/* Plan management rows. */}
      <section className="sub-section" aria-label="Manage subscription">
        <h2 className="sub-section-title">Manage</h2>
        <div className="sub-rows">
          <button type="button" className="sub-row" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen}>
            <span className="sub-row-main">
              <span className="sub-row-title">Plan details</span>
              <span className="sub-row-sub">Price, billing and what is included</span>
            </span>
            <ChevronRightIcon size={18} />
          </button>
          {detailsOpen ? (
            <div className="sub-row-panel">
              <div className="pay-details">
                <div className="pay-detail-row">
                  <span className="pay-detail-label">Plan</span>
                  <span className="pay-detail-value">{plan.name}</span>
                </div>
                <div className="pay-detail-row">
                  <span className="pay-detail-label">Price</span>
                  <span className="pay-detail-value">
                    <Money minor={plan.monthlyPriceMinor} currency={plan.currency} /> /{intervalSuffix}
                  </span>
                </div>
                <div className="pay-detail-row">
                  <span className="pay-detail-label">Billing</span>
                  <span className="pay-detail-value">
                    {plan.billingInterval === 'MONTHLY' ? 'Monthly' : plan.billingInterval.toLowerCase()}
                  </span>
                </div>
                {plan.trialDays > 0 ? (
                  <div className="pay-detail-row">
                    <span className="pay-detail-label">Free trial</span>
                    <span className="pay-detail-value">{plan.trialDays} days</span>
                  </div>
                ) : null}
              </div>
              {(plan.benefits ?? []).length > 0 ? (
                <ul className="sub-benefits">
                  {(plan.benefits ?? []).map((b) => (
                    <li key={b}>
                      <CheckIcon size={14} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <button type="button" className="sub-row" onClick={() => setChoosingPlan((v) => !v)} aria-expanded={choosingPlan}>
            <span className="sub-row-main">
              <span className="sub-row-title">Change plan</span>
              <span className="sub-row-sub">Pick the plan your trial and payments use</span>
            </span>
            <ChevronRightIcon size={18} />
          </button>
          {choosingPlan ? (
            <div className="sub-row-panel">
              <OwnerChoosePlan
                businessId={props.businessId}
                onBack={() => setChoosingPlan(false)}
                onSelect={(p) => {
                  setSelectedSlug(p.slug);
                  setChoosingPlan(false);
                  scrollToSection('sub-plans');
                }}
              />
            </div>
          ) : null}

          <button type="button" className="sub-row" onClick={() => scrollToSection('sub-payments')}>
            <span className="sub-row-main">
              <span className="sub-row-title">Payment methods</span>
              <span className="sub-row-sub">The accounts you pay into</span>
            </span>
            <ChevronRightIcon size={18} />
          </button>
          <button
            type="button"
            className="sub-row"
            onClick={() => {
              setPaySignal((s) => s + 1);
              scrollToSection('sub-payments');
            }}
          >
            <span className="sub-row-main">
              <span className="sub-row-title">Make a payment</span>
              <span className="sub-row-sub">Submit your payment proof for review</span>
            </span>
            <ChevronRightIcon size={18} />
          </button>
          <button type="button" className="sub-row" onClick={() => scrollToSection('sub-pay-history')}>
            <span className="sub-row-main">
              <span className="sub-row-title">Payment history</span>
              <span className="sub-row-sub">Every submission and its review status</span>
            </span>
            <ChevronRightIcon size={18} />
          </button>
        </div>
      </section>

      {/* Manual payment flow: pay-in details, receipt submission, history.
          Rendered for every subscription state — an expired business pays the
          same way as a fresh one. */}
      <section className="sub-section" aria-label="Subscription payments" id="sub-payments">
        <h2 className="sub-section-title">Payments</h2>
        <p className="sub-how">
          How manual payment works: pay the exact plan amount to one of the accounts below, then submit your
          transaction reference and a photo of the receipt. The NearbyOrders team reviews every payment, and your
          subscription activates only after approval.
        </p>
        <OwnerPayments
          businessId={props.businessId}
          planPriceMinor={plan.monthlyPriceMinor}
          planCurrency={plan.currency}
          planName={plan.name}
          requests={Array.isArray(requests.data) ? requests.data : null}
          requestsLoading={requests.loading}
          requestsError={requests.error}
          onRequestsReload={requests.reload}
          openFormSignal={paySignal}
        />
      </section>
    </div>
  );
}
