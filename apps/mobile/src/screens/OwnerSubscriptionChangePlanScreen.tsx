import { getBusinessSubscription, type BusinessSubscriptionState } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { ErrorState, Loading } from '../components/ui.js';
import { OwnerChoosePlan } from './OwnerChoosePlanScreen.js';
import { setStoredPlanSlug } from './OwnerSubscriptionShared.js';

/**
 * Change plan: every live plan from GET /subscription/plans as selectable
 * cards — name, description, price, billing period, trial period, benefits,
 * the Recommended badge only from the server's isHighlighted flag, and a
 * Current plan indicator for the plan the subscription already uses.
 * Selecting a plan makes it the working plan for the trial and payments
 * (persisted per business), then returns to the hub.
 *
 * Rendered inside the OwnerScreen chrome, which provides the back button to
 * the subscription hub — this screen never renders its own.
 */
export function OwnerSubscriptionChangePlan(props: { businessId: string; onBack: () => void }) {
  const subscription = useAsyncData<BusinessSubscriptionState | null>(
    () => getBusinessSubscription(props.businessId),
    [props.businessId],
  );

  if (subscription.loading) return <Loading label="Loading plans…" />;
  if (subscription.error) return <ErrorState message={subscription.error} onRetry={subscription.reload} />;

  const currentPlanSlug = subscription.data?.subscription?.plan?.slug ?? null;

  return (
    <OwnerChoosePlan
      businessId={props.businessId}
      currentPlanSlug={currentPlanSlug}
      onSelect={(plan) => {
        setStoredPlanSlug(props.businessId, plan.slug);
        props.onBack();
      }}
    />
  );
}
