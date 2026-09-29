import { useState } from 'react';
import {
  applyTrial,
  type BusinessSubscriptionState,
  type SubscriptionPlan,
} from '../api.js';
import { Button, ErrorState, Money } from '../components/ui.js';
import { CheckIcon } from '../components/icons.js';
import {
  HUB_STATUS_BADGE,
  HUB_STATUS_LABEL,
  getStoredPlanSlug,
  hubPath,
  hubStatusFor,
  intervalPerLabel,
  resolveWorkingPlan,
  setStoredPlanSlug,
} from './OwnerSubscriptionShared.js';

/**
 * P4: the free-trial conversion flow.
 *
 * CHOOSE PLAN -> START FREE TRIAL -> USE BUSINESS -> CONTINUE WITH SAME PLAN.
 *
 * Every number on screen — plan name, price, trial days, business allowance —
 * comes from the server (plan catalog / subscription state). Nothing is
 * hard-coded and nothing is derived from plan names. The server remains
 * authoritative for eligibility; the trial CTA only renders when the business
 * is listed (APPROVED) and the trial is ELIGIBLE, and applyTrial's 403/409
 * still carries the server's reason for anything missed here.
 *
 * There is no automated billing anywhere in this flow: after the trial the
 * owner continues with the same plan through the existing manual payment
 * process (Make a payment -> admin review -> approval). No "Renews", no
 * "Auto-renews", no implied charging.
 */

export type TrialFlowProps = {
  businessId: string;
  /** Server subscription state for the business (P2 contract). */
  state: BusinessSubscriptionState;
  /** Active catalog plans (P3 contract: includes maxBusinesses). */
  activePlans: SubscriptionPlan[];
  /** Opens another owner route (continuation CTAs). */
  onOpen?: (path: string) => void;
  /** Called after a successful trial start so the parent reloads. */
  onTrialStarted: () => void;
};

/** "1 business" / "3 businesses" from the server allowance. Never hard-coded. */
function allowanceLabel(maxBusinesses: number): string {
  return `${maxBusinesses} ${maxBusinesses === 1 ? 'business' : 'businesses'}`;
}

