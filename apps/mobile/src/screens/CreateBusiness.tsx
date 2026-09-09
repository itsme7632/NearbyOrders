import { useState } from 'react';
import { createBusiness, listCategories, ApiError, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading } from '../components/ui.js';
import { AlertIcon, StoreIcon } from '../components/icons.js';

type FormState = { name: string; categoryId: string; description: string; phone: string; address: string; city: string };

const initialForm: FormState = { name: '', categoryId: '', description: '', phone: '', address: '', city: '' };

/** Basic phone sanity: starts with + or a digit, then digits/spaces/dashes. */
const phoneOk = (value: string): boolean => /^[+\d][\d\s-]{5,19}$/.test(value.trim());

/** Client-side mirror of the server rules; the API stays authoritative. */
export function validateBusinessForm(form: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (form.name.trim().length < 2) errors.name = 'Business name must be at least 2 characters.';
  else if (form.name.trim().length > 120) errors.name = 'Business name must be at most 120 characters.';
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
}) {
  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

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
      };
      const business = await createBusiness(payload);
      // The server-returned status drives post-creation messaging (approved
      // vs pending review); never claim approval the backend did not return.
      props.onCreated(business.id, business.name, business.status);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 0) setApiError(e.message);
        else if (e.status === 400) setApiError('Please check the highlighted fields and try again.');
        else if (e.status === 403) setApiError('Only business accounts can list a business.');
        else setApiError('Could not create the business. Please try again.');
      } else {
        setApiError('Could not create the business. Please try again.');
      }
      setSaving(false);
    }
  };

  if (categories.loading) return <Loading label="Loading categories…" />;
  if (categories.error) return <ErrorState message={categories.error} onRetry={categories.reload} />;

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

        <Field label="Description" hint="Optional — tell customers what makes your business special.">
          <textarea
            value={form.description}
            onChange={(e) => set('description')(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Short description of your business"
          />
        </Field>
        {err('description')}

        <Field label="Phone" hint="Optional — shown to customers so they can reach you.">
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
