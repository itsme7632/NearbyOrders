import { useState } from 'react';
import {
  listPaymentMethods,
  listPaymentRequests,
  submitPaymentRequest,
  cancelPaymentRequest,
  uploadPaymentReceipt,
  type PaymentMethod,
  type PaymentRequest,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading, Money } from '../components/ui.js';
import { ImageUploader, type ImageUploaderState, type PendingImage } from '../components/ImageUploader.js';

export function validatePaymentForm(form: { transactionReference: string; hasReceipt: boolean }): string | null {
  const ref = form.transactionReference.trim();
  if (ref.length < 4) return 'Enter the transaction reference (at least 4 characters).';
  if (ref.length > 100) return 'Transaction reference must be at most 100 characters.';
  if (!form.hasReceipt) return 'Attach a photo of your payment receipt.';
  return null;
}

/** Owner-facing labels for manual payment-request states (Phase 7B). */
const PAYMENT_STATUS_LABEL: Record<PaymentRequest['status'], string> = {
  PENDING: 'Awaiting verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/**
 * The pay + verify experience for one owned business: server-configured
 * pay-in channels, a real receipt-pick (persisted through the image-storage
 * provider once connected, honestly blocked before that), submission for
 * admin verification, and the business's payment history with cancellation
 * of its own pending request. No client-sent amounts, no fake activations.
 */
export function OwnerPayments(props: { businessId: string }) {
  const methods = useAsyncData<PaymentMethod[]>(() => listPaymentMethods(), []);
  const history = useAsyncData<PaymentRequest[]>(() => listPaymentRequests(props.businessId).then((p) => p.items), [props.businessId]);
  const [formOpen, setFormOpen] = useState(false);
  const [methodId, setMethodId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const methodList = methods.data ?? [];
  const pendingRequest = (history.data ?? []).find((p) => p.status === 'PENDING');
  const selectedMethod = methodList.find((m) => m.id === methodId) ?? methodList[0] ?? null;

  const resetForm = () => {
    setFormOpen(false);
    setReference('');
    setPendingReceipt(null);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!selectedMethod) {
      setError('Choose a payment method.');
      return;
    }
    const validation = validatePaymentForm({ transactionReference: reference, hasReceipt: Boolean(pendingReceipt) });
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
      });
      setNotice('Payment submitted. NearbyOrders will verify it shortly: your subscription activates after approval.');
      resetForm();
      history.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the payment');
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (requestId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancelPaymentRequest(props.businessId, requestId);
      setConfirmCancelId(null);
      setNotice('Payment request cancelled. You can submit a corrected one now.');
      history.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel the payment request');
    } finally {
      setBusy(false);
    }
  };

  if (methods.loading) return <Loading label="Loading payment methods…" />;
  if (methods.error) return <ErrorState message={methods.error} onRetry={methods.reload} />;

  if (methodList.length === 0) {
    return (
      <div className="pay-section">
        <h3>Pay by hand: verified by NearbyOrders</h3>
        <p className="muted">No payment methods are available right now. Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="pay-section">
      <h3>Pay by hand — verified by NearbyOrders</h3>
      {notice ? (
        <p className="save-ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      {pendingRequest ? (
        <div className="pay-pending" role="status">
          <strong>Awaiting verification.</strong> Reference {pendingRequest.transactionReference}: we'll
          activate your subscription as soon as it's approved.
        </div>
      ) : !formOpen ? (
        <Button full variant="secondary" onClick={() => setFormOpen(true)} disabled={busy}>
          I've paid: submit proof
        </Button>
      ) : null}

      {formOpen && !pendingRequest ? (
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
          {selectedMethod ? (
            <div className="pay-details">
              <div className="pay-detail-row">
                <span className="pay-detail-label">Account title</span>
                <span className="pay-detail-value">{selectedMethod.accountTitle}</span>
              </div>
              <div className="pay-detail-row">
                <span className="pay-detail-label">{selectedMethod.type === 'BANK_TRANSFER' ? 'IBAN / account' : 'Number'}</span>
                <span className="pay-detail-value pay-detail-mono">{selectedMethod.type === 'BANK_TRANSFER' && selectedMethod.iban ? selectedMethod.iban : selectedMethod.accountNumber}</span>
              </div>
              {selectedMethod.instructions ? <p className="hint">{selectedMethod.instructions}</p> : null}
            </div>
          ) : null}
          <Field label="Transaction reference" hint="From your payment app or bank slip — we match it against your receipt.">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TX-123456789"
              maxLength={100}
            />
          </Field>
          <Field label="Payment receipt">
            <ImageUploader
              currentUrl={null}
              label="Payment receipt"
              onChange={(state) => setPendingReceipt(state.pending)}
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
      ) : null}

      {history.error ? <ErrorState message={history.error} onRetry={history.reload} /> : null}
      {history.data?.length ? (
        <div className="pay-history">
          <h4>Payment history</h4>
          <ul className="manage-list">
            {history.data.map((p) => (
              <li key={p.id} className="manage-item">
                <div className="item-row">
                  <span className="item-name">{p.paymentMethod.name}</span>
                  <Money minor={p.amountMinor} currency={p.currency} />
                </div>
                <p className="item-desc pay-ref">Ref {p.transactionReference}</p>
                <p className={`badge ${p.status === 'APPROVED' ? 'badge-open' : p.status === 'PENDING' ? 'badge-neutral' : 'badge-closed'}`}>
                  {PAYMENT_STATUS_LABEL[p.status]}
                </p>
                {p.status === 'REJECTED' && p.rejectionReason ? <p className="item-desc">Reason: {p.rejectionReason}</p> : null}
                {p.status === 'PENDING' ? (
                  confirmCancelId === p.id ? (
                    <div className="btn-row" role="alert">
                      <Button sm variant="danger" disabled={busy} onClick={() => void cancelRequest(p.id)}>
                        {busy ? 'Cancelling…' : 'Yes, cancel it'}
                      </Button>
                      <Button sm variant="ghost" disabled={busy} onClick={() => setConfirmCancelId(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <div className="btn-row">
                      <Button sm variant="ghost" disabled={busy} onClick={() => setConfirmCancelId(p.id)}>
                        Cancel request
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Services ------------------------------ */

