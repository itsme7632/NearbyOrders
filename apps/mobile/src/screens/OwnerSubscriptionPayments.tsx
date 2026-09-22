import { useEffect, useState } from 'react';
import {
  listPaymentMethods,
  submitPaymentRequest,
  uploadPaymentReceipt,
  downloadReceipt,
  type PaymentMethod,
  type PaymentRequest,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading, Money } from '../components/ui.js';
import { ImageUploader, type PendingImage } from '../components/ImageUploader.js';

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

/** Owner-facing labels for manual payment-request states. */
const PAYMENT_STATUS_LABEL: Record<PaymentRequest['status'], string> = {
  PENDING: 'Awaiting verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/**
 * The pay + verify experience for one owned business: server-configured
 * pay-in channels (always visible), a real receipt-pick (persisted through
 * the API's multipart endpoint), submission for admin verification, and the
 * business's payment history. The amount shown is always the server plan
 * price — the client never sends an amount, and submitting proof never
 * claims activation: the NearbyOrders team reviews every request.
 *
 * Rendered inside the OwnerScreen chrome, which provides back navigation —
 * this component never renders its own back button.
 */
export function OwnerPayments(props: {
  businessId: string;
  planPriceMinor: number | null;
  planCurrency: string;
  planName: string | null;
  requests: PaymentRequest[] | null;
  requestsLoading: boolean;
  requestsError: string | null;
  onRequestsReload: () => void;
  /** Increment to open the payment form (e.g. from a "Make a payment" row). */
  openFormSignal?: number;
}) {
  const methods = useAsyncData<PaymentMethod[]>(() => listPaymentMethods(), []);
  const [formOpen, setFormOpen] = useState(false);
  const [methodId, setMethodId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [note, setNote] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewingReceiptId, setViewingReceiptId] = useState<string | null>(null);

  // Defensive: these lists are typed as arrays, but a future wire-shape
  // change must never throw during render — an unwrapped envelope object is
  // truthy, and `.find` on it blanked the whole subscription screen.
  const methodList = Array.isArray(methods.data) ? methods.data : [];
  const history = Array.isArray(props.requests) ? props.requests.filter(Boolean) : [];
  const pendingRequest = history.find((p) => p?.status === 'PENDING');
  const selectedMethod = methodList.find((m) => m.id === methodId) ?? methodList[0] ?? null;

  // A "Make a payment" row elsewhere on the screen can request the form.
  // Ignored while a request is already pending review (there is nothing
  // new to submit until the team decides).
  useEffect(() => {
    if ((props.openFormSignal ?? 0) > 0 && !pendingRequest) setFormOpen(true);
  }, [props.openFormSignal, pendingRequest]);

  const resetForm = () => {
    setFormOpen(false);
    setReference('');
    setPaidAt('');
    setNote('');
    setPendingReceipt(null);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!selectedMethod) {
      setError('Choose a payment method.');
      return;
    }
    const validation = validatePaymentForm({
      transactionReference: reference,
      hasReceipt: Boolean(pendingReceipt),
      paidAt: paidAt || undefined,
      note: note.trim() || undefined,
    });
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // REAL upload: the picked receipt goes to the API's multipart endpoint,
      // which stores the bytes server-side and returns an opaque storage key
      // (never a user-typed URL and never a public link).
      const storageKey = await uploadPaymentReceipt(pendingReceipt!.file);
      await submitPaymentRequest(props.businessId, {
        paymentMethodId: selectedMethod.id,
        transactionReference: reference.trim(),
        receiptStorageKey: storageKey,
        ...(paidAt ? { paidAt: new Date(paidAt).toISOString() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNotice(
        'Payment submitted. The NearbyOrders team will review it and activate your subscription after approval.',
      );
      resetForm();
      props.onRequestsReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the payment');
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <div className="pay-wrap">
      {notice ? (
        <p className="save-ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      {/* Pay-in channels: always visible, from the server. */}
      <div className="pay-block">
        <h3 className="pay-block-title">Payment methods</h3>
        {methods.loading ? (
          <Loading label="Loading payment methods…" />
        ) : methods.error ? (
          <ErrorState message={methods.error} onRetry={methods.reload} />
        ) : methodList.length === 0 ? (
          <p className="pay-empty">No payment methods are available right now. Please try again later.</p>
        ) : (
          <ul className="pay-method-list">
            {methodList.map((m) => (
              <li key={m.id} className="pay-method">
                <span className="pay-method-name">{m.name}</span>
                <div className="pay-details">
                  <div className="pay-detail-row">
                    <span className="pay-detail-label">Account title</span>
                    <span className="pay-detail-value">{m.accountTitle}</span>
                  </div>
                  <div className="pay-detail-row">
                    <span className="pay-detail-label">
                      {m.type === 'BANK_TRANSFER' ? 'IBAN / account' : 'Number'}
                    </span>
                    <span className="pay-detail-value pay-detail-mono">
                      {m.type === 'BANK_TRANSFER' && m.iban ? m.iban : m.accountNumber}
                    </span>
                  </div>
                </div>
                {m.instructions ? <p className="hint">{m.instructions}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingRequest ? (
        <div className="pay-pending" role="status">
          <strong>Awaiting verification.</strong> Reference {pendingRequest.transactionReference}: the NearbyOrders
          team reviews every payment, and your subscription activates after approval.
        </div>
      ) : null}

      {/* The proof form only makes sense when there is a channel to pay
          into; with no configured methods the owner sees the empty state
          above instead of a dead form. */}
      {!pendingRequest && methodList.length > 0 ? (
        !formOpen ? (
          <Button full variant="secondary" onClick={() => setFormOpen(true)} disabled={busy}>
            I&apos;ve paid: submit proof
          </Button>
        ) : (
          <div className="edit-block">
            <Field label="Payment method">
              {methodList.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`chip${selectedMethod?.id === m.id ? ' chip-active' : ''}`}
                  onClick={() => setMethodId(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </Field>
            {props.planPriceMinor !== null ? (
              <div className="pay-details">
                <div className="pay-detail-row">
                  <span className="pay-detail-label">Amount due{props.planName ? ` (${props.planName})` : ''}</span>
                  <span className="pay-detail-value">
                    <Money minor={props.planPriceMinor} currency={props.planCurrency} />
                  </span>
                </div>
                <p className="hint">Pay exactly this amount to the account above, then submit your proof below.</p>
              </div>
            ) : null}
            <Field label="Transaction reference" hint="From your payment app or bank slip. We match it against your receipt.">
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. TX-123456789"
                maxLength={100}
              />
            </Field>
            <Field label="Payment date" hint="When you made the payment (optional).">
              <input type="date" value={paidAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
            <Field label="Payment receipt">
              <ImageUploader
                currentUrl={null}
                label="Payment receipt"
                onChange={(state) => setPendingReceipt(state.pending)}
              />
            </Field>
            <Field label="Note (optional)">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the review team should know"
                maxLength={500}
              />
            </Field>
            <div className="btn-row">
              <Button sm onClick={submit} disabled={busy || !reference || !pendingReceipt}>
                {busy ? 'Submitting…' : 'Submit for verification'}
              </Button>
              <Button sm variant="ghost" onClick={resetForm} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )
      ) : null}

      <div className="pay-block" id="sub-pay-history">
        <h3 className="pay-block-title">Payment history</h3>
        {props.requestsError ? <ErrorState message={props.requestsError} onRetry={props.onRequestsReload} /> : null}
        {props.requestsLoading && history.length === 0 ? (
          <div className="pay-skel-list" role="status" aria-label="Loading payment history">
            <div className="pay-skel" />
            <div className="pay-skel" />
          </div>
        ) : null}
        {history.length > 0 ? (
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
                  <p className={`badge ${p.status === 'APPROVED' ? 'badge-open' : p.status === 'PENDING' ? 'badge-neutral' : 'badge-closed'}`}>
                    {PAYMENT_STATUS_LABEL[p.status]}
                  </p>
                  {p.reviewedAt ? (
                    <p className="item-desc">Reviewed {new Date(p.reviewedAt).toLocaleDateString()}</p>
                  ) : null}
                  {p.status === 'REJECTED' && p.rejectionReason ? <p className="item-desc">Reason: {p.rejectionReason}</p> : null}
                  <div className="btn-row">
                    <Button sm variant="ghost" disabled={viewingReceiptId === p.id} onClick={() => void viewReceipt(p)}>
                      {viewingReceiptId === p.id ? 'Opening…' : 'View receipt'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : !props.requestsLoading && !props.requestsError ? (
          <p className="pay-empty">You have not submitted any payments yet.</p>
        ) : null}
      </div>
    </div>
  );
}
