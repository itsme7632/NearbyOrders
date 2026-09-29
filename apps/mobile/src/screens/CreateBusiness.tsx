import { useState } from 'react';
import {
  createBusiness,
  listCategories,
  getMyBusinessesWithEntitlement,
  ApiError,
  type Category,
  type BusinessEntitlement,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading } from '../components/ui.js';
import { BusinessLimitNotice } from '../components/BusinessLimitNotice.js';
import { AlertIcon, StoreIcon } from '../components/icons.js';

type FormState = { name: string; ownerName: string; categoryId: string; description: string; phone: string; address: string; city: string };

const initialForm: FormState = { name: '', ownerName: '', categoryId: '', description: '', phone: '', address: '', city: '' };

/** Basic phone sanity: starts with + or a digit, then digits/spaces/dashes. */
const phoneOk = (value: string): boolean => /^[+\d][\d\s-]{5,19}$/.test(value.trim());

/** Client-side mirror of the server rules; the API stays authoritative. */
export function validateBusinessForm(form: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (form.name.trim().length < 2) errors.name = 'Business name must be at least 2 characters.';
  else if (form.name.trim().length > 120) errors.name = 'Business name must be at most 120 characters.';
  // Owner name is optional (existing accounts without one stay valid), but when
  // given it must be a real name — it is shown to the admin as the owner.
  if (form.ownerName.trim() && form.ownerName.trim().length < 2) errors.ownerName = 'Enter your full name.';
  else if (form.ownerName.trim().length > 120) errors.ownerName = 'Owner name must be at most 120 characters.';
  if (!form.categoryId) errors.categoryId = 'Choose the category that fits your business.';
  if (form.description.length > 2000) errors.description = 'Description must be at most 2000 characters.';
  if (form.phone.trim() && !phoneOk(form.phone)) errors.phone = 'Enter a valid phone number, e.g. +92 300 1234567.';
  if (form.address.trim().length < 5) errors.address = 'Enter the street address (at least 5 characters).';
  if (form.city.trim().length < 2) errors.city = 'Enter your city.';
  return errors;
}

