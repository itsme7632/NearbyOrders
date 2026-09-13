import { useState } from 'react';
import { collectOrderCash, listOrders, listOrderPayments, setOrderStatus, ApiError, type CustomerPayment, type Order, type OrderStatus } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { AlertIcon, OrdersIcon } from '../components/icons.js';

const ORDER_TRANSITIONS: Partial<Record<OrderStatus, { status: OrderStatus; label: string; variant: 'primary' | 'secondary' | 'danger' }[]>> = {
  PENDING: [
    { status: 'ACCEPTED', label: 'Accept', variant: 'primary' },
    { status: 'REJECTED', label: 'Reject', variant: 'danger' },
  ],
  ACCEPTED: [
    { status: 'PREPARING', label: 'Start preparing', variant: 'primary' },
    { status: 'READY', label: 'Mark ready', variant: 'secondary' },
  ],
  PREPARING: [{ status: 'READY', label: 'Mark ready', variant: 'primary' }],
  READY: [{ status: 'COMPLETED', label: 'Complete', variant: 'primary' }],
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  PREPARING: 'Preparing',
  READY: 'Ready',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  PENDING: 'status-pending',
  ACCEPTED: 'status-accepted',
  REJECTED: 'status-cancelled',
  PREPARING: 'status-preparing',
  READY: 'status-ready',
  COMPLETED: 'status-completed',
  CANCELLED: 'status-cancelled',
};

/** Short human-safe label (mirrors customer Orders screen). */
export const orderNo = (o: Order) => `#${o.id.replace(/-/g, '').slice(-6).toUpperCase()}`;

const itemCount = (o: Order) => o.items.reduce((sum, i) => sum + i.quantity, 0);

