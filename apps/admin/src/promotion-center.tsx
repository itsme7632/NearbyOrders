import React, { useEffect, useState } from 'react';
import * as api from './api.js';
import type { AdminPromotionPayment, EditorialFeature, FeaturedItem, FeaturedListState } from './api.js';
import {
  BlobViewerModal,
  Modal,
  PromotionCatalog,
  PromotionRequestQueue,
  StatusBadge,
  fmtDate,
  fmtMoney,
  useBlobViewer,
} from './sections.js';

/* Rebuilt promotions center: Catalog | Requests queue | Payments | Active |
   Featured. Catalog CRUD and the requests queue are reused untouched from
   sections.tsx. Paid promotions can only go live through payment approval
   in the Payments tab; the UI repeats that rule wherever activation could
   be misunderstood. */

/* --------------------------------- drawer ------------------------------- */

function Drawer(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={props.onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="drawer-head">
          <h2>{props.title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body">{props.children}</div>
      </aside>
    </>
  );
}

/* ------------------------------ payments tab ---------------------------- */

const PAYMENT_FILTERS = [
  { value: 'PENDING', label: 'Pending review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: '', label: 'All' },
] as const;

function PaymentReviewDrawer(props: { paymentId: string; onClose: () => void; onChanged: () => void }) {
  const [payment, setPayment] = useState<AdminPromotionPayment | null>(null);
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
      props.onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const approve = (p: AdminPromotionPayment) => {
    if (
      !window.confirm(
        `Approve this payment of ${fmtMoney(p.amountMinor, p.currency)} from ${p.business.name}? The promotion activates immediately with server-set start and end dates.`,
      )
    )
      return;
    void act(() => api.approvePromotionPayment(p.id));
  };

  return (
    <>
      <Drawer title="Promotion payment review" onClose={props.onClose}>
        {loading ? (
          <div className="loading">Loading payment…</div>
        ) : error || !payment ? (
          <div className="form-error">{error ?? 'Payment not found.'}</div>
        ) : (
          <>
            {actionError ? (
              <div className="form-error" role="alert">
                {actionError}
              </div>
            ) : null}
            <table className="admin-table">
              <tbody>
                <tr>
                  <th style={{ width: 170 }}>Business</th>
                  <td>
                    <strong>{payment.business.name}</strong>
                  </td>
                </tr>
                <tr>
                  <th>Promotion</th>
                  <td>
                    <strong>{payment.promotion.name}</strong>
                    <div className="muted mono">
                      {payment.promotion.slug}
                      {payment.promotion.durationDays ? ` · ${payment.promotion.durationDays} days` : null}
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>Amount paid</th>
                  <td>{fmtMoney(payment.amountMinor, payment.currency)}</td>
                </tr>
                <tr>
                  <th>Catalog price</th>
                  <td>
                    {payment.promotion.priceMinor == null ? (
                      <span className="muted">Not available</span>
                    ) : (
                      <>
                        {fmtMoney(payment.promotion.priceMinor, payment.currency)}
                        {payment.promotion.priceMinor === payment.amountMinor ? (
                          <div className="muted">Matches the catalog price.</div>
                        ) : (
                          <div className="reason-box">Does not match the catalog price. Verify with the business before approving.</div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>Payment method</th>
                  <td>
                    {payment.paymentMethod.name} <span className="muted">({payment.paymentMethod.type.replace(/_/g, ' ')})</span>
                  </td>
                </tr>
                <tr>
                  <th>Transaction reference</th>
                  <td className="mono">{payment.transactionReference || 'N/A'}</td>
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
            <p className="hint">
              Approving a payment is the only action that puts a paid promotion live. The promotion activates with server-set start and end
              dates. Rejecting keeps the application approved so the business can resubmit.
            </p>
            {payment.status === 'PENDING' ? (
              rejecting ? (
                <div className="drawer-actions">
                  <input
                    className="admin-input"
                    style={{ minWidth: 0, width: '100%' }}
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
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="drawer-actions">
                  <button className="btn btn-sm" disabled={busy} onClick={() => approve(payment)}>
                    {busy ? 'Working…' : 'Approve payment'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(true)}>
                    Reject payment
                  </button>
                </div>
              )
            ) : null}
          </>
        )}
      </Drawer>
      <BlobViewerModal title="Payment receipt" state={blob.state} onClose={blob.close} />
    </>
  );
}

export function PromotionPaymentsTab() {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [items, setItems] = useState<AdminPromotionPayment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPromotionPaymentRequests({ status: status || undefined });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load promotion payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <>
      <p className="hint" style={{ marginBottom: 12 }}>
        Paid promotions go live only through this workflow: review the business payment here, and approving it activates the promotion with
        server-set start and end dates.
      </p>
      <div className="toolbar" role="tablist" aria-label="Filter promotion payments by status">
        {PAYMENT_FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            className={`btn btn-sm ${status === f.value ? '' : 'btn-ghost'}`}
            role="tab"
            aria-selected={status === f.value}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="loading">Loading promotion payments…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Promotion payments ({items!.length})</h2>
          {items!.length === 0 ? (
            <div className="empty">No promotion payments with this status.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Promotion</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items!.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.business.name}</strong>
                    </td>
                    <td>{p.promotion.name}</td>
                    <td>{fmtMoney(p.amountMinor, p.currency)}</td>
                    <td>{p.paymentMethod.name}</td>
                    <td className="mono">{p.transactionReference || 'N/A'}</td>
                    <td>{fmtDate(p.submittedAt)}</td>
                    <td>
                      <StatusBadge value={p.status} />
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setSelectedId(p.id)}>
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
        <PaymentReviewDrawer paymentId={selectedId} onClose={() => setSelectedId(null)} onChanged={() => void load()} />
      ) : null}
    </>
  );
}

/* ------------------------------- active tab ----------------------------- */

export function ActivePlacementsTab() {
  const [items, setItems] = useState<FeaturedItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listFeatured('active')
      .then((all) => {
        if (!cancelled) setItems(all.filter((i) => i.source === 'paid'));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load active placements.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <p className="hint" style={{ marginBottom: 12 }}>
        Currently live paid promotion placements. Each one went live through payment approval in the Payments tab.
      </p>
      {loading ? (
        <div className="loading">Loading active placements…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Active paid placements ({items!.length})</h2>
          {items!.length === 0 ? (
            <div className="empty">No paid promotions are live right now.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Promotion</th>
                  <th>Placement</th>
                  <th>Started</th>
                  <th>Ends</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items!.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.business.name}</strong>
                      <div className="muted mono">{i.business.slug}</div>
                    </td>
                    <td>
                      <strong>{i.promotion?.name ?? <span className="muted">N/A</span>}</strong>
                      {i.payment ? <div className="muted mono">{fmtMoney(i.payment.amountMinor, i.payment.currency)} paid</div> : null}
                    </td>
                    <td className="mono">{i.placementType}</td>
                    <td>{i.startsAt ? fmtDate(i.startsAt) : <span className="muted">N/A</span>}</td>
                    <td>{i.endsAt ? fmtDate(i.endsAt) : <span className="muted">N/A</span>}</td>
                    <td>
                      <StatusBadge value={i.state.toUpperCase()} />
                      {i.payment ? (
                        <div style={{ marginTop: 4 }}>
                          <StatusBadge value={i.payment.status} />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------ featured tab ---------------------------- */

function SourceBadge(props: { source: 'paid' | 'editorial' }) {
  return props.source === 'paid' ? (
    <span className="badge badge-open">Paid promotion</span>
  ) : (
    <span className="badge badge-info">Editorial pick</span>
  );
}

const FEATURED_STATES: Array<{ value: FeaturedListState; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
];

function FeaturedItemDrawer(props: {
  item: FeaturedItem;
  onClose: () => void;
  onEnded: () => void;
  onExtend: () => void;
  onRemoved: () => void;
}) {
  const i = props.item;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isEditorial = i.source === 'editorial';
  const isLive = i.state === 'active' || i.state === 'scheduled';

  const act = async (fn: () => Promise<unknown>, done: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      done();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const endEarly = () => {
    if (!window.confirm(`End the editorial feature "${i.label}" for ${i.business.name} early? It will stop showing immediately.`)) return;
    void act(() => api.endEditorialFeature(i.id), props.onEnded);
  };

  const remove = () => {
    if (!window.confirm(`Remove the editorial feature "${i.label}" for ${i.business.name} entirely? This cannot be undone.`)) return;
    void act(() => api.deleteEditorialFeature(i.id), props.onRemoved);
  };

  return (
    <Drawer title={isEditorial ? 'Editorial feature' : 'Paid placement'} onClose={props.onClose}>
      {actionError ? (
        <div className="form-error" role="alert">
          {actionError}
        </div>
      ) : null}
      <table className="admin-table">
        <tbody>
          <tr>
            <th style={{ width: 170 }}>Business</th>
            <td>
              <strong>{i.business.name}</strong>
              <div className="muted mono">{i.business.slug}</div>
            </td>
          </tr>
          <tr>
            <th>Source</th>
            <td>
              <SourceBadge source={i.source} />
            </td>
          </tr>
          {isEditorial ? (
            <>
              <tr>
                <th>Placement type</th>
                <td className="mono">{i.placementType}</td>
              </tr>
              <tr>
                <th>Label</th>
                <td>{i.label}</td>
              </tr>
            </>
          ) : (
            <>
              <tr>
                <th>Promotion</th>
                <td>
                  <strong>{i.promotion?.name ?? 'N/A'}</strong>
                  {i.promotion ? <div className="muted mono">{i.promotion.slug}</div> : null}
                </td>
              </tr>
              {i.payment ? (
                <tr>
                  <th>Payment</th>
                  <td>
                    {fmtMoney(i.payment.amountMinor, i.payment.currency)} <StatusBadge value={i.payment.status} />
                  </td>
                </tr>
              ) : null}
            </>
          )}
          <tr>
            <th>Starts</th>
            <td>{i.startsAt ? fmtDate(i.startsAt) : <span className="muted">N/A</span>}</td>
          </tr>
          <tr>
            <th>Ends</th>
            <td>{i.endsAt ? fmtDate(i.endsAt) : <span className="muted">N/A</span>}</td>
          </tr>
          <tr>
            <th>State</th>
            <td>
              <StatusBadge value={i.state.toUpperCase()} />
            </td>
          </tr>
        </tbody>
      </table>
      {isEditorial ? (
        <p className="hint">
          Editorial features are free admin curation and are structurally separate from paid promotions. Creating, extending, or removing
          one can never activate a paid promotion.
        </p>
      ) : (
        <p className="hint">
          This placement went live through payment approval in the Payments tab. Paid placements cannot be started, extended, or ended
          from this screen; they run their server-set term.
        </p>
      )}
      {isEditorial && isLive ? (
        <div className="drawer-actions">
          <button className="btn btn-sm" disabled={busy} onClick={props.onExtend}>
            Extend end date
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={endEarly}>
            End early
          </button>
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={remove}>
            Remove
          </button>
        </div>
      ) : null}
    </Drawer>
  );
}

function ExtendFeatureModal(props: { feature: EditorialFeature; onClose: () => void; onSaved: () => void }) {
  const f = props.feature;
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endAt) {
      setError('Pick a new end date.');
      return;
    }
    const next = new Date(endAt);
    if (Number.isNaN(next.getTime()) || next <= new Date(f.endsAt)) {
      setError('The new end date must be later than the current end date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateEditorialFeature(f.id, { endAt: next.toISOString() });
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not extend the feature.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Extend feature: ${f.label}`} onClose={props.onClose}>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="hint" style={{ marginTop: 0 }}>
        Current end date: {fmtDate(f.endsAt)}. The extension is extend-only: the new end date must be later than the current one. Only the
        end date can change; paid promotions are never affected.
      </p>
      <form onSubmit={(e) => void save(e)}>
        <label className="field">
          <span className="label">New end date and time</span>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Extend feature'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewEditorialFeatureModal(props: { onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; slug: string }> | null>(null);
  const [searching, setSearching] = useState(false);
  const [businessId, setBusinessId] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [placementType, setPlacementType] = useState('');
  const [label, setLabel] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const term = q.trim();
    if (term.length < 2) {
      setError('Type at least 2 characters to search businesses.');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const list = await api.listBusinesses({ q: term });
      setResults(list.map((b) => ({ id: b.id, name: b.name, slug: b.slug })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Business search failed.');
    } finally {
      setSearching(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) {
      setError('Search for and select a business first.');
      return;
    }
    const pt = placementType.trim();
    if (pt.length < 2) {
      setError('Enter a placement type, e.g. homepage_hero.');
      return;
    }
    if (!endAt) {
      setError('Pick an end date for the feature.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createEditorialFeature({
        businessId,
        placementType: pt,
        label: label.trim() || undefined,
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        endAt: new Date(endAt).toISOString(),
      });
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the feature.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New editorial feature" onClose={props.onClose} wide>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="hint" style={{ marginTop: 0 }}>
        Editorial features are free admin curation and are structurally separate from paid promotions. Creating one can never activate a
        paid promotion. Paid promotions go live only when a payment is approved in the Payments tab.
      </p>
      <form onSubmit={(e) => void save(e)}>
        <div className="field">
          <span className="label">Business</span>
          {businessId ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong>{businessName}</strong>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setBusinessId('');
                  setBusinessName('');
                  setResults(null);
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by business name"
                  aria-label="Search businesses"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void search();
                    }
                  }}
                />
                <button type="button" className="btn" disabled={searching} onClick={() => void search()}>
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>
              {results ? (
                results.length === 0 ? (
                  <div className="empty">No businesses match this search.</div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
                    {results.slice(0, 8).map((b) => (
                      <li key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span>
                          <strong>{b.name}</strong> <span className="muted mono">{b.slug}</span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ marginLeft: 'auto' }}
                          onClick={() => {
                            setBusinessId(b.id);
                            setBusinessName(b.name);
                          }}
                        >
                          Select
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Placement type</span>
            <input value={placementType} onChange={(e) => setPlacementType(e.target.value)} required maxLength={60} placeholder="homepage_hero" />
          </label>
          <label className="field">
            <span className="label">Label (optional, defaults to the placement type)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Homepage hero" />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="label">Start (optional, defaults to now)</span>
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">End (required)</span>
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy}>
            {busy ? 'Creating…' : 'Create editorial feature'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function FeaturedTab() {
  const [state, setState] = useState<FeaturedListState>('active');
  const [items, setItems] = useState<FeaturedItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeaturedItem | null>(null);
  const [extending, setExtending] = useState<EditorialFeature | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listFeatured(state));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the featured list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const endEarly = async (i: FeaturedItem) => {
    if (i.source !== 'editorial') return;
    if (!window.confirm(`End the editorial feature "${i.label}" for ${i.business.name} early? It will stop showing immediately.`)) return;
    setBusyId(i.id);
    setActionError(null);
    try {
      await api.endEditorialFeature(i.id);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (i: FeaturedItem) => {
    if (i.source !== 'editorial') return;
    if (!window.confirm(`Remove the editorial feature "${i.label}" for ${i.business.name} entirely? This cannot be undone.`)) return;
    setBusyId(i.id);
    setActionError(null);
    try {
      await api.deleteEditorialFeature(i.id);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const openExtend = async (i: FeaturedItem) => {
    if (i.source !== 'editorial') return;
    setBusyId(i.id);
    setActionError(null);
    try {
      // Reuse the featured list dates; the extend modal only needs the
      // current end date, which the unified list already carries.
      setExtending({
        id: i.id,
        placementType: i.placementType,
        label: i.label,
        startsAt: i.startsAt ?? new Date().toISOString(),
        endsAt: i.endsAt ?? new Date().toISOString(),
        state: i.state,
        createdAt: i.startsAt ?? new Date().toISOString(),
        business: i.business,
        createdBy: { id: '', email: '' },
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <p className="hint" style={{ marginBottom: 12 }}>
        The unified featured list. <strong>Paid promotion</strong> badges mark placements that were activated through payment approval;
        <strong> Editorial pick</strong> badges mark free admin curation. Nothing on this screen can activate a paid promotion.
      </p>
      <div className="toolbar">
        <select className="admin-select" value={state} onChange={(e) => setState(e.target.value as FeaturedListState)} aria-label="Filter featured items by state">
          {FEATURED_STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setCreating(true)}>
          New editorial feature
        </button>
      </div>
      {actionError ? (
        <div className="form-error" role="alert">
          {actionError}
        </div>
      ) : null}
      {loading ? (
        <div className="loading">Loading featured businesses…</div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : (
        <div className="panel">
          <h2>Featured businesses ({items!.length})</h2>
          {items!.length === 0 ? (
            <div className="empty">Nothing featured with this filter.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Source</th>
                  <th>Placement</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>State</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items!.map((i) => {
                  const isEditorial = i.source === 'editorial';
                  const isLive = i.state === 'active' || i.state === 'scheduled';
                  return (
                    <tr key={`${i.source}-${i.id}`}>
                      <td>
                        <strong>{i.business.name}</strong>
                        <div className="muted mono">{i.business.slug}</div>
                      </td>
                      <td>
                        <SourceBadge source={i.source} />
                      </td>
                      <td>
                        {isEditorial ? (
                          <>
                            <strong>{i.label}</strong>
                            <div className="muted mono">{i.placementType}</div>
                          </>
                        ) : (
                          <>
                            <strong>{i.promotion?.name ?? 'N/A'}</strong>
                            {i.payment ? <div className="muted mono">{fmtMoney(i.payment.amountMinor, i.payment.currency)} paid</div> : null}
                          </>
                        )}
                      </td>
                      <td>{i.startsAt ? fmtDate(i.startsAt) : <span className="muted">N/A</span>}</td>
                      <td>{i.endsAt ? fmtDate(i.endsAt) : <span className="muted">N/A</span>}</td>
                      <td>
                        <StatusBadge value={i.state.toUpperCase()} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setSelected(i)}>
                          View
                        </button>
                        {isEditorial && isLive ? (
                          <>
                            {' '}
                            <button className="btn btn-ghost btn-sm" disabled={busyId === i.id} onClick={() => void openExtend(i)}>
                              Extend
                            </button>{' '}
                            <button className="btn btn-ghost btn-sm" disabled={busyId === i.id} onClick={() => void endEarly(i)}>
                              End early
                            </button>{' '}
                            <button className="btn btn-ghost btn-sm" disabled={busyId === i.id} onClick={() => void remove(i)}>
                              Remove
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {selected ? (
        <FeaturedItemDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onEnded={() => {
            setSelected(null);
            void load();
          }}
          onExtend={() => {
            setSelected(null);
            void openExtend(selected);
          }}
          onRemoved={() => {
            setSelected(null);
            void load();
          }}
        />
      ) : null}
      {extending ? <ExtendFeatureModal feature={extending} onClose={() => setExtending(null)} onSaved={() => void load()} /> : null}
      {creating ? <NewEditorialFeatureModal onClose={() => setCreating(false)} onSaved={() => void load()} /> : null}
    </>
  );
}

/* ---------------------------- center (5 tabs) --------------------------- */

const TABS = [
  { key: 'catalog', label: 'Catalog' },
  { key: 'requests', label: 'Requests queue' },
  { key: 'payments', label: 'Payments' },
  { key: 'active', label: 'Active' },
  { key: 'featured', label: 'Featured' },
] as const;

type CenterTab = (typeof TABS)[number]['key'];

export function PromotionCenter() {
  const [tab, setTab] = useState<CenterTab>('catalog');
  return (
    <>
      <div className="toolbar" role="tablist" aria-label="Promotions views">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`btn ${tab === t.key ? '' : 'btn-ghost'}`}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'catalog' ? <PromotionCatalog /> : null}
      {tab === 'requests' ? <PromotionRequestQueue /> : null}
      {tab === 'payments' ? <PromotionPaymentsTab /> : null}
      {tab === 'active' ? <ActivePlacementsTab /> : null}
      {tab === 'featured' ? <FeaturedTab /> : null}
    </>
  );
}
