import { useState } from 'react';
import {
  listOwnerPayments,
  verifyOwnerPayment,
  rejectOwnerPayment,
  listOwnerPayInMethods,
  createPayInMethod,
  deactivatePayInMethod,
  ApiError,
  type CustomerPayment,
  type BusinessPayInMethod,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { AlertIcon } from '../components/icons.js';

const CUSTOMER_PAYMENT_LABEL: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'Waiting for verification',
  PAID: 'Paid',
  FAILED: 'Rejected',
  UNPAID: 'Unpaid',
};

function OwnerPaymentRow(props: { payment: CustomerPayment; kind: 'booking' | 'order'; onChanged: () => void }) {
  const { payment } = props;
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<CustomerPayment>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      props.onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
      setRejecting(false);
    }
  };

  return (
    <li className="manage-item">
      <div className="item-row">
        <span className="item-name">
          <Money minor={payment.amountMinor} currency={payment.currency} />
        </span>
        <span className={`pay-status pay-status-${payment.status === 'PAID' ? 'paid' : payment.status === 'FAILED' ? 'failed' : 'pending'}`}>
          {CUSTOMER_PAYMENT_LABEL[payment.status]}
        </span>
      </div>
      <p className="hint">
        {payment.paymentMethod?.displayName ?? 'Payment'}
        {payment.transactionReference ? (
          <>
            {' '}
            · ref <span className="pay-ref">{payment.transactionReference}</span>
          </>
        ) : null}
        {' '}
        · {new Date(payment.submittedAt).toLocaleDateString()}
      </p>
      {payment.status === 'FAILED' && payment.rejectionReason ? <p className="hint">Reason: {payment.rejectionReason}</p> : null}
      {error ? <ErrorState message={error} /> : null}
      {payment.status === 'PENDING_VERIFICATION' ? (
        rejecting ? (
          <div className="confirm-cancel">
            <label className="field">
              <span className="label">Reason (required)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why can't this be verified?" />
            </label>
            <div className="btn-row">
              <Button
                sm
                variant="danger"
                disabled={busy || reason.trim().length < 4}
                onClick={() => void act(() => rejectOwnerPayment(payment.id, props.kind, reason.trim()))}
              >
                {busy ? 'Rejecting…' : 'Reject payment'}
              </Button>
              <Button sm variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
                Back
              </Button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <Button sm disabled={busy} onClick={() => void act(() => verifyOwnerPayment(payment.id, props.kind))}>
              {busy ? 'Working…' : 'Verify payment'}
            </Button>
            <Button sm variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

/**
 * Payments tab: the owner's verification queue plus the pay-in channels
 * customers see. Money never flows through NearbyOrders — the owner only
 * confirms what they received.
 */
export function OwnerCustomerPayments(props: { businessId: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [showMethodForm, setShowMethodForm] = useState(false);
  const [mType, setMType] = useState<BusinessPayInMethod['type']>('EASYPAISA');
  const [mName, setMName] = useState('');
  const [mTitle, setMTitle] = useState('');
  const [mNumber, setMNumber] = useState('');
  const [mIban, setMIban] = useState('');
  const [mInstructions, setMInstructions] = useState('');
  const [mError, setMError] = useState<string | null>(null);
  const [mBusy, setMBusy] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const queue = useAsyncData(
    () => listOwnerPayments('PENDING_VERIFICATION'),
    [props.businessId, reloadKey],
  );
  const methods = useAsyncData(() => listOwnerPayInMethods(props.businessId), [props.businessId, reloadKey]);

  const bookingPayments = (queue.data?.bookingPayments ?? []).filter((p) => p.status === 'PENDING_VERIFICATION');
  const orderPayments = (queue.data?.orderPayments ?? []).filter((p) => p.status === 'PENDING_VERIFICATION');
  const reload = () => {
    queue.reload();
    methods.reload();
    setReloadKey((k) => k + 1);
  };

  const addMethod = async () => {
    if (mBusy) return;
    setMBusy(true);
    setMError(null);
    try {
      await createPayInMethod(props.businessId, {
        type: mType,
        displayName: mName.trim(),
        ...(mType !== 'CASH' && mTitle.trim() ? { accountTitle: mTitle.trim() } : {}),
        ...(mType !== 'CASH' && mNumber.trim() ? { accountNumber: mNumber.trim() } : {}),
        ...(mType !== 'CASH' && mIban.trim() ? { iban: mIban.trim() } : {}),
        ...(mInstructions.trim() ? { instructions: mInstructions.trim() } : {}),
      });
      setShowMethodForm(false);
      setMName('');
      setMTitle('');
      setMNumber('');
      setMIban('');
      setMInstructions('');
      reload();
    } catch (e) {
      setMError(e instanceof ApiError ? e.message : 'Could not add the payment method. Please try again.');
    } finally {
      setMBusy(false);
    }
  };

  return (
    <div className="owner-screen">
      <section className="card" aria-label="Payments awaiting verification">
        <h2>Awaiting verification</h2>
        {queue.loading ? (
          <Loading label="Loading payments…" />
        ) : queue.error ? (
          <ErrorState message={queue.error} onRetry={queue.reload} />
        ) : bookingPayments.length === 0 && orderPayments.length === 0 ? (
          <EmptyState icon={<AlertIcon size={30} />} title="Nothing to verify" body="Customer payment proofs will appear here for you to verify." />
        ) : (
          <>
            {bookingPayments.length > 0 ? (
              <>
                <div className="section-head section-head-sm">
                  <h2>
                    Booking payments
                    <span className="count-pill">{bookingPayments.length}</span>
                  </h2>
                </div>
                <ul className="manage-list">
                  {bookingPayments.map((p) => (
                    <OwnerPaymentRow key={p.id} payment={p} kind="booking" onChanged={reload} />
                  ))}
                </ul>
              </>
            ) : null}
            {orderPayments.length > 0 ? (
              <>
                <div className="section-head section-head-sm">
                  <h2>
                    Order payments
                    <span className="count-pill">{orderPayments.length}</span>
                  </h2>
                </div>
                <ul className="manage-list">
                  {orderPayments.map((p) => (
                    <OwnerPaymentRow key={p.id} payment={p} kind="order" onChanged={reload} />
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </section>

      <section className="card" aria-label="Your payment methods">
        <h2>How customers pay you</h2>
        <p className="hint">
          These channels are shown to customers at checkout. NearbyOrders never handles the money: customers pay you
          directly.
        </p>
        {deactivateError ? (
          <p className="form-error" role="alert">
            {deactivateError}{' '}
            <button type="button" className="link-btn" style={{ display: 'inline', margin: 0 }} onClick={() => setDeactivateError(null)}>
              Dismiss
            </button>
          </p>
        ) : null}
        {methods.loading ? (
          <Loading label="Loading methods…" />
        ) : methods.error ? (
          <ErrorState message={methods.error} onRetry={methods.reload} />
        ) : (
          <ul className="manage-list">
            {(methods.data ?? []).map((m) => (
              <li key={m.id} className="manage-item">
                <div className="item-row">
                  <span className="item-name">{m.displayName}</span>
                  <span className={`badge ${m.isActive ? 'badge-open' : 'badge-closed'}`}>{m.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <p className="hint">
                  {m.accountTitle ? `${m.accountTitle} · ` : ''}
                  {m.accountNumber ?? m.iban ?? m.type}
                </p>
                {m.isActive ? (
                  <Button
                    sm
                    variant="ghost"
                    onClick={() => {
                      setDeactivateError(null);
                      void deactivatePayInMethod(props.businessId, m.id)
                        .then(reload)
                        .catch(() => setDeactivateError(`Could not deactivate ${m.displayName}. Please try again.`));
                    }}
                  >
                    Deactivate
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {showMethodForm ? (
          <div className="pay-details">
            <label className="field">
              <span className="label">Type</span>
              <select value={mType} onChange={(e) => setMType(e.target.value as BusinessPayInMethod['type'])}>
                <option value="EASYPAISA">Easypaisa</option>
                <option value="JAZZCASH">JazzCash</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Display name (required)</span>
              <input value={mName} onChange={(e) => setMName(e.target.value)} maxLength={60} placeholder="e.g. Easypaisa" />
            </label>
            {mType !== 'CASH' ? (
              <>
                <label className="field">
                  <span className="label">Account title</span>
                  <input value={mTitle} onChange={(e) => setMTitle(e.target.value)} maxLength={80} />
                </label>
                <label className="field">
                  <span className="label">Account number</span>
                  <input value={mNumber} onChange={(e) => setMNumber(e.target.value)} maxLength={40} />
                </label>
                <label className="field">
                  <span className="label">IBAN (optional)</span>
                  <input value={mIban} onChange={(e) => setMIban(e.target.value)} maxLength={34} />
                </label>
              </>
            ) : null}
            <label className="field">
              <span className="label">Instructions for customers</span>
              <textarea value={mInstructions} onChange={(e) => setMInstructions(e.target.value)} rows={3} maxLength={500} />
            </label>
            {mError ? <ErrorState message={mError} /> : null}
            <div className="btn-row">
              <Button sm disabled={mBusy || !mName.trim()} onClick={() => void addMethod()}>
                {mBusy ? 'Saving…' : 'Save method'}
              </Button>
              <Button sm variant="ghost" onClick={() => setShowMethodForm(false)} disabled={mBusy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button full variant="secondary" onClick={() => setShowMethodForm(true)}>
            Add payment method
          </Button>
        )}
      </section>
    </div>
  );
}
