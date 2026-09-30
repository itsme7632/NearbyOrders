import { RemoteImage } from '../components/RemoteImage.js';
import { useEffect, useState } from 'react';
import { createRider, listRiders, updateRider, createApiImageStorageProvider, ApiError, type Rider, type RiderInput } from '../api.js';
import { setImageStorageProvider } from '../upload.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading } from '../components/ui.js';
import { OrdersIcon } from '../components/icons.js';
import { RiderForm } from './RiderForm.js';

/**
 * Rider directory for one business: active riders first, then inactive.
 * Each row shows name, phone, photo (if any), internal note, the
 * active/inactive badge, and an Edit action. Add/edit go through RiderForm.
 */
export function OwnerRiders(props: { businessId: string; onBack: () => void }) {
  const riders = useAsyncData<Rider[]>(() => listRiders(props.businessId), [props.businessId]);
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list');
  const [editing, setEditing] = useState<Rider | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Riders belong to the business: rider photos upload through the
    // business's image endpoint, via the same provider the profile uses.
    setImageStorageProvider(createApiImageStorageProvider(props.businessId));
  }, [props.businessId]);

  const save = async (input: RiderInput) => {
    setSaving(true);
    setError(null);
    try {
      if (mode === 'edit' && editing) {
        await updateRider(props.businessId, editing.id, input);
      } else {
        await createRider(props.businessId, input);
      }
      setMode('list');
      setEditing(null);
      riders.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save the rider');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rider: Rider) => {
    setSaving(true);
    setError(null);
    try {
      await updateRider(props.businessId, rider.id, { isActive: !rider.isActive });
      riders.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not update the rider');
    } finally {
      setSaving(false);
    }
  };

  if (mode !== 'list') {
    return (
      <section className="card" aria-label={mode === 'add' ? 'Add rider' : 'Edit rider'}>
        <button className="back-link" onClick={() => { setMode('list'); setEditing(null); setError(null); }}>
          ‹ Riders
        </button>
        <div className="owner-head">
          <h2>{mode === 'add' ? 'Add rider' : 'Edit rider'}</h2>
        </div>
        <RiderForm
          initial={editing}
          saving={saving}
          error={error}
          onSubmit={(input) => void save(input)}
          onCancel={() => { setMode('list'); setEditing(null); setError(null); }}
        />
      </section>
    );
  }

  if (riders.loading) return <Loading label="Loading riders…" />;
  if (riders.error) return <ErrorState message={riders.error} onRetry={riders.reload} />;

  const all = riders.data ?? [];
  const active = all.filter((r) => r.isActive);
  const inactive = all.filter((r) => !r.isActive);

  const row = (r: Rider) => (
    <li key={r.id} className="manage-item">
      <div className="item-row">
        <span className="item-name rider-name">
          {r.photoUrl ? (
            <RemoteImage src={r.photoUrl} alt="" className="rider-photo" loading="lazy" />
          ) : null}
          {r.name}
        </span>
        <span className={`badge ${r.isActive ? 'badge-open' : 'badge-closed'}`}>
          {r.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
      <p className="item-desc">{r.phone}</p>
      {r.note ? <p className="item-desc">Note: {r.note}</p> : null}
      <div className="btn-row">
        <Button
          sm
          variant="secondary"
          disabled={saving}
          onClick={() => { setEditing(r); setMode('edit'); setError(null); }}
        >
          Edit
        </Button>
        <Button sm variant="secondary" disabled={saving} onClick={() => void toggleActive(r)}>
          {r.isActive ? 'Deactivate' : 'Activate'}
        </Button>
      </div>
    </li>
  );

  return (
    <section className="card" aria-label="Riders">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <div className="owner-head">
        <h2>Riders</h2>
        <Button sm onClick={() => { setEditing(null); setMode('add'); setError(null); }}>
          Add rider
        </Button>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {!all.length ? (
        <EmptyState
          icon={<OrdersIcon size={28} />}
          title="No riders yet"
          body="Add your delivery riders here. They never log in - this directory is for your dispatch only."
          action={<Button sm onClick={() => { setEditing(null); setMode('add'); }}>Add rider</Button>}
        />
      ) : (
        <>
          <h3 className="pay-section-title">Active ({active.length})</h3>
          {!active.length ? (
            <p className="hint">No active riders.</p>
          ) : (
            <ul className="manage-list">{active.map(row)}</ul>
          )}
          {inactive.length ? (
            <>
              <h3 className="pay-section-title">Inactive ({inactive.length})</h3>
              <ul className="manage-list">{inactive.map(row)}</ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
