import { useEffect, useState } from 'react';
import {
  getVerification,
  updateVerificationDraft,
  submitVerification,
  uploadVerificationDocument,
  listCategories,
  type Category,
  type VerificationApplication,
  type VerificationDocument,
  type VerificationStatus,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading } from '../components/ui.js';
import { ImageUploader, type PendingImage } from '../components/ImageUploader.js';
import { CheckIcon } from '../components/icons.js';

const STATUS_LABEL: Record<VerificationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CHANGES_REQUESTED: 'Changes requested',
};

/**
 * Verification documents carry the server's raw status enum
 * (PENDING / APPROVED / REJECTED) — users see plain-English labels.
 */
const DOC_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const DOC_TYPES = [
  { value: 'IDENTITY', label: 'Identity proof', hint: 'CNIC, passport, or driving licence of the business owner.' },
  { value: 'BUSINESS_PROOF', label: 'Business proof', hint: 'Registration certificate, trade licence, or utility bill in the business name.' },
] as const;

function validateDraft(form: {
  legalName: string;
  ownerName: string;
  phone: string;
  address: string;
  city: string;
  categoryId: string;
  documentCount: number;
}): string | null {
  if (form.legalName.trim().length < 2) return 'Enter the legal (registered) name of the business.';
  if (form.ownerName.trim().length < 2) return 'Enter the owner full name.';
  if (!/^[+\d][\d\s-]{5,19}$/.test(form.phone.trim())) return 'Enter a valid phone number, e.g. +92 300 1234567.';
  if (form.address.trim().length < 5) return 'Enter the street address (at least 5 characters).';
  if (form.city.trim().length < 2) return 'Enter your city.';
  if (!form.categoryId) return 'Choose the business category.';
  if (form.documentCount < 1) return 'Upload at least one document (identity or business proof).';
  return null;
}

/**
 * Business verification: why it is required, what the review team needs,
 * and what happens after submission. Draft fields save to the server;
 * Submit asks the NearbyOrders team to review. Documents upload through the
 * receipt-style multipart endpoint (file + docType). The verified badge on
 * the business profile only ever reflects the server's isVerified flag.
 */
