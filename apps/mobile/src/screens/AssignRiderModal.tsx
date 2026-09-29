import { useState } from 'react';
import { assignRider, listRiders, ApiError, type Order, type Rider } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Loading } from '../components/ui.js';
import { orderNo } from './OwnerOrders.js';

/**
 * Assign (or reassign) a rider to a delivery order. Lists ACTIVE riders only —
 * inactive riders must never appear as assignable. The assignment is
 * idempotent server-side; reassigning to another rider replaces the current
 * one.
 */
export function AssignRiderModal(props: {
  businessId: string;
  order: Order;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const riders = useAsyncData<Rider[]>(() => listRiders(props.businessId), [props.businessId]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = (riders.data ?? []).filter((r) => r.isActive);

  const assign = async (rider: Rider) => {
    // Idempotent: assigning the already-assigned rider is a no-op server-side.
    if (props.order.assignedRider?.id === rider.id) {
      props.onAssigned();
      return;
    }
    setBusyId(rider.id);
    setError(null);
    try {
      await assignRider(props.order.id, rider.id);
      props.onAssigned();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not assign the rider',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Assign rider to order ${orderNo(props.order)}`}>
      <div className="modal-card">
        <div className="modal-head">
          <h2>Assign rider</h2>
          <button type="button" className="back-link" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hint">
          Order {orderNo(props.order)}
          {props.order.assignedRider ? ` · currently ${props.order.assignedRider.name}` : ''} · active riders only
        </p>
        {error ? <ErrorState message={error} /> : null}
        {riders.loading ? (
          <Loading label="Loading riders…" />
        ) : riders.error ? (
          <ErrorState message={riders.error} onRetry={riders.reload} />
        ) : !active.length ? (
          <p className="hint">No active riders. Add a rider in the Riders directory first.</p>
        ) : (
          <ul className="manage-list">
            {active.map((r) => (
              <li key={r.id} className="manage-item">
                <div className="item-row">
                  <span className="item-name rider-name">{r.name}</span>
                  <Button
                    sm
                    variant={props.order.assignedRider?.id === r.id ? 'secondary' : 'primary'}
                    disabled={busyId !== null}
                    onClick={() => void assign(r)}
                  >
                    {busyId === r.id ? 'Assigning…' : props.order.assignedRider?.id === r.id ? 'Assigned' : 'Assign'}
                  </Button>
                </div>
                <p className="item-desc">{r.phone}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="btn-row">
          <Button sm variant="secondary" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