const customerName = (o: Order) => [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || 'Customer';

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Owner order management for one business. When `orders` is provided (the
 * Business-mode tab already fetched the scoped list) it is used directly;
 * otherwise the component fetches and filters itself (management screens).
 */
export function OwnerOrders(props: { businessId: string; orders?: Order[] }) {
  const selfFetched = useAsyncData<Order[]>(() => listOrders(), []);
  const orders = props.orders ? { data: props.orders, loading: false, error: null, reload: selfFetched.reload } : selfFetched;
  const list = (orders.data ?? []).filter((o) => o.business.id === props.businessId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (order: Order, next: OrderStatus) => {
    setBusyId(order.id);
    setError(null);
    try {
      await setOrderStatus(order.id, next);
      orders.reload();
    } catch (e) {
      // Someone else (or the other side) changed it first — surface and refresh.
      setError(
        e instanceof ApiError && e.code === 'INVALID_TRANSITION'
          ? 'That action is no longer available: the order status already changed.'
          : e instanceof Error
            ? e.message
            : 'Could not update the order',
      );
      orders.reload();
    } finally {
      setBusyId(null);
    }
  };

  if (orders.loading) return <Loading label="Loading orders…" />;
  if (orders.error) return <ErrorState message={orders.error} onRetry={orders.reload} />;

  // Scoped to the one business being managed. (Owner detail isolation is
  // enforced server-side.)
  const mine = list;

  if (selectedId) {
    const o = mine.find((x) => x.id === selectedId);
    if (!o) {
      return (
        <section className="card">
          {error ? <ErrorState message={error} /> : null}
          <EmptyState
            icon={<OrdersIcon size={28} />}
            title="Order not found"
            body="It may have been removed, or belongs to another business."
            action={<Button sm onClick={() => setSelectedId(null)}>Back to orders</Button>}
          />
        </section>
      );
    }
    const actions = ORDER_TRANSITIONS[o.status] ?? [];
    return (
      <section className="card" aria-label="Order detail">
        <button className="back-link" onClick={() => setSelectedId(null)}>
          ‹ All orders
        </button>
        {error ? <ErrorState message={error} /> : null}
        <div className="owner-head">
          <h2>Order {orderNo(o)}</h2>
          <span className={`badge ${STATUS_CLASS[o.status]}`}>{STATUS_LABEL[o.status]}</span>
        </div>
        <p className="order-meta">
          {customerName(o)} · {formatWhen(o.createdAt)}
        </p>
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
          <div className="cart-line">
            <span>Subtotal</span>
            <Money minor={o.subtotalMinor} currency={o.currency} />
          </div>
          {o.fulfillmentType === 'DELIVERY' ? (
            <div className="cart-line">
              <span>Delivery fee</span>
              <Money minor={o.deliveryFeeMinor ?? 0} currency={o.currency} />
            </div>
          ) : null}
          <div className="cart-line">
            <span>{o.fulfillmentType === 'DELIVERY' ? 'Delivery' : 'Pickup'} · total</span>
            <Money minor={o.totalMinor ?? o.subtotalMinor} currency={o.currency} />
          </div>
        </div>

        <OrderPaymentBlock orderId={o.id} onChanged={orders.reload} />

        {actions.length ? (
          <div className="btn-row">
            {actions.map((a) => (
              <Button key={a.status} sm variant={a.variant} disabled={busyId === o.id} onClick={() => void act(o, a.status)}>
                {busyId === o.id ? 'Working…' : a.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="hint">No further actions: this order is {STATUS_LABEL[o.status].toLowerCase()}.</p>
        )}
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Incoming orders</h2>
      {error ? <ErrorState message={error} /> : null}
      {!mine.length ? (
        <EmptyState
          icon={<OrdersIcon size={28} />}
          title="No customer orders yet"
          body="Orders placed with your business will appear here."
        />
      ) : (
        <ul className="order-list">
          {mine.map((o) => {
            const actions = ORDER_TRANSITIONS[o.status] ?? [];
            return (
              <li key={o.id}>
                <div className="order-card order-card-static">
                  <button
                    type="button"
                    className="order-card-open"
                    onClick={() => setSelectedId(o.id)}
                    aria-label={`Open order ${orderNo(o)}`}
                  >
                    <div className="order-card-top">
                      <span className="order-no">{orderNo(o)}</span>
                      <span className={`badge ${STATUS_CLASS[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                    </div>
                    <div className="item-row">
                      <span className="item-name">{customerName(o)}</span>
                      <Money minor={o.subtotalMinor} currency={o.currency} />
                    </div>
                    <p className="order-meta">
                      {formatWhen(o.createdAt)} · {itemCount(o)} item{itemCount(o) === 1 ? '' : 's'}
                    </p>
                  </button>
                  {actions.length ? (
                    <div className="btn-row">
                      {actions.map((a) => (
                        <Button
                          key={a.status}
                          sm
                          variant={a.variant}
                          disabled={busyId === o.id}
                          onClick={() => void act(o, a.status)}
                        >
                          {busyId === o.id ? 'Working…' : a.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------ Owner view of one order's payment ------------------ */

const OWNER_ORDER_PAYMENT_LABEL: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'Waiting for your verification',
  PAID: 'Paid',
  FAILED: 'Rejected',
  UNPAID: 'Unpaid',
};

/**
 * Payment block inside the owner's order detail: the chosen channel (or
 * cash), existing payment proofs with honest statuses, and — for cash flows
 * with money still due — a Collect cash action. COD stays UNPAID until the
 * owner confirms the cash was received in person; NearbyOrders never holds it.
 */
export function OrderPaymentBlock(props: { orderId: string; onChanged: () => void }) {
  const payments = useAsyncData<CustomerPayment[]>(() => listOrderPayments(props.orderId), [props.orderId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (payments.loading) return <Loading label="Loading payment…" />;
  if (payments.error || !payments.data) return null; // Non-critical; order still shows.

  const collect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await collectOrderCash(props.orderId);
      payments.reload();
      props.onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the cash collection');
    } finally {
      setBusy(false);
    }
  };

  const paid = payments.data.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountMinor, 0);
  const pending = payments.data.filter((p) => p.status === 'PENDING_VERIFICATION').reduce((s, p) => s + p.amountMinor, 0);

  return (
    <div className="pay-details">
      <h3 className="pay-section-title">Payment</h3>
      {error ? <ErrorState message={error} /> : null}
      {payments.data.length === 0 ? (
        <p className="hint">No payment proof yet: the customer will pay cash or submit proof for verification.</p>
      ) : (
        <ul className="manage-list">
          {payments.data.map((p) => (
            <li key={p.id} className="manage-item">
              <div className="item-row">
                <span className="item-name">
                  {p.paymentMethod?.displayName ?? 'Cash'} · <Money minor={p.amountMinor} currency={p.currency} />
                </span>
                <span className={`pay-status pay-status-${p.status === 'PAID' ? 'paid' : p.status === 'FAILED' ? 'failed' : 'pending'}`}>
                  {OWNER_ORDER_PAYMENT_LABEL[p.status]}
                </span>
              </div>
              {p.transactionReference ? <p className="item-desc pay-ref">Ref {p.transactionReference}</p> : null}
              {p.status === 'FAILED' && p.rejectionReason ? (
                <p className="item-desc">
                  <AlertIcon size={12} /> Reason: {p.rejectionReason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {paid + pending === 0 ? (
        <Button sm variant="secondary" disabled={busy} onClick={() => void collect()}>
          {busy ? 'Recording…' : 'Collect cash'}
        </Button>
      ) : null}
    </div>
  );
}
