import { useState } from 'react';
import {
  downloadReceipt,
  listPaymentRequests,
  type PaymentRequest,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { OrdersIcon } from '../components/icons.js';
import { PAYMENT_REQUEST_STATUS_LABEL } from './OwnerSubscriptionShared.js';

/**
 * Payment history: records only — payment method, amount, submitted date,
 * reference, paid date, status badge (Pending review / Approved / Rejected),
 * reviewed date, and a receipt action where the stored receipt is available.
 * A professional empty state when nothing was submitted; no submission form
 * (that lives on the Make a payment route).
 *
 * Rendered inside the OwnerScreen chrome, which provides the back button to
 * the subscription hub — this screen never renders its own.
 */
export function OwnerSubscriptionPaymentHistory(props: { businessId: string }) {
  const requests = useAsyncData<PaymentRequest[]>(() => listPaymentRequests(props.businessId), [props.businessId]);
  const [viewingReceiptId, setViewingReceiptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.loading) return <Loading label="Loading payment history…" />;
  if (requests.error) return <ErrorState message={requests.error} onRetry={requests.reload} />;

  // Defensive: typed as an array, but a future wire-shape change must never
  // throw during render.
  const history = Array.isArray(requests.data) ? requests.data.filter(Boolean) : [];

  /** Opens the stored receipt through the authorized endpoint (never a public URL). */
  const viewReceipt = async (request: PaymentRequest) => {
    if (viewingReceiptId) return;
    setViewingReceiptId(request.id);
    setError(null);
    try {
      const blob = await downloadReceipt(request.receiptStorageKey);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // Revoke after a beat so the new tab has time to load the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the receipt');
    } finally {
      setViewingReceiptId(null);
    }
  };

  if (history.length === 0) {
    return (
      <EmptyState
        icon={<OrdersIcon size={22} />}
        title="No payments submitted yet"
        body="When you submit a payment, it appears here with its review status: pending review, approved, or rejected."
        action={<Button onClick={requests.reload}>Refresh</Button>}
      />
    );
  }

  return (
    <div className="pay-wrap">
      {error ? <ErrorState message={error} /> : null}
      <ul className="manage-list">
        {history.map((p) => {
          if (!p) return null;
          const methodName = p.paymentMethodName ?? p.paymentMethod?.name ?? 'Payment method';
          return (
            <li key={p.id} className="manage-item">
              <div className="item-row">
                <span className="item-name">{methodName}</span>
                <Money minor={p.amountMinor} currency={p.currency} />
              </div>
              <p className="item-desc">
                {p.planName ? `${p.planName} · ` : ''}Submitted {new Date(p.submittedAt).toLocaleDateString()}
              </p>
              <p className="item-desc pay-ref">Ref {p.transactionReference}</p>
              {p.paidAt ? <p className="item-desc">Paid on {new Date(p.paidAt).toLocaleDateString()}</p> : null}
              {p.note ? <p className="item-desc">Note: {p.note}</p> : null}
              <p
                className={`badge ${
                  p.status === 'APPROVED' ? 'badge-open' : p.status === 'PENDING' ? 'badge-neutral' : 'badge-closed'
                }`}
              >
                {PAYMENT_REQUEST_STATUS_LABEL[p.status]}
              </p>
              {p.reviewedAt ? <p className="item-desc">Reviewed {new Date(p.reviewedAt).toLocaleDateString()}</p> : null}
              {p.status === 'REJECTED' && p.rejectionReason ? (
                <p className="item-desc">Reason: {p.rejectionReason}</p>
              ) : null}
              {p.receiptStorageKey ? (
                <div className="btn-row">
                  <Button sm variant="ghost" disabled={viewingReceiptId === p.id} onClick={() => void viewReceipt(p)}>
                    {viewingReceiptId === p.id ? 'Opening…' : 'View receipt'}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
