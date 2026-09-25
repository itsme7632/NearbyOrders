import { useState } from 'react';
import {
  ApiError,
  listPaymentMethods,
  listPromotionPayments,
  submitPromotionPayment,
  uploadPaymentReceipt,
  downloadReceipt,
  type PaymentMethod,
  type PromotionPaymentRequest,
  type PromotionRequest,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading, Money } from '../components/ui.js';
import { ImageUploader, type PendingImage } from '../components/ImageUploader.js';
import { validatePaymentForm } from './OwnerSubscriptionShared.js';

/** Owner-facing labels for promotion payment-proof states. */
const PAYMENT_STATUS_LABEL: Record<PromotionPaymentRequest['status'], string> = {
  PENDING: 'Awaiting verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** Friendly wording for the promotion payment error codes the server returns. */
const PAYMENT_ERROR_HINT: Record<string, string> = {
  NOT_PAYABLE: 'This request is no longer awaiting payment. Refresh to see its latest status.',
  PAYMENT_NOT_REQUIRED: 'This promotion needs no payment, so there is nothing to submit.',
  PAYMENT_ALREADY_PENDING: 'A payment is already under review for this request. Please wait for the team’s decision.',
  INVALID_PAYMENT_METHOD: 'That payment method is no longer available. Please choose another one.',
};

/**
 * The promotion pay + verify flow for one promotion request, rendered after
 * the NearbyOrders team approves a paid application. It mirrors the manual
 * subscription-payment architecture: server-configured pay-in channels
 * (never hardcoded), a real receipt upload through the API's multipart
 * endpoint, and admin verification before anything activates. The amount
 * shown is always the server's amountDueMinor; the client never sends an
 * amount.
 *
 * Free promotions (no price) never reach this flow: approval activates them
 * directly, and a defensive guard below renders an honest note instead of a
 * form if one ever does.
 *
 * Rendered inside the OwnerScreen chrome, which provides screen-level
 * navigation — the back button here returns to the request list within the
 * promotions screen.
 */
export function PromotionPaymentFlow(props: {
  businessId: string;
  request: PromotionRequest;
  /** Returns to the request list (the parent reloads request state). */
  onBack: () => void;
}) {
  const { request } = props;
  const methods = useAsyncData<PaymentMethod[]>(() => listPaymentMethods(), []);
  const payments = useAsyncData<PromotionPaymentRequest[]>(
    () => listPromotionPayments(props.businessId, request.id),
    [props.businessId, request.id],
  );
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [note, setNote] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewingReceiptId, setViewingReceiptId] = useState<string | null>(null);

  const methodList = Array.isArray(methods.data) ? methods.data : [];
  const history = Array.isArray(payments.data) ? payments.data.filter(Boolean) : [];
  const pendingPayment = history.find((p) => p?.status === 'PENDING');
  const selectedMethod = methodList.find((m) => m.id === methodId) ?? methodList[0] ?? null;
  const isFree = request.amountDueMinor === 0;

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
      const storageKey = await uploadPaymentReceipt(pendingReceipt!.file);
      await submitPromotionPayment(props.businessId, request.id, {
        paymentMethodId: selectedMethod.id,
        transactionReference: reference.trim(),
        receiptStorageKey: storageKey,
        ...(paidAt ? { paidAt: new Date(paidAt).toISOString() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNotice(
        'Promotion payment submitted. The NearbyOrders team will review it and activate your promotion after approval.',
      );
      setReference('');
      setPaidAt('');
      setNote('');
      setPendingReceipt(null);
      // Reloading surfaces the new PENDING submission, which renders the
      // "Payment under review" state below.
      payments.reload();
    } catch (e) {
      if (e instanceof ApiError && PAYMENT_ERROR_HINT[e.code]) {
        setError(PAYMENT_ERROR_HINT[e.code]);
        payments.reload();
      } else {
        setError(e instanceof Error ? e.message : 'Could not submit the payment');
      }
    } finally {
      setBusy(false);
    }
  };

  /** Opens the stored receipt through the authorized endpoint (never a public URL). */
  const viewReceipt = async (payment: PromotionPaymentRequest) => {
    if (viewingReceiptId) return;
    setViewingReceiptId(payment.id);
    setError(null);
    try {
      const blob = await downloadReceipt(payment.receiptStorageKey);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the receipt');
    } finally {
      setViewingReceiptId(null);
    }
  };

  return (
    <div className="pay-wrap">
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <Button sm variant="ghost" onClick={props.onBack} disabled={busy}>
          Back to my requests
        </Button>
      </div>

      {notice ? (
        <p className="save-ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      <div className="pay-block">
        <p className="pay-eyebrow">Promotion payment</p>
        <h3 className="pay-block-title">Promotion approved</h3>
        <p className="hint">
          The NearbyOrders team approved your request for {request.promotionName ?? 'this promotion'}. Pay the
          amount below and submit your proof to activate it.
        </p>
        <div className="pay-details" style={{ marginTop: 8 }}>
          <div className="pay-detail-row">
            <span className="pay-detail-label">Amount due</span>
            <span className="pay-detail-value">
              <Money minor={request.amountDueMinor} currency={request.currency} />
            </span>
          </div>
        </div>
      </div>

      {isFree ? (
        <div className="pay-pending" role="status">
          No payment is needed for this promotion. It activates directly after approval.
        </div>
      ) : (
        <>
          <div className="pay-block">
            <h3 className="pay-block-title">Payment method</h3>
            {methods.loading ? (
              <Loading label="Loading payment methods…" />
            ) : methods.error ? (
              <ErrorState message={methods.error} onRetry={methods.reload} />
            ) : methodList.length === 0 ? (
              <p className="pay-empty">No payment methods are available right now. Please try again later.</p>
            ) : (
              <>
                {/* Selectable method chips once; only the selected method's
                    account details show below — mirroring the subscription
                    payment screen. */}
                <div className="field">
                  <span className="label" id="promo-pay-method-label">
                    Payment method
                  </span>
                  <div role="group" aria-labelledby="promo-pay-method-label">
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
                  </div>
                </div>
                {selectedMethod ? (
                  <div className="pay-details">
                    <div className="pay-detail-row">
                      <span className="pay-detail-label">Account title</span>
                      <span className="pay-detail-value">{selectedMethod.accountTitle}</span>
                    </div>
                    <div className="pay-detail-row">
                      <span className="pay-detail-label">
                        {selectedMethod.type === 'BANK_TRANSFER' ? 'IBAN / account' : 'Number'}
                      </span>
                      <span className="pay-detail-value pay-detail-mono">
                        {selectedMethod.type === 'BANK_TRANSFER' && selectedMethod.iban
                          ? selectedMethod.iban
                          : selectedMethod.accountNumber}
                      </span>
                    </div>
                    {selectedMethod.instructions ? <p className="hint">{selectedMethod.instructions}</p> : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {pendingPayment ? (
            <div className="pay-pending" role="status">
              <strong>Payment under review.</strong> Reference {pendingPayment.transactionReference}: the
              NearbyOrders team reviews every payment, and your promotion activates after approval.
            </div>
          ) : methodList.length > 0 ? (
            <div className="edit-block">
              <p className="hint">Pay exactly the amount due to the account above, then submit your proof below.</p>
              <Field label="Transaction reference" hint="From your payment app or bank slip. We match it against your receipt.">
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. TX-123456789"
                  maxLength={100}
                />
              </Field>
              <Field label="Payment date" hint="When you made the payment (optional).">
                <input
                  type="date"
                  value={paidAt}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </Field>
              <Field label="Payment receipt">
                {/* The receipt is genuinely persisted through the API's
                    multipart endpoint — the generic "image storage is not
                    connected" notice is about business/product images. */}
                <ImageUploader
                  currentUrl={null}
                  label="Payment receipt"
                  hideStorageNotice
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
                <Button sm variant="ghost" onClick={props.onBack} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className="pay-block">
        <h3 className="pay-block-title">Payment history</h3>
        {payments.error ? <ErrorState message={payments.error} onRetry={payments.reload} /> : null}
        {payments.loading && history.length === 0 ? (
          <div className="pay-skel-list" role="status" aria-label="Loading payment history">
            <div className="pay-skel" />
            <div className="pay-skel" />
          </div>
        ) : null}
        {history.length > 0 ? (
          <ul className="manage-list">
            {history.map((p) => {
              if (!p) return null;
              return (
                <li key={p.id} className="manage-item">
                  <div className="item-row">
                    <span className="item-name">{p.paymentMethod?.name ?? 'Payment method'}</span>
                    <Money minor={p.amountMinor} currency={p.currency} />
                  </div>
                  <p className="item-desc">Submitted {formatPaymentDate(p.submittedAt)}</p>
                  <p className="item-desc pay-ref">Ref {p.transactionReference}</p>
                  {p.paidAt ? <p className="item-desc">Paid on {formatPaymentDate(p.paidAt)}</p> : null}
                  {p.note ? <p className="item-desc">Note: {p.note}</p> : null}
                  <p className={`badge ${p.status === 'APPROVED' ? 'badge-open' : p.status === 'PENDING' ? 'badge-neutral' : 'badge-closed'}`}>
                    {PAYMENT_STATUS_LABEL[p.status]}
                  </p>
                  {p.reviewedAt ? <p className="item-desc">Reviewed {formatPaymentDate(p.reviewedAt)}</p> : null}
                  {p.status === 'REJECTED' && p.rejectionReason ? (
                    <p className="item-desc">Reason: {p.rejectionReason}</p>
                  ) : null}
                  <div className="btn-row">
                    <Button sm variant="ghost" disabled={viewingReceiptId === p.id} onClick={() => void viewReceipt(p)}>
                      {viewingReceiptId === p.id ? 'Opening…' : 'View receipt'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : !payments.loading && !payments.error ? (
          <p className="pay-empty">You have not submitted any payments for this request yet.</p>
        ) : null}
      </div>
    </div>
  );
}

function formatPaymentDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}
