import { useState } from 'react';
import { listSubscriptionPlans, type SubscriptionPlan } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { CheckIcon, StarIcon } from '../components/icons.js';

/**
 * Choose Plan: every active plan from GET /subscription/plans — name, price,
 * billing interval, trial days, benefits, highlighted badge. The highlighted
 * catalog plan (server flag) gets the Recommended badge and the stronger
 * card treatment so it reads as the suggested choice. Selecting a plan hands
 * it back to the caller (trial apply or the payment flow); the amount always
 * comes from the server plan, never from client state.
 *
 * Rendered inside the OwnerScreen chrome by its route case, or inline in
 * the subscription screen's "Change plan" row; props carry the back handler
 * and the optional selection callback.
 */
export function OwnerChoosePlan(props: { businessId: string; onBack?: () => void; onSelect?: (plan: SubscriptionPlan) => void }) {
  const plans = useAsyncData<SubscriptionPlan[]>(() => listSubscriptionPlans(), []);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  if (plans.loading) return <Loading label="Loading plans…" />;
  if (plans.error) return <ErrorState message={plans.error} onRetry={plans.reload} />;

  const list = (plans.data ?? []).filter((p) => p.isActive);
  const selected = list.find((p) => p.slug === selectedSlug) ?? null;

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<StarIcon size={22} />}
        title="No plans available right now"
        body="There are no subscription plans to show at the moment. Try again later."
        action={<Button onClick={plans.reload}>Retry</Button>}
      />
    );
  }

  return (
    <div className="choose-plan">
      <p className="sub-lede">Select the plan your free trial and payments will use.</p>
      <div className="plan-option-list" role="radiogroup" aria-label="Subscription plans">
        {list.map((plan) => {
          const isSelected = plan.slug === selectedSlug;
          return (
            <button
              key={plan.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`plan-option${isSelected ? ' plan-option-selected' : ''}${plan.isHighlighted ? ' plan-option-highlighted' : ''}`}
              onClick={() => setSelectedSlug(plan.slug)}
            >
              <span className="plan-option-top">
                <span className="plan-option-name">{plan.name}</span>
                {plan.isHighlighted ? <span className="badge-rec">Recommended</span> : null}
              </span>
              {plan.description ? <span className="plan-option-desc">{plan.description}</span> : null}
              <span className="plan-option-price">
                <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
                <span className="muted"> /{plan.billingInterval === 'MONTHLY' ? 'month' : plan.billingInterval.toLowerCase()}</span>
              </span>
              {plan.trialDays > 0 ? (
                <span className="plan-option-trial">{plan.trialDays}-day free trial included</span>
              ) : null}
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
            </button>
          );
        })}
      </div>
      {props.onSelect ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <Button full disabled={!selected} onClick={() => selected && props.onSelect?.(selected)}>
            {selected ? `Continue with ${selected.name}` : 'Select a plan to continue'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