export function OwnerVerification(props: { businessId: string }) {
  const state = useAsyncData(() => getVerification(props.businessId), [props.businessId]);
  const categories = useAsyncData<Category[]>(() => listCategories(), []);

  const [form, setForm] = useState({
    legalName: '',
    publicName: '',
    ownerName: '',
    phone: '',
    address: '',
    city: '',
    categoryId: '',
    description: '',
    registrationInfo: '',
  });
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [docType, setDocType] = useState<string>('IDENTITY');
  const [pendingDoc, setPendingDoc] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const application: VerificationApplication | null = state.data?.application ?? null;
  const status: VerificationStatus | null = application?.status ?? null;
  const locked = status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'APPROVED';
  const editable = !locked;

  // Hydrate the form once from the server draft (never overwrite typing).
  // All hooks stay above the early returns so the hook order is stable.
  useEffect(() => {
    if (editable && hydratedFor !== props.businessId && application) {
      setHydratedFor(props.businessId);
      setForm({
        legalName: application.legalName ?? '',
        publicName: application.publicName ?? '',
        ownerName: application.ownerName ?? '',
        phone: application.phone ?? '',
        address: application.address ?? '',
        city: application.city ?? '',
        categoryId: application.categoryId ?? '',
        description: application.description ?? '',
        registrationInfo: application.registrationInfo ?? '',
      });
    }
  }, [editable, hydratedFor, props.businessId, application]);

  if (state.loading || categories.loading) return <Loading label="Loading verification…" />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (categories.error) return <ErrorState message={categories.error} onRetry={categories.reload} />;

  const documents: VerificationDocument[] = state.data?.documents ?? [];

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const saveDraft = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await updateVerificationDraft(props.businessId, {
        legalName: form.legalName.trim() || null,
        publicName: form.publicName.trim() || null,
        ownerName: form.ownerName.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        categoryId: form.categoryId || null,
        description: form.description.trim() || null,
        registrationInfo: form.registrationInfo.trim() || null,
      });
      state.reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the draft');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const uploadDoc = async () => {
    if (busy || !pendingDoc) return;
    setBusy(true);
    setError(null);
    try {
      await uploadVerificationDocument(props.businessId, pendingDoc.file, docType);
      setPendingDoc(null);
      setNotice('Document uploaded. It will be reviewed with your application.');
      state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the document');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    const validation = validateDraft({
      legalName: form.legalName,
      ownerName: form.ownerName,
      phone: form.phone,
      address: form.address,
      city: form.city,
      categoryId: form.categoryId,
      documentCount: documents.length,
    });
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveDraft();
      if (!saved) {
        setBusy(false);
        return;
      }
      await submitVerification(props.businessId);
      setNotice('Submitted. The NearbyOrders team will review your application and contact you with the decision.');
      state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the application');
    } finally {
      setBusy(false);
    }
  };

  const statusBadgeClass =
    status === 'APPROVED'
      ? 'badge-open'
      : status === 'REJECTED'
        ? 'badge-closed'
        : status === 'CHANGES_REQUESTED'
          ? 'badge-warn'
          : 'badge-neutral';

  return (
    <div className="owner-screen owner-verification">
      {error ? <ErrorState message={error} /> : null}
      {notice ? (
        <p className="save-ok" role="status">
          {notice}
        </p>
      ) : null}

      {/* Status header. */}
      <section className="card" aria-label="Verification status">
        <p className="sub-state-line" role="status" style={{ marginTop: 0 }}>
          <span className={`badge ${statusBadgeClass}`}>{status ? STATUS_LABEL[status] : 'Not started'}</span>
          {status === 'APPROVED' ? (
            <span className="badge badge-verified">✓ Verified</span>
          ) : null}
        </p>
        {application?.reviewerMessage ? (
          <p className="hint" role="note" style={{ marginTop: 8 }}>
            <strong>Reviewer note:</strong> {application.reviewerMessage}
          </p>
        ) : null}
        {status === 'REJECTED' ? (
          <p className="hint">Your application was not approved. Fix the details below and submit again.</p>
        ) : null}
        {status === 'CHANGES_REQUESTED' ? (
          <p className="hint">The review team asked for changes. Update the details below and submit again.</p>
        ) : null}
        {locked && status !== 'APPROVED' ? (
          <p className="hint">Your application is with the review team. You will be contacted with the decision.</p>
        ) : null}
      </section>

      {/* Why / what / what-next explainer. */}
      <section className="card" aria-label="About verification">
        <h3 className="owner-section-title" style={{ margin: '0 0 6px' }}>Why verification is required</h3>
        <p className="muted" style={{ margin: '0 0 8px' }}>
          Verified businesses earn a badge on their profile and rank higher in customer trust. It confirms your
          business is real and legally yours, which protects customers and keeps the marketplace honest.
        </p>
        <h3 className="owner-section-title" style={{ margin: '10px 0 6px' }}>What you need</h3>
        <p className="muted" style={{ margin: '0 0 8px' }}>
          Your legal business details (as registered), the owner name and phone, and at least one document:
          an identity proof and a business proof. Your business map location (set on the Location screen) is
          attached automatically.
        </p>
        <h3 className="owner-section-title" style={{ margin: '10px 0 6px' }}>What happens after you submit</h3>
        <p className="muted" style={{ margin: 0 }}>
          The NearbyOrders team reviews your details and documents, usually within a few working days. You will
          be contacted with the decision. Approved businesses show the verified badge immediately.
        </p>
      </section>

      {editable ? (
        <>
          {/* Draft form. */}
          <section className="card" aria-label="Verification details">
            <h3 className="owner-section-title" style={{ margin: '0 0 8px' }}>Business details</h3>
            <Field label="Legal (registered) name">
              <input value={form.legalName} onChange={set('legalName')} maxLength={120} />
            </Field>
            <Field label="Public name (optional)">
              <input value={form.publicName} onChange={set('publicName')} maxLength={120} />
            </Field>
            <div className="form-grid">
              <Field label="Owner full name">
                <input value={form.ownerName} onChange={set('ownerName')} maxLength={120} />
              </Field>
              <Field label="Phone">
                <input value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={20} />
              </Field>
              <Field label="City">
                <input value={form.city} onChange={set('city')} maxLength={100} />
              </Field>
            </div>
            <Field label="Street address">
              <input value={form.address} onChange={set('address')} maxLength={255} />
            </Field>
            <Field label="Category">
              <div className="chip-row">
                {(categories.data ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip${form.categoryId === c.id ? ' chip-active' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, categoryId: c.id }))}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Business description (optional)">
              <textarea value={form.description} onChange={set('description')} rows={3} maxLength={2000} />
            </Field>
            <Field label="Registration info (optional)" hint="Registration number, licence number, or tax ID, if any.">
              <input value={form.registrationInfo} onChange={set('registrationInfo')} maxLength={255} />
            </Field>
            <p className="hint" role="note">
              Location: your business map location is attached automatically. Update it on the Location screen
              if the pin is wrong.
            </p>
            <div className="btn-row">
              <Button sm variant="secondary" disabled={saving || busy} onClick={() => void saveDraft()}>
                {saving ? 'Saving…' : 'Save draft'}
              </Button>
            </div>
          </section>

          {/* Documents. */}
          <section className="card" aria-label="Verification documents">
            <h3 className="owner-section-title" style={{ margin: '0 0 8px' }}>Documents</h3>
            <p className="hint" style={{ margin: '0 0 8px' }}>
              Documents upload to the NearbyOrders server and stay attached to this application.
              Upload them before you submit.
            </p>
            {documents.length > 0 ? (
              <ul className="manage-list">
                {documents.map((d) => (
                  <li key={d.id} className="manage-item">
                    <div className="item-row">
                      <span className="item-name">
                        {DOC_TYPES.find((t) => t.value === d.docType)?.label ?? d.docType}
                      </span>
                      <span className="badge badge-neutral">{DOC_STATUS_LABEL[d.status] ?? d.status}</span>
                    </div>
                    <p className="item-desc">Uploaded {new Date(d.uploadedAt).toLocaleDateString()}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No documents uploaded yet.</p>
            )}
            <Field label="Document type">
              <div className="chip-row">
                {DOC_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`chip${docType === t.value ? ' chip-active' : ''}`}
                    onClick={() => setDocType(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="hint">{DOC_TYPES.find((t) => t.value === docType)?.hint}</span>
            </Field>
            <Field label="Document photo">
              <ImageUploader
                currentUrl={null}
                label="Document photo"
                hideStorageNotice
                onChange={(state) => setPendingDoc(state.pending)}
              />
            </Field>
            <div className="btn-row">
              <Button sm disabled={busy || !pendingDoc} onClick={() => void uploadDoc()}>
                {busy ? 'Uploading…' : 'Upload document'}
              </Button>
            </div>
          </section>

          <div className="btn-row">
            <Button full disabled={busy || saving} onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Submit for verification'}
            </Button>
          </div>
        </>
      ) : null}

      {status === 'APPROVED' ? (
        <p className="save-ok" role="status">
          <CheckIcon size={15} /> Your business is verified. The badge shows on your business profile.
        </p>
      ) : null}
    </div>
  );
}
