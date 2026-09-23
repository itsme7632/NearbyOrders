import {
  getBusinessSubscription,
  listSubscriptionPlans,
  type BusinessSubscriptionState,
  type SubscriptionPlan,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { CheckIcon, StarIcon } from '../components/icons.js';
import {
  HUB_STATUS_BADGE,
  HUB_STATUS_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  getStoredPlanSlug,
  hubStatusFor,
  intervalNameLabel,
  intervalPerLabel,
  resolveWorkingPlan,
} from './OwnerSubscriptionShared.js';

/**
 * Plan details: the current plan only — name, price, billing period, trial
 * info, status, and the full benefits list in a clean hierarchy. Every value
 * comes from the server; no catalog browsing here (that lives on the Change
 * plan route).
 *
 * Rendered inside the OwnerScreen chrome, which provides the back button to
 * the subscription hub — this screen never renders its own.
 */
export function OwnerSubscriptionPlanDetails(props: { businessId: string }) {
  const subscription = useAsyncData<BusinessSubscriptionState | null>(
    () => getBusinessSubscription(props.businessId),
    [props.businessId],
  );
  const plans = useAsyncData<SubscriptionPlan[]>(() => listSubscriptionPlans(), []);

  if (subscription.loading || plans.loading) return <Loading label="Loading plan details…" />;
  if (subscription.error) return <ErrorState message={subscription.error} onRetry={subscription.reload} />;
  if (plans.error) return <ErrorState message={plans.error} onRetry={plans.reload} />;

  const sub = subscription.data?.subscription ?? null;
  const activePlans = (plans.data ?? []).filter((p) => p.isActive);
  const plan = resolveWorkingPlan(sub?.plan ?? null, activePlans, getStoredPlanSlug(props.businessId));
  if (!plan) {
    return (
      <EmptyState
        icon={<StarIcon size={22} />}
        title="No plan to show"
        body="There are no subscription plans to show at the moment. Try again later."
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
  const intervalSuffix = intervalPerLabel(plan.billingInterval);
  const benefits = plan.benefits ?? [];

  return (
    <div className="sub-screen">
      <p className="sub-lede">Everything about the plan your business is on</p>

      <section className="sub-section" aria-label="Plan details">
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
            {sub ? <span className="muted">{SUBSCRIPTION_STATUS_LABEL[sub.status]}</span> : null}
          </p>
        </div>

        <div className="pay-details" style={{ marginTop: 14 }}>
          <div className="pay-detail-row">
            <span className="pay-detail-label">Price</span>
            <span className="pay-detail-value">
              <Money minor={plan.monthlyPriceMinor} currency={plan.currency} /> /{intervalSuffix}
            </span>
          </div>
          <div className="pay-detail-row">
            <span className="pay-detail-label">Billing</span>
            <span className="pay-detail-value">{intervalNameLabel(plan.billingInterval)}</span>
          </div>
          <div className="pay-detail-row">
            <span className="pay-detail-label">Free trial</span>
            <span className="pay-detail-value">
              {plan.trialDays > 0 ? `${plan.trialDays} day${plan.trialDays === 1 ? '' : 's'}` : 'Not included'}
            </span>
          </div>
          {sub?.status === 'TRIAL' && sub.trialEndAt ? (
            <div className="pay-detail-row">
              <span className="pay-detail-label">Trial ends</span>
              <span className="pay-detail-value">{new Date(sub.trialEndAt).toLocaleDateString()}</span>
            </div>
          ) : null}
          {sub ? (
            <div className="pay-detail-row">
              <span className="pay-detail-label">Current period ends</span>
              <span className="pay-detail-value">{new Date(sub.currentPeriodEndAt).toLocaleDateString()}</span>
            </div>
          ) : null}
        </div>

        {benefits.length > 0 ? (
          <>
            <h2 className="sub-section-title" style={{ marginTop: 18 }}>
              What is included
            </h2>
            <ul className="sub-benefits">
              {benefits.map((b) => (
                <li key={b}>
                  <CheckIcon size={14} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
