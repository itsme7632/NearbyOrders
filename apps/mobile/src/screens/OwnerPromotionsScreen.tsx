import { useState } from 'react';
import {
  listPromotions,
  listPromotionRequests,
  requestPromotion,
  type Promotion,
  type PromotionRequest,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Field, Loading, Money } from '../components/ui.js';
import { CheckIcon, StarIcon } from '../components/icons.js';

const REQUEST_STATUS_LABEL: Record<PromotionRequest['status'], string> = {
  PENDING: 'Request pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/**
 * Promotions: the platform's active promotion catalog with pricing, duration,
 * requirements and benefits. Requesting creates a PENDING request for the
 * NearbyOrders team to review; they contact the owner directly. There is no
 * checkout and no payment step in the app.
 */
export function OwnerPromotions(props: { businessId: string }) {
  const promotions = useAsyncData<Promotion[]>(() => listPromotions(), []);
  const requests = useAsyncData<PromotionRequest[]>(() => listPromotionRequests(props.businessId), [props.businessId]);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (promotions.loading) return <Loading label="Loading promotions…" />;
  if (promotions.error) return <ErrorState message={promotions.error} onRetry={promotions.reload} />;

  const list = promotions.data ?? [];
  const byPromotionId = new Map<string, PromotionRequest>();
  for (const r of requests.data ?? []) {
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

  return (
    <div className="owner-promotions">
      {error ? <ErrorState message={error} /> : null}
      {notice ? (
        <p className="save-ok" role="status">
          {notice}
        </p>
      ) : null}
      {requests.error ? <ErrorState message={requests.error} onRetry={requests.reload} /> : null}

      {list.length === 0 ? (
        <EmptyState
          icon={<StarIcon size={22} />}
          title="Grow your visibility"
          body="Promotion opportunities will appear here when NearbyOrders launches them. Check back soon."
          action={<Button onClick={promotions.reload}>Retry</Button>}
        />
      ) : (
        <div className="plan-option-list">
          {list.map((p) => {
            const existing = byPromotionId.get(p.id);
            const isPending = existing?.status === 'PENDING';
            return (
              <section key={p.id} className="plan-option" aria-label={p.name}>
                <span className="plan-option-top">
                  <span className="plan-option-name">{p.name}</span>
                  {existing ? (
                    <span className={`badge ${existing.status === 'APPROVED' ? 'badge-open' : existing.status === 'PENDING' ? 'badge-neutral' : 'badge-closed'}`}>
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
                {!existing || existing.status === 'REJECTED' || existing.status === 'CANCELLED' ? (
                  noteFor === p.id ? (
                    <div style={{ marginTop: 8 }}>
                      <Field label="Note for the team (optional)">
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          maxLength={500}
                          placeholder="Anything we should know"
                        />
                      </Field>
                      <div className="btn-row">
                        <Button sm disabled={busy} onClick={() => void sendRequest(p)}>
                          {busy && requestingId === p.id ? 'Sending…' : 'Send request'}
                        </Button>
                        <Button sm variant="ghost" disabled={busy} onClick={() => { setNoteFor(null); setNote(''); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="btn-row" style={{ marginTop: 8 }}>
                      <Button sm variant="secondary" disabled={busy} onClick={() => setNoteFor(p.id)}>
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
      )}
    </div>
  );
}
