import { getBusinessSubscription, type Subscription } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Loading } from '../components/ui.js';

/** One line of real subscription state, from the server, for owner surfaces. */
export function SubscriptionBadge(props: { businessId: string }) {
  const sub = useAsyncData<Subscription | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);

  if (sub.loading) return <Loading label="Checking your plan…" />;
  if (sub.error || !sub.data) return null; // Quietly hidden rather than inventing a state.

  const s = sub.data;
  const daysRemaining = s.trialEndAt
    ? Math.max(0, Math.ceil((new Date(s.trialEndAt).getTime() - Date.now()) / 86_400_000))
    : null;
  const renews = new Date(s.currentPeriodEndAt).toLocaleDateString();

  if (s.status === 'TRIAL')
    return (
      <p className="sub-badge" data-status="TRIAL">
        <span className="sub-badge-icon" aria-hidden>🌱</span>
        Free Trial
        {daysRemaining !== null ? ` · ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining` : ''}
      </p>
    );
  if (s.status === 'ACTIVE')
    return (
      <p className="sub-badge" data-status="ACTIVE">
        <span className="sub-badge-icon" aria-hidden>✓</span>
        Business Plan: Active · Renews {renews}
      </p>
    );
  if (s.status === 'CANCELLED')
    return (
      <p className="sub-badge" data-status="CANCELLED">
        <span className="sub-badge-icon" aria-hidden>⏳</span>
        Plan Cancelled: access until {renews}
      </p>
    );
  if (s.status === 'SUSPENDED')
    return (
      <p className="sub-badge" data-status="SUSPENDED">
        <span className="sub-badge-icon" aria-hidden>⚠</span>
        Plan Suspended: payment verification in progress
      </p>
    );
  return (
    <p className="sub-badge" data-status="EXPIRED">
      <span className="sub-badge-icon" aria-hidden>·</span>
      Plan Expired: renew to continue
    </p>
  );
}
