import { getBusinessSubscription, listPaymentRequests, type BusinessSubscriptionState } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, Loading, Money } from '../components/ui.js';

/** One line of real subscription state, from the server, for owner surfaces. */
export function SubscriptionBadge(props: { businessId: string; variant?: 'line' | 'hero'; onOpen?: () => void }) {
  const sub = useAsyncData<BusinessSubscriptionState | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);

  if (sub.loading) return <Loading label="Checking your plan…" />;
  const s = sub.data?.subscription ?? null;
  if (sub.error || !s) return null; // Quietly hidden rather than inventing a state.
  const daysRemaining = s.trialEndAt
    ? Math.max(0, Math.ceil((new Date(s.trialEndAt).getTime() - Date.now()) / 86_400_000))
    : null;
  const renews = new Date(s.currentPeriodEndAt).toLocaleDateString();

  const copy = (() => {
    if (s.status === 'TRIAL')
      return {
        status: 'TRIAL' as const,
        title: 'Free Trial',
        sub: daysRemaining !== null ? `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining` : 'Trial in progress',
      };
    if (s.status === 'ACTIVE')
      return { status: 'ACTIVE' as const, title: 'Business Plan', sub: `Active · Renews ${renews}` };
    if (s.status === 'CANCELLED')
      return { status: 'CANCELLED' as const, title: 'Plan Cancelled', sub: `Access until ${renews}` };
    if (s.status === 'SUSPENDED')
      return { status: 'PENDING' as const, title: 'Plan Pending', sub: 'Payment verification in progress' };
    return { status: 'EXPIRED' as const, title: 'Plan Expired', sub: 'Renew to continue' };
  })();

  // Hero variant: the navy plan card used on the business dashboard.
  if (props.variant === 'hero') {
    const body = (
      <>
        <span className="plan-card-icon" aria-hidden>
          ★
        </span>
        <span className="plan-card-main">
          <span className="plan-card-title">{copy.title}</span>
          <span className="plan-card-sub">{copy.sub}</span>
        </span>
        <span className="plan-card-badge">{copy.status}</span>
      </>
    );
    return (
      <div className="plan-card" data-status={copy.status}>
        {props.onOpen ? (
          <button
            type="button"
            onClick={props.onOpen}
            style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', color: 'inherit', textAlign: 'left' }}
          >
            {body}
          </button>
        ) : (
          body
        )}
      </div>
    );
  }

  // Line variant: the original compact inline badge.
  return (
    <p className="sub-badge" data-status={copy.status}>
      <span className="sub-badge-icon" aria-hidden>★</span>
      {copy.title}: {copy.sub}
    </p>
  );
}

/**
 * Prominent plan card for the business profile: current plan name,
 * subscription status, trial status with days remaining, monthly price,
 * renewal date when applicable, and payment status — all from the server.
 * Actions open the full subscription screen ("Manage plan") and its payments
 * section ("View payment history").
 */
export function OwnerPlanCard(props: {
  businessId: string;
  onManagePlan: () => void;
  onViewPayments: () => void;
}) {
  const sub = useAsyncData<BusinessSubscriptionState | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);
  const requests = useAsyncData(() => listPaymentRequests(props.businessId), [props.businessId]);

  if (sub.loading) return <Loading label="Checking your plan…" />;
  if (sub.error) return null; // Quietly hidden rather than inventing a state.

  const state = sub.data;
  const s = state?.subscription ?? null;
  const trialWindow = state?.trial ?? null;
  const plan = s?.plan ?? null;
  const trialDaysLeft =
    trialWindow?.daysRemaining ??
    (s?.status === 'TRIAL' && s.trialEndAt
      ? Math.max(0, Math.ceil((new Date(s.trialEndAt).getTime() - Date.now()) / 86_400_000))
      : null);
  const latestRequest = (requests.data ?? [])[0] ?? null;
  const paymentStatus = latestRequest
    ? latestRequest.status === 'PENDING'
      ? 'Payment under review'
      : latestRequest.status === 'APPROVED'
        ? 'Last payment approved'
        : latestRequest.status === 'REJECTED'
          ? 'Last payment rejected'
          : 'Last payment cancelled'
    : 'No payments yet';

  const statusBadge =
    !s || s.status === 'EXPIRED' || s.status === 'CANCELLED'
      ? 'badge-closed'
      : s.status === 'SUSPENDED'
        ? 'badge-warn'
        : 'badge-open';
  const statusText = !s
    ? 'No subscription'
    : s.status === 'TRIAL'
      ? trialDaysLeft !== null
        ? `Free trial: ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} remaining`
        : 'Free trial'
      : s.status === 'ACTIVE'
        ? 'Active'
        : s.status === 'SUSPENDED'
          ? 'Payment verification in progress'
          : s.status === 'CANCELLED'
            ? 'Cancelled'
            : 'Expired';

  return (
    <section className="sub-plan-card" aria-label="NearbyOrders plan">
      <div className="sub-plan-head">
        <span className="sub-plan-name">{plan?.name ?? 'NearbyOrders Plan'}</span>
        {plan ? (
          <span className="sub-plan-price">
            <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
            <span className="muted"> /month</span>
          </span>
        ) : null}
      </div>
      <p className="sub-state-line" role="status">
        <span className={`badge ${statusBadge}`}>{statusText}</span>
        {s?.status === 'ACTIVE' ? <span>Renews {new Date(s.currentPeriodEndAt).toLocaleDateString()}</span> : null}
        {s?.status === 'TRIAL' && trialWindow?.endsAt ? (
          <span>Trial ends {new Date(trialWindow.endsAt).toLocaleDateString()}</span>
        ) : null}
      </p>
      <div className="pay-details" style={{ marginTop: 8 }}>
        <div className="pay-detail-row">
          <span className="pay-detail-label">Payment status</span>
          <span className="pay-detail-value">{paymentStatus}</span>
        </div>
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <Button sm onClick={props.onManagePlan}>
          Manage plan
        </Button>
        <Button sm variant="secondary" onClick={props.onViewPayments}>
          View payment history
        </Button>
      </div>
    </section>
  );
}
