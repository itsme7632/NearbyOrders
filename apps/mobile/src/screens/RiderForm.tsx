import { useState } from 'react';
import { type Rider, type RiderInput } from '../api.js';
import { Button, ErrorState } from '../components/ui.js';

/**
 * Reusable add/edit form for a delivery rider. Name and phone are required;
 * photo URL and internal note are optional; the active toggle controls
 * whether the rider can be assigned to new deliveries.
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
  const [photoUrl, setPhotoUrl] = useState(props.initial?.photoUrl ?? '');
  const [note, setNote] = useState(props.initial?.note ?? '');
  const [isActive, setIsActive] = useState(props.initial?.isActive ?? true);
  const [touched, setTouched] = useState(false);

  const nameError = !name.trim() ? 'Name is required' : null;
  const phoneError = !phone.trim() ? 'Phone is required' : null;
  const invalid = Boolean(nameError || phoneError);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || props.saving) return;
    props.onSubmit({
      name: name.trim(),
      phone: phone.trim(),
      photoUrl: photoUrl.trim() || null,
      note: note.trim() || null,
      isActive,
    });
  };

  const showError = (err: string | null) => (touched && err ? <p className="field-error">{err}</p> : null);

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
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
      <div className="field">
        <label htmlFor="rider-photo">Photo URL (optional)</label>
        <input
          id="rider-photo"
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
        />
      </div>
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
        <Button type="submit" disabled={props.saving}>
          {props.saving ? 'Saving…' : props.initial ? 'Save changes' : 'Add rider'}
        </Button>
        <Button type="button" variant="secondary" onClick={props.onCancel} disabled={props.saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