/** Self-service business creation form for business owners (Phase 3C.5). */
export function CreateBusinessScreen(props: {
  onBack: () => void;
  onCreated: (id: string, name: string, status?: string) => void;
  onUpgrade: () => void;
}) {
  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  // P3: server-authoritative slot entitlement. When the plan has no remaining
  // slots the form is replaced by the limit notice (with an Upgrade action)
  // instead of letting the user fill a form the server would reject.
  const entitlement = useAsyncData<BusinessEntitlement | null>(
    () => getMyBusinessesWithEntitlement().then((r) => r.entitlement).catch(() => null),
    [],
  );
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  // Set when the server rejects creation with BUSINESS_LIMIT_REACHED even
  // though the UI believed a slot was available (stale entitlement read).
  const [limitHit, setLimitHit] = useState<BusinessEntitlement | null>(null);

  const set = (key: keyof FormState) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const submit = async () => {
    if (saving) return;
    const validation = validateBusinessForm(form);
    if (Object.values(validation).some(Boolean)) {
      setErrors(validation);
      return;
    }
    setSaving(true);
    setApiError(null);
    try {
      const payload = {
        name: form.name.trim(),
        categoryIds: [form.categoryId],
        description: form.description.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim(),
        city: form.city.trim(),
        ownerName: form.ownerName.trim() || undefined,
      };
      const business = await createBusiness(payload);
      // The server-returned status drives post-creation messaging (approved
      // vs pending review); never claim approval the backend did not return.
      props.onCreated(business.id, business.name, business.status);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 0) setApiError(e.message);
        else if (e.code === 'BUSINESS_LIMIT_REACHED') {
          // The server is authoritative: surface the real limit state with
          // usage numbers and an Upgrade action, never a generic failure.
          const d = e.details as { maxBusinesses?: number; used?: number } | undefined;
          if (d && typeof d.maxBusinesses === 'number' && typeof d.used === 'number') {
            setLimitHit({
              usedBusinesses: d.used,
              maxBusinesses: d.maxBusinesses,
              remainingBusinesses: Math.max(0, d.maxBusinesses - d.used),
            });
          } else {
            void entitlement.reload();
            setApiError('You have reached your plan\u2019s business limit. Upgrade your plan to list more businesses.');
          }
        }
        else if (e.status === 400) setApiError('Please check the highlighted fields and try again.');
        else if (e.status === 403) setApiError('Only business accounts can list a business.');
        else setApiError('Could not create the business. Please try again.');
      } else {
        setApiError('Could not create the business. Please try again.');
      }
      setSaving(false);
    }
  };

  if (categories.loading || entitlement.loading) return <Loading label="Loading…" />;
  if (categories.error) return <ErrorState message={categories.error} onRetry={categories.reload} />;
  // If the entitlement read itself failed, fall through to the form — the
  // server remains the authoritative gate and will reject honestly.

  // P3: at the limit (from the entitlement read or the server rejection),
  // show the limit state — never the form, and never an upgrade option when
  // a slot is actually available.
  const atLimit =
    limitHit ?? (entitlement.data && entitlement.data.remainingBusinesses <= 0 ? entitlement.data : null);
  if (atLimit) {
    return (
      <div className="screen">
        <button className="back-link" onClick={props.onBack}>
          ‹ Back
        </button>

        <header className="screen-head">
          <h1>List my business</h1>
          <p className="muted">Your current plan has reached its business limit.</p>
        </header>

        <BusinessLimitNotice entitlement={atLimit} onUpgrade={props.onUpgrade} />
      </div>
    );
  }

  const err = (key: keyof FormState) =>
    errors[key] ? (
      <p className="auth-error" role="alert">
        <AlertIcon size={14} /> {errors[key]}
      </p>
    ) : null;

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>

      <header className="screen-head">
        <h1>List my business</h1>
        <p className="muted">Create your business profile and start accepting bookings.</p>
      </header>

      <div className="card">
        <Field label="Business name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
            placeholder="e.g. DHA Glow Salon"
            maxLength={120}
            autoComplete="organization"
          />
        </Field>
        {err('name')}

        <Field label="Business Owner Name" hint="Optional: your name as the business owner. Shown to the admin team, never inferred from your email.">
          <input
            type="text"
            value={form.ownerName}
            onChange={(e) => set('ownerName')(e.target.value)}
            placeholder="e.g. Muhammad Butt"
            maxLength={120}
            autoComplete="name"
          />
        </Field>
        {err('ownerName')}

        <Field label="Category">
          <select value={form.categoryId} onChange={(e) => set('categoryId')(e.target.value)}>
            <option value="">Choose a category…</option>
            {categories.data
              ?.filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        {err('categoryId')}

        <Field label="Description" hint="Optional: tell customers what makes your business special.">
          <textarea
            value={form.description}
            onChange={(e) => set('description')(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Short description of your business"
          />
        </Field>
        {err('description')}

        <Field label="Phone" hint="Optional: shown to customers so they can reach you.">
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone')(e.target.value)}
            placeholder="+92 300 1234567"
            maxLength={20}
            autoComplete="tel"
          />
        </Field>
        {err('phone')}

        <Field label="Address">
          <input
            type="text"
            value={form.address}
            onChange={(e) => set('address')(e.target.value)}
            placeholder="Street and building"
            maxLength={200}
            autoComplete="street-address"
          />
        </Field>
        {err('address')}

        <Field label="City">
          <input
            type="text"
            value={form.city}
            onChange={(e) => set('city')(e.target.value)}
            placeholder="e.g. Karachi"
            maxLength={80}
            autoComplete="address-level2"
          />
        </Field>
        {err('city')}

        {apiError ? (
          <div className="auth-error" role="alert">
            <AlertIcon size={18} />
            <span>{apiError}</span>
          </div>
        ) : null}

        <div className="onboard-note">
          <StoreIcon size={16} />
          <span>Listings may be reviewed before appearing in customer search; you'll see the status on the next screen.</span>
        </div>

        <Button full onClick={() => void submit()} disabled={saving}>
          {saving ? 'Creating…' : 'Create business'}
        </Button>
      </div>
    </div>
  );
}
