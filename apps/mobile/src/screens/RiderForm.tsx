import { useState } from 'react';
import { resolveImageUrl, type Rider, type RiderInput } from '../api.js';
import { getImageStorageProvider } from '../upload.js';
import { ImageUploader, type ImageUploaderState, type PendingImage } from '../components/ImageUploader.js';
import { Button, ErrorState, Field } from '../components/ui.js';

/**
 * Reusable add/edit form for a delivery rider. Name and phone are required;
 * the photo and internal note are optional; the active toggle controls
 * whether the rider can be assigned to new deliveries.
 *
 * The photo follows the product-wide upload rule: a real file pick through
 * ImageUploader, never a URL field. The business's image-storage provider
 * (registered by the owning screen) uploads a pending pick before the rider
 * is saved; a failed upload aborts the save. Omitting the photo key preserves
 * the existing photo on edit; explicit removal clears it.
 */
export function RiderForm(props: {
  initial?: Rider | null;
  saving: boolean;
  error: string | null;
  onSubmit: (input: RiderInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [phone, setPhone] = useState(props.initial?.phone ?? '');
  const [note, setNote] = useState(props.initial?.note ?? '');
  const [isActive, setIsActive] = useState(props.initial?.isActive ?? true);
  const [touched, setTouched] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [removeSavedImage, setRemoveSavedImage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const nameError = !name.trim() ? 'Name is required' : null;
  const phoneError = !phone.trim() ? 'Phone is required' : null;
  const invalid = Boolean(nameError || phoneError);

  const onImageStateChange = (state: ImageUploaderState) => {
    setPendingImage(state.pending);
    setRemoveSavedImage(state.removeSaved);
    setUploadError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || props.saving || uploading) return;
    // Upload a pending pick BEFORE the rider save: a failed upload aborts the
    // save so a previously stored photo is never corrupted.
    let photoUrl: string | null | undefined;
    if (pendingImage) {
      const provider = getImageStorageProvider();
      if (!provider) {
        setUploadError('Image storage is not connected yet. Remove the photo to save the rider without one.');
        return;
      }
      setUploading(true);
      try {
        photoUrl = (await provider.upload(pendingImage)).url;
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Photo upload failed. The existing photo was kept.');
        setUploading(false);
        return;
      }
      setUploading(false);
    } else if (removeSavedImage) {
      // Explicit removal clears the stored photo.
      photoUrl = null;
    } else {
      // Omitted: the server preserves the existing photo on edit and stores
      // none on create. Never echo a stale URL back.
      photoUrl = undefined;
    }
    props.onSubmit({
      name: name.trim(),
      phone: phone.trim(),
      photoUrl,
      note: note.trim() || null,
      isActive,
    });
  };

  const showError = (err: string | null) => (touched && err ? <p className="field-error">{err}</p> : null);

  return (
    <form className="form-grid" onSubmit={(e) => void submit(e)} noValidate>
      {props.error ? <ErrorState message={props.error} /> : null}
      <div className="field">
        <label htmlFor="rider-name">Name</label>
        <input
          id="rider-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rider's full name"
          autoComplete="name"
          className={touched && nameError ? 'input-invalid' : undefined}
        />
        {showError(nameError)}
      </div>
      <div className="field">
        <label htmlFor="rider-phone">Phone</label>
        <input
          id="rider-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="03xx xxxxxxx"
          inputMode="tel"
          autoComplete="tel"
          className={touched && phoneError ? 'input-invalid' : undefined}
        />
        {showError(phoneError)}
        <p className="hint">Only shown to the customer of their own delivery order.</p>
      </div>
      <Field label="Photo" hint="Optional - shown to customers with their delivery details.">
        <ImageUploader
          key={props.initial?.id ?? 'new'}
          currentUrl={resolveImageUrl(removeSavedImage ? null : (props.initial?.photoUrl ?? null))}
          label="Rider photo"
          onChange={onImageStateChange}
        />
      </Field>
      {uploadError ? <ErrorState message={uploadError} /> : null}
      <div className="field">
        <label htmlFor="rider-note">Internal note (optional)</label>
        <textarea
          id="rider-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Only visible to you, e.g. shift timings"
          rows={2}
        />
      </div>
      <div className="field">
        <label className="toggle-row">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Active - can be assigned to deliveries</span>
        </label>
        {!isActive ? <p className="hint">Inactive riders never appear in the assign-rider list.</p> : null}
      </div>
      <div className="btn-row">
        <Button type="submit" disabled={props.saving || uploading}>
          {uploading ? 'Uploading photo…' : props.saving ? 'Saving…' : props.initial ? 'Save changes' : 'Add rider'}
        </Button>
        <Button type="button" variant="secondary" onClick={props.onCancel} disabled={props.saving || uploading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
