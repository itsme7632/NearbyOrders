import { useState } from 'react';
import {
  listOwnerServices,
  listOwnerProducts,
  createProduct,
  updateService,
  deleteService,
  createService,
  updateProduct,
  deleteProduct,
  ApiError,
  type Service,
  type Product,
} from '../api.js';
import { ImageUploader, type ImageUploaderState, type PendingImage } from '../components/ImageUploader.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Field, Loading, Money, Toggle } from '../components/ui.js';
import { AlertIcon, OrdersIcon, StoreIcon } from '../components/icons.js';

export function OwnerServices(props: { businessId: string }) {
  const services = useAsyncData<Service[]>(() => listOwnerServices(props.businessId), [props.businessId]);
  // Phase 3F: local-only visibility filter — the server list is unchanged.
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const list = services.data ?? [];
  const visible = list.filter((s) => (filter === 'all' ? true : filter === 'active' ? s.isActive : !s.isActive));

  return (
    <section className="card">
      <div className="section-head-v3">
        <h2>
          Services{list.length ? <span className="count-note"> · {list.length}</span> : null}
        </h2>
      </div>
      {list.length > 1 ? (
        <div className="filter-row" role="group" aria-label="Filter services by status" style={{ marginBottom: 8 }}>
          {(
            [
              ['all', 'All'],
              ['active', 'Active'],
              ['inactive', 'Inactive'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" className={`chip${filter === v ? ' chip-active' : ''}`} onClick={() => setFilter(v)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {services.loading ? (
        <Loading />
      ) : services.error ? (
        <ErrorState message={services.error} onRetry={services.reload} />
      ) : !list.length ? (
        <EmptyState icon={<StoreIcon size={30} />} title="No services yet" body="Add your first service below so customers can book it later." />
      ) : !visible.length ? (
        <EmptyState icon={<StoreIcon size={30} />} title={`No ${filter} services`} body="Try a different filter to see the rest of your catalog." />
      ) : (
        <ul className="manage-list">
          {visible.map((s) => (
            <li key={s.id} className={`manage-item${s.isActive ? '' : ' manage-item-off'}`}>
              <div className="item-row">
                <span className="item-name">{s.name}</span>
                <Money minor={s.priceMinor} currency={s.currency} />
              </div>
              {s.description ? <p className="item-desc">{s.description}</p> : null}
              {s.durationMinutes ? <span className="pill">{s.durationMinutes} min</span> : null}
              {s.advanceType && s.advanceType !== 'NONE' ? (
                <span className="pill">
                  Advance: {s.advanceType === 'FIXED' ? `Rs ${(s.advanceAmountMinor ?? 0) / 100}` : `${s.advancePercent ?? 0}%`}
                </span>
              ) : null}
              <ServiceRow service={s} onSaved={services.reload} />
            </li>
          ))}
        </ul>
      )}
      <ServiceForm businessId={props.businessId} onCreated={() => services.reload()} />
    </section>
  );
}

function ServiceRow(props: { service: Service; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: props.service.name,
    description: props.service.description ?? '',
    price: String(props.service.priceMinor / 100),
    duration: props.service.durationMinutes ? String(props.service.durationMinutes) : '',
  });
  const [advance, setAdvance] = useState<AdvanceFormValue>({
    type: props.service.advanceType ?? 'NONE',
    value: props.service.advanceType === 'FIXED' && props.service.advanceAmountMinor ? String(props.service.advanceAmountMinor / 100) : props.service.advancePercent ? String(props.service.advancePercent) : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const priceMinor = parsePriceToMinor(form.price);
      if (priceMinor === null) throw new Error('Enter a valid price in rupees, e.g. 450 or 450.50.');
      const advanceBody = buildAdvanceBody(advance, priceMinor);
      if ('error' in advanceBody) throw new Error(advanceBody.error);
      await updateService(props.service.id, {
        name: form.name,
        description: form.description || undefined,
        priceMinor,
        durationMinutes: form.duration ? Number(form.duration) : undefined,
        ...advanceBody.advance,
      });
      setEditing(false);
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (isActive: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await updateService(props.service.id, { isActive });
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update service status');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteService(props.service.id);
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="edit-block">
        {error ? <ErrorState message={error} /> : null}
        <Field label="Name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label="Price (PKR)">
            <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Minutes">
            <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} inputMode="numeric" />
          </Field>
        </div>
        <Field label="Description">
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <ServiceAdvanceFields value={advance} onChange={setAdvance} priceMinor={parsePriceToMinor(form.price)} />
        <div className="btn-row">
          <Button sm onClick={save} disabled={busy || !form.name || !form.price}>
            Save
          </Button>
          <Button sm variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && !editing ? <ErrorState message={error} /> : null}
      <div className="btn-row">
        <Toggle checked={props.service.isActive} onChange={(v) => toggle(v)} label={props.service.isActive ? 'Active' : 'Inactive'} />
        <Button sm variant="secondary" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button sm variant="danger" onClick={remove} disabled={busy}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function ServiceForm(props: { businessId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', price: '', duration: '', description: '' });
  const [advance, setAdvance] = useState<{ type: 'NONE' | 'FIXED' | 'PERCENTAGE'; value: string }>({
    type: 'NONE',
    value: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const priceMinor = parsePriceToMinor(form.price);
      if (priceMinor === null) throw new Error('Enter a valid price in rupees, e.g. 450 or 450.50.');
      const advanceBody = buildAdvanceBody(advance, priceMinor);
      if ('error' in advanceBody) throw new Error(advanceBody.error);
      await createService(props.businessId, {
        name: form.name,
        priceMinor,
        durationMinutes: form.duration ? Number(form.duration) : undefined,
        description: form.description || undefined,
        ...advanceBody.advance,
      });
      setForm({ name: '', price: '', duration: '', description: '' });
      setAdvance({ type: 'NONE', value: '' });
      setOpen(false);
      props.onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create service');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button full variant="secondary" onClick={() => setOpen(true)}>
        + Add service
      </Button>
    );
  }
  return (
    <div className="edit-block">
      <h3>New service</h3>
      {error ? <ErrorState message={error} /> : null}
      <Field label="Name">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="Price (PKR)">
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label="Minutes">
          <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Description">
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <ServiceAdvanceFields value={advance} onChange={setAdvance} priceMinor={parsePriceToMinor(form.price)} />
      <div className="btn-row">
        <Button sm onClick={create} disabled={busy || !form.name || !form.price}>
          Create
        </Button>
        <Button sm variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ---------------------- Advance requirement (Phase 7C) ---------------------- */

export type AdvanceFormValue = { type: 'NONE' | 'FIXED' | 'PERCENTAGE'; value: string };

/**
 * Builds the advance payload for create/update service calls. Pure and
 * exported for tests; the server re-validates everything against priceMinor.
 */
export function buildAdvanceBody(
  value: AdvanceFormValue,
  priceMinor: number | null,
): { advance: { advanceType: 'NONE' | 'FIXED' | 'PERCENTAGE'; advanceAmountMinor?: number; advancePercent?: number } } | { error: string } {
  if (value.type === 'NONE') return { advance: { advanceType: 'NONE' } };
  if (value.type === 'FIXED') {
    const minor = priceMinor === null ? null : parsePriceToMinor(value.value);
    if (minor === null)
      return { error: priceMinor === null ? 'Enter a valid price before setting a fixed advance.' : 'Enter a valid advance amount in rupees, e.g. 200 or 200.50.' };
    if (priceMinor !== null && minor > priceMinor) return { error: 'Fixed advance cannot exceed the service price.' };
    return { advance: { advanceType: 'FIXED', advanceAmountMinor: minor } };
  }
  const percent = Number(value.value.trim().replace(/%$/, ''));
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return { error: 'Percentage must be a whole number between 1 and 100.' };
  return { advance: { advanceType: 'PERCENTAGE', advancePercent: percent } };
}

/** Advance type + value fields shared by the create and edit service forms. */
function ServiceAdvanceFields(props: { value: AdvanceFormValue; onChange: (v: AdvanceFormValue) => void; priceMinor: number | null }) {
  return (
    <>
      <Field label="Advance payment" hint="Optional amount the customer must pay before the booking is confirmed.">
        <select value={props.value.type} onChange={(e) => props.onChange({ type: e.target.value as AdvanceFormValue['type'], value: '' })}>
          <option value="NONE">No advance required</option>
          <option value="FIXED">Fixed amount</option>
          <option value="PERCENTAGE">Percentage of price</option>
        </select>
      </Field>
      {props.value.type === 'FIXED' ? (
        <Field label="Advance amount (PKR)">
          <input
            value={props.value.value}
            onChange={(e) => props.onChange({ ...props.value, value: e.target.value })}
            inputMode="decimal"
            placeholder="e.g. 200"
          />
        </Field>
      ) : null}
      {props.value.type === 'PERCENTAGE' ? (
        <Field label="Advance percentage (1–100%)">
          <input
            value={props.value.value}
            onChange={(e) => props.onChange({ ...props.value, value: e.target.value })}
            inputMode="numeric"
            placeholder="e.g. 20"
          />
        </Field>
      ) : null}
    </>
  );
}

/* ------------------------------ Products ------------------------------ */

/**
 * Parses a major-unit price string ("450", "450.50") into integer minor units
 * per the project's `priceMinor` convention. Returns null instead of rounding
 * silently: more than 2 decimal places, non-numeric, zero/negative, NaN,
 * Infinity and over-max inputs are all rejected — the caller shows a message.
 */
export function parsePriceToMinor(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round(value * 100);
  return minor > 99_999_999 ? null : minor; // server caps priceMinor at 99_999_999
}

/**
 * Client-side mirror of the server product rules. Returns per-field messages;
 * the backend stays authoritative. Exported for tests.
 */
export function validateProductForm(form: { name: string; price: string; description: string }): {
  name?: string;
  price?: string;
  description?: string;
} {
  const errors: { name?: string; price?: string; description?: string } = {};
  const name = form.name.trim();
  if (!name) errors.name = 'Product name is required.';
  else if (name.length < 2) errors.name = 'Product name must be at least 2 characters.';
  else if (name.length > 120) errors.name = 'Product name must be at most 120 characters.';
  if (parsePriceToMinor(form.price) === null)
    errors.price = 'Enter a valid price in rupees, e.g. 450 or 450.50.';
  if (form.description.trim().length > 1000) errors.description = 'Description must be at most 1000 characters.';
  return errors;
}

/** Small product thumbnail: the saved image, or a neutral placeholder. */
function ProductThumb(props: { imageUrl: string | null; name: string }) {
  return props.imageUrl ? (
    <img src={props.imageUrl} alt={props.name} className="product-thumb" loading="lazy" />
  ) : (
    <span className="product-thumb product-thumb-empty" aria-hidden>
      <OrdersIcon size={18} />
    </span>
  );
}

/** Exported for tests. */
export function OwnerProducts(props: { businessId: string }) {
  const products = useAsyncData<Product[]>(() => listOwnerProducts(props.businessId), [props.businessId]);
  // Phase 3F: local-only availability filter — the server list is unchanged.
  const [filter, setFilter] = useState<'all' | 'available' | 'unavailable'>('all');

  const list = products.data ?? [];
  const visible = list.filter((p) => (filter === 'all' ? true : filter === 'available' ? p.isActive : !p.isActive));

  return (
    <section className="card">
      <div className="section-head-v3">
        <h2>
          Products{list.length ? <span className="count-note"> · {list.length}</span> : null}
        </h2>
      </div>
      {list.length > 1 ? (
        <div className="filter-row" role="group" aria-label="Filter products by availability" style={{ marginBottom: 8 }}>
          {(
            [
              ['all', 'All'],
              ['available', 'Available'],
              ['unavailable', 'Unavailable'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" className={`chip${filter === v ? ' chip-active' : ''}`} onClick={() => setFilter(v)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {products.loading ? (
        <Loading />
      ) : products.error ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : !list.length ? (
        <EmptyState icon={<OrdersIcon size={30} />} title="No products yet" body="Add your first product to start building your menu." />
      ) : !visible.length ? (
        <EmptyState icon={<OrdersIcon size={30} />} title={`No ${filter} products`} body="Try a different filter to see the rest of your catalog." />
      ) : (
        <ul className="manage-list">
          {visible.map((p) => (
            <li key={p.id} className={`manage-item manage-item-product${p.isActive ? '' : ' manage-item-off'}`}>
              <div className="item-row">
                <span className="product-title">
                  <ProductThumb imageUrl={p.imageUrl} name={p.name} />
                  <span className="item-name">{p.name}</span>
                </span>
                <Money minor={p.priceMinor} currency={p.currency} />
              </div>
              {p.description ? <p className="item-desc">{p.description}</p> : null}
              <span className={`product-availability ${p.isActive ? 'product-available' : 'product-unavailable'}`}>
                {p.isActive ? 'Available' : 'Unavailable'}
              </span>
              <ProductRow product={p} onSaved={products.reload} />
            </li>
          ))}
        </ul>
      )}
      <ProductForm businessId={props.businessId} onCreated={() => products.reload()} />
    </section>
  );
}

function ProductRow(props: { product: Product; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: props.product.name,
    description: props.product.description ?? '',
    price: String(props.product.priceMinor / 100),
  });
  // Image handling follows the product-wide upload rule: no URL field. A
  // pending device pick cannot be persisted yet (no storage provider), so it
  // blocks saving honestly; removing the saved image persists imageUrl: null.
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateProductForm>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const onImageStateChange = (state: ImageUploaderState) => {
    setPendingImage(state.pending);
    setRemoveImage(state.removeSaved);
  };

  const save = async () => {
    if (busy) return;
    const validation = validateProductForm(form);
    if (Object.values(validation).some(Boolean)) {
      setFieldErrors(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateProduct(props.product.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        priceMinor: parsePriceToMinor(form.price) ?? 0,
        ...(removeImage ? { imageUrl: null } : {}),
      });
      setEditing(false);
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (isActive: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateProduct(props.product.id, { isActive });
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update availability');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteProduct(props.product.id);
      props.onSaved();
    } catch (e) {
      // Server refuses deleting products that appear in an order — suggest
      // the non-destructive path instead of an opaque failure.
      setError(e instanceof ApiError && e.code === 'PRODUCT_IN_USE'
        ? 'This product is part of an order, so it cannot be deleted. Disable it instead.'
        : e instanceof Error
          ? e.message
          : 'Delete failed');
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="edit-block">
        {error ? <ErrorState message={error} /> : null}
        <Field label="Product image">
          <ImageUploader
            currentUrl={removeImage ? null : props.product.imageUrl}
            label="Product image"
            onChange={onImageStateChange}
          />
        </Field>
        <Field label="Product name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Chicken Biryani"
            maxLength={120}
          />
        </Field>
        {fieldErrors.name ? <p className="auth-error" role="alert"><AlertIcon size={14} /> {fieldErrors.name}</p> : null}
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            maxLength={1000}
            placeholder="Short description (optional)"
          />
        </Field>
        {fieldErrors.description ? <p className="auth-error" role="alert"><AlertIcon size={14} /> {fieldErrors.description}</p> : null}
        <Field label="Price (PKR)">
          <input
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            inputMode="decimal"
            placeholder="e.g. 450"
          />
        </Field>
        {fieldErrors.price ? <p className="auth-error" role="alert"><AlertIcon size={14} /> {fieldErrors.price}</p> : null}
        <Field label="Availability">
          <Toggle checked={props.product.isActive} onChange={(v) => void toggle(v)} label={props.product.isActive ? 'Available' : 'Unavailable'} />
        </Field>
        {pendingImage ? (
          <p className="hint" role="note">
            Save is unavailable while a new photo is selected: image storage is not connected yet, so the photo cannot be persisted. Remove it to save your other changes.
          </p>
        ) : null}
        <div className="btn-row">
          <Button sm onClick={save} disabled={busy || Boolean(pendingImage)}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button sm variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="btn-row">
      <Toggle checked={props.product.isActive} onChange={(v) => void toggle(v)} label={props.product.isActive ? 'Available' : 'Unavailable'} />
      <Button sm variant="secondary" onClick={() => setEditing(true)}>
        Edit
      </Button>
      {error && !editing ? <p className="auth-error" role="alert"><AlertIcon size={14} /> {error}</p> : null}
      {confirmingDelete ? (
        <>
          <span className="confirm-delete-text" role="alert">Delete this product?</span>
          <Button sm variant="danger" onClick={() => void remove()} disabled={busy}>
            {busy ? 'Deleting…' : 'Yes, delete'}
          </Button>
          <Button sm variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={busy}>
            Keep
          </Button>
        </>
      ) : (
        <Button sm variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
          Delete
        </Button>
      )}
    </div>
  );
}

function ProductForm(props: { businessId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', price: '', description: '' });
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateProductForm>>({});

  const onImageStateChange = (state: ImageUploaderState) => {
    setPendingImage(state.pending);
    setRemoveImage(state.removeSaved);
  };

  const create = async () => {
    if (busy) return;
    const validation = validateProductForm(form);
    if (Object.values(validation).some(Boolean)) {
      setFieldErrors(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createProduct(props.businessId, {
        name: form.name.trim(),
        priceMinor: parsePriceToMinor(form.price) ?? 0,
        description: form.description.trim() || undefined,
      });
      setForm({ name: '', price: '', description: '' });
      setPendingImage(null);
      setRemoveImage(false);
      setOpen(false);
      props.onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create product');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button full variant="secondary" onClick={() => setOpen(true)}>
        + Add product
      </Button>
    );
  }
  return (
    <div className="edit-block">
      <h3>New product</h3>
      {error ? <ErrorState message={error} /> : null}
      <Field label="Product image">
        <ImageUploader currentUrl={null} label="Product image" onChange={onImageStateChange} />
      </Field>
      <Field label="Product name">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Chicken Biryani"
          maxLength={120}
        />
      </Field>
      {fieldErrors.name ? <p className="auth-error" role="alert"><AlertIcon size={14} /> {fieldErrors.name}</p> : null}
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          maxLength={1000}
          placeholder="Short description (optional)"
        />
      </Field>
      {fieldErrors.description ? <p className="auth-error" role="alert"><AlertIcon size={14} /> {fieldErrors.description}</p> : null}
      <Field label="Price (PKR)">
        <input
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          inputMode="decimal"
          placeholder="e.g. 450"
        />
      </Field>
      {fieldErrors.price ? <p className="auth-error" role="alert"><AlertIcon size={14} /> {fieldErrors.price}</p> : null}
      <p className="hint">New products start as Available; toggle availability after creating.</p>
      {pendingImage ? (
        <p className="hint" role="note">
          Save is unavailable while a new photo is selected: image storage is not connected yet, so the photo cannot be persisted. Remove it to save your other changes.
        </p>
      ) : null}
      <div className="btn-row">
        <Button sm onClick={create} disabled={busy || Boolean(pendingImage)}>
          {busy ? 'Creating…' : 'Create product'}
        </Button>
        <Button sm variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
