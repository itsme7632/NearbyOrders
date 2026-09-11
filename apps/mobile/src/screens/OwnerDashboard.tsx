import { useState } from 'react';
import {
  cancelBusinessSubscription,
  createProduct,
  createService,
  deleteProduct,
  deleteService,
  getBusinessSubscription,
  getMyBusinesses,
  listCategories,
  putHours,
  startBusinessTrial,
  updateBusiness,
  updateProduct,
  updateService,
  type Business,
  type BusinessHour,
  type Category,
  type HourInput,
  type Product,
  type Service,
  type Subscription,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import {
  ApiError,
  getHours,
  listMyBusinessReviews,
  listProducts,
  listServices,
  type OwnerReview,
} from '../api.js';
import { Button, EmptyState, ErrorState, Field, Loading, Money, Toggle } from '../components/ui.js';
import { Stars } from '../components/ReviewForm.js';
import { AlertIcon, CheckIcon, OrdersIcon, StoreIcon } from '../components/icons.js';
import { formatMoney } from '@nearbyorders/shared';
import { ImageUploader, type ImageUploaderState, type PendingImage } from '../components/ImageUploader.js';
import { OwnerOrders } from './OwnerOrders.js';

type OwnerTab = 'orders' | 'profile' | 'services' | 'products' | 'hours' | 'reviews' | 'subscription';

export function OwnerDashboardScreen(props: {
  onBack: () => void;
  onListBusiness?: () => void;
  justCreatedName?: string | null;
  justCreatedStatus?: string | null;
}) {
  const businesses = useAsyncData<Business[]>(() => getMyBusinesses(), []);
  const [businessId, setBusinessId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<OwnerTab>('profile');

  if (businesses.loading) return <Loading label="Loading your businesses…" />;
  if (businesses.error) return <ErrorState message={businesses.error} onRetry={businesses.reload} />;
  if (!businesses.data?.length) {
    return (
      <div className="screen">
        <button className="back-link" onClick={props.onBack}>
          ‹ Back
        </button>
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Your business"
          body="You haven't listed a business yet. Create your business profile and start accepting bookings."
          action={
            props.onListBusiness ? (
              <Button onClick={props.onListBusiness}>List my business</Button>
            ) : null
          }
        />
      </div>
    );
  }

  const active = businesses.data.find((b) => b.id === businessId) ?? businesses.data[0];
  const switcher =
    businesses.data.length > 1 ? (
      <div className="filter-row" aria-label="Switch business">
        {businesses.data.map((b) => (
          <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setBusinessId(b.id)}>
            {b.name}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <header className="owner-head">
        <h1>My businesses</h1>
      </header>
      {props.justCreatedName ? (
        <div className="created-banner" role="status">
          <CheckIcon size={16} />
          <span>
            <strong>{props.justCreatedName}</strong> has been created. Add your services and opening hours below.
            {props.justCreatedStatus === 'APPROVED'
              ? ' It\'s now visible to customers.'
              : ' It will appear in customer search once approved.'}
          </span>
        </div>
      ) : null}
      {/* One business: manage it directly. Several: the switcher above shows
          which business the tabs below are acting on. */}
      {businesses.data.length === 1 ? (
        <div className="owner-biz-card" aria-label="Managed business">
          <span className="owner-biz-name">{active.name}</span>
          <span className={`badge ${active.status === 'APPROVED' ? 'badge-open' : 'badge-closed'}`}>{active.status}</span>
        </div>
      ) : null}
      {switcher}
      <div className="btn-row">
        {props.onListBusiness ? (
          <Button variant="ghost" sm onClick={props.onListBusiness}>
            List another business
          </Button>
        ) : null}
      </div>
      <nav className="owner-tabs" aria-label="Management sections">
        {(
          [
            ['orders', 'Orders'],
            ['profile', 'Profile'],
            ['services', 'Services'],
            ['products', 'Products'],
            ['hours', 'Hours'],
            ['reviews', 'Reviews'],
            ['subscription', 'Subscription'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={`owner-tab${tab === key ? ' owner-tab-active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'orders' ? <OwnerOrders businessId={active.id} /> : null}
      {tab === 'profile' ? <OwnerProfile business={active} onSaved={businesses.reload} /> : null}
      {tab === 'subscription' ? <OwnerSubscription businessId={active.id} businessName={active.name} /> : null}
      {tab === 'services' ? <OwnerServices businessId={active.id} /> : null}
      {tab === 'products' ? <OwnerProducts businessId={active.id} /> : null}
      {tab === 'hours' ? <OwnerHours businessId={active.id} /> : null}
      {tab === 'reviews' ? <OwnerReviews businessId={active.id} /> : null}
    </div>
  );
}

/* ------------------------------ Profile ------------------------------ */

/** Exported for tests; the dashboard renders it inside the Profile tab. */
export function OwnerProfile(props: { business: Business; onSaved: () => void }) {
  const b = props.business;
  const [form, setForm] = useState({
    name: b.name,
    description: b.description ?? '',
    phone: b.phone ?? '',
    email: b.email ?? '',
    address: b.address,
    city: b.city,
    locality: b.locality ?? '',
  });
  // Image handling follows the product-wide upload rule: no URL field. A
  // pending device pick cannot be persisted yet (no storage provider), so it
  // blocks saving honestly; removing the saved image IS persistable now and
  // sends imageUrl: null on save. Omitting the key keeps the saved value.
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [removeSavedImage, setRemoveSavedImage] = useState(false);
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set(b.categories.map((c) => c.id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const categories = useAsyncData<Category[]>(() => listCategories(), []);

  const onImageStateChange = (state: ImageUploaderState) => {
    setPendingImage(state.pending);
    setRemoveSavedImage(state.removeSaved);
    setSaved(false);
  };

  const save = async () => {
    if (saving) return; // guard against double submission
    if (pendingImage) return; // unreachable: the button is disabled — belt & braces
    // Server-side mirrors: required fields must be present and valid; optional
    // fields are sent as null when cleared so the server nulls the column.
    const trimmed = {
      name: form.name.trim(),
      description: form.description.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      locality: form.locality.trim(),
    };
    const fieldErrors: string[] = [];
    if (trimmed.name.length < 2) fieldErrors.push('Business name must be at least 2 characters.');
    if (trimmed.name.length > 120) fieldErrors.push('Business name must be at most 120 characters.');
    if (trimmed.address.length < 5) fieldErrors.push('Enter the street address (at least 5 characters).');
    if (trimmed.city.length < 2) fieldErrors.push('Enter your city.');
    if (trimmed.description.length > 2000) fieldErrors.push('Description must be at most 2000 characters.');
    if (trimmed.locality.length > 100) fieldErrors.push('Area / locality must be at most 100 characters.');
    if (trimmed.phone && !/^[+\d][\d\s-]{5,19}$/.test(trimmed.phone)) fieldErrors.push('Enter a valid phone number, e.g. +92 300 1234567.');
    if (trimmed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) fieldErrors.push('Enter a valid email address.');
    if (fieldErrors.length > 0) {
      setError(fieldErrors.join(' '));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateBusiness(b.id, {
        name: trimmed.name,
        // Cleared optional fields go as null so the server nulls the column.
        description: trimmed.description || null,
        phone: trimmed.phone || null,
        email: trimmed.email || null,
        address: trimmed.address,
        city: trimmed.city,
        locality: trimmed.locality || null,
        // Image: only ever cleared here (no fake uploads). A pending pick is
        // blocked above; the key is omitted otherwise so the saved value stays.
        ...(removeSavedImage ? { imageUrl: null } : {}),
        categoryIds: [...categoryIds],
      });
      setSaved(true);
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2>Business profile</h2>
      {error ? <ErrorState message={error} /> : null}
      {saved ? <p className="save-ok">Saved ✓</p> : null}

      <Field label="Business name">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
      </Field>
      <div className="form-grid">
        <Field label="Phone">
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
        </Field>
        <Field label="Email">
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} inputMode="email" />
        </Field>
        <Field label="City">
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="Area / locality">
          <input value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} />
        </Field>
      </div>
      <Field label="Address">
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </Field>

      <Field label="Business logo">
        <ImageUploader
          currentUrl={removeSavedImage ? null : b.imageUrl}
          label="Business logo"
          onChange={onImageStateChange}
        />
      </Field>

      <Field label="Categories">
        {categories.loading ? (
          <Loading label="Loading categories…" />
        ) : (
          <div className="chip-row">
            {categories.data?.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${categoryIds.has(c.id) ? ' chip-active' : ''}`}
                onClick={() =>
                  setCategoryIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </Field>

      {pendingImage ? (
        <p className="hint" role="note">
          Save is unavailable while a new photo is selected: image storage is not connected yet, so the photo cannot be persisted. Remove it to save your other changes.
        </p>
      ) : null}
      <Button full disabled={saving || !form.name || categoryIds.size === 0 || Boolean(pendingImage)} onClick={save}>
        {saving ? 'Saving…' : 'Save profile'}
      </Button>
    </section>
  );
}

/* --------------------------- Subscription ---------------------------- */

const SUBSCRIPTION_STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUSPENDED: 'Suspended',
};

/**
 * Owner-facing subscription view (Phase 7A foundation). Start Trial uses the
 * server's plan configuration and generates all dates server-side; Cancel
 * stops renewal while access continues to the period end. There is no payment
 * flow or fake "Upgrade" button — real payments arrive in a later phase.
 */
export function OwnerSubscription(props: { businessId: string; businessName?: string }) {
  const subscription = useAsyncData<Subscription | null>(() => getBusinessSubscription(props.businessId), [props.businessId]);
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<Subscription>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      subscription.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (subscription.loading) return <Loading label="Loading subscription…" />;
  if (subscription.error) return <ErrorState message={subscription.error} onRetry={subscription.reload} />;

  const sub = subscription.data;
  const plan = sub?.plan;
  const isLive = sub?.status === 'TRIAL' || sub?.status === 'ACTIVE';
  const periodEnd = sub ? new Date(sub.currentPeriodEndAt).toLocaleDateString() : null;
  const trialEnd = sub?.trialEndAt ? new Date(sub.trialEndAt).toLocaleDateString() : null;

  return (
    <section className="card" aria-label="Subscription">
      <h2>Subscription</h2>
      {error ? <ErrorState message={error} /> : null}
      {!plan ? (
        <>
          <p className="muted">
            NearbyOrders Business makes your business discoverable with bookings, orders and reviews.
          </p>
          <div className="sub-plan-head">
            <span className="sub-plan-name">NearbyOrders Business</span>
            <Money minor={299900} />
            <span className="muted"> /month after a 30-day free trial</span>
          </div>
          <p className="hint">You have not started a trial yet. Your data stays intact either way.</p>
          <Button full disabled={busy} onClick={() => act(() => startBusinessTrial(props.businessId))}>
            {busy ? 'Starting…' : 'Start 30-day free trial'}
          </Button>
        </>
      ) : (
        <>
          <div className="sub-plan-head">
            <span className="sub-plan-name">{plan.name}</span>
            <Money minor={plan.monthlyPriceMinor} currency={plan.currency} />
            <span className="muted"> /month</span>
          </div>
          <p className={`badge ${isLive ? 'badge-open' : 'badge-closed'}`}>
            {SUBSCRIPTION_STATUS_LABEL[sub!.status]}
          </p>
          <ul className="sub-facts">
            {sub!.status === 'TRIAL' && trialEnd ? <li>Trial ends {trialEnd}</li> : null}
            {sub!.status === 'TRIAL' ? <li>After the trial: {formatMoney(plan.monthlyPriceMinor, plan.currency)} /month</li> : null}
            {periodEnd ? <li>Current period ends {periodEnd}</li> : null}
            {sub!.status === 'CANCELLED' && sub!.cancelledAt ? (
              <li>Cancelled — access continues until {periodEnd}</li>
            ) : null}
            {sub!.status === 'EXPIRED' ? <li>Ended. Start again any time.</li> : null}
          </ul>
          {isLive ? (
            confirmingCancel ? (
              <div className="btn-row" role="alert">
                <Button
                  sm
                  variant="danger"
                  disabled={busy}
                  onClick={() => act(() => cancelBusinessSubscription(props.businessId))}
                >
                  {busy ? 'Cancelling…' : 'Yes, cancel'}
                </Button>
                <Button sm variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(false)}>
                  Keep subscription
                </Button>
              </div>
            ) : (
              <div className="btn-row">
                <Button sm variant="danger" onClick={() => setConfirmingCancel(true)} disabled={busy}>
                  Cancel subscription
                </Button>
              </div>
            )
          ) : (
            <Button full disabled={busy} onClick={() => act(() => startBusinessTrial(props.businessId))}>
              {busy ? 'Starting…' : 'Start 30-day free trial'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------ Services ------------------------------ */

function OwnerServices(props: { businessId: string }) {
  const services = useAsyncData<Service[]>(() => listServices(props.businessId), [props.businessId]);

  return (
    <section className="card">
      <h2>Services</h2>
      {services.loading ? (
        <Loading />
      ) : services.error ? (
        <ErrorState message={services.error} onRetry={services.reload} />
      ) : !services.data?.length ? (
        <EmptyState icon={<StoreIcon size={30} />} title="No services yet" body="Add your first service below so customers can book it later." />
      ) : (
        <ul className="manage-list">
          {services.data.map((s) => (
            <li key={s.id} className={`manage-item${s.isActive ? '' : ' manage-item-off'}`}>
              <div className="item-row">
                <span className="item-name">{s.name}</span>
                <Money minor={s.priceMinor} currency={s.currency} />
              </div>
              {s.description ? <p className="item-desc">{s.description}</p> : null}
              {s.durationMinutes ? <span className="pill">{s.durationMinutes} min</span> : null}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateService(props.service.id, {
        name: form.name,
        description: form.description || undefined,
        priceMinor: Math.round(Number(form.price) * 100),
        durationMinutes: form.duration ? Number(form.duration) : undefined,
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
    try {
      await updateService(props.service.id, { isActive });
      props.onSaved();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteService(props.service.id);
      props.onSaved();
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
    <div className="btn-row">
      <Toggle checked={props.service.isActive} onChange={(v) => toggle(v)} label={props.service.isActive ? 'Active' : 'Inactive'} />
      <Button sm variant="secondary" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button sm variant="danger" onClick={remove} disabled={busy}>
        Delete
      </Button>
    </div>
  );
}

function ServiceForm(props: { businessId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', price: '', duration: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createService(props.businessId, {
        name: form.name,
        priceMinor: Math.round(Number(form.price) * 100),
        durationMinutes: form.duration ? Number(form.duration) : undefined,
        description: form.description || undefined,
      });
      setForm({ name: '', price: '', duration: '', description: '' });
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
  const products = useAsyncData<Product[]>(() => listProducts(props.businessId), [props.businessId]);

  return (
    <section className="card">
      <h2>Products</h2>
      {products.loading ? (
        <Loading />
      ) : products.error ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : !products.data?.length ? (
        <EmptyState icon={<OrdersIcon size={30} />} title="No products yet" body="Add your first product to start building your menu." />
      ) : (
        <ul className="manage-list">
          {products.data.map((p) => (
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

/* ------------------------------- Hours ------------------------------- */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** HH:MM validity mirror of the server rule; empty string means "not set". */
const isValidTime = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/**
 * Client-side mirror of the server's opening-hours validation so obvious
 * mistakes never reach the API. Returns per-day messages keyed by dayOfWeek.
 * The backend stays authoritative — this only improves the UX.
 */
export function validateHours(days: HourInput[]): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const d of days) {
    if (d.isClosed) continue;
    if (!d.opensAt || !d.closesAt || !isValidTime(d.opensAt) || !isValidTime(d.closesAt)) {
      errors[d.dayOfWeek] = 'Set an opening and closing time for open days.';
    } else if (d.opensAt >= d.closesAt) {
      errors[d.dayOfWeek] = 'Closing time must be after opening time.';
    }
  }
  return errors;
}

function OwnerHours(props: { businessId: string }) {
  const hours = useAsyncData<BusinessHour[]>(() => getHours(props.businessId), [props.businessId]);
  const [days, setDays] = useState<HourInput[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (hours.loading && !days) return <Loading />;
  if (hours.error && !days) return <ErrorState message={hours.error} onRetry={hours.reload} />;

  const model: HourInput[] =
    days ??
    (hours.data?.length
      ? hours.data.map((h) => ({
          dayOfWeek: h.dayOfWeek,
          isClosed: h.isClosed,
          opensAt: h.opensAt ?? undefined,
          closesAt: h.closesAt ?? undefined,
        }))
      : Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: '09:00', closesAt: '18:00' })));

  const fieldErrors = validateHours(model);
  const hasErrors = Object.keys(fieldErrors).length > 0;

  const update = (day: number, patch: Partial<HourInput>) => {
    setSaved(false);
    setDays(model.map((d) => (d.dayOfWeek === day ? { ...d, ...patch } : d)));
  };

  const save = async () => {
    if (busy || hasErrors) return;
    setBusy(true);
    setError(null);
    try {
      await putHours(
        props.businessId,
        model.map((d) => (d.isClosed ? { dayOfWeek: d.dayOfWeek, isClosed: true } : d)),
      );
      setSaved(true);
      setDays(null);
      hours.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Opening hours</h2>
      {error ? <ErrorState message={error} /> : null}
      {saved ? <p className="save-ok">Saved ✓</p> : null}
      <ul className="hours-editor">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const d = model.find((x) => x.dayOfWeek === day)!;
          const dayError = fieldErrors[day];
          return (
            <li key={day} className={`hours-row${dayError ? ' hours-row-invalid' : ''}`}>
              <span className="hours-day">{DAY_LABELS[day]}</span>
              <Toggle checked={!d.isClosed} onChange={(v) => update(day, { isClosed: !v, opensAt: v ? d.opensAt ?? '09:00' : undefined, closesAt: v ? d.closesAt ?? '18:00' : undefined })} label="" />
              {d.isClosed ? (
                <span className="hours-closed">Closed</span>
              ) : (
                <span className="hours-times">
                  <input type="time" value={d.opensAt ?? ''} onChange={(e) => update(day, { opensAt: e.target.value })} aria-label={`${DAY_LABELS[day]} opens`} />
                  <input type="time" value={d.closesAt ?? ''} onChange={(e) => update(day, { closesAt: e.target.value })} aria-label={`${DAY_LABELS[day]} closes`} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {hasErrors ? (
        <div className="hours-error-summary" role="alert">
          <AlertIcon size={14} /> Fix the highlighted days before saving.
        </div>
      ) : null}
      <Button full onClick={save} disabled={busy || hasErrors}>
        {busy ? 'Saving…' : 'Save hours'}
      </Button>
    </section>
  );
}

/* ------------------------------ Reviews ------------------------------ */

/** Customer reviews for one of the owner's businesses (read-only). */
export function OwnerReviews(props: { businessId: string }) {
  const reviews = useAsyncData<OwnerReview[]>(() => listMyBusinessReviews(), []);

  if (reviews.loading) return <Loading label="Loading reviews…" />;
  if (reviews.error) return <ErrorState message={reviews.error} onRetry={reviews.reload} />;

  // The endpoint scopes by owner; filter to the business this tab acts on.
  const items = (reviews.data ?? []).filter((rv) => rv.business.id === props.businessId);

  if (items.length === 0)
    return (
      <section className="card" aria-label="Reviews">
        <h2>Reviews</h2>
        <p className="muted">No reviews yet. Customers can review after a completed booking or order.</p>
      </section>
    );

  const avg = items.reduce((sum, rv) => sum + rv.rating, 0) / items.length;

  return (
    <section className="card" aria-label="Reviews">
      <h2>Reviews</h2>
      <div className="rating-summary">
        <span className="rating-average">{(Math.round(avg * 10) / 10).toFixed(1)}</span>
        <Stars value={avg} count={items.length} />
      </div>
      <ul className="review-list">
        {items.map((rv) => (
          <li key={rv.id} className="review-item">
            <div className="review-head">
              <span className="review-author">{rv.reviewerName}</span>
              <span className="review-date">{new Date(rv.createdAt).toLocaleDateString()}</span>
            </div>
            <Stars value={rv.rating} />
            {rv.comment ? <p className="review-comment-text">{rv.comment}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
