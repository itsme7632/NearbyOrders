import { getBusinessSubscription, type Subscription } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Loading } from '../components/ui.js';

/** One line of real subscription state, from the server, for owner surfaces. */
export function SubscriptionBadge(props: { businessId: string; variant?: 'line' | 'hero'; onOpen?: () => void }) {
  const sub = useAsyncData<Subscription | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);

  if (sub.loading) return <Loading label="Checking your plan…" />;
  if (sub.error || !sub.data) return null; // Quietly hidden rather than inventing a state.

  const s = sub.data;
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
