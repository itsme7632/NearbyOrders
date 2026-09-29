import { useEffect, useState } from 'react';
import {
  createApiImageStorageProvider,
  resolveImageUrl,
  updateBusiness,
  listCategories,
  type Business,
  type Category,
} from '../api.js';
import { getImageStorageProvider, setImageStorageProvider } from '../upload.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading } from '../components/ui.js';
import { ImageUploader, type ImageUploaderState, type PendingImage } from '../components/ImageUploader.js';

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
  // Image handling follows the product-wide upload rule: no URL field. The
  // real API storage provider is registered for this business, so a pending
  // device pick is uploaded in the save flow below (upload first — a failed
  // upload aborts the save and never corrupts the stored image). Removing the
  // saved image persists imageUrl: null. Omitting the key keeps the saved value.
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [removeSavedImage, setRemoveSavedImage] = useState(false);
  const [storageReady, setStorageReady] = useState(() => getImageStorageProvider() !== null);
  useEffect(() => {
    setImageStorageProvider(createApiImageStorageProvider(b.id));
    setStorageReady(true);
    // Reset image state when switching businesses: a pending pick or removal
    // from Business A must never leak into Business B's save flow. The
    // ImageUploader remounts via key, but this parent state persists.
    setPendingImage(null);
    setRemoveSavedImage(false);
    setSaved(false);
    setError(null);
  }, [b.id]);
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set(b.categories.map((c) => c.id)));
  const [saving, setSaving] = useState(false);
  // Bumps on every successful save so the uploader remounts immediately with
  // clean internal state (its pending preview must not linger as "not saved
  // yet" after the save that persisted it).
  const [saveCount, setSaveCount] = useState(0);
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
      // Upload a pending pick BEFORE the profile PATCH: a failed upload aborts
      // the save so the previously stored image is never corrupted.
      let uploadedUrl: string | undefined;
      if (pendingImage) {
        const provider = getImageStorageProvider();
        if (!provider) {
          setError('Image storage is not connected yet. Remove the photo to save your other changes.');
          setSaving(false);
          return;
        }
        try {
          uploadedUrl = (await provider.upload(pendingImage)).url;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Image upload failed. Your existing photo was kept.');
          setSaving(false);
          return;
        }
      }
      await updateBusiness(b.id, {
        name: trimmed.name,
        // Cleared optional fields go as null so the server nulls the column.
        description: trimmed.description || null,
        phone: trimmed.phone || null,
        email: trimmed.email || null,
        address: trimmed.address,
        city: trimmed.city,
        locality: trimmed.locality || null,
        // Image: a fresh upload wins; an explicit removal clears the field;
        // otherwise the key is omitted so the saved value stays.
        ...(uploadedUrl ? { imageUrl: uploadedUrl } : {}),
        ...(removeSavedImage ? { imageUrl: null } : {}),
        categoryIds: [...categoryIds],
      });
      setPendingImage(null);
      setRemoveSavedImage(false);
      setSaveCount((c) => c + 1);
      setSaved(true);
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" aria-label="Business profile">
      <div className="section-head">
        <h2>Business profile</h2>
      </div>
      <p className="ov-section-sub">
        This is what customers see on your business page. Keep it accurate so bookings and orders run smoothly.
      </p>
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
          key={`${b.id}:${saveCount}`}
          currentUrl={resolveImageUrl(removeSavedImage ? null : b.imageUrl)}
          label="Business logo"
          onChange={onImageStateChange}
        />
      </Field>

      <Field label="Categories">
        {categories.loading ? (
          <Loading label="Loading categories…" />
        ) : categories.error ? (
          <ErrorState message={categories.error} onRetry={categories.reload} />
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

      {pendingImage && !storageReady ? (
        <p className="hint" role="note">
          Save is unavailable while a new photo is selected: image storage is not connected yet, so the photo cannot be persisted. Remove it to save your other changes.
        </p>
      ) : null}
      <Button full disabled={saving || !form.name || categoryIds.size === 0 || (Boolean(pendingImage) && !storageReady)} onClick={save}>
        {saving ? 'Saving…' : 'Save profile'}
      </Button>
    </section>
  );
}

/* -------------------- Delivery / COD settings (Phase 7C) -------------------- */

/** Exported for tests: owner toggle for own-rider delivery + COD + fee. */
