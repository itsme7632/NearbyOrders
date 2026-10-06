import { useEffect } from 'react';
import { getVerification, getBusinessSubscription, listPaymentRequests } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { AlertIcon } from '../components/icons.js';
import { OwnerHubRow, OwnerHubSection } from './owner-ui.js';

/**
 * Actionable attention items only: verification not approved, an unused free
 * trial, or a subscription that needs attention (expiring soon, expired, or
 * a rejected payment). Renders nothing when everything is healthy.
 *
 * (Extracted from the removed OwnerDashboard; this is the only live export.)
 */
export function OwnerAttentionItems(props: {
  businessId: string;
  onOpenVerification: () => void;
  onOpenSubscription: () => void;
  /** Render only the rows (no labelled section wrapper) for embedding inside
      another section, e.g. the Overview's "Needs attention". */
  bare?: boolean;
  /** Reports loading/error/item-count so an embedding section can gate its
      own all-clear state instead of assuming healthy while still loading. */
  onStatus?: (s: { loading: boolean; error: boolean; count: number; retry: () => void }) => void;
}) {
  const verification = useAsyncData(() => getVerification(props.businessId), [props.businessId]);
  const subscription = useAsyncData(() => getBusinessSubscription(props.businessId), [props.businessId]);
  const requests = useAsyncData(() => listPaymentRequests(props.businessId), [props.businessId]);

  const loading = verification.loading || subscription.loading || requests.loading;
  const error = verification.error || subscription.error || requests.error;

  // Compute items before the early returns so the status callback always
  // reflects the real state (loading → error → items).
  const items: { title: string; subtitle: string; onClick: () => void }[] = [];
  if (!loading && !error) {
    const verificationStatus = verification.data?.application?.status ?? null;
    if (verificationStatus !== 'APPROVED') {
      items.push({
        title: 'Complete verification',
        subtitle:
          verificationStatus === 'SUBMITTED' || verificationStatus === 'UNDER_REVIEW'
            ? 'Your application is under review'
            : verificationStatus === 'CHANGES_REQUESTED'
              ? 'The review team asked for changes'
              : 'Get the verified badge for your business',
        onClick: props.onOpenVerification,
      });
    }

    const state = subscription.data;
    const sub = state?.subscription ?? null;
    const trialStatus = state?.trialStatus ?? null;
    const businessStatus = state?.businessStatus ?? null;
    const noLiveSub = sub?.status !== 'TRIAL' && sub?.status !== 'ACTIVE';
    // P2 §9: the trial CTA only when the business is listed (APPROVED). A
    // verified-but-unlisted business gets the waiting state instead — never
    // a trial offer it cannot use.
    if (trialStatus === 'ELIGIBLE' && noLiveSub) {
      if (businessStatus === 'APPROVED') {
        items.push({
          title: 'Start your free trial',
          subtitle: 'Your trial starts immediately. No payment required',
          onClick: props.onOpenSubscription,
        });
      } else if (businessStatus !== null) {
        items.push({
          title: 'Waiting for listing approval',
          subtitle: 'Your business is verified. It needs listing approval before customers can find it.',
          onClick: props.onOpenVerification,
        });
      }
    }

    const latestRequest = (requests.data ?? [])[0] ?? null;
    const trialDaysLeft = state?.trial?.daysRemaining ?? null;
    const needsPlanAttention =
      sub?.status === 'EXPIRED' ||
      sub?.status === 'SUSPENDED' ||
      (sub?.status === 'TRIAL' && trialDaysLeft !== null && trialDaysLeft <= 3) ||
      latestRequest?.status === 'REJECTED';
    if (needsPlanAttention) {
      items.push({
        title: 'Your plan needs attention',
        subtitle:
          sub?.status === 'EXPIRED'
            ? 'Your subscription has expired'
            : sub?.status === 'SUSPENDED'
              ? 'Your subscription is suspended'
              : latestRequest?.status === 'REJECTED'
                ? 'Your last payment was rejected'
                : 'Your free trial ends soon',
        onClick: props.onOpenSubscription,
      });
    }
  }

  const retry = () => {
    verification.reload();
    subscription.reload();
    requests.reload();
  };
  const onStatus = props.onStatus;
  useEffect(() => {
    onStatus?.({ loading, error: Boolean(error), count: items.length, retry });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, items.length]);

  if (loading || error) return null;
  if (items.length === 0) return null;

  const rows = items.map((item) => (
    <OwnerHubRow
      key={item.title}
      icon={<AlertIcon size={18} />}
      title={item.title}
      subtitle={item.subtitle}
      badge="Action needed"
      onClick={item.onClick}
    />
  ));

  if (props.bare) return <div className="hub-card">{rows}</div>;

  return <OwnerHubSection label="Needs attention">{rows}</OwnerHubSection>;
}
