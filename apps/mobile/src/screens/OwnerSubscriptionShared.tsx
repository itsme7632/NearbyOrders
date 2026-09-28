import type {
  PaymentMethod,
  PaymentRequestStatus,
  Subscription,
  SubscriptionPlan,
  SubscriptionRowPlan,
} from '../api.js';

/** A plan row in either server shape (catalog row or embedded row plan). */
export type AnyPlan = Pick<
  SubscriptionRowPlan,
  | 'slug'
  | 'name'
  | 'description'
  | 'monthlyPriceMinor'
  | 'currency'
  | 'trialDays'
  | 'benefits'
  | 'billingInterval'
  | 'isHighlighted'
>;

/**
 * The working plan for subscription actions (trial apply, amount due): the
 * subscription's own plan when one exists, else the owner's explicit choice,
 * else the highlighted catalog plan, else the first row as a last resort.
 * Never an arbitrary pick, and never hard-coded.
 */
export function resolveWorkingPlan(
  subPlan: SubscriptionRowPlan | null,
  activePlans: SubscriptionPlan[],
  selectedSlug: string | null,
): SubscriptionPlan | null {
  if (subPlan) {
    const catalog = activePlans.find((p) => p.slug === subPlan.slug);
    if (catalog) return catalog;
    // The subscription references a plan the catalog no longer lists: fall
    // through to the catalog rows rather than rendering a stale row.
  }
  return (
    activePlans.find((p) => p.slug === selectedSlug) ??
    activePlans.find((p) => p.isHighlighted) ??
    activePlans[0] ??
    null
  );
}

/* ----------------- owner-chosen plan (trial/payment target) ------- */

const SELECTED_PLAN_KEY = (businessId: string) => `nearbyorders:subscription:plan:${businessId}`;

function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Private mode or unavailable storage: fall through to null.
  }
  return null;
}

/** The plan the owner picked on the Change plan route, if any. */
export function getStoredPlanSlug(businessId: string): string | null {
  return storage()?.getItem(SELECTED_PLAN_KEY(businessId)) ?? null;
}

/** Persists the owner's plan pick so the hub's trial/payment flows use it. */
export function setStoredPlanSlug(businessId: string, slug: string): void {
  try {
    storage()?.setItem(SELECTED_PLAN_KEY(businessId), slug);
  } catch {
    // Storage unavailable: the choice simply does not persist.
  }
}

/* ------------------------------ labels ---------------------------- */

/**
 * Hub summary status, mapped 1:1 from the server's subscription row — never
 * collapsed. P2: EXPIRED / CANCELLED / SUSPENDED / no-subscription each say
 * what they are; none of them is "Payment required".
 */
export type HubStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED' | 'NONE';

export function hubStatusFor(sub: Subscription | null): HubStatus {
  if (!sub) return 'NONE';
  if (sub.status === 'TRIAL') return 'TRIAL';
  if (sub.status === 'ACTIVE') return 'ACTIVE';
  if (sub.status === 'EXPIRED') return 'EXPIRED';
  if (sub.status === 'CANCELLED') return 'CANCELLED';
  if (sub.status === 'SUSPENDED') return 'SUSPENDED';
  return 'NONE';
}

export const HUB_STATUS_LABEL: Record<HubStatus, string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  EXPIRED: 'Plan expired',
  CANCELLED: 'Plan cancelled',
  SUSPENDED: 'Subscription suspended',
  NONE: 'No plan yet',
};

export const HUB_STATUS_BADGE: Record<HubStatus, string> = {
  TRIAL: 'badge-open',
  ACTIVE: 'badge-open',
  EXPIRED: 'badge-warn',
  CANCELLED: 'badge-closed',
  SUSPENDED: 'badge-warn',
  NONE: 'badge-neutral',
};

/** Server detail statuses, kept for records that carry them. */
export const SUBSCRIPTION_STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUSPENDED: 'Suspended',
};

/** Owner-facing labels for manual payment-request states. */
export const PAYMENT_REQUEST_STATUS_LABEL: Record<PaymentRequestStatus, string> = {
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** "month" for MONTHLY, lowercase for anything else. */
export function intervalPerLabel(billingInterval: string): string {
  return billingInterval === 'MONTHLY' ? 'month' : billingInterval.toLowerCase();
}

/** "Monthly" for MONTHLY, lowercase otherwise. */
export function intervalNameLabel(billingInterval: string): string {
  return billingInterval === 'MONTHLY' ? 'Monthly' : billingInterval.toLowerCase();
}

/** The hub route for one business — the back target of every sub-screen. */
export function hubPath(businessId: string): string {
  return `/owner/${businessId}/subscription`;
}

/* ---------------------- pay-in channel card ----------------------- */

/**
 * One admin-configured pay-in channel: title, account title, account number
 * (IBAN for bank transfers), and instructions. Rendered only from server
 * data — no hard-coded channels anywhere.
 */
export function PaymentMethodCard({ method }: { method: PaymentMethod }) {
  return (
    <li className="pay-method">
      <span className="pay-method-name">{method.name}</span>
      <div className="pay-details">
        <div className="pay-detail-row">
          <span className="pay-detail-label">Account title</span>
          <span className="pay-detail-value">{method.accountTitle}</span>
        </div>
        <div className="pay-detail-row">
          <span className="pay-detail-label">{method.type === 'BANK_TRANSFER' ? 'IBAN / account' : 'Number'}</span>
          <span className="pay-detail-value pay-detail-mono">
            {method.type === 'BANK_TRANSFER' && method.iban ? method.iban : method.accountNumber}
          </span>
        </div>
      </div>
      {method.instructions ? <p className="hint">{method.instructions}</p> : null}
    </li>
  );
}

/**
 * Client-side payment-proof validation, shared by the subscription and
 * promotion payment flows. This only guards the form before touching the
 * network; the server re-validates everything (amount, method, receipt key).
 */
export function validatePaymentForm(form: {
  transactionReference: string;
  hasReceipt: boolean;
  paidAt?: string;
  note?: string;
}): string | null {
  const ref = form.transactionReference.trim();
  if (ref.length < 4) return 'Enter the transaction reference (at least 4 characters).';
  if (ref.length > 100) return 'Transaction reference must be at most 100 characters.';
  if (!form.hasReceipt) return 'Attach a photo of your payment receipt.';
  if (form.paidAt) {
    const paid = new Date(form.paidAt);
    if (Number.isNaN(paid.getTime())) return 'Enter a valid payment date.';
    if (paid.getTime() > Date.now()) return 'The payment date cannot be in the future.';
  }
  if ((form.note ?? '').length > 500) return 'The note must be at most 500 characters.';
  return null;
}
