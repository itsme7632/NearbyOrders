import { useState } from 'react';
import {
  cancelBusinessSubscription,
  cancelPaymentRequest,
  createProduct,
  createPayInMethod,
  createService,
  deactivatePayInMethod,
  deleteProduct,
  deleteService,
  getBusinessSubscription,
  getDeliverySettings,
  getMyBusinesses,
  listCategories,
  listOwnerPayInMethods,
  listOwnerPayments,
  listPaymentMethods,
  listPaymentRequests,
  putDeliverySettings,
  putHours,
  rejectOwnerPayment,
  startBusinessTrial,
  submitPaymentRequest,
  updateBusiness,
  updateProduct,
  updateService,
  uploadPaymentReceipt,
  verifyOwnerPayment,
  type Business,
  type BusinessHour,
  type BusinessPayInMethod,
  type Category,
  type CustomerPayment,
  type DeliverySettings,
  type HourInput,
  type PaymentMethod,
  type PaymentRequest,
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

type OwnerTab = 'orders' | 'payments' | 'profile' | 'services' | 'products' | 'hours' | 'reviews' | 'subscription';

/**
 * Dashboard navigation, grouped the way an owner thinks about their business.
 * Labels stay short so two tabs fit per row on a 360px phone.
 */
const OWNER_TAB_GROUPS: { group: string; tabs: readonly (readonly [OwnerTab, string])[] }[] = [
  {
    group: 'Business',
    tabs: [
      ['profile', 'Profile'],
      ['hours', 'Hours'],
    ],
  },
  {
    group: 'Catalog',
    tabs: [
      ['services', 'Services'],
      ['products', 'Products'],
    ],
  },
  {
    group: 'Operations',
    tabs: [
      ['orders', 'Orders'],
      ['payments', 'Payments'],
    ],
  },
  {
    group: 'Trust & account',
    tabs: [
      ['reviews', 'Reviews'],
      ['subscription', 'Subscription'],
    ],
  },
];

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
        {OWNER_TAB_GROUPS.map(({ group, tabs }) => (
          <div key={group} className="owner-tab-group">
            <span className="owner-tab-group-label" aria-hidden>
              {group}
            </span>
            <div className="owner-tab-group-row">
              {tabs.map(([key, label]) => (
                <button key={key} className={`owner-tab${tab === key ? ' owner-tab-active' : ''}`} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {tab === 'orders' ? <OwnerOrders businessId={active.id} /> : null}
      {tab === 'payments' ? <OwnerCustomerPayments businessId={active.id} /> : null}
      {tab === 'profile' ? (
        <>
          <OwnerProfile business={active} onSaved={businesses.reload} />
          <DeliverySettingsSection businessId={active.id} />
        </>
      ) : null}
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

/* -------------------- Delivery / COD settings (Phase 7C) -------------------- */

/** Exported for tests: owner toggle for own-rider delivery + COD + fee. */
export function DeliverySettingsSection(props: { businessId: string }) {
  const settings = useAsyncData<DeliverySettings>(() => getDeliverySettings(props.businessId), [props.businessId]);
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean | null>(null);
  const [codEnabled, setCodEnabled] = useState<boolean | null>(null);
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const current = settings.data;
  const model = {
    deliveryEnabled: deliveryEnabled ?? current?.deliveryEnabled ?? false,
    codEnabled: codEnabled ?? current?.codEnabled ?? false,
    fee,
  };

  // Empty fee field means "keep the saved fee" — never silently reset it to 0.
  const feeMinor = fee.trim() === '' ? current?.deliveryFeeMinor ?? 0 : parsePriceToMinor(fee);
  const feeInvalid = model.deliveryEnabled && fee.trim() !== '' && feeMinor === null;

  const save = async () => {
    if (busy || feeInvalid) return;
    setBusy(true);
    setError(null);
    try {
      await putDeliverySettings(props.businessId, {
        deliveryEnabled: model.deliveryEnabled,
        codEnabled: model.deliveryEnabled && model.codEnabled,
        deliveryFeeMinor: model.deliveryEnabled ? feeMinor ?? 0 : 0,
      });
      setSaved(true);
      setFee('');
      setDeliveryEnabled(null);
      setCodEnabled(null);
      settings.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Delivery settings">
      <h2>Delivery &amp; cash on delivery</h2>
      <p className="hint">
        Offer delivery with your own rider. Customers pay the delivery fee to you — NearbyOrders never handles the money.
      </p>
      {settings.loading && !current ? (
        <Loading label="Loading settings…" />
      ) : settings.error && !current ? (
        <ErrorState message={settings.error} onRetry={settings.reload} />
      ) : (
        <>
          {error ? <ErrorState message={error} /> : null}
          {saved ? <p className="save-ok">Saved ✓</p> : null}
          <Toggle
            checked={model.deliveryEnabled}
            onChange={(v) => {
              setSaved(false);
              setDeliveryEnabled(v);
              if (!v) setCodEnabled(false);
            }}
            label="Offer delivery (own rider)"
          />
          {model.deliveryEnabled ? (
            <>
              <Toggle
                checked={model.codEnabled}
                onChange={(v) => {
                  setSaved(false);
                  setCodEnabled(v);
                }}
                label="Cash on delivery"
              />
              <Field label="Delivery fee (PKR)" hint="Added to the order total for delivery orders only.">
                <input
                  value={model.fee}
                  onChange={(e) => {
                    setSaved(false);
                    setFee(e.target.value);
                  }}
                  inputMode="decimal"
                  placeholder={current ? String(current.deliveryFeeMinor / 100) : 'e.g. 200'}
                  aria-invalid={feeInvalid}
                />
              </Field>
              {feeInvalid ? <p className="form-error">Enter a valid fee in rupees, e.g. 200 or 200.50.</p> : null}
            </>
          ) : null}
          <Button full onClick={save} disabled={busy || feeInvalid}>
            {busy ? 'Saving…' : 'Save delivery settings'}
          </Button>
        </>
      )}
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

/** Owner-facing labels for manual payment-request states (Phase 7B). */
const PAYMENT_STATUS_LABEL: Record<PaymentRequest['status'], string> = {
  PENDING: 'Awaiting verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/**
 * Owner-facing subscription view. Phase 7A built Start Trial / Cancel; Phase
 * 7B adds real manual payments: the owner pays via Easypaisa / JazzCash /
 * bank transfer using server-configured pay-in details, uploads a receipt,
 * and an admin verifies the payment before the subscription becomes ACTIVE.
 * There is no self-attestation and no fake "payment successful" flow — the
 * amount is always the server-computed plan price.
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
      {/* Manual payment flow (Phase 7B): pay-in details, receipt submission
          and history. Rendered for every subscription state — an expired or
          cancelled business pays the same way as a fresh one. */}
      <OwnerPayments businessId={props.businessId} />
    </section>
  );
}

/* ----------------------- Manual payments (Phase 7B) ----------------------- */

/**
 * Parsed/validated form state mirror for the payment submission form.
 * Exported for tests; the server stays authoritative.
 */
export function validatePaymentForm(form: { transactionReference: string; hasReceipt: boolean }): string | null {
  const ref = form.transactionReference.trim();
  if (ref.length < 4) return 'Enter the transaction reference (at least 4 characters).';
  if (ref.length > 100) return 'Transaction reference must be at most 100 characters.';
  if (!form.hasReceipt) return 'Attach a photo of your payment receipt.';
  return null;
}

/**
 * The pay + verify experience for one owned business: server-configured
 * pay-in channels, a real receipt-pick (persisted through the image-storage
 * provider once connected, honestly blocked before that), submission for
 * admin verification, and the business's payment history with cancellation
 * of its own pending request. No client-sent amounts, no fake activations.
 */
export function OwnerPayments(props: { businessId: string }) {
  const methods = useAsyncData<PaymentMethod[]>(() => listPaymentMethods(), []);
  const history = useAsyncData<PaymentRequest[]>(() => listPaymentRequests(props.businessId).then((p) => p.items), [props.businessId]);
  const [formOpen, setFormOpen] = useState(false);
  const [methodId, setMethodId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const methodList = methods.data ?? [];
  const pendingRequest = (history.data ?? []).find((p) => p.status === 'PENDING');
  const selectedMethod = methodList.find((m) => m.id === methodId) ?? methodList[0] ?? null;

  const resetForm = () => {
    setFormOpen(false);
    setReference('');
    setPendingReceipt(null);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!selectedMethod) {
      setError('Choose a payment method.');
      return;
    }
    const validation = validatePaymentForm({ transactionReference: reference, hasReceipt: Boolean(pendingReceipt) });
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // REAL upload: the picked receipt goes to the API's multipart endpoint,
      // which stores the bytes server-side and returns an opaque storage key
      // (never a user-typed URL and never a public link).
      const storageKey = await uploadPaymentReceipt(pendingReceipt!.file);
      await submitPaymentRequest(props.businessId, {
        paymentMethodId: selectedMethod.id,
        transactionReference: reference.trim(),
        receiptStorageKey: storageKey,
      });
      setNotice('Payment submitted. NearbyOrders will verify it shortly — your subscription activates after approval.');
      resetForm();
      history.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the payment');
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (requestId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancelPaymentRequest(props.businessId, requestId);
      setConfirmCancelId(null);
      setNotice('Payment request cancelled. You can submit a corrected one now.');
      history.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel the payment request');
    } finally {
      setBusy(false);
    }
  };

  if (methods.loading) return <Loading label="Loading payment methods…" />;
  if (methods.error) return <ErrorState message={methods.error} onRetry={methods.reload} />;

  if (methodList.length === 0) {
    return (
      <div className="pay-section">
        <h3>Pay by hand — verified by NearbyOrders</h3>
        <p className="muted">No payment methods are available right now. Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="pay-section">
      <h3>Pay by hand — verified by NearbyOrders</h3>
      {notice ? (
        <p className="save-ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      {pendingRequest ? (
        <div className="pay-pending" role="status">
          <strong>Awaiting verification.</strong> Reference {pendingRequest.transactionReference} — we'll
          activate your subscription as soon as it's approved.
        </div>
      ) : !formOpen ? (
        <Button full variant="secondary" onClick={() => setFormOpen(true)} disabled={busy}>
          I've paid — submit proof
        </Button>
      ) : null}

      {formOpen && !pendingRequest ? (
        <div className="edit-block">
          <Field label="Payment method">
            {methodList.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chip${selectedMethod?.id === m.id ? ' chip-active' : ''}`}
                onClick={() => setMethodId(m.id)}
              >
                {m.name}
              </button>
            ))}
          </Field>
          {selectedMethod ? (
            <div className="pay-details">
              <div className="pay-detail-row">
                <span className="pay-detail-label">Account title</span>
                <span className="pay-detail-value">{selectedMethod.accountTitle}</span>
              </div>
              <div className="pay-detail-row">
                <span className="pay-detail-label">{selectedMethod.type === 'BANK_TRANSFER' ? 'IBAN / account' : 'Number'}</span>
                <span className="pay-detail-value pay-detail-mono">{selectedMethod.type === 'BANK_TRANSFER' && selectedMethod.iban ? selectedMethod.iban : selectedMethod.accountNumber}</span>
              </div>
              {selectedMethod.instructions ? <p className="hint">{selectedMethod.instructions}</p> : null}
            </div>
          ) : null}
          <Field label="Transaction reference" hint="From your payment app or bank slip — we match it against your receipt.">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TX-123456789"
              maxLength={100}
            />
          </Field>
          <Field label="Payment receipt">
            <ImageUploader
              currentUrl={null}
              label="Payment receipt"
              onChange={(state) => setPendingReceipt(state.pending)}
            />
          </Field>
          <div className="btn-row">
            <Button sm onClick={submit} disabled={busy || !reference || !pendingReceipt}>
              {busy ? 'Submitting…' : 'Submit for verification'}
            </Button>
            <Button sm variant="ghost" onClick={resetForm} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {history.error ? <ErrorState message={history.error} onRetry={history.reload} /> : null}
      {history.data?.length ? (
        <div className="pay-history">
          <h4>Payment history</h4>
          <ul className="manage-list">
            {history.data.map((p) => (
              <li key={p.id} className="manage-item">
                <div className="item-row">
                  <span className="item-name">{p.paymentMethod.name}</span>
                  <Money minor={p.amountMinor} currency={p.currency} />
                </div>
                <p className="item-desc pay-ref">Ref {p.transactionReference}</p>
                <p className={`badge ${p.status === 'APPROVED' ? 'badge-open' : p.status === 'PENDING' ? 'badge-neutral' : 'badge-closed'}`}>
                  {PAYMENT_STATUS_LABEL[p.status]}
                </p>
                {p.status === 'REJECTED' && p.rejectionReason ? <p className="item-desc">Reason: {p.rejectionReason}</p> : null}
                {p.status === 'PENDING' ? (
                  confirmCancelId === p.id ? (
                    <div className="btn-row" role="alert">
                      <Button sm variant="danger" disabled={busy} onClick={() => void cancelRequest(p.id)}>
                        {busy ? 'Cancelling…' : 'Yes, cancel it'}
                      </Button>
                      <Button sm variant="ghost" disabled={busy} onClick={() => setConfirmCancelId(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <div className="btn-row">
                      <Button sm variant="ghost" disabled={busy} onClick={() => setConfirmCancelId(p.id)}>
                        Cancel request
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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

/* ------------------- Phase 7C: owner payment verification ---------- */

const CUSTOMER_PAYMENT_LABEL: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'Waiting for verification',
  PAID: 'Paid',
  FAILED: 'Rejected',
  UNPAID: 'Unpaid',
};

/** Queue row shared by booking and order payments. */
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
    <li className="manage-item pay-owner-row">
      <div className="pay-owner-head">
        <strong>
          <Money minor={payment.amountMinor} currency={payment.currency} />
        </strong>
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
    <div className="owner-section">
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
                <h3 className="pay-section-title">Booking payments</h3>
                <ul className="manage-list">
                  {bookingPayments.map((p) => (
                    <OwnerPaymentRow key={p.id} payment={p} kind="booking" onChanged={reload} />
                  ))}
                </ul>
              </>
            ) : null}
            {orderPayments.length > 0 ? (
              <>
                <h3 className="pay-section-title">Order payments</h3>
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
          These channels are shown to customers at checkout. NearbyOrders never handles the money — customers pay you
          directly.
        </p>
        {methods.loading ? (
          <Loading label="Loading methods…" />
        ) : methods.error ? (
          <ErrorState message={methods.error} onRetry={methods.reload} />
        ) : (
          <ul className="manage-list">
            {(methods.data ?? []).map((m) => (
              <li key={m.id} className="manage-item">
                <div className="pay-owner-head">
                  <strong>{m.displayName}</strong>
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
                    onClick={() =>
                      void deactivatePayInMethod(props.businessId, m.id)
                        .then(reload)
                        .catch(() => undefined)
                    }
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
