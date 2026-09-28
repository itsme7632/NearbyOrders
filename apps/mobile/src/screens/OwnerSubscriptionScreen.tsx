import {
  getBusinessSubscription,
  listSubscriptionPlans,
  listPaymentRequests,
  type BusinessSubscriptionState,
  type PaymentRequest,
  type SubscriptionPlan,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { ChevronRightIcon, StarIcon } from '../components/icons.js';
import {
  HUB_STATUS_BADGE,
  HUB_STATUS_LABEL,
  getStoredPlanSlug,
  hubPath,
  hubStatusFor,
  intervalPerLabel,
  resolveWorkingPlan,
} from './OwnerSubscriptionShared.js';
import { TrialFlow } from './TrialFlow.js';

/**
 * My Subscription: a clean summary/dashboard. Current plan (name, price,
 * billing period), honest subscription status (Free trial / Active / Plan
 * expired / Plan cancelled / Subscription suspended / No plan yet), trial
 * remaining or plan-end info, payment status, then navigation rows to
 * the five dedicated routes — Plan details, Change plan, Payment methods,
 * Make a payment, Payment history — plus a short honest explanation of the
 * manual payment flow. None of the five destinations render inline here.
 *
 * Every number — price, trial days, renewal date — comes from the API.
 * Submitting payment proof never claims activation: the NearbyOrders team
 * reviews every request.
 */
export function OwnerSubscription(props: {
  businessId: string;
  businessName?: string;
  /** Opens another owner route (the Manage rows). Optional so the summary still renders without a router. */
  onOpen?: (path: string) => void;
}) {
  const subscription = useAsyncData<BusinessSubscriptionState | null>(
    () => getBusinessSubscription(props.businessId),
    [props.businessId],
  );
  const plans = useAsyncData<SubscriptionPlan[]>(() => listSubscriptionPlans(), []);
  const requests = useAsyncData<PaymentRequest[]>(() => listPaymentRequests(props.businessId), [props.businessId]);

  if (subscription.loading || plans.loading || requests.loading) return <Loading label="Loading subscription…" />;
  if (subscription.error) return <ErrorState message={subscription.error} onRetry={subscription.reload} />;
  if (plans.error) return <ErrorState message={plans.error} onRetry={plans.reload} />;
  if (requests.error) return <ErrorState message={requests.error} onRetry={requests.reload} />;

  const state = subscription.data;
  const sub = state?.subscription ?? null;
  const activePlans = (plans.data ?? []).filter((p) => p.isActive);
  // The working plan: the subscription's plan when one exists, else the
  // owner's explicit choice (Change plan route), else the highlighted
  // catalog plan, else the first row as a last resort. Never an arbitrary
  // pick.
  const plan = resolveWorkingPlan(sub?.plan ?? null, activePlans, getStoredPlanSlug(props.businessId));
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

  const hubStatus = hubStatusFor(sub);
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

  // Defensive: the payment history must be an array before indexing — a
  // non-array wire shape must never throw during render.
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

  // P4: the trial offer/active/expired flow lives in TrialFlow. The hub keeps
  // only the plan summary below; TrialFlow re-derives the same P2 gates
  // from the server state.

  const go = (suffix: string) => props.onOpen?.(`${hubPath(props.businessId)}${suffix}`);
  const rows: Array<{ title: string; sub: string; suffix: string }> = [
    { title: 'Plan details', sub: 'Price, billing and what is included', suffix: '-plan' },
    { title: 'Change plan', sub: 'Pick the plan your trial and payments use', suffix: '-change-plan' },
    { title: 'Payment methods', sub: 'The accounts you pay into', suffix: '-payment-methods' },
    { title: 'Make a payment', sub: 'Submit your payment proof for review', suffix: '-make-payment' },
    { title: 'Payment history', sub: 'Every submission and its review status', suffix: '-payment-history' },
  ];

  const intervalSuffix = intervalPerLabel(plan.billingInterval);

  return (
    <div className="sub-screen">
      {/* The OwnerScreen chrome renders the page title ("Business
          Subscription"); this is the supporting heading line. */}
      <p className="sub-lede">Your plan, payments and billing in one place</p>

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
            <span className={`badge ${HUB_STATUS_BADGE[hubStatus]}`}>{HUB_STATUS_LABEL[hubStatus]}</span>
            {hubStatus === 'TRIAL' && trialDaysLeft !== null ? (
              <span>
                {trialDaysLeft <= 3
                  ? trialDaysLeft === 0
                    ? 'Your trial ends today.'
                    : trialDaysLeft === 1
                      ? 'Your trial ends tomorrow.'
                      : `Your trial ends in ${trialDaysLeft} days.`
                  : `${trialDaysLeft} days remaining `}
                {trialDaysLeft > 3 && trialWindow?.endsAt ? (
                  <span>(trial ends {new Date(trialWindow.endsAt).toLocaleDateString()})</span>
                ) : null}
              </span>
            ) : null}
            {hubStatus === 'ACTIVE' && renewalDate ? <span>Plan active until {renewalDate}</span> : null}
            {hubStatus === 'EXPIRED' ? (
              <span>
                {trialStatus === 'EXPIRED'
                  ? 'Your free trial has ended.'
                  : 'Your plan has expired.'}
              </span>
            ) : null}
            {hubStatus === 'CANCELLED' && renewalDate ? <span>Access until {renewalDate}</span> : null}
            {hubStatus === 'SUSPENDED' ? <span>Contact the NearbyOrders team if you think this is a mistake.</span> : null}
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

      {/* P4: the free-trial conversion flow — plan selection, trial start,
          active/ending/expired states. All gates re-derived from the server
          state; all numbers from the plan catalog. */}
      {state ? (
        <TrialFlow
          businessId={props.businessId}
          state={state}
          activePlans={activePlans}
          onOpen={props.onOpen}
          onTrialStarted={subscription.reload}
        />
      ) : null}

      {/* Navigation rows: each opens its own dedicated route. None of the
          five destinations renders inline on this hub. */}
      <section className="sub-section" aria-label="Manage subscription">
        <h2 className="sub-section-title">Manage</h2>
        <div className="sub-rows">
          {rows.map((row) => (
            <button key={row.title} type="button" className="sub-row" onClick={() => go(row.suffix)}>
              <span className="sub-row-main">
                <span className="sub-row-title">{row.title}</span>
                <span className="sub-row-sub">{row.sub}</span>
              </span>
              <ChevronRightIcon size={18} />
            </button>
          ))}
        </div>
      </section>

      {/* Short, honest explanation of the manual payment flow. */}
      <section className="sub-section" aria-label="How manual payment works">
        <h2 className="sub-section-title">How manual payment works</h2>
        <p className="sub-how">
          There is no online checkout. Pay the exact plan amount to one of the accounts on the Payment methods
          screen, then submit your transaction reference and a photo of the receipt on the Make a payment screen.
          The NearbyOrders team reviews every payment, and your subscription activates only after approval.
        </p>
      </section>
    </div>
  );
}
