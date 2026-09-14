import { useEffect, useState } from 'react';
import {
  getMyOrder,
  listMyOrders,
  listMyReviews,
  listBusinessPayInMethods,
  listOrderPayments,
  submitOrderPayment,
  uploadPaymentReceipt,
  type BusinessPayInMethod,
  type CustomerPayment,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Loading, Money } from '../components/ui.js';
import { OrdersIcon } from '../components/icons.js';
import type { Order, OrderStatus } from '../api.js';
import { ReviewForm } from '../components/ReviewForm.js';

/** Short, human-safe order label: never exposes the raw database id. */
export function orderNumber(o: Order): string {
  return `#${o.id.replace(/-/g, '').slice(-6).toUpperCase()}`;
}

/** Marketplace-card business thumbnail: image when present, monogram otherwise. */
export function OrderThumb(props: { name: string; imageUrl?: string | null }) {
  if (props.imageUrl) {
    return <img className="oc-thumb" src={props.imageUrl} alt="" loading="lazy" />;
  }
  return (
    <span className="oc-thumb" aria-hidden>
      {props.name[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

export function orderLabel(status: OrderStatus): { text: string; cls: string } {
  switch (status) {
    case 'PENDING':
      return { text: 'Pending', cls: 'status-pending' };
    case 'ACCEPTED':
      return { text: 'Accepted', cls: 'status-accepted' };
    case 'PREPARING':
      return { text: 'Preparing', cls: 'status-preparing' };
    case 'READY':
      return { text: 'Ready', cls: 'status-ready' };
    case 'COMPLETED':
      return { text: 'Completed', cls: 'status-completed' };
    case 'CANCELLED':
      return { text: 'Cancelled', cls: 'status-cancelled' };
    case 'REJECTED':
      return { text: 'Rejected', cls: 'status-cancelled' };
  }
}

const itemCount = (o: Order) => o.items.reduce((sum, i) => sum + i.quantity, 0);

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function OrdersScreen(props: { onOpenOrder: (id: string) => void; onBrowse: () => void }) {
  const orders = useAsyncData<Order[]>(() => listMyOrders(), []);

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>My orders</h1>
      </header>
      {orders.loading ? (
        <ListSkeleton count={4} />
      ) : orders.error ? (
        <ErrorState message={orders.error} onRetry={orders.reload} />
      ) : !orders.data?.length ? (
        <EmptyState
          icon={<OrdersIcon size={30} />}
          title="No orders yet"
          body="Discover something nearby and place your first order."
          action={<Button onClick={props.onBrowse}>Find businesses</Button>}
        />
      ) : (
        <ul className="order-list" style={{ display: 'grid', gap: 10 }}>
          {orders.data.map((o) => {
            const label = orderLabel(o.status);
            return (
              <li key={o.id}>
                <button className="order-card-v3" onClick={() => props.onOpenOrder(o.id)}>
                  <span className="oc-top">
                    <OrderThumb name={o.business.name} imageUrl={o.business.imageUrl} />
                    <span className="oc-main">
                      <span className="oc-name">{o.business.name}</span>
                      <span className="oc-sub">
                        {orderNumber(o)} · {itemCount(o)} item{itemCount(o) === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="oc-side">
                      <Money minor={o.totalMinor ?? o.subtotalMinor} currency={o.currency} />
                      <span className={`badge ${label.cls}`}>{label.text}</span>
                    </span>
                  </span>
                  <span className="oc-bottom">
                    <span className="oc-when">Placed {formatWhen(o.createdAt)}</span>
                    <span className="oc-when" aria-hidden>›</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Fetches by id; list views pass ids, so a dedicated fetch keeps it simple. */
async function fetchOrder(id: string): Promise<Order> {
  return getMyOrder(id);
}

export function OrderDetailScreen(props: { orderId: string; onBack: () => void }) {
  const order = useAsyncData<Order>(() => fetchOrder(props.orderId), [props.orderId]);

  if (order.loading) return <Loading label="Loading order…" />;
  if (order.error) return <ErrorState message={order.error} onRetry={order.reload} />;
  if (!order.data)
    return <EmptyState icon={<OrdersIcon size={30} />} title="Order not found" body="It may belong to another account." />;

  const o = order.data;
  const label = orderLabel(o.status);

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <header className="owner-head">
        <h1>Order {orderNumber(o)}</h1>
        <span className={`badge ${label.cls}`}>{label.text}</span>
      </header>
      <p className="order-meta">
        {o.business.name} · {formatWhen(o.createdAt)}
      </p>

      <section className="card" aria-label="Order items">
        <h2>Items</h2>
        <ul className="item-list">
          {o.items.map((i) => (
            <li key={i.id}>
              <div className="item-row">
                <span className="item-name">{i.name}</span>
                <Money minor={i.lineTotalMinor} currency={o.currency} />
              </div>
              <p className="item-desc">
                {i.quantity} × <Money minor={i.unitPriceMinor} currency={o.currency} />
              </p>
            </li>
          ))}
        </ul>
        <div className="cart-summary">
          {o.fulfillmentType === 'DELIVERY' ? (
            <div className="cart-line">
              <span>Delivery fee</span>
              <Money minor={o.deliveryFeeMinor ?? 0} currency={o.currency} />
            </div>
          ) : null}
          <div className="cart-line">
            <span>Items subtotal</span>
            <Money minor={o.subtotalMinor} currency={o.currency} />
          </div>
          <div className="cart-line cart-total">
            <span>Total</span>
            <Money minor={o.totalMinor ?? o.subtotalMinor} currency={o.currency} />
          </div>
        </div>
      </section>
      <p className="hint">
        Purchase-time prices are shown: later menu changes never alter your order.
        {o.fulfillmentType === 'DELIVERY' ? ' Delivered by the business’s own rider.' : ''}
      </p>

      <OrderPaymentPanel order={o} onChanged={order.reload} />

      {o.status === 'COMPLETED' ? <OrderReviewPanel order={o} /> : null}
    </div>
  );
}

/* ------------------- Phase 7C: order payment (customer) ------------------- */

const ORDER_PAYMENT_LABEL: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'Waiting for verification',
  PAID: 'Paid',
  FAILED: 'Rejected',
  UNPAID: 'Unpaid',
};

const ORDER_PAYMENT_BADGE: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'badge-neutral',
  PAID: 'badge-open',
  FAILED: 'badge-closed',
  UNPAID: 'badge-closed',
};

/**
 * Payment section for one order: cash flows show a simple state line, manual
 * digital channels show instructions + reference + receipt upload, and every
 * proof stays "waiting for verification" until the business verifies it.
 */
export function OrderPaymentPanel(props: { order: Order; onChanged: () => void }) {
  const { order } = props;
  const payments = useAsyncData<CustomerPayment[]>(() => listOrderPayments(order.id), [order.id]);
  const methods = useAsyncData<BusinessPayInMethod[]>(() => listBusinessPayInMethods(order.business.id), [order.business.id]);

  const total = order.totalMinor ?? order.subtotalMinor;
  const paid = (payments.data ?? []).filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountMinor, 0);
  const pending = (payments.data ?? []).filter((p) => p.status === 'PENDING_VERIFICATION').reduce((s, p) => s + p.amountMinor, 0);
  const due = Math.max(total - paid - pending, 0);
  // All hooks run unconditionally, before any early return (rules of hooks).
  const [formOpen, setFormOpen] = useState(false);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (payments.loading) return <Loading label="Loading payment…" />;
  if (payments.error) return null; // Non-critical panel; order details still load.

  const hasDue = due > 0;
  const digitalMethods = (methods.data ?? []).filter((m) => m.type !== 'CASH');
  const selected = digitalMethods.find((m) => m.id === methodId) ?? null;

  // Nothing due, nothing pending, no history: pure cash flow state line.
  // With any payment record we still show the summary + history below.
  if (!hasDue && !pending && !(payments.data ?? []).length)
    return (
      <section className="card" aria-label="Payment">
        <h2>Payment</h2>
        <p className="hint">{paid >= total ? 'Paid in full.' : 'Pay cash when you receive the order.'}</p>
      </section>
    );

  return (
    <section className="card" aria-label="Payment">
      <h2>Payment</h2>
      {error ? <ErrorState message={error} /> : null}
      <div className="cart-summary">
        <div className="cart-line">
          <span>Total</span>
          <Money minor={total} currency={order.currency} />
        </div>
        {paid > 0 ? (
          <div className="cart-line">
            <span>Paid</span>
            <Money minor={paid} currency={order.currency} />
          </div>
        ) : null}
        {pending > 0 ? (
          <div className="cart-line">
            <span>Submitted, awaiting verification</span>
            <Money minor={pending} currency={order.currency} />
          </div>
        ) : null}
        <div className="cart-line cart-total">
          <span>Due</span>
          <Money minor={due} currency={order.currency} />
        </div>
      </div>

      <ul className="manage-list">
        {(payments.data ?? []).map((p) => (
          <li key={p.id} className="manage-item">
            <div className="item-row">
              <span className="item-name">
                {p.paymentMethod?.displayName ?? 'Cash'} · <Money minor={p.amountMinor} currency={p.currency} />
                </span>
              <span className={`badge ${ORDER_PAYMENT_BADGE[p.status]}`}>{ORDER_PAYMENT_LABEL[p.status]}</span>
            </div>
            {p.transactionReference ? <p className="item-desc pay-ref">Ref {p.transactionReference}</p> : null}
            {p.status === 'FAILED' && p.rejectionReason ? <p className="item-desc">Reason: {p.rejectionReason}</p> : null}
          </li>
        ))}
      </ul>

      {hasDue && digitalMethods.length > 0 ? (
        formOpen ? (
          <div className="pay-details">
            <div className="pay-methods" role="radiogroup" aria-label="Payment method">
              {digitalMethods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={methodId === m.id}
                  className={`pay-chip${methodId === m.id ? ' pay-chip-active' : ''}`}
                  onClick={() => setMethodId(m.id)}
                >
                  {m.displayName}
                </button>
              ))}
            </div>
            {selected ? (
              <div className="pay-details">
                <p className="pay-instructions">{selected.instructions ?? 'Pay the business directly, then submit your proof below.'}</p>
                {selected.accountTitle || selected.accountNumber || selected.iban ? (
                  <dl className="pay-account">
                    {selected.accountTitle ? (
                      <div>
                        <dt>Account title</dt>
                        <dd>{selected.accountTitle}</dd>
                      </div>
                    ) : null}
                    {selected.accountNumber ? (
                      <div>
                        <dt>Account number</dt>
                        <dd>{selected.accountNumber}</dd>
                      </div>
                    ) : null}
                    {selected.iban ? (
                      <div>
                        <dt>IBAN</dt>
                        <dd className="pay-iban">{selected.iban}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                <label className="field">
                  <span className="label">Transaction reference (required)</span>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TX-123456" maxLength={80} />
                </label>
                <label className="field">
                  <span className="label">Receipt image</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
                </label>
                <p className="hint">Your payment stays “submitted” until the business verifies it.</p>
                <div className="btn-row">
                  <Button
                    sm
                    disabled={busy || !methodId || !reference.trim() || !receiptFile}
                    onClick={() => {
                      if (!methodId) return;
                      setBusy(true);
                      setError(null);
                      uploadPaymentReceipt(receiptFile!)
                        .then((receiptStorageKey) =>
                          submitOrderPayment(order.id, {
                            amountMinor: due,
                            paymentMethodId: methodId,
                            transactionReference: reference.trim(),
                            receiptStorageKey,
                          }),
                        )
                        .then(() => {
                          setFormOpen(false);
                          setReference('');
                          setReceiptFile(null);
                          setMethodId(null);
                          props.onChanged();
                          payments.reload();
                        })
                        .catch((e) => setError(e instanceof Error ? e.message : 'Could not submit payment'))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {busy ? 'Submitting…' : 'Submit for verification'}
                  </Button>
                  <Button sm variant="ghost" disabled={busy} onClick={() => setFormOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <Button full variant="secondary" onClick={() => setFormOpen(true)}>
            Pay Rs {due / 100} online: submit proof
          </Button>
        )
      ) : null}
    </section>
  );
}

/** Leave-a-review panel for completed orders; server rejects duplicates. */
function OrderReviewPanel(props: { order: Order }) {
  const [showForm, setShowForm] = useState(false);
  const [reviewed, setReviewed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    listMyReviews()
      .then((mine) => {
        if (active) setReviewed(mine.some((rv) => rv.orderId === props.order.id));
      })
      .catch(() => {
        if (active) setReviewed(false); // Fail open; the API still blocks duplicates.
      });
    return () => {
      active = false;
    };
  }, [props.order.id]);

  if (reviewed === null) return null;
  if (reviewed)
    return (
      <p className="review-done" role="status">
        ★ Reviewed: thank you for your feedback.
      </p>
    );
  if (!showForm)
    return (
      <Button full variant="secondary" onClick={() => setShowForm(true)}>
        Leave a review
      </Button>
    );
  return (
    <ReviewForm
      businessId={props.order.business.id}
      source={{ orderId: props.order.id }}
      heading="Rate this business"
      onSubmitted={() => {
        setReviewed(true);
        setShowForm(false);
      }}
      onCancel={() => setShowForm(false)}
    />
  );
}
