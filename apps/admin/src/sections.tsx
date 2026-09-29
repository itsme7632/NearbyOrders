import React, { useEffect, useState } from 'react';
import * as api from './api.js';
import type {
  AdminBusiness,
  AdminPaymentMethod,
  AdminPaymentRequest,
  AdminPromotion,
  AdminPromotionRequest,
  AdminSubscriptionPlan,
  PaymentMethodInput,
  PromotionInput,
  SubscriptionPlanInput,
  VerificationApplication,
  VerificationDocument,
} from './api.js';

/* Shared presentation helpers (same values as main.tsx; kept local so this
   module stays importable without a render-cycle dependency). */

export const fmtMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

export function StatusBadge(props: { value: string }) {
  const v = props.value;
  const cls =
    v === 'APPROVED' || v === 'ACTIVE' || v === 'COMPLETED' || v === 'PAID' || v === 'APPROVED_PAY'
      ? 'badge-open'
      : v === 'PENDING' || v === 'PENDING_VERIFICATION' || v === 'TRIAL' || v === 'SUBMITTED' || v === 'UNDER_REVIEW'
        ? 'badge-warn'
        : v === 'SUSPENDED' || v === 'REJECTED' || v === 'CANCELLED' || v === 'FAILED' || v === 'EXPIRED'
          ? 'badge-closed'
          : 'badge-info';
  return <span className={`badge ${cls}`}>{v.replace(/_/g, ' ')}</span>;
}

/* --------------------------------- modal -------------------------------- */