function TrialGiftGlyph() {
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

export function TrialFlow(props: TrialFlowProps) {
  const { businessId, state, activePlans } = props;
  const sub = state.subscription ?? null;
  const hubStatus = hubStatusFor(sub);
  const hasLiveSubscription = sub !== null && (sub.status === 'TRIAL' || sub.status === 'ACTIVE');
  const trialStatus = state.trialStatus ?? null;
  const businessStatus = state.businessStatus ?? null;
  const trialWindow = state.trial ?? null;

  // The working plan: subscription's plan, else the owner's stored choice,
  // else the highlighted catalog plan, else the first row. Never arbitrary.
  const workingPlan = resolveWorkingPlan(sub?.plan ?? null, activePlans, getStoredPlanSlug(businessId));

  const trialDaysLeft =
    trialWindow?.daysRemaining ??
    (sub?.status === 'TRIAL' && sub.trialEndAt
      ? Math.max(0, Math.ceil((new Date(sub.trialEndAt).getTime() - Date.now()) / 86_400_000))
      : null);

  // P2 §9: the free-trial offer is presentation-only; the server enforces
  // the same gate (APPROVED + ELIGIBLE + no live subscription + trial days).
  const trialOfferable =
    workingPlan !== null &&
    businessStatus === 'APPROVED' &&
    trialStatus === 'ELIGIBLE' &&
    !hasLiveSubscription &&
    workingPlan.trialDays > 0;
  const waitingForListingApproval =
    businessStatus !== null &&
    businessStatus !== 'APPROVED' &&
    trialStatus === 'ELIGIBLE' &&
    !hasLiveSubscription;
  const trialEndingSoon = hubStatus === 'TRIAL' && trialDaysLeft !== null && trialDaysLeft <= 3;
  const trialExpired = hubStatus === 'EXPIRED' && trialStatus === 'EXPIRED';

  const trialUnavailableReason =
    workingPlan !== null &&
    !hasLiveSubscription &&
    !trialOfferable &&
    !waitingForListingApproval &&
    !trialExpired &&
    workingPlan.trialDays > 0
      ? trialStatus === 'ACTIVE' || trialStatus === 'EXPIRED' || trialStatus === 'CONVERTED'
        ? 'Your free trial has already been used for this business.'
        : trialStatus === 'ELIGIBLE'
          ? 'Your business must be approved before you can start the free trial.'
          : // NOT_ELIGIBLE (or unknown): the trial unlocks after the
            // NearbyOrders team verifies and approves the business — never a
            // dead-end "not available".
            'Your free trial unlocks after the NearbyOrders team verifies and approves your business.'
      : null;

  return (
    <>
      {trialOfferable && workingPlan ? (
        <TrialOffer
          businessId={businessId}
          plans={activePlans}
          workingPlan={workingPlan}
          onTrialStarted={props.onTrialStarted}
        />
      ) : null}
      {waitingForListingApproval ? (
        <section className="sub-trial-card" aria-label="Waiting for listing approval">
          <div className="sub-trial-main">
            <span className="sub-trial-title">Waiting for listing approval</span>
            <span className="sub-trial-sub">
              Your business is verified, but it still needs listing approval before customers can find it.
              You&rsquo;ll be able to start your free trial once it&rsquo;s approved.
            </span>
          </div>
        </section>
      ) : null}
      {hubStatus === 'TRIAL' && workingPlan ? (
        <TrialActive
          plan={workingPlan}
          trialWindow={trialWindow}
          trialDaysLeft={trialDaysLeft}
          trialEndAt={sub?.trialEndAt ?? null}
          trialStartAt={sub?.trialStartAt ?? null}
          endingSoon={trialEndingSoon}
          onOpen={props.onOpen}
          businessId={businessId}
        />
      ) : null}
      {trialExpired && workingPlan ? (
        <TrialExpired plan={workingPlan} onOpen={props.onOpen} businessId={businessId} />
      ) : null}
      {!hasLiveSubscription && !trialExpired && trialUnavailableReason ? (
        <p className="hint sub-note" role="status">
          {trialUnavailableReason}
        </p>
      ) : null}
    </>
  );
}

/* ------------------------- Step 1 + 2: offer ------------------------- */

function TrialOffer(props: {
  businessId: string;
  plans: SubscriptionPlan[];
  workingPlan: SubscriptionPlan;
  onTrialStarted: () => void;
}) {
  const { businessId, plans, workingPlan } = props;
  // Pre-select the working plan (server subscription / stored choice /
  // highlighted), so a business with a valid trial plan does not have to
  // choose again. The owner can still pick a different plan.
  const [selectedSlug, setSelectedSlug] = useState<string>(workingPlan.slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const selected = plans.find((p) => p.slug === selectedSlug) ?? workingPlan;
  const trialPlans = plans.filter((p) => p.trialDays > 0);

  const startTrial = async () => {
    if (busy || started) return;
    setBusy(true);
    setError(null);
    try {
      // The server decides eligibility (403 NOT_ELIGIBLE / 409
      // ALREADY_SUBSCRIBED / 403 BUSINESS_NOT_APPROVED surface here with
      // the server's reason). Nothing is claimed before it confirms.
      await applyTrial(businessId, selected.slug);
      setStoredPlanSlug(businessId, selected.slug);
      setStarted(true);
      props.onTrialStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the free trial. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (started) {
    return (
      <section className="sub-trial-card" aria-label="Free trial started" role="status">
        <div className="sub-trial-hero">
          <span className="sub-trial-icon" aria-hidden>
            <TrialGiftGlyph />
          </span>
          <div className="sub-trial-main">
            <span className="sub-trial-title">Free trial started</span>
            <span className="sub-trial-sub">
              Your {selected.trialDays}-day free trial of {selected.name} is now active. No payment has
              been taken.
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="sub-trial-card" aria-label="Start your free trial">
      <div className="sub-trial-hero">
        <span className="sub-trial-icon" aria-hidden>
          <TrialGiftGlyph />
        </span>
        <div className="sub-trial-main">
          <span className="sub-trial-title">Start your free trial</span>
          <span className="sub-trial-sub">
            Choose a plan to try free. No payment required today.
          </span>
        </div>
      </div>

      {/* Step 1: plan selection. One plan, from the server catalog. */}
      <div className="plan-option-list" role="radiogroup" aria-label="Choose a plan for your free trial">
        {trialPlans.map((plan) => {
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
                <span className="muted"> /{intervalPerLabel(plan.billingInterval)}</span>
              </span>
              <span className="plan-option-trial">{plan.trialDays}-day free trial included</span>
              <span className="plan-option-allowance">{allowanceLabel(plan.maxBusinesses)} included</span>
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

      {/* Step 2: confirmation for the selected plan. All numbers from the server. */}
      <div className="sub-trial-confirm" aria-live="polite">
        <p className="sub-trial-confirm-title">
          Try {selected.name} free for {selected.trialDays} days
        </p>
        <p className="sub-trial-confirm-line">
          <Money minor={selected.monthlyPriceMinor} currency={selected.currency} />
          <span className="muted">/{intervalPerLabel(selected.billingInterval)} after trial</span>
        </p>
        <p className="sub-trial-confirm-line">No payment required today.</p>
        <p className="sub-trial-confirm-line muted">
          {allowanceLabel(selected.maxBusinesses)} included. Your trial starts immediately when you
          apply. Your business remains subject to the normal approval and listing lifecycle.
        </p>
        {error ? <ErrorState message={error} /> : null}
        <Button full disabled={busy} onClick={startTrial}>
          {busy ? 'Starting…' : `Start ${selected.trialDays}-Day Free Trial`}
        </Button>
      </div>
    </section>
  );
}

/* ------------------------- Step 3: active trial ------------------------- */

function TrialActive(props: {
  plan: SubscriptionPlan;
  trialWindow: { startsAt: string; endsAt: string; daysRemaining: number } | null;
  trialDaysLeft: number | null;
  trialEndAt: string | null;
  trialStartAt: string | null;
  endingSoon: boolean;
  businessId: string;
  onOpen?: (path: string) => void;
}) {
  const { plan } = props;
  const endsAt = props.trialWindow?.endsAt ?? props.trialEndAt;
  const startsAt = props.trialWindow?.startsAt ?? props.trialStartAt;
  const daysLeft = props.trialWindow?.daysRemaining ?? props.trialDaysLeft;

  const countdown =
    daysLeft === null
      ? null
      : daysLeft <= 0
        ? 'Your trial ends today.'
        : daysLeft === 1
          ? '1 day remaining'
          : `${daysLeft} days remaining`;

  return (
    <section className="sub-trial-card" aria-label="Active free trial">
      <div className="sub-trial-hero">
        <span className="sub-trial-icon" aria-hidden>
          <TrialGiftGlyph />
        </span>
        <div className="sub-trial-main">
          <span className="sub-trial-title">
            {plan.name} <span className={`badge ${HUB_STATUS_BADGE.TRIAL}`}>{HUB_STATUS_LABEL.TRIAL}</span>
          </span>
          {countdown ? <span className="sub-trial-sub">{countdown}</span> : null}
        </div>
      </div>

      <div className="pay-details" style={{ marginTop: 10 }}>
        {startsAt ? (
          <div className="pay-detail-row">
            <span className="pay-detail-label">Trial started</span>
            <span className="pay-detail-value">{new Date(startsAt).toLocaleDateString()}</span>
          </div>
        ) : null}
        {endsAt ? (
          <div className="pay-detail-row">
            <span className="pay-detail-label">Trial ends</span>
            <span className="pay-detail-value">{new Date(endsAt).toLocaleDateString()}</span>
          </div>
        ) : null}
        <div className="pay-detail-row">
          <span className="pay-detail-label">After trial</span>
          <span className="pay-detail-value">
            <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
            <span className="muted">/{intervalPerLabel(plan.billingInterval)}</span>
          </span>
        </div>
        <div className="pay-detail-row">
          <span className="pay-detail-label">Businesses</span>
          <span className="pay-detail-value">{allowanceLabel(plan.maxBusinesses)} included</span>
        </div>
        <div className="pay-detail-row">
          <span className="pay-detail-label">Payment</span>
          <span className="pay-detail-value">No payment has been taken.</span>
        </div>
      </div>

      {props.endingSoon ? (
        <div className="sub-trial-ending" role="status">
          <p className="sub-trial-ending-title">Your trial ends soon.</p>
          <p className="sub-trial-ending-sub">
            Choose a plan to continue your subscription. No money will be charged automatically.
            Continuing is always your choice.
          </p>
          <Button full onClick={() => props.onOpen?.(`${hubPath(props.businessId)}-make-payment`)}>
            Continue with {plan.name}
          </Button>
          <p className="hint" style={{ marginTop: 8 }}>
            You&rsquo;ll pay manually and the NearbyOrders team will review your payment before your
            subscription activates.
          </p>
        </div>
      ) : (
        <p className="hint sub-note">
          When your trial ends, choose a plan to continue. Your business stays listed under the normal
          approval lifecycle either way.
        </p>
      )}
    </section>
  );
}

/* ------------------------- Step 5: trial expired ------------------------- */

function TrialExpired(props: { plan: SubscriptionPlan; businessId: string; onOpen?: (path: string) => void }) {
  const { plan } = props;
  return (
    <section className="sub-trial-card" aria-label="Free trial ended" role="status">
      <div className="sub-trial-main">
        <span className="sub-trial-title">Your free trial has ended.</span>
        <span className="sub-trial-sub">Your business is still here.</span>
      </div>
      <p className="sub-trial-confirm-line" style={{ marginTop: 8 }}>
        Choose a plan to continue your subscription. Nothing was charged, and your subscription only
        continues when you choose to continue it.
      </p>
      <div style={{ marginTop: 12 }}>
        <Button full onClick={() => props.onOpen?.(`${hubPath(props.businessId)}-make-payment`)}>
          Continue with {plan.name}
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
        <span className="muted">/{intervalPerLabel(plan.billingInterval)}</span> after you complete the
        manual payment and the NearbyOrders team approves it. Prefer a different plan?{' '}
        <button
          type="button"
          className="link-inline"
          onClick={() => props.onOpen?.(`${hubPath(props.businessId)}-change-plan`)}
        >
          Choose another plan
        </button>
        .
      </p>
    </section>
  );
}
