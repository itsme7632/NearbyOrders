import { useState } from 'react';
import {
  getBusinessSubscription,
  listPaymentMethods,
  listPaymentRequests,
  listSubscriptionPlans,
  submitPaymentRequest,
  uploadPaymentReceipt,
  type BusinessSubscriptionState,
  type PaymentMethod,
  type PaymentRequest,
  type SubscriptionPlan,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading, Money } from '../components/ui.js';
import { ImageUploader, type PendingImage } from '../components/ImageUploader.js';
import { validatePaymentForm } from './OwnerSubscriptionShared.js';
import {
  getStoredPlanSlug,
  hubPath,
  intervalPerLabel,
  resolveWorkingPlan,
} from './OwnerSubscriptionShared.js';

/**
 * Make a payment: a focused, sectioned flow. Plan and amount due come from
 * the server (the client never sends an amount), the payment method comes
 * from the admin-configured list, the receipt uploads through the API's real
 * multipart endpoint (server stores the bytes and returns a storage key),
 * and the submission stays pending until the NearbyOrders team approves it.
 * No payment history renders underneath — that lives on its own route.
 *
 * Rendered inside the OwnerScreen chrome, which provides the back button to
 * the subscription hub — this screen never renders its own.
 */
export function OwnerSubscriptionMakePayment(props: {
  businessId: string;
  /** Optional: opens another owner route (used for the "View payment history" link). */
  onOpen?: (path: string) => void;
}) {
  const subscription = useAsyncData<BusinessSubscriptionState | null>(
    () => getBusinessSubscription(props.businessId),
    [props.businessId],
  );
  const plans = useAsyncData<SubscriptionPlan[]>(() => listSubscriptionPlans(), []);
  const methods = useAsyncData<PaymentMethod[]>(() => listPaymentMethods(), []);
  const requests = useAsyncData<PaymentRequest[]>(() => listPaymentRequests(props.businessId), [props.businessId]);

  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [note, setNote] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (subscription.loading || plans.loading || methods.loading || requests.loading) {
    return <Loading label="Loading payment…" />;
  }
  if (subscription.error) return <ErrorState message={subscription.error} onRetry={subscription.reload} />;
  if (plans.error) return <ErrorState message={plans.error} onRetry={plans.reload} />;
  if (methods.error) return <ErrorState message={methods.error} onRetry={methods.reload} />;
  if (requests.error) return <ErrorState message={requests.error} onRetry={requests.reload} />;

  const sub = subscription.data?.subscription ?? null;
  const activePlans = (plans.data ?? []).filter((p) => p.isActive);
  const plan = resolveWorkingPlan(sub?.plan ?? null, activePlans, getStoredPlanSlug(props.businessId));
  // Defensive: typed as arrays, but a future wire-shape change must never
  // throw during render.
  const methodList = Array.isArray(methods.data) ? methods.data : [];
  const history = Array.isArray(requests.data) ? requests.data.filter(Boolean) : [];
  const pendingRequest = history.find((p) => p?.status === 'PENDING');
  const selectedMethod = methodList.find((m) => m.id === methodId) ?? methodList[0] ?? null;

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
        'Payment submitted. It stays pending until the NearbyOrders team reviews and approves it.',
      );
      setMethodId('');
      setReference('');
      setPaidAt('');
      setNote('');
      setPendingReceipt(null);
      requests.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the payment');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = () => props.onOpen?.(`${hubPath(props.businessId)}-payment-history`);

  return (
    <div className="pay-wrap">
      {notice ? (
        <p className="save-ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      {pendingRequest ? (
        <div className="pay-pending" role="status">
          <strong>Awaiting verification.</strong> Reference {pendingRequest.transactionReference}: the NearbyOrders
          team reviews every payment, and your subscription activates after approval.
          {props.onOpen ? (
            <div className="btn-row" style={{ marginTop: 10 }}>
              <Button sm variant="secondary" onClick={openHistory}>
                View payment history
              </Button>
            </div>
          ) : null}
        </div>
      ) : methodList.length === 0 ? (
        <p className="pay-empty">No payment methods are available right now. Please try again later.</p>
      ) : (
        <>
          <div className="pay-block">
            <div className="pay-step-head">
              <span className="step-num" aria-hidden>
                1
              </span>
              <h3 className="pay-block-title">Amount due</h3>
            </div>
            {plan ? (
              <div className="pay-details">
                <div className="pay-detail-row">
                  <span className="pay-detail-label">Plan</span>
                  <span className="pay-detail-value">{plan.name}</span>
                </div>
                <div className="pay-detail-row">
                  <span className="pay-detail-label">Amount due</span>
                  <span className="pay-detail-value">
                    <Money minor={plan.monthlyPriceMinor} currency={plan.currency} /> /{intervalPerLabel(plan.billingInterval)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="pay-empty">No plan is available right now. Try again later.</p>
            )}
            <p className="hint">Pay exactly this amount to one of the accounts below, then submit your proof.</p>
          </div>

          <div className="pay-block">
            <div className="pay-step-head">
              <span className="step-num" aria-hidden>
                2
              </span>
              <h3 className="pay-block-title">Payment method</h3>
            </div>
            {/* Chip group: a plain div, not a <label> — buttons are not
                labelable content, and nesting them inside a label would hand
                the first chip the whole label text as its accessible name. */}
            <div className="field">
              <span className="label" id="pay-method-label">
                Payment method
              </span>
              <div role="group" aria-labelledby="pay-method-label">
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
              </div>
            ) : null}
          </div>

          <div className="pay-block">
            <div className="pay-step-head">
              <span className="step-num" aria-hidden>
                3
              </span>
              <h3 className="pay-block-title">Payment proof</h3>
            </div>
            <Field
              label="Transaction reference"
              hint="From your payment app or bank slip. We match it against your receipt."
            >
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
              {/* The receipt is genuinely persisted: uploadPaymentReceipt POSTs
                  it to the API's multipart endpoint, which stores the bytes
                  server-side and returns a storage key. The generic "image
                  storage is not connected" notice is about business/product
                  images, not receipts — hiding it here keeps the text honest. */}
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
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              Your payment stays pending until the NearbyOrders team reviews and approves it.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