export function Modal(props: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={props.title} onClick={props.onClose}>
      <div className="modal-card" style={props.wide ? { maxWidth: 'min(880px, 96vw)' } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={props.onClose}>
            Close
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

/* ----------------------- authorized document viewer --------------------- */

export function useBlobViewer(fetchFile: (storageKey: string) => Promise<string> = api.fetchVerificationDocumentUrl) {
  const [state, setState] = useState<{ url: string; error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const open = async (storageKey: string) => {
    setLoading(true);
    setState(null);
    try {
      const url = await fetchFile(storageKey);
      setState({ url, error: null });
    } catch (e) {
      setState({ url: '', error: e instanceof Error ? e.message : 'Could not load the file.' });
    } finally {
      setLoading(false);
    }
  };
  const close = () => {
    if (state?.url) URL.revokeObjectURL(state.url);
    setState(null);
  };
  return { state, loading, open, close };
}

export function BlobViewerModal(props: { title: string; state: { url: string; error: string | null } | null; onClose: () => void }) {
  if (!props.state) return null;
  return (
    <Modal title={props.title} onClose={props.onClose}>
      {props.state.error ? <div className="form-error">{props.state.error}</div> : null}
      {props.state.url ? <img className="receipt-img" src={props.state.url} alt={props.title} /> : null}
    </Modal>
  );
}

/* --------------------------- verification review ------------------------ */

const VERIFICATION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'];

function verificationDecisionLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

/** Humanizes a document type label (e.g. CNIC_FRONT -> CNIC FRONT). */
function docTypeLabel(docType: string): string {
  return docType.replace(/_/g, ' ').trim() || 'Document';
}

function VerificationDetailModal(props: { applicationId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<VerificationApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewerMessage, setReviewerMessage] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const blob = useBlobViewer();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getVerification(props.applicationId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the application.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.applicationId]);

  const decide = async (kind: 'approve' | 'reject' | 'changes') => {
    const msg = reviewerMessage.trim();
    if (kind !== 'approve' && msg.length < 4) {
      setActionError('A reviewer message is required so the business owner knows what to fix.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const body = { reviewerMessage: msg || undefined, adminNotes: adminNotes.trim() || undefined };
      if (kind === 'approve') await api.approveVerification(props.applicationId, body);
      else if (kind === 'reject') await api.rejectVerification(props.applicationId, { ...body, reviewerMessage: msg });
      else await api.requestVerificationChanges(props.applicationId, { ...body, reviewerMessage: msg });
      props.onChanged();
      props.onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  };

  const app = detail;

  return (
    <>
      <Modal title="Verification application" onClose={props.onClose} wide>
        {loading ? (
          <div className="loading">Loading application…</div>
        ) : error || !app ? (
          <div className="form-error">{error ?? 'Application not found.'}</div>
        ) : (
          <>
            <div className="panel" style={{ marginBottom: 12 }}>
              <h2>Submitted information</h2>
              <table className="admin-table">
                <tbody>
                  <tr>
                    <th style={{ width: 200 }}>Business</th>
                    <td>
                      <strong>{app.publicName ?? app.business.name}</strong>
                      <div className="muted mono">
                        {app.business.slug}
                        {app.city ? ` · ${app.city}` : null}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <th>Owner</th>
                    <td>
                      <span className="mono">{app.business.owner.email}</span>
                      {app.ownerName ? <div className="muted">{app.ownerName}</div> : null}
                    </td>
                  </tr>
                  <tr>
                    <th>Status</th>
                    <td>
                      <StatusBadge value={app.status} />
                    </td>
                  </tr>
                  <tr>
                    <th>Submitted</th>
                    <td>{app.submittedAt ? fmtDate(app.submittedAt) : <span className="muted">Not submitted yet</span>}</td>
                  </tr>
                  {app.legalName ? (
                    <tr>
                      <th>Legal name</th>
                      <td>{app.legalName}</td>
                    </tr>
                  ) : null}
                  {app.phone ? (
                    <tr>
                      <th>Phone</th>
                      <td className="mono">{app.phone}</td>
                    </tr>
                  ) : null}
                  {app.address ? (
                    <tr>
                      <th>Address</th>
                      <td>{app.address}</td>
                    </tr>
                  ) : null}
                  {app.description ? (
                    <tr>
                      <th>Description</th>
                      <td>{app.description}</td>
                    </tr>
                  ) : null}
                  {app.registrationInfo ? (
                    <tr>
                      <th>Registration info</th>
                      <td>{app.registrationInfo}</td>
                    </tr>
                  ) : null}
                  {app.reviewerMessage ? (
                    <tr>
                      <th>Last reviewer message</th>
                      <td>{app.reviewerMessage}</td>
                    </tr>
                  ) : null}
                  {app.adminNotes ? (
                    <tr>
                      <th>Internal notes</th>
                      <td>{app.adminNotes}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="panel" style={{ marginBottom: 12 }}>
              <h2>Documents ({app.documents.length})</h2>
              {app.documents.length === 0 ? (
                <div className="empty">No documents were attached to this application.</div>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Status</th>
                      <th>Uploaded</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {app.documents.map((d: VerificationDocument) => (
                      <tr key={d.id}>
                        <td>
                          <strong>{docTypeLabel(d.docType)}</strong>
                        </td>
                        <td>
                          <StatusBadge value={d.status} />
                        </td>
                        <td>{fmtDate(d.uploadedAt)}</td>
                        <td>
                          <button className="btn btn-ghost btn-sm" disabled={blob.loading} onClick={() => void blob.open(d.storageKey)}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel" style={{ marginBottom: 0 }}>
              <h2>Decision</h2>
              <p className="hint" style={{ marginTop: 0 }}>
                Approving grants the verified badge on this business and makes it eligible for a subscription trial. The reviewer message is
                shown to the business owner; admin notes stay internal.
              </p>
              {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
              <label className="field">
                <span className="label">Reviewer message (shown to the business owner)</span>
                <textarea rows={3} value={reviewerMessage} onChange={(e) => setReviewerMessage(e.target.value)} placeholder="e.g. Your trade license looks good; approved." />
              </label>
              <label className="field">
                <span className="label">Admin notes (internal only)</span>
                <textarea rows={2} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Optional internal note for the audit trail." />
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" disabled={busy} onClick={() => void decide('approve')}>
                  {busy ? 'Working…' : 'Approve verification'}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void decide('changes')}>
                  Request changes
                </button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void decide('reject')}>
                  Reject
                </button>
              </div>
            </div>
          </>
        )}
      </Modal>
      <BlobViewerModal title="Verification document" state={blob.state} onClose={blob.close} />
    </>
  );
}

export function VerificationReview() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [apps, setApps] = useState<VerificationApplication[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setApps(await api.listVerifications({ status: status || undefined, q: query || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load verification applications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query]);

  return (
    <>
      <div className="toolbar">
        <input
          className="admin-input"
          placeholder="Search business or owner email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search verification applications"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQuery(q.trim());
          }}
        />
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by verification status">
          <option value="">All statuses</option>
          {VERIFICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {verificationDecisionLabel(s)}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setQuery(q.trim())}>
          Search
        </button>
      </div>
      {loading ? (
        <div className="loading">Loading verification applications…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Verification applications ({apps!.length})</h2>
          {apps!.length === 0 ? (
            <div className="empty">No applications match these filters.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Owner</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {apps!.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.publicName ?? a.business.name}</strong>
                    </td>
                    <td className="mono">{a.business.owner.email}</td>
                    <td>{a.submittedAt ? fmtDate(a.submittedAt) : <span className="muted">Not submitted</span>}</td>
                    <td>
                      <StatusBadge value={a.status} />
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setSelectedId(a.id)}>
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {selectedId ? (
        <VerificationDetailModal
          applicationId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </>
  );
}

/* ---------------------------- subscription plans ------------------------ */

function PlanDialog(props: { plan: AdminSubscriptionPlan | null; onClose: () => void; onSaved: () => void }) {
  const p = props.plan;
  const [name, setName] = useState(p?.name ?? '');
  const [slug, setSlug] = useState(p?.slug ?? '');
  const [description, setDescription] = useState(p?.description ?? '');
  const [priceRupees, setPriceRupees] = useState(p ? String(p.monthlyPriceMinor / 100) : '');
  const [currency, setCurrency] = useState(p?.currency ?? 'PKR');
  const [trialDays, setTrialDays] = useState(p ? String(p.trialDays) : '0');
  const [billingInterval, setBillingInterval] = useState(p?.billingInterval ?? 'MONTHLY');
  const [benefits, setBenefits] = useState((p?.benefits ?? []).join('\n'));
  const [displayOrder, setDisplayOrder] = useState(p ? String(p.displayOrder) : '0');
  const [isHighlighted, setIsHighlighted] = useState(p?.isHighlighted ?? false);
  const [isActive, setIsActive] = useState(p?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const rupees = Number(priceRupees);
    if (!name.trim() || Number.isNaN(rupees) || rupees < 0) {
      setError('Enter a plan name and a valid price in rupees.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: SubscriptionPlanInput = {
        name: name.trim(),
        monthlyPriceMinor: Math.round(rupees * 100),
        currency: currency.trim() || 'PKR',
        trialDays: Math.max(0, parseInt(trialDays, 10) || 0),
        billingInterval: billingInterval.trim() || 'MONTHLY',
        benefits: benefits
          .split('\n')
          .map((b) => b.trim())
          .filter(Boolean),
        displayOrder: parseInt(displayOrder, 10) || 0,
        isHighlighted,
        isActive,
      };
      if (p) {
        await api.updateSubscriptionPlan(p.id, input);
      } else {
        await api.createSubscriptionPlan({ ...input, slug: slug.trim() || undefined, description: description.trim() || null });
      }
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the plan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={p ? `Edit plan: ${p.name}` : 'New subscription plan'} onClose={props.onClose} wide>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <form onSubmit={(e) => void save(e)}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Business Plus" />
          </label>
          <label className="field">
            <span className="label">Slug {p ? '(locked after creation)' : '(optional, auto-generated)'}</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={80} disabled={Boolean(p)} placeholder="business-plus" />
          </label>
        </div>
        <label className="field">
          <span className="label">Description</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short pitch shown on the plans screen." />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Price (PKR / month)</span>
            <input inputMode="decimal" value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)} required placeholder="2999" />
          </label>
          <label className="field">
            <span className="label">Currency</span>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={8} />
          </label>
          <label className="field">
            <span className="label">Trial days</span>
            <input inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} placeholder="14" />
          </label>
          <label className="field">
            <span className="label">Billing interval</span>
            <input value={billingInterval} onChange={(e) => setBillingInterval(e.target.value)} maxLength={24} placeholder="MONTHLY" />
          </label>
        </div>
        <label className="field">
          <span className="label">Benefits (one per line)</span>
          <textarea rows={5} value={benefits} onChange={(e) => setBenefits(e.target.value)} placeholder={'Unlimited products\nPriority search placement\nDedicated support'} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Display order (lower shows first)</span>
            <input inputMode="numeric" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
            </label>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={isHighlighted} onChange={(e) => setIsHighlighted(e.target.checked)} /> Highlighted (featured card)
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : p ? 'Save changes' : 'Create plan'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SubscriptionPlans() {
  const [plans, setPlans] = useState<AdminSubscriptionPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { plan: AdminSubscriptionPlan | null }>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setPlans(await api.listSubscriptionPlans());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load plans.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleActive = async (p: AdminSubscriptionPlan) => {
    setBusyId(p.id);
    setActionError(null);
    try {
      await api.updateSubscriptionPlan(p.id, { isActive: !p.isActive });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: AdminSubscriptionPlan) => {
    if (!window.confirm(`Delete the plan "${p.name}"? This cannot be undone.`)) return;
    setBusyId(p.id);
    setActionError(null);
    try {
      await api.deleteSubscriptionPlan(p.id);
      await load();
    } catch (e) {
      if (e instanceof api.ApiError && (e.status === 409 || e.code === 'PLAN_IN_USE')) {
        setActionError(
          `Cannot delete "${p.name}": ${p.usageCount} ${p.usageCount === 1 ? 'business is' : 'businesses are'} on this plan. ` +
            'Deactivate it instead so existing subscribers keep their plan.',
        );
      } else {
        setActionError(e instanceof Error ? e.message : 'Delete failed.');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <p className="hint" style={{ marginBottom: 12 }}>
        The business app reads these plans live. Creating, editing, reordering or deactivating a plan here changes what business owners see
        immediately, no developer needed.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={() => setDialog({ plan: null })}>
          New plan
        </button>
      </div>
      {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
      {loading ? (
        <div className="loading">Loading subscription plans…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Subscription plans ({plans!.length})</h2>
          {plans!.length === 0 ? (
            <div className="empty">No plans yet. Create the first one to let businesses subscribe.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Interval</th>
                  <th>Trial</th>
                  <th>Benefits</th>
                  <th>Order</th>
                  <th>Featured</th>
                  <th>Status</th>
                  <th>Businesses</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans!.map((p) => (
                  <tr key={p.id} className={p.isActive ? undefined : 'row-hidden'}>
                    <td>
                      <strong>{p.name}</strong>
                      <div className="muted mono">{p.slug}</div>
                    </td>
                    <td>{fmtMoney(p.monthlyPriceMinor, p.currency)}</td>
                    <td className="mono">{p.billingInterval}</td>
                    <td>{p.trialDays > 0 ? `${p.trialDays} days` : <span className="muted">None</span>}</td>
                    <td>
                      {p.benefits.length === 0 ? (
                        <span className="muted">No benefits listed</span>
                      ) : expanded === p.id ? (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {p.benefits.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      ) : (
                        <>
                          {p.benefits.slice(0, 2).map((b, i) => (
                            <div key={i}>{b}</div>
                          ))}
                          {p.benefits.length > 2 ? <div className="muted">+{p.benefits.length - 2} more</div> : null}
                        </>
                      )}
                      {p.benefits.length > 2 ? (
                        <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                          {expanded === p.id ? 'Collapse' : 'Expand'}
                        </button>
                      ) : null}
                    </td>
                    <td className="mono">{p.displayOrder}</td>
                    <td>{p.isHighlighted ? <span className="badge badge-info">Featured</span> : <span className="muted">No</span>}</td>
                    <td>{p.isActive ? <span className="badge badge-open">Active</span> : <span className="badge badge-closed">Inactive</span>}</td>
                    <td>{p.usageCount}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => setDialog({ plan: p })}>
                        Edit
                      </button>{' '}
                      <button className={`btn btn-sm ${p.isActive ? 'btn-danger' : ''}`} disabled={busyId === p.id} onClick={() => void toggleActive(p)}>
                        {busyId === p.id ? 'Working…' : p.isActive ? 'Deactivate' : 'Activate'}
                      </button>{' '}
                      <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void remove(p)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {dialog ? <PlanDialog plan={dialog.plan} onClose={() => setDialog(null)} onSaved={() => void load()} /> : null}
    </>
  );
}

/* ----------------------------- payment methods -------------------------- */

const PAYMENT_METHOD_TYPES = [
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'JAZZCASH', label: 'JazzCash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'OTHER', label: 'Other' },
];

function paymentMethodTypeLabel(type: string): string {
  return PAYMENT_METHOD_TYPES.find((t) => t.value === type)?.label ?? type.replace(/_/g, ' ');
}

function PaymentMethodDialog(props: { method: AdminPaymentMethod | null; onClose: () => void; onSaved: () => void }) {
  const m = props.method;
  const [name, setName] = useState(m?.name ?? '');
  const [type, setType] = useState<string>(m?.type ?? 'EASYPAISA');
  const [accountTitle, setAccountTitle] = useState(m?.accountTitle ?? '');
  const [accountNumber, setAccountNumber] = useState(m?.accountNumber ?? '');
  const [iban, setIban] = useState(m?.iban ?? '');
  const [instructions, setInstructions] = useState(m?.instructions ?? '');
  const [qrImageUrl, setQrImageUrl] = useState(m?.qrImageUrl ?? '');
  const [displayOrder, setDisplayOrder] = useState(m ? String(m.displayOrder) : '0');
  const [isActive, setIsActive] = useState(m?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a display name for this payment method.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: PaymentMethodInput = {
        name: name.trim(),
        type,
        accountTitle: accountTitle.trim() || null,
        accountNumber: accountNumber.trim() || null,
        iban: iban.trim() || null,
        instructions: instructions.trim() || null,
        qrImageUrl: qrImageUrl.trim() || null,
        isActive,
        displayOrder: parseInt(displayOrder, 10) || 0,
      };
      if (m) await api.updatePaymentMethod(m.id, input);
      else await api.createPaymentMethod(input);
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the payment method.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={m ? `Edit payment method: ${m.name}` : 'New payment method'} onClose={props.onClose} wide>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <form onSubmit={(e) => void save(e)}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Easypaisa (business account)" />
          </label>
          <label className="field">
            <span className="label">Type</span>
            <select className="admin-select" style={{ width: '100%' }} value={type} onChange={(e) => setType(e.target.value)}>
              {PAYMENT_METHOD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Account title</span>
            <input value={accountTitle} onChange={(e) => setAccountTitle(e.target.value)} maxLength={120} placeholder="NearbyOrders Pvt Ltd" />
          </label>
          <label className="field">
            <span className="label">Account number</span>
            <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={64} placeholder="0345 1234567" />
          </label>
        </div>
        <label className="field">
          <span className="label">IBAN (bank transfers)</span>
          <input value={iban} onChange={(e) => setIban(e.target.value)} maxLength={64} placeholder="PK36…" />
        </label>
        <label className="field">
          <span className="label">Payment instructions (shown to the business owner)</span>
          <textarea
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Send the exact plan amount to the number above, then upload your receipt here."
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">QR image URL (optional)</span>
            <input value={qrImageUrl} onChange={(e) => setQrImageUrl(e.target.value)} maxLength={500} placeholder="https://…" />
          </label>
          <label className="field">
            <span className="label">Display order (lower shows first)</span>
            <input inputMode="numeric" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </label>
        </div>
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active (visible to business owners)
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : m ? 'Save changes' : 'Add payment method'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PaymentMethods() {
  const [methods, setMethods] = useState<AdminPaymentMethod[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { method: AdminPaymentMethod | null }>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setMethods(await api.listPaymentMethods());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payment methods.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleActive = async (m: AdminPaymentMethod) => {
    setBusyId(m.id);
    setActionError(null);
    try {
      await api.updatePaymentMethod(m.id, { isActive: !m.isActive });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (m: AdminPaymentMethod) => {
    if (!window.confirm(`Delete the payment method "${m.name}"? This cannot be undone.`)) return;
    setBusyId(m.id);
    setActionError(null);
    try {
      await api.deletePaymentMethod(m.id);
      await load();
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 409) {
        setActionError(
          `Cannot delete "${m.name}": payment requests reference it. Deactivate it instead so past requests keep their records.`,
        );
      } else {
        setActionError(e instanceof Error ? e.message : 'Delete failed.');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <p className="hint" style={{ marginBottom: 12 }}>
        These are the accounts business owners pay into when they subscribe manually. Changing the Easypaisa number here updates the business
        app immediately, no developer needed.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={() => setDialog({ method: null })}>
          New payment method
        </button>
      </div>
      {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
      {loading ? (
        <div className="loading">Loading payment methods…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Payment methods ({methods!.length})</h2>
          {methods!.length === 0 ? (
            <div className="empty">No payment methods yet. Add one so businesses can pay for subscriptions manually.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Account</th>
                  <th>Instructions</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {methods!.map((m) => (
                  <tr key={m.id} className={m.isActive ? undefined : 'row-hidden'}>
                    <td>
                      <strong>{m.name}</strong>
                    </td>
                    <td>{paymentMethodTypeLabel(m.type)}</td>
                    <td>
                      {m.accountTitle ? <div>{m.accountTitle}</div> : null}
                      {m.accountNumber ? <div className="mono">{m.accountNumber}</div> : null}
                      {m.iban ? <div className="mono muted">{m.iban}</div> : null}
                      {!m.accountTitle && !m.accountNumber && !m.iban ? <span className="muted">No account details</span> : null}
                    </td>
                    <td className="review-comment">
                      {m.instructions ? (
                        m.instructions.length > 120 ? (
                          <>{m.instructions.slice(0, 120)}…</>
                        ) : (
                          m.instructions
                        )
                      ) : (
                        <span className="muted">No instructions</span>
                      )}
                    </td>
                    <td className="mono">{m.displayOrder}</td>
                    <td>{m.isActive ? <span className="badge badge-open">Active</span> : <span className="badge badge-closed">Inactive</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" disabled={busyId === m.id} onClick={() => setDialog({ method: m })}>
                        Edit
                      </button>{' '}
                      <button className={`btn btn-sm ${m.isActive ? 'btn-danger' : ''}`} disabled={busyId === m.id} onClick={() => void toggleActive(m)}>
                        {busyId === m.id ? 'Working…' : m.isActive ? 'Deactivate' : 'Activate'}
                      </button>{' '}
                      <button className="btn btn-ghost btn-sm" disabled={busyId === m.id} onClick={() => void remove(m)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {dialog ? <PaymentMethodDialog method={dialog.method} onClose={() => setDialog(null)} onSaved={() => void load()} /> : null}
    </>
  );
}

/* ------------------------------ promotions -------------------------------- */

function PromotionDialog(props: { promotion: AdminPromotion | null; onClose: () => void; onSaved: () => void }) {
  const p = props.promotion;
  const [name, setName] = useState(p?.name ?? '');
  const [slug, setSlug] = useState(p?.slug ?? '');
  const [description, setDescription] = useState(p?.description ?? '');
  const [benefits, setBenefits] = useState((p?.benefits ?? []).join('\n'));
  const [priceRupees, setPriceRupees] = useState(p ? String(p.priceMinor / 100) : '');
  const [durationDays, setDurationDays] = useState(p ? String(p.durationDays) : '30');
  const [requirements, setRequirements] = useState(p?.requirements ?? '');
  const [displayOrder, setDisplayOrder] = useState(p ? String(p.displayOrder) : '0');
  const [isActive, setIsActive] = useState(p?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const rupees = Number(priceRupees);
    if (!name.trim() || Number.isNaN(rupees) || rupees < 0) {
      setError('Enter a promotion name and a valid price in rupees.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: PromotionInput = {
        name: name.trim(),
        description: description.trim() || null,
        benefits: benefits
          .split('\n')
          .map((b) => b.trim())
          .filter(Boolean),
        priceMinor: Math.round(rupees * 100),
        durationDays: Math.max(1, parseInt(durationDays, 10) || 30),
        requirements: requirements.trim() || null,
        isActive,
        displayOrder: parseInt(displayOrder, 10) || 0,
      };
      if (p) await api.updatePromotion(p.id, input);
      else await api.createPromotion({ ...input, slug: slug.trim() || undefined });
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the promotion.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={p ? `Edit promotion: ${p.name}` : 'New promotion'} onClose={props.onClose} wide>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <form onSubmit={(e) => void save(e)}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Ramadan Spotlight" />
          </label>
          <label className="field">
            <span className="label">Slug {p ? '(locked after creation)' : '(optional, auto-generated)'}</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={80} disabled={Boolean(p)} />
          </label>
        </div>
        <label className="field">
          <span className="label">Description</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the promotion does for the business." />
        </label>
        <label className="field">
          <span className="label">Benefits (one per line)</span>
          <textarea rows={4} value={benefits} onChange={(e) => setBenefits(e.target.value)} placeholder={'Homepage banner for 7 days\nSocial media mention'} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Price (PKR)</span>
            <input inputMode="decimal" value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)} required placeholder="4999" />
          </label>
          <label className="field">
            <span className="label">Duration (days)</span>
            <input inputMode="numeric" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Display order</span>
            <input inputMode="numeric" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="label">Requirements (eligibility rules shown to owners)</span>
          <textarea rows={2} value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="e.g. Active subscription required." />
        </label>
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active (visible to business owners)
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : p ? 'Save changes' : 'Create promotion'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PromotionCatalog() {
  const [promos, setPromos] = useState<AdminPromotion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { promotion: AdminPromotion | null }>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setPromos(await api.listPromotions());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load promotions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleActive = async (p: AdminPromotion) => {
    setBusyId(p.id);
    setActionError(null);
    try {
      await api.updatePromotion(p.id, { isActive: !p.isActive });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: AdminPromotion) => {
    if (!window.confirm(`Delete the promotion "${p.name}"? This cannot be undone.`)) return;
    setBusyId(p.id);
    setActionError(null);
    try {
      await api.deletePromotion(p.id);
      await load();
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 409) {
        setActionError(`Cannot delete "${p.name}": promotion requests reference it. Deactivate it instead.`);
      } else {
        setActionError(e instanceof Error ? e.message : 'Delete failed.');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => setDialog({ promotion: null })}>
          New promotion
        </button>
      </div>
      {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
      {loading ? (
        <div className="loading">Loading promotions…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Promotion catalog ({promos!.length})</h2>
          {promos!.length === 0 ? (
            <div className="empty">No promotions yet. Create one to offer paid visibility boosts to businesses.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Promotion</th>
                  <th>Price</th>
                  <th>Duration</th>
                  <th>Benefits</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Requests</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {promos!.map((p) => (
                  <tr key={p.id} className={p.isActive ? undefined : 'row-hidden'}>
                    <td>
                      <strong>{p.name}</strong>
                      <div className="muted mono">{p.slug}</div>
                      {p.description ? <div className="muted">{p.description}</div> : null}
                    </td>
                    <td>{fmtMoney(p.priceMinor, p.currency)}</td>
                    <td>{p.durationDays} days</td>
                    <td>
                      {p.benefits.length === 0 ? <span className="muted">None listed</span> : p.benefits.slice(0, 3).join(' · ')}
                      {p.benefits.length > 3 ? <span className="muted"> +{p.benefits.length - 3} more</span> : null}
                    </td>
                    <td className="mono">{p.displayOrder}</td>
                    <td>{p.isActive ? <span className="badge badge-open">Active</span> : <span className="badge badge-closed">Inactive</span>}</td>
                    <td>{p.requestCount ?? <span className="muted">N/A</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => setDialog({ promotion: p })}>
                        Edit
                      </button>{' '}
                      <button className={`btn btn-sm ${p.isActive ? 'btn-danger' : ''}`} disabled={busyId === p.id} onClick={() => void toggleActive(p)}>
                        {busyId === p.id ? 'Working…' : p.isActive ? 'Deactivate' : 'Activate'}
                      </button>{' '}
                      <button className="btn btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void remove(p)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {dialog ? <PromotionDialog promotion={dialog.promotion} onClose={() => setDialog(null)} onSaved={() => void load()} /> : null}
    </>
  );
}

const PROMOTION_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'CANCELLED'];

/** Reviews the newest payment of an APPROVED paid promotion request. */
function PromotionPaymentReview(props: { paymentId: string; onChanged: () => void }) {
  const [payment, setPayment] = useState<api.AdminPromotionPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Promotion payment receipts are served by the same authorized receipt
  // endpoint as subscription payments.
  const blob = useBlobViewer(api.fetchReceiptObjectUrl);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getPromotionPaymentRequest(props.paymentId)
      .then((p) => {
        if (!cancelled) setPayment(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the payment.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.paymentId]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setRejecting(false);
      setReason('');
      props.onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const approve = (p: api.AdminPromotionPayment) => {
    if (
      !window.confirm(
        `Approve this payment of ${fmtMoney(p.amountMinor, p.currency)} from ${p.business.name}? The promotion activates immediately with server-set start and end dates.`,
      )
    )
      return;
    void act(() => api.approvePromotionPayment(p.id));
  };

  if (loading) return <div className="loading">Loading latest payment…</div>;
  if (error || !payment) return <div className="form-error">{error ?? 'Payment not found.'}</div>;

  return (
    <>
      {actionError ? (
        <div className="form-error" role="alert">
          {actionError}
        </div>
      ) : null}
      <table className="admin-table">
        <tbody>
          <tr>
            <th style={{ width: 200 }}>Amount</th>
            <td>{fmtMoney(payment.amountMinor, payment.currency)}</td>
          </tr>
          <tr>
            <th>Payment method</th>
            <td>
              {payment.paymentMethod.name} <span className="muted">({payment.paymentMethod.type.replace(/_/g, ' ')})</span>
            </td>
          </tr>
          <tr>
            <th>Transaction reference</th>
            <td className="mono">{payment.transactionReference ?? 'N/A'}</td>
          </tr>
          <tr>
            <th>Paid date</th>
            <td>{payment.paidAt ? fmtDate(payment.paidAt) : <span className="muted">Not provided</span>}</td>
          </tr>
          <tr>
            <th>Submitted</th>
            <td>{fmtDate(payment.submittedAt)}</td>
          </tr>
          {payment.note ? (
            <tr>
              <th>Business note</th>
              <td>{payment.note}</td>
            </tr>
          ) : null}
          <tr>
            <th>Receipt / proof</th>
            <td>
              {payment.receiptStorageKey ? (
                <button className="btn btn-ghost btn-sm" disabled={blob.loading} onClick={() => void blob.open(payment.receiptStorageKey!)}>
                  {blob.loading ? 'Loading…' : 'View receipt'}
                </button>
              ) : (
                <span className="muted">No receipt uploaded</span>
              )}
            </td>
          </tr>
          <tr>
            <th>Status</th>
            <td>
              <StatusBadge value={payment.status} />
            </td>
          </tr>
          {payment.reviewedAt ? (
            <tr>
              <th>Decision</th>
              <td>
                <div>Decided {fmtDate(payment.reviewedAt)}</div>
                {payment.rejectionReason ? <div className="reason-box">{payment.rejectionReason}</div> : null}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {payment.status === 'PENDING' ? (
        rejecting ? (
          <div style={{ marginTop: 10, minWidth: 220 }}>
            <input
              className="admin-input"
              style={{ minWidth: 0, width: '100%', marginBottom: 6 }}
              placeholder="Rejection reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Payment rejection reason"
            />
            <button
              className="btn btn-danger btn-sm"
              disabled={busy || reason.trim().length < 4}
              onClick={() => void act(() => api.rejectPromotionPayment(payment.id, reason.trim()))}
            >
              Confirm rejection
            </button>{' '}
            <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn btn-sm" disabled={busy} onClick={() => approve(payment)}>
              {busy ? 'Working…' : 'Approve payment'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(true)}>
              Reject payment
            </button>
          </div>
        )
      ) : null}
      <BlobViewerModal title="Payment receipt" state={blob.state} onClose={blob.close} />
    </>
  );
}

/** Expandable detail for one promotion request: note, reviewer message,
    timeline, and (for approved paid requests) the payment review. */
function PromotionRequestDetail(props: { request: AdminPromotionRequest; onChanged: () => void }) {
  const r = props.request;
  const price = r.promotion?.priceMinor ?? 0;
  const isPaid = price > 0;
  const ownerName = [r.business.owner.firstName, r.business.owner.lastName].filter(Boolean).join(' ') || 'No name on file';
  return (
    <>
      <table className="admin-table">
        <tbody>
          <tr>
            <th style={{ width: 200 }}>Business</th>
            <td>
              <strong>{r.business.name}</strong>
              <div className="muted mono">{r.business.slug}</div>
            </td>
          </tr>
          <tr>
            <th>Owner</th>
            <td>
              <span className="mono">{r.business.owner.email}</span>
              <div className="muted">{ownerName}</div>
            </td>
          </tr>
          {r.promotion ? (
            <tr>
              <th>Promotion</th>
              <td>
                {r.promotion.name}
                <div className="muted mono">
                  {r.promotion.slug} · {r.promotion.durationDays} days · {isPaid ? fmtMoney(price, r.promotion.currency) : 'Free'}
                </div>
              </td>
            </tr>
          ) : null}
          {r.note ? (
            <tr>
              <th>Application note</th>
              <td>{r.note}</td>
            </tr>
          ) : null}
          {r.reviewerMessage ? (
            <tr>
              <th>Reviewer message</th>
              <td>
                <div className="reason-box">{r.reviewerMessage}</div>
              </td>
            </tr>
          ) : null}
          <tr>
            <th>Timeline</th>
            <td>
              <div>Requested {fmtDate(r.createdAt)}</div>
              {r.reviewedAt ? <div>Decided {fmtDate(r.reviewedAt)}</div> : null}
              {r.activatedAt ? <div>Activated {fmtDate(r.activatedAt)}</div> : null}
              {r.expiresAt ? <div>Expires {fmtDate(r.expiresAt)}</div> : null}
            </td>
          </tr>
        </tbody>
      </table>
      {r.status === 'APPROVED' && isPaid ? (
        <div className="panel" style={{ marginTop: 12, marginBottom: 0 }}>
          <h2>Latest payment</h2>
          {r.payments.length === 0 ? (
            <div className="empty">No payment submitted yet. The business owner can submit one from their app.</div>
          ) : (
            <PromotionPaymentReview paymentId={r.payments[0].id} onChanged={props.onChanged} />
          )}
        </div>
      ) : null}
    </>
  );
}

export function PromotionRequestQueue() {
  const [status, setStatus] = useState('PENDING');
  const [reqs, setReqs] = useState<AdminPromotionRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messageFor, setMessageFor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReqs(await api.listPromotionRequests(status || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load promotion requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const act = async (id: string, kind: 'approve' | 'reject') => {
    setBusy(true);
    setActionError(null);
    try {
      const msg = message.trim() || undefined;
      if (kind === 'approve') await api.approvePromotionRequest(id, msg);
      else await api.rejectPromotionRequest(id, msg);
      setMessageFor(null);
      setMessage('');
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter promotion requests by status">
          <option value="">All statuses</option>
          {PROMOTION_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
      {loading ? (
        <div className="loading">Loading promotion requests…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Promotion requests ({reqs!.length})</h2>
          {reqs!.length === 0 ? (
            <div className="empty">No promotion requests with this status.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Business</th>
                  <th>Promotion</th>
                  <th>Price</th>
                  <th>Applied</th>
                  <th>Application status</th>
                  <th>Payment status</th>
                  <th>Promotion status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reqs!.map((r) => {
                  const price = r.promotion?.priceMinor ?? 0;
                  const isPaid = price > 0;
                  const isOpen = expanded === r.id;
                  return (
                    <React.Fragment key={r.id}>
                      <tr>
                        <td>{fmtDate(r.createdAt)}</td>
                        <td>
                          <strong>{r.business.name}</strong>
                          <div className="muted mono">{r.business.owner.email}</div>
                        </td>
                        <td>
                          {r.promotion?.name ?? <span className="muted">N/A</span>}
                          {r.promotion ? <div className="muted">{r.promotion.durationDays} days</div> : null}
                        </td>
                        <td>{r.promotion ? (isPaid ? fmtMoney(price, r.promotion.currency) : 'Free') : <span className="muted">N/A</span>}</td>
                        <td>{r.activatedAt ? fmtDate(r.activatedAt) : <span className="muted">Not active</span>}</td>
                        <td>
                          <StatusBadge value={r.status} />
                        </td>
                        <td>{r.paymentStatus ? <StatusBadge value={r.paymentStatus} /> : <span className="muted">None</span>}</td>
                        <td>
                          {r.status === 'ACTIVE' ? (
                            <>
                              <span className="badge badge-open">Active</span>
                              {r.expiresAt ? <div className="muted">until {fmtDate(r.expiresAt)}</div> : null}
                            </>
                          ) : r.status === 'EXPIRED' ? (
                            <StatusBadge value="EXPIRED" />
                          ) : (
                            <span className="muted">N/A</span>
                          )}
                        </td>
                        <td>
                          {r.status === 'PENDING' ? (
                            messageFor === r.id ? (
                              <div style={{ minWidth: 240 }}>
                                <div className="muted" style={{ marginBottom: 6 }}>
                                  {isPaid
                                    ? 'Approval moves this to the payment step: the owner must pay before the promotion goes live.'
                                    : 'Approving activates this free promotion immediately. No payment is needed.'}
                                </div>
                                <input
                                  className="admin-input"
                                  style={{ minWidth: 0, width: '100%', marginBottom: 6 }}
                                  placeholder="Reviewer message (optional)"
                                  value={message}
                                  onChange={(e) => setMessage(e.target.value)}
                                />
                                <button className="btn btn-sm" disabled={busy} onClick={() => void act(r.id, 'approve')}>
                                  Confirm approval
                                </button>{' '}
                                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void act(r.id, 'reject')}>
                                  Confirm rejection
                                </button>{' '}
                                <button className="btn btn-ghost btn-sm" onClick={() => setMessageFor(null)}>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <button className="btn btn-ghost btn-sm" onClick={() => setMessageFor(r.id)}>
                                  Decide
                                </button>{' '}
                                <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(r.id)}>
                                  Details
                                </button>
                              </>
                            )
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(isOpen ? null : r.id)}>
                              {isOpen ? 'Hide details' : 'Details'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr key={`${r.id}-detail`}>
                          <td colSpan={9}>
                            <PromotionRequestDetail request={r} onChanged={() => void load()} />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="hint">
            Free promotions activate immediately on approval. Paid promotions wait for the owner's payment before going live.
          </p>
        </div>
      )}
    </>
  );
}

export function PromotionCenter() {
  const [tab, setTab] = useState<'catalog' | 'requests'>('catalog');
  return (
    <>
      <div className="toolbar" role="tablist" aria-label="Promotions views">
        <button className={`btn ${tab === 'catalog' ? '' : 'btn-ghost'}`} role="tab" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')}>
          Catalog
        </button>
        <button className={`btn ${tab === 'requests' ? '' : 'btn-ghost'}`} role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')}>
          Requests queue
        </button>
      </div>
      {tab === 'catalog' ? <PromotionCatalog /> : <PromotionRequestQueue />}
    </>
  );
}

/* --------------------- payment requests (extended) ---------------------- */

function PaymentRequestDetailModal(props: { request: AdminPaymentRequest; onClose: () => void }) {
  const p = props.request;
  const blob = useBlobViewer();
  return (
    <>
      <Modal title="Payment request detail" onClose={props.onClose}>
        <table className="admin-table">
          <tbody>
            <tr>
              <th style={{ width: 180 }}>Business</th>
              <td>
                <strong>{p.business.name}</strong>
              </td>
            </tr>
            <tr>
              <th>Amount</th>
              <td>{fmtMoney(p.amountMinor, p.currency)}</td>
            </tr>
            <tr>
              <th>Plan</th>
              <td>{p.plan?.name ?? <span className="muted">N/A</span>}</td>
            </tr>
            <tr>
              <th>Payment method</th>
              <td>{p.paymentMethod ? `${p.paymentMethod.name} (${p.paymentMethod.type.replace(/_/g, ' ')})` : <span className="muted">N/A</span>}</td>
            </tr>
            <tr>
              <th>Transaction reference</th>
              <td className="mono">{p.transactionReference ?? 'N/A'}</td>
            </tr>
            <tr>
              <th>Paid date</th>
              <td>{p.paidAt ? fmtDate(p.paidAt) : <span className="muted">Not provided</span>}</td>
            </tr>
            <tr>
              <th>Submitted</th>
              <td>{fmtDate(p.createdAt)}</td>
            </tr>
            {p.note ? (
              <tr>
                <th>Business note</th>
                <td>{p.note}</td>
              </tr>
            ) : null}
            <tr>
              <th>Receipt / proof</th>
              <td>
                {p.receiptStorageKey ? (
                  <button className="btn btn-ghost btn-sm" disabled={blob.loading} onClick={() => void blob.open(p.receiptStorageKey!)}>
                    {blob.loading ? 'Loading…' : 'View receipt'}
                  </button>
                ) : (
                  <span className="muted">No receipt uploaded</span>
                )}
              </td>
            </tr>
            <tr>
              <th>Status</th>
              <td>
                <StatusBadge value={p.status} />
              </td>
            </tr>
            {p.reviewedAt ? (
              <tr>
                <th>Decision</th>
                <td>
                  <div>Decided {fmtDate(p.reviewedAt)}</div>
                  {p.reviewer?.email ? <div className="muted mono">by {p.reviewer.email}</div> : null}
                  {p.rejectionReason ? <div className="reason-box">{p.rejectionReason}</div> : null}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Modal>
      <BlobViewerModal title="Payment receipt" state={blob.state} onClose={blob.close} />
    </>
  );
}

export function PaymentRequests(props: { initialStatus?: string; initialBusinessId?: string }) {
  const [status, setStatus] = useState(props.initialStatus ?? 'PENDING');
  const [businessId, setBusinessId] = useState(props.initialBusinessId ?? '');
  const [q, setQ] = useState('');
  const [planId, setPlanId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<api.PaymentRequestListParams>({ status: props.initialStatus ?? 'PENDING' });
  const [reqs, setReqs] = useState<AdminPaymentRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<AdminSubscriptionPlan[] | null>(null);
  const [methods, setMethods] = useState<AdminPaymentMethod[] | null>(null);
  const [detail, setDetail] = useState<AdminPaymentRequest | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async (params: api.PaymentRequestListParams) => {
    setLoading(true);
    setError(null);
    try {
      setReqs(await api.listPaymentRequests(params));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payment requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(applied);
    void api
      .listSubscriptionPlans()
      .then(setPlans)
      .catch(() => setPlans([]));
    void api
      .listPaymentMethods()
      .then(setMethods)
      .catch(() => setMethods([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  const applyFilters = () => {
    setApplied({
      status: status || undefined,
      businessId: businessId || undefined,
      q: q.trim() || undefined,
      planId: planId || undefined,
      paymentMethodId: paymentMethodId || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setReasonFor(null);
      setReason('');
      await load(applied);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const decide = (p: AdminPaymentRequest, kind: 'approve' | 'reject') => {
    if (kind === 'approve') {
      if (!window.confirm(`Approve this payment of ${fmtMoney(p.amountMinor, p.currency)} from ${p.business.name}? The subscription activates immediately.`)) return;
      void act(() => api.approvePaymentRequest(p.id));
    } else {
      setReasonFor(p.id);
    }
  };

  return (
    <>
      <div className="toolbar">
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter payment requests by status">
          <option value="">All statuses</option>
          {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className="admin-input"
          placeholder="Business ID"
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          aria-label="Filter by business ID"
          style={{ minWidth: 140 }}
        />
        <input
          className="admin-input"
          placeholder="Search business or reference"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search payment requests"
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilters();
          }}
        />
        <select className="admin-select" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Filter by plan">
          <option value="">All plans</option>
          {(plans ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="admin-select" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} aria-label="Filter by payment method">
          <option value="">All methods</option>
          {(methods ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input className="admin-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" style={{ minWidth: 150 }} />
        <input className="admin-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" style={{ minWidth: 150 }} />
        <button className="btn" onClick={applyFilters}>
          Apply
        </button>
      </div>
      {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
      {loading ? (
        <div className="loading">Loading payment requests…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Manual subscription payments ({reqs!.length})</h2>
          {reqs!.length === 0 ? (
            <div className="empty">No payment requests match these filters.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Business</th>
                  <th>Plan</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reqs!.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.createdAt)}</td>
                    <td>{p.business.name}</td>
                    <td>{p.plan?.name ?? <span className="muted">N/A</span>}</td>
                    <td>{p.paymentMethod?.name ?? <span className="muted">N/A</span>}</td>
                    <td>{fmtMoney(p.amountMinor, p.currency)}</td>
                    <td className="mono">{p.transactionReference ?? 'N/A'}</td>
                    <td>
                      {p.status === 'PENDING' ? (
                        reasonFor === p.id ? (
                          <div style={{ minWidth: 220 }}>
                            <input
                              className="admin-input"
                              style={{ minWidth: 0, width: '100%', marginBottom: 6 }}
                              placeholder="Rejection reason (required)"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                            <button className="btn btn-danger btn-sm" disabled={busy || reason.trim().length < 4} onClick={() => void act(() => api.rejectPaymentRequest(p.id, reason.trim()))}>
                              Confirm rejection
                            </button>{' '}
                            <button className="btn btn-ghost btn-sm" onClick={() => setReasonFor(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => setDetail(p)}>
                              View
                            </button>{' '}
                            <button className="btn btn-sm" disabled={busy} onClick={() => decide(p, 'approve')}>
                              Approve
                            </button>{' '}
                            <button className="btn btn-ghost btn-sm" onClick={() => setReasonFor(p.id)}>
                              Reject
                            </button>
                          </>
                        )
                      ) : (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDetail(p)}>
                            View
                          </button>{' '}
                          <StatusBadge value={p.status} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Approving a payment activates the business subscription server-side. Rejections require a reason shown to the business owner.</p>
        </div>
      )}
      {detail ? <PaymentRequestDetailModal request={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

/* ------------------------- business review drawer ----------------------- */

export function BusinessDetailModal(props: {
  business: AdminBusiness;
  onClose: () => void;
  onChanged: () => void;
  onOpenPayments: (businessId: string) => void;
}) {
  const b = props.business;
  const [reviewerMessage, setReviewerMessage] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeStatus = async (next: AdminBusiness['status']) => {
    const label = next.toLowerCase();
    if (next === 'SUSPENDED' || next === 'REJECTED') {
      if (!window.confirm(`${next === 'SUSPENDED' ? 'Suspend' : 'Reject'} "${b.name}"? The business will disappear from customer discovery.`)) return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setBusinessStatus(b.id, next);
      props.onChanged();
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${label} the business.`);
    } finally {
      setBusy(false);
    }
  };

  const decideVerification = async (kind: 'approve' | 'reject' | 'changes') => {
    if (!b.verificationApplicationId) return;
    const msg = reviewerMessage.trim();
    if (kind !== 'approve' && msg.length < 4) {
      setError('A reviewer message is required so the business owner knows what to fix.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { reviewerMessage: msg || undefined, adminNotes: adminNotes.trim() || undefined };
      if (kind === 'approve') await api.approveVerification(b.verificationApplicationId, body);
      else if (kind === 'reject') await api.rejectVerification(b.verificationApplicationId, { ...body, reviewerMessage: msg });
      else await api.requestVerificationChanges(b.verificationApplicationId, { ...body, reviewerMessage: msg });
      props.onChanged();
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification decision failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Business: ${b.name}`} onClose={props.onClose} wide>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2>Business information</h2>
        <table className="admin-table">
          <tbody>
            <tr>
              <th style={{ width: 200 }}>Name / slug</th>
              <td>
                <strong>{b.name}</strong>
                <div className="muted mono">{b.slug}</div>
              </td>
            </tr>
            <tr>
              <th>Owner</th>
              <td>
                <span className="mono">{b.owner.email}</span>
                <div className="muted">{[b.owner.firstName, b.owner.lastName].filter(Boolean).join(' ') || 'No name on file'}</div>
              </td>
            </tr>
            <tr>
              <th>Category</th>
              <td>{b.categories.length > 0 ? b.categories.map((c) => c.name).join(', ') : <span className="muted">N/A</span>}</td>
            </tr>
            <tr>
              <th>Location</th>
              <td>
                {b.city}
                {b.address ? <div className="muted">{b.address}</div> : null}
              </td>
            </tr>
            <tr>
              <th>Submitted</th>
              <td>{fmtDate(b.createdAt)}</td>
            </tr>
            <tr>
              <th>Approval status</th>
              <td>
                <StatusBadge value={b.status} />
              </td>
            </tr>
            <tr>
              <th>Verification</th>
              <td>
                {b.verificationStatus ? <StatusBadge value={b.verificationStatus} /> : <span className="muted">No application</span>}{' '}
                {b.isVerified ? <span className="badge badge-info">Verified badge on</span> : null}
              </td>
            </tr>
            <tr>
              <th>Trial</th>
              <td>{b.trialStatus ? <StatusBadge value={b.trialStatus} /> : <span className="muted">N/A</span>}</td>
            </tr>
            <tr>
              <th>Subscription</th>
              <td>{b.subscriptionStatus ? <StatusBadge value={b.subscriptionStatus} /> : <span className="muted">No subscription</span>}</td>
            </tr>
            <tr>
              <th>Activity</th>
              <td className="mono muted">
                {b.counts.orders} orders · {b.counts.bookings} bookings · {b.counts.services} services · {b.counts.products} products ·{' '}
                {b.counts.reviews} reviews
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => props.onOpenPayments(b.id)}>
            View payment history
          </button>
        </div>
      </div>

      {b.verificationApplicationId ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h2>Verification decision</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Approving grants the verified badge and makes the business eligible for a subscription trial. The reviewer message is shown to the
            business owner; admin notes stay internal.
          </p>
          <label className="field">
            <span className="label">Reviewer message (shown to the business owner)</span>
            <textarea rows={2} value={reviewerMessage} onChange={(e) => setReviewerMessage(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Admin notes (internal only)</span>
            <textarea rows={2} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" disabled={busy} onClick={() => void decideVerification('approve')}>
              {busy ? 'Working…' : 'Approve verification'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void decideVerification('changes')}>
              Request changes
            </button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void decideVerification('reject')}>
              Reject verification
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel" style={{ marginBottom: 0 }}>
        <h2>Business status</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {b.status !== 'APPROVED' ? (
            <button className="btn btn-sm" disabled={busy} onClick={() => void changeStatus('APPROVED')}>
              Approve business
            </button>
          ) : null}
          {b.status !== 'SUSPENDED' && b.status !== 'ARCHIVED' ? (
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void changeStatus('SUSPENDED')}>
              Suspend business
            </button>
          ) : null}
          {b.status !== 'REJECTED' ? (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void changeStatus('REJECTED')}>
              Reject business
            </button>
          ) : null}
        </div>
        <p className="hint">Suspending or rejecting removes the business from customer discovery immediately.</p>
      </div>
    </Modal>
  );
}
