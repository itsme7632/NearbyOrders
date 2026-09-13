import { useState } from 'react';
import { getMyBusinesses, listBusinessOrders, type Order } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading } from '../components/ui.js';
import { OrdersIcon, StoreIcon } from '../components/icons.js';
import { OwnerOrders } from './OwnerOrders.js';

/**
 * Business-mode Orders tab: incoming orders for the selected owned business.
 * Reuses the existing owner order management (lifecycle + payment block);
 * the data is scoped server-side to businesses the caller owns.
 */
export function OwnerBusinessOrders(props: { onListBusiness?: () => void }) {
  const businesses = useAsyncData(() => getMyBusinesses(), []);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  if (businesses.loading) return <Loading label="Loading your businesses…" />;
  if (businesses.error) return <ErrorState message={businesses.error} onRetry={businesses.reload} />;
  if (!businesses.data?.length) {
    return (
      <div className="screen">
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Your business"
          body="You haven't listed a business yet. Create your business profile to start receiving orders."
          action={props.onListBusiness ? <Button onClick={props.onListBusiness}>List my business</Button> : null}
        />
      </div>
    );
  }

  const active = businesses.data.find((b) => b.id === selectedId) ?? businesses.data[0];
  const switcher =
    businesses.data.length > 1 ? (
      <div className="filter-row" aria-label="Switch business">
        {businesses.data.map((b) => (
          <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setSelectedId(b.id)}>
            {b.name}
          </button>
        ))}
      </div>
    ) : null;

  return <OrdersForBusiness businessId={active.id} switcher={switcher} />;
}

function OrdersForBusiness(props: { businessId: string; switcher?: React.ReactNode }) {
  const orders = useAsyncData<Order[]>(() => listBusinessOrders(props.businessId), [props.businessId]);

  if (orders.loading) return <Loading label="Loading orders…" />;
  if (orders.error) return <ErrorState message={orders.error} onRetry={orders.reload} />;

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>Orders</h1>
      </header>
      {props.switcher}
      {!orders.data?.length ? (
        /* Business-mode empty state: never the customer wording. */
        <EmptyState
          icon={<OrdersIcon size={30} />}
          title="No customer orders yet"
          body="Orders placed with your business will appear here."
        />
      ) : (
        <OwnerOrders businessId={props.businessId} orders={orders.data} />
      )}
    </div>
  );
}
