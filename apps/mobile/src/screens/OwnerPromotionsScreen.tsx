import { useState } from 'react';
import {
  listPromotions,
  listPromotionRequests,
  requestPromotion,
  type Promotion,
  type PromotionRequest,
  type PromotionLifecycleState,
} from '../api.js';
import { useAsyncData, type AsyncState } from '../hooks.js';
import { Button, EmptyState, ErrorState, Field, Loading, Money } from '../components/ui.js';
import { SegmentedControl } from '../components/primitives.js';
import { CheckIcon, StarIcon } from '../components/icons.js';
import { PromotionPaymentFlow } from './OwnerPromotionPayment.js';

const REQUEST_STATUS_LABEL: Record<PromotionRequest['status'], string> = {
  PENDING: 'Request pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

/** Owner-facing labels for the server-computed promotion lifecycle. */
const LIFECYCLE_LABEL: Record<PromotionLifecycleState, string> = {
  PENDING_REVIEW: 'Pending review',
  PAYMENT_REQUIRED: 'Payment required',
  PAYMENT_UNDER_REVIEW: 'Payment under review',
  ACTIVE: 'Active',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

const LIFECYCLE_BADGE_CLASS: Record<PromotionLifecycleState, string> = {
  PENDING_REVIEW: 'badge-neutral',
  PAYMENT_REQUIRED: 'badge-open',
  PAYMENT_UNDER_REVIEW: 'badge-neutral',
  ACTIVE: 'badge-open',
  REJECTED: 'badge-closed',
  EXPIRED: 'badge-closed',
  CANCELLED: 'badge-closed',
};

type Tab = 'available' | 'requests';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/**
 * Promotions: the platform's active promotion catalog plus the business's
 * request history across the monetization lifecycle (review, payment,
 * activation). Requesting creates a request for the NearbyOrders team to
 * review. Free promotions activate directly on approval; paid ones move to
 * PAYMENT_REQUIRED and activate only after the payment proof is approved.
 */
export function OwnerPromotions(props: { businessId: string }) {
  const promotions = useAsyncData<Promotion[]>(() => listPromotions(), []);
  const requests = useAsyncData<PromotionRequest[]>(() => listPromotionRequests(props.businessId), [props.businessId]);
  const [tab, setTab] = useState<Tab>('available');
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The request whose payment flow is open (replaces the tabs until closed). */
  const [payingFor, setPayingFor] = useState<PromotionRequest | null>(null);

  const list = promotions.data ?? [];
  const requestList = requests.data ?? [];
  const byPromotionId = new Map<string, PromotionRequest>();
  for (const r of requestList) {
    if (!byPromotionId.has(r.promotionId)) byPromotionId.set(r.promotionId, r);
  }

  const sendRequest = async (promotion: Promotion) => {
    if (busy) return;
    setBusy(true);
    setRequestingId(promotion.id);
    setError(null);
    setNotice(null);
    try {
      await requestPromotion(props.businessId, {
        promotionId: promotion.id,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote('');
      setNoteFor(null);
      setNotice(
        'Request received. The NearbyOrders team will review it and contact you about next steps.',
      );
      requests.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request');
    } finally {
      setBusy(false);
      setRequestingId(null);
    }
  };

  if (payingFor) {
    return (
      <PromotionPaymentFlow
        businessId={props.businessId}
        request={payingFor}
        onBack={() => {
          setPayingFor(null);
          setTab('requests');
          requests.reload();
        }}
      />
    );
  }

  return (
    <div className="owner-screen owner-promotions">
      {error ? <ErrorState message={error} /> : null}
      {notice ? (
        <p className="save-ok" role="status">
          {notice}
        </p>
      ) : null}

      <SegmentedControl<Tab>
        label="Promotion views"
        full
        value={tab}
        onChange={setTab}
        options={[
          { value: 'available', label: 'Available' },
          { value: 'requests', label: 'My requests' },
        ]}
      />

      {tab === 'available' ? (
        <AvailablePromotions
          promotions={promotions}
          requests={requests}
          list={list}
          byPromotionId={byPromotionId}
          busy={busy}
          requestingId={requestingId}
          noteFor={noteFor}
          note={note}
          onNoteChange={setNote}
          onNoteFor={setNoteFor}
          onSendRequest={sendRequest}
        />
      ) : (
        <MyPromotionRequests
          requests={requests}
          onPay={(r) => setPayingFor(r)}
        />
      )}
    </div>
  );
}

/* ------------------------------ available ------------------------------ */

function AvailablePromotions(props: {
  promotions: AsyncState<Promotion[]>;
  requests: AsyncState<PromotionRequest[]>;
  list: Promotion[];
  byPromotionId: Map<string, PromotionRequest>;
  busy: boolean;
  requestingId: string | null;
  noteFor: string | null;
  note: string;
  onNoteChange: (v: string) => void;
  onNoteFor: (id: string | null) => void;
  onSendRequest: (p: Promotion) => void;
}) {
  const { promotions, requests, list, byPromotionId, busy, requestingId, noteFor, note } = props;

  if (promotions.loading) return <Loading label="Loading promotions…" />;
  if (promotions.error) return <ErrorState message={promotions.error} onRetry={promotions.reload} />;
  if (requests.error) return <ErrorState message={requests.error} onRetry={requests.reload} />;

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<StarIcon size={22} />}
        title="Grow your visibility"
        body="Promotion opportunities will appear here when NearbyOrders launches them. Check back soon."
        action={<Button onClick={promotions.reload}>Retry</Button>}
      />
    );
  }

  return (
    <>
      <div className="section-head">
        <h2>
          Available promotions
          <span className="count-pill">{list.length}</span>
        </h2>
      </div>
      <div className="plan-option-list">
        {list.map((p) => {
          const existing = byPromotionId.get(p.id);
          const isPending = existing?.status === 'PENDING';
          const canReapply =
            !existing ||
            existing.status === 'REJECTED' ||
            existing.status === 'EXPIRED' ||
            existing.status === 'CANCELLED';
          return (
            <section key={p.id} className="plan-option" aria-label={p.name}>
              <span className="plan-option-top">
                <span className="plan-option-name">{p.name}</span>
                {existing ? (
                  <span className={`badge ${existing.status === 'APPROVED' || existing.status === 'ACTIVE' ? 'badge-open' : existing.status === 'PENDING' ? 'badge-neutral' : 'badge-closed'}`}>
                    {REQUEST_STATUS_LABEL[existing.status]}
                  </span>
                ) : null}
              </span>
              {p.description ? <span className="plan-option-desc">{p.description}</span> : null}
              {p.priceMinor != null ? (
                <span className="plan-option-price">
                  <Money minor={p.priceMinor} currency={p.currency} />
                  {p.durationDays != null ? <span className="muted"> / {p.durationDays} days</span> : null}
                </span>
              ) : null}
              {(p.benefits ?? []).length > 0 ? (
                <ul className="sub-benefits">
                  {(p.benefits ?? []).map((b) => (
                    <li key={b}>
                      <CheckIcon size={14} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {p.requirements ? (
                <p className="hint" style={{ marginTop: 6 }}>
                  <strong>Requirements:</strong> {p.requirements}
                </p>
              ) : null}
              {existing?.status === 'REJECTED' && existing.rejectionReason ? (
                <p className="hint">Reason: {existing.rejectionReason}</p>
              ) : null}
              {existing?.lifecycleState === 'PAYMENT_REQUIRED' ? (
                <p className="hint" style={{ marginTop: 8 }}>
                  Your application was approved. Open the My requests tab to complete the promotion payment.
                </p>
              ) : null}
              {canReapply ? (
                noteFor === p.id ? (
                  <div style={{ marginTop: 8 }}>
                    <Field label="Note for the team (optional)">
                      <input
                        value={note}
                        onChange={(e) => props.onNoteChange(e.target.value)}
                        maxLength={500}
                        placeholder="Anything we should know"
                      />
                    </Field>
                    <div className="btn-row">
                      <Button sm disabled={busy} onClick={() => props.onSendRequest(p)}>
                        {busy && requestingId === p.id ? 'Sending…' : 'Send request'}
                      </Button>
                      <Button sm variant="ghost" disabled={busy} onClick={() => { props.onNoteFor(null); props.onNoteChange(''); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="btn-row" style={{ marginTop: 8 }}>
                    <Button sm variant="secondary" disabled={busy} onClick={() => props.onNoteFor(p.id)}>
                      Request this promotion
                    </Button>
                  </div>
                )
              ) : isPending ? (
                <p className="hint" style={{ marginTop: 8 }}>
                  Your request is with the NearbyOrders team. They will contact you about next steps.
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}

/* ----------------------------- my requests ---------------------------- */

function MyPromotionRequests(props: {
  requests: AsyncState<PromotionRequest[]>;
  onPay: (r: PromotionRequest) => void;
}) {
  const { requests, onPay } = props;

  if (requests.loading) return <Loading label="Loading your requests…" />;
  if (requests.error) return <ErrorState message={requests.error} onRetry={requests.reload} />;

  const list = requests.data ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<StarIcon size={22} />}
        title="No requests yet"
        body="When you request a promotion, its status and any payment steps will appear here."
        action={<Button onClick={requests.reload}>Retry</Button>}
      />
    );
  }

  return (
    <>
      <div className="section-head">
        <h2>
          My requests
          <span className="count-pill">{list.length}</span>
        </h2>
      </div>
      <div className="plan-option-list">
        {list.map((r) => (
          <section key={r.id} className="plan-option" aria-label={r.promotionName ?? 'Promotion request'}>
            <span className="plan-option-top">
              <span className="plan-option-name">{r.promotionName ?? 'Promotion'}</span>
              <span className={`badge ${LIFECYCLE_BADGE_CLASS[r.lifecycleState]}`}>
                {LIFECYCLE_LABEL[r.lifecycleState]}
              </span>
            </span>
            <p className="hint">Requested {formatDate(r.submittedAt)}</p>

            {r.lifecycleState === 'ACTIVE' && r.activatedAt ? (
              <p className="hint">
                Active from {formatDate(r.activatedAt)}
                {r.expiresAt ? ` to ${formatDate(r.expiresAt)}` : null}
                {r.promotionDurationDays != null ? ` (${r.promotionDurationDays} days)` : null}
              </p>
            ) : null}

            {r.lifecycleState === 'EXPIRED' && r.activatedAt ? (
              <p className="hint">
                Ran {formatDate(r.activatedAt)}
                {r.expiresAt ? ` to ${formatDate(r.expiresAt)}` : null}
              </p>
            ) : null}

            {r.lifecycleState === 'REJECTED' && r.rejectionReason ? (
              <p className="hint">Reason: {r.rejectionReason}</p>
            ) : null}

            {r.lifecycleState === 'PAYMENT_REQUIRED' ? (
              <div style={{ marginTop: 8 }}>
                <div className="pay-details">
                  <div className="pay-detail-row">
                    <span className="pay-detail-label">Amount due</span>
                    <span className="pay-detail-value">
                      <Money minor={r.amountDueMinor} currency={r.currency} />
                    </span>
                  </div>
                </div>
                {r.lastPaymentRejected ? (
                  <p className="hint" style={{ marginTop: 6 }}>
                    Your last payment was rejected. Submit a new payment below.
                  </p>
                ) : null}
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <Button full onClick={() => onPay(r)}>
                    Pay now
                  </Button>
                </div>
              </div>
            ) : null}

            {r.lifecycleState === 'PAYMENT_UNDER_REVIEW' ? (
              <p className="hint" style={{ marginTop: 8 }}>
                Your payment proof is with the NearbyOrders team. Your promotion activates after approval.
              </p>
            ) : null}

            {r.lifecycleState === 'PENDING_REVIEW' ? (
              <p className="hint" style={{ marginTop: 8 }}>
                The NearbyOrders team is reviewing your request.
                {r.promotionPriceMinor != null && r.promotionPriceMinor > 0
                  ? ' If approved, you will complete a payment step before it activates.'
                  : ' Free promotions activate directly on approval.'}
              </p>
            ) : null}

            {r.lifecycleState === 'CANCELLED' ? (
              <p className="hint" style={{ marginTop: 8 }}>
                This request was cancelled. It will not activate.
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}
