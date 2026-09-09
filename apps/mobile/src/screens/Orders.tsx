import { getMyOrder, listMyOrders } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { OrdersIcon } from '../components/icons.js';
import type { Order, OrderStatus } from '../api.js';

/** Short, human-safe order label: never exposes the raw database id. */
export function orderNumber(o: Order): string {
  return `#${o.id.replace(/-/g, '').slice(-6).toUpperCase()}`;
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
        <Loading label="Loading your orders…" />
      ) : orders.error ? (
        <ErrorState message={orders.error} onRetry={orders.reload} />
      ) : !orders.data?.length ? (
        <EmptyState
          icon={<OrdersIcon size={30} />}
          title="No orders yet"
          body="Add products from a business and place your first order."
          action={<Button onClick={props.onBrowse}>Find businesses</Button>}
        />
      ) : (
        <ul className="order-list">
          {orders.data.map((o) => {
            const label = orderLabel(o.status);
            return (
              <li key={o.id}>
                <button className="order-card" onClick={() => props.onOpenOrder(o.id)}>
                  <div className="order-card-top">
                    <span className="order-no">{orderNumber(o)}</span>
                    <span className={`badge ${label.cls}`}>{label.text}</span>
                  </div>
                  <div className="item-row">
                    <span className="item-name">{o.business.name}</span>
                    <Money minor={o.subtotalMinor} currency={o.currency} />
                  </div>
                  <p className="order-meta">
                    {formatWhen(o.createdAt)} · {itemCount(o)} item{itemCount(o) === 1 ? '' : 's'}
                  </p>
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
          <div className="cart-line cart-total">
            <span>Total</span>
            <Money minor={o.subtotalMinor} currency={o.currency} />
          </div>
        </div>
      </section>
      <p className="hint">Purchase-time prices are shown — later menu changes never alter your order.</p>
    </div>
  );
}
