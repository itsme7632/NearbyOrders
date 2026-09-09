import { useState } from 'react';
import { listOrders, setOrderStatus, ApiError, type Order, type OrderStatus } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { OrdersIcon } from '../components/icons.js';

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

export function OwnerOrders(props: { businessId: string }) {
  const orders = useAsyncData<Order[]>(() => listOrders(), []);
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
          ? 'That action is no longer available — the order status already changed.'
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

  // The list endpoint already scopes to the owner's businesses; filter here to
  // the one being managed. (Owner detail isolation is enforced server-side.)
  const mine = (orders.data ?? []).filter((o) => o.business.id === props.businessId);

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
          <div className="cart-line cart-total">
            <span>Total</span>
            <Money minor={o.subtotalMinor} currency={o.currency} />
          </div>
        </div>
        {actions.length ? (
          <div className="btn-row">
            {actions.map((a) => (
              <Button key={a.status} sm variant={a.variant} disabled={busyId === o.id} onClick={() => void act(o, a.status)}>
                {busyId === o.id ? 'Working…' : a.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="hint">No further actions — this order is {STATUS_LABEL[o.status].toLowerCase()}.</p>
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
          title="No orders yet"
          body="Customer orders for this business will appear here."
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
