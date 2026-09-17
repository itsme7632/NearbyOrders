import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import * as api from './api.js';
import type { AdminBusiness, AdminUser } from './api.js';

type Section =
  | 'dashboard'
  | 'users'
  | 'businesses'
  | 'orders'
  | 'bookings'
  | 'reviews'
  | 'categories'
  | 'subscriptions'
  | 'payments'
  | 'audit';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'users', label: 'Users' },
  { key: 'businesses', label: 'Businesses' },
  { key: 'orders', label: 'Orders' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'categories', label: 'Categories' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'payments', label: 'Payment requests' },
  { key: 'audit', label: 'Audit log' },
];

const fmtMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

const StatusBadge = (props: { value: string }) => {
  const v = props.value;
  const cls =
    v === 'APPROVED' || v === 'ACTIVE' || v === 'COMPLETED' || v === 'PAID' || v === 'APPROVED_PAY'
      ? 'badge-open'
      : v === 'PENDING' || v === 'PENDING_VERIFICATION' || v === 'TRIAL'
        ? 'badge-warn'
        : v === 'SUSPENDED' || v === 'REJECTED' || v === 'CANCELLED' || v === 'FAILED' || v === 'EXPIRED'
          ? 'badge-closed'
          : 'badge-info';
  return <span className={`badge ${cls}`}>{v.replace(/_/g, ' ')}</span>;
};

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e: unknown) => alive && setState({ data: null, loading: false, error: e instanceof Error ? e.message : 'Something went wrong.' }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/* --------------------------------- auth --------------------------------- */

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>NearbyOrders Admin</h1>
        <p className="sub">Platform administration. Administrator accounts only.</p>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <label className="field">
          <span className="label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button className="btn" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------- dashboard ------------------------------ */

function Dashboard() {
  const stats = useAsync(() => api.getDashboard(), []);
  if (stats.loading) return <div className="loading">Loading platform metrics…</div>;
  if (stats.error) return <div className="form-error">{stats.error}</div>;
  const d = stats.data!;
  const cards: { label: string; value: number | string }[] = [
    { label: 'Users', value: d.users },
    { label: 'Customers', value: d.customers },
    { label: 'Business owners', value: d.businessOwners },
    { label: 'Businesses', value: d.businesses },
    { label: 'Active businesses', value: d.activeBusinesses },
    { label: 'Pending businesses', value: d.pendingBusinesses },
    { label: 'Suspended', value: d.suspendedBusinesses },
    { label: 'Orders', value: d.orders },
    { label: 'Pending orders', value: d.pendingOrders },
    { label: 'Bookings', value: d.bookings },
    { label: 'Pending bookings', value: d.pendingBookings },
    { label: 'Payment requests', value: d.pendingSubscriptionPayments },
    { label: 'Reviews', value: d.reviews },
    { label: 'Hidden reviews', value: d.hiddenReviews },
    { label: 'Push devices', value: d.pushDevices.total },
    { label: 'Active push devices', value: d.pushDevices.active },
  ];
  return (
    <>
      <div className="stat-grid">
        {cards.map((c) => (
          <div key={c.label} className="stat-card">
            <span className="stat-num">{c.value}</span>
            <span className="stat-label">{c.label}</span>
          </div>
        ))}
      </div>
      <div className="panel">
        <h2>Push fleet by platform</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Android</th>
              <th>iOS</th>
              <th>Web</th>
              <th>Total</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{d.pushDevices.android}</td>
              <td>{d.pushDevices.ios}</td>
              <td>{d.pushDevices.web}</td>
              <td>{d.pushDevices.total}</td>
              <td>{d.pushDevices.active}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/* --------------------------------- users -------------------------------- */

function Users() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const users = useAsync(() => api.listUsers(query), [query]);
  const [detail, setDetail] = useState<AdminUser | null>(null);

  const toggleSuspend = async (u: AdminUser) => {
    await api.setUserSuspended(u.id, !u.isSuspended);
    users.reload();
    if (detail?.id === u.id) setDetail(await api.getUser(u.id));
  };

  return (
    <>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <input className="admin-input" placeholder="Search email or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        <button className="btn">Search</button>
      </form>
      {users.loading ? (
        <div className="loading">Loading users…</div>
      ) : users.error ? (
        <div className="form-error">{users.error}</div>
      ) : (
        <div className="panel">
          <h2>Users ({users.data!.length})</h2>
          {users.data!.length === 0 ? (
            <div className="empty">No users match this search.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.data!.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{[u.firstName, u.lastName].filter(Boolean).join(' ') || <span className="muted">—</span>}</td>
                    <td>{u.role.replace(/_/g, ' ')}</td>
                    <td>{u.isSuspended ? <span className="badge badge-closed">Suspended</span> : <span className="badge badge-open">Active</span>}</td>
                    <td>{fmtDate(u.createdAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => void api.getUser(u.id).then(setDetail)}>
                        View
                      </button>{' '}
                      {u.role !== 'ADMIN' ? (
                        <button className={`btn btn-sm ${u.isSuspended ? '' : 'btn-danger'}`} onClick={() => void toggleSuspend(u)}>
                          {u.isSuspended ? 'Reinstate' : 'Suspend'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {detail ? (
        <div className="panel">
          <h2>
            {detail.email} {detail.isSuspended ? <span className="badge badge-closed">Suspended</span> : null}
          </h2>
          <table className="admin-table">
            <tbody>
              <tr>
                <th>Role</th>
                <td>{detail.role.replace(/_/g, ' ')}</td>
              </tr>
              <tr>
                <th>Phone</th>
                <td>{detail.phone ?? <span className="muted">Not provided</span>}</td>
              </tr>
              <tr>
                <th>Businesses</th>
                <td>{detail.counts?.businesses ?? 0}</td>
              </tr>
              <tr>
                <th>Bookings placed</th>
                <td>{detail.counts?.bookings ?? 0}</td>
              </tr>
              <tr>
                <th>Orders placed</th>
                <td>{detail.counts?.orders ?? 0}</td>
              </tr>
              <tr>
                <th>Reviews written</th>
                <td>{detail.counts?.reviews ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------ businesses ------------------------------ */

function Businesses() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const businesses = useAsync(() => api.listBusinesses({ status: status || undefined, q: query || undefined }), [status, query]);

  const change = async (b: AdminBusiness, next: AdminBusiness['status']) => {
    await api.setBusinessStatus(b.id, next);
    businesses.reload();
  };
  const toggleVerify = async (b: AdminBusiness) => {
    await api.setBusinessVerified(b.id, !b.isVerified);
    businesses.reload();
  };

  return (
    <>
      <div className="toolbar">
        <input
          className="admin-input"
          placeholder="Search name or city"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search businesses"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQuery(q.trim());
          }}
        />
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ARCHIVED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setQuery(q.trim())}>
          Search
        </button>
      </div>
      {businesses.loading ? (
        <div className="loading">Loading businesses…</div>
      ) : businesses.error ? (
        <div className="form-error">{businesses.error}</div>
      ) : (
        <div className="panel">
          <h2>Businesses ({businesses.data!.length})</h2>
          {businesses.data!.length === 0 ? (
            <div className="empty">No businesses match these filters.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Owner</th>
                  <th>City</th>
                  <th>Status</th>
                  <th>Verified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {businesses.data!.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.name}</strong>
                      <div className="muted mono">{b.slug}</div>
                    </td>
                    <td>
                      {b.owner.email}
                      <div className="muted">{[b.owner.firstName, b.owner.lastName].filter(Boolean).join(' ')}</div>
                    </td>
                    <td>{b.city}</td>
                    <td>
                      <StatusBadge value={b.status} />
                    </td>
                    <td>{b.isVerified ? <span className="badge badge-info">✓ Verified</span> : <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {b.status !== 'APPROVED' ? (
                        <button className="btn btn-sm" onClick={() => void change(b, 'APPROVED')}>
                          Approve
                        </button>
                      ) : null}{' '}
                      {b.status !== 'SUSPENDED' && b.status !== 'ARCHIVED' ? (
                        <button className="btn btn-danger btn-sm" onClick={() => void change(b, 'SUSPENDED')}>
                          Suspend
                        </button>
                      ) : null}{' '}
                      {b.status !== 'REJECTED' ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => void change(b, 'REJECTED')}>
                          Reject
                        </button>
                      ) : null}{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => void toggleVerify(b)}>
                        {b.isVerified ? 'Unverify' : 'Verify'}
                      </button>
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

/* ---------------------------- orders / bookings -------------------------- */

function Orders() {
  const [status, setStatus] = useState('');
  const orders = useAsync(() => api.listOrders(status), [status]);
  return (
    <>
      <div className="toolbar">
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter orders by status">
          <option value="">All statuses</option>
          {['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {orders.loading ? (
        <div className="loading">Loading orders…</div>
      ) : orders.error ? (
        <div className="form-error">{orders.error}</div>
      ) : (
        <div className="panel">
          <h2>Orders ({orders.data!.length})</h2>
          {orders.data!.length === 0 ? (
            <div className="empty">No orders match this filter.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Placed</th>
                  <th>Business</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.data!.map((o) => (
                  <tr key={o.id}>
                    <td>{fmtDate(o.createdAt)}</td>
                    <td>{o.business.name}</td>
                    <td>{o.customer?.email}</td>
                    <td>{fmtMoney(o.totalMinor ?? o.subtotalMinor, o.currency)}</td>
                    <td>
                      <StatusBadge value={o.status} />
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

function Bookings() {
  const [status, setStatus] = useState('');
  const bookings = useAsync(() => api.listBookings(status), [status]);
  return (
    <>
      <div className="toolbar">
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter bookings by status">
          <option value="">All statuses</option>
          {['PENDING', 'CONFIRMED', 'COMPLETED', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {bookings.loading ? (
        <div className="loading">Loading bookings…</div>
      ) : bookings.error ? (
        <div className="form-error">{bookings.error}</div>
      ) : (
        <div className="panel">
          <h2>Bookings ({bookings.data!.length})</h2>
          {bookings.data!.length === 0 ? (
            <div className="empty">No bookings match this filter.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Business</th>
                  <th>Service</th>
                  <th>Customer</th>
                  <th>When</th>
                  <th>Amount due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.data!.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDate(b.createdAt)}</td>
                    <td>{b.business.name}</td>
                    <td>{b.service?.name ?? <span className="muted">—</span>}</td>
                    <td>{b.customer?.email}</td>
                    <td>{fmtDate(b.startAt)}</td>
                    <td>{b.amountDueMinor === null ? '—' : fmtMoney(b.amountDueMinor, b.currency)}</td>
                    <td>
                      <StatusBadge value={b.status} />
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

/* -------------------------------- reviews ------------------------------- */

function Reviews() {
  const [status, setStatus] = useState<'' | 'visible' | 'hidden'>('');
  const reviews = useAsync(() => api.listReviews(status), [status]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggle = async (r: api.AdminReview) => {
    setBusyId(r.id);
    setActionError(null);
    try {
      await api.setReviewVisibility(r.id, !r.isHidden);
      reviews.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="toolbar">
        <select
          className="admin-select"
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | 'visible' | 'hidden')}
          aria-label="Filter reviews by visibility"
        >
          <option value="">All reviews</option>
          <option value="visible">Visible only</option>
          <option value="hidden">Hidden only</option>
        </select>
      </div>
      {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
      {reviews.loading ? (
        <div className="loading">Loading reviews…</div>
      ) : reviews.error ? (
        <div className="form-error">{reviews.error}</div>
      ) : (
        <div className="panel">
          <h2>Reviews ({reviews.data!.length})</h2>
          {reviews.data!.length === 0 ? (
            <div className="empty">No reviews match this filter.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Business</th>
                  <th>Customer</th>
                  <th>Rating</th>
                  <th>Comment</th>
                  <th>Visibility</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.data!.map((r) => (
                  <tr key={r.id} className={r.isHidden ? 'row-hidden' : undefined}>
                    <td>{fmtDate(r.createdAt)}</td>
                    <td>{r.business.name}</td>
                    <td>{r.customer?.email}</td>
                    <td>{'★'.repeat(r.rating)}</td>
                    <td className="review-comment">{r.comment ?? <span className="muted">No comment</span>}</td>
                    <td>{r.isHidden ? <span className="badge badge-closed">Hidden</span> : <span className="badge badge-open">Public</span>}</td>
                    <td>
                      <button className={`btn btn-sm ${r.isHidden ? '' : 'btn-danger'}`} disabled={busyId === r.id} onClick={() => void toggle(r)}>
                        {busyId === r.id ? 'Working…' : r.isHidden ? 'Restore' : 'Hide'}
                      </button>
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

/* ------------------------------ categories ------------------------------ */

function Categories() {
  const categories = useAsync(() => api.listCategories(), []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCategory(name.trim());
      setName('');
      categories.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the category.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: api.AdminCategory) => {
    setBusy(true);
    setError(null);
    try {
      await api.setCategoryActive(c.id, !c.isActive);
      categories.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form
        className="toolbar"
        onSubmit={(e) => void create(e)}
      >
        <input
          className="admin-input"
          placeholder="New category name (e.g. Home Services)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New category name"
          minLength={2}
          maxLength={60}
          required
        />
        <button className="btn" disabled={busy || name.trim().length < 2}>
          Add category
        </button>
      </form>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {categories.loading ? (
        <div className="loading">Loading categories…</div>
      ) : categories.error ? (
        <div className="form-error">{categories.error}</div>
      ) : (
        <div className="panel">
          <h2>Categories ({categories.data!.length})</h2>
          {categories.data!.length === 0 ? (
            <div className="empty">No categories yet.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Businesses</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.data!.map((c) => (
                  <tr key={c.id} className={c.isActive ? undefined : 'row-hidden'}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td className="mono">{c.slug}</td>
                    <td>{c.businessCount}</td>
                    <td>{c.isActive ? <span className="badge badge-open">Active</span> : <span className="badge badge-closed">Inactive</span>}</td>
                    <td>
                      <button className={`btn btn-sm ${c.isActive ? 'btn-danger' : ''}`} disabled={busy} onClick={() => void toggle(c)}>
                        {c.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Inactive categories disappear from customer discovery; existing businesses keep their links.</p>
        </div>
      )}
    </>
  );
}

/* ----------------------------- subscriptions ---------------------------- */

function Subscriptions() {
  const [status, setStatus] = useState('');
  const subs = useAsync(() => api.listSubscriptions(status), [status]);
  return (
    <>
      <div className="toolbar">
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter subscriptions by status">
          <option value="">All statuses</option>
          {['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {subs.loading ? (
        <div className="loading">Loading subscriptions…</div>
      ) : subs.error ? (
        <div className="form-error">{subs.error}</div>
      ) : (
        <div className="panel">
          <h2>Subscriptions ({subs.data!.length})</h2>
          {subs.data!.length === 0 ? (
            <div className="empty">No subscriptions match this filter.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Renews / ended</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {subs.data!.map((s) => (
                  <tr key={s.id}>
                    <td>{s.business.name}</td>
                    <td>{s.plan?.name ?? <span className="muted">—</span>}</td>
                    <td>{s.plan ? fmtMoney(s.plan.monthlyPriceMinor, s.plan.currency) : '—'}</td>
                    <td>{fmtDate(s.currentPeriodEndAt)}</td>
                    <td>
                      <StatusBadge value={s.status} />
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

/* --------------------------- payment requests --------------------------- */

function PaymentRequests() {
  const [status, setStatus] = useState('PENDING');
  const reqs = useAsync(() => api.listPaymentRequests(status), [status]);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ url: string; error: string | null } | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const openReceipt = async (storageKey: string) => {
    setReceiptLoading(true);
    setReceipt(null);
    try {
      const url = await api.fetchReceiptObjectUrl(storageKey);
      setReceipt({ url, error: null });
    } catch (e) {
      setReceipt({ url: '', error: e instanceof Error ? e.message : 'Could not load the receipt.' });
    } finally {
      setReceiptLoading(false);
    }
  };

  const closeReceipt = () => {
    if (receipt?.url) URL.revokeObjectURL(receipt.url);
    setReceipt(null);
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setReasonFor(null);
      setReason('');
      reqs.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter payment requests by status">
          {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {reqs.loading ? (
        <div className="loading">Loading payment requests…</div>
      ) : reqs.error ? (
        <div className="form-error">{reqs.error}</div>
      ) : (
        <div className="panel">
          <h2>Manual subscription payments ({reqs.data!.length})</h2>
          {reqs.data!.length === 0 ? (
            <div className="empty">No payment requests with this status.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Business</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Receipt</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reqs.data!.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.createdAt)}</td>
                    <td>{p.business.name}</td>
                    <td>{fmtMoney(p.amountMinor, p.currency)}</td>
                    <td className="mono">{p.transactionReference ?? '—'}</td>
                    <td>
                      {p.receiptStorageKey ? (
                        <button className="btn btn-ghost btn-sm" disabled={receiptLoading} onClick={() => void openReceipt(p.receiptStorageKey!)}>
                          View
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {p.status === 'PENDING' ? (
                        reasonFor === p.id ? (
                          <div style={{ minWidth: 220 }}>
                            <input
                              className="admin-input"
                              style={{ minWidth: 0, width: '100%', marginBottom: 6 }}
                              placeholder="Reason (required)"
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
                            <button className="btn btn-sm" disabled={busy} onClick={() => void act(() => api.approvePaymentRequest(p.id))}>
                              Approve
                            </button>{' '}
                            <button className="btn btn-ghost btn-sm" onClick={() => setReasonFor(p.id)}>
                              Reject
                            </button>
                          </>
                        )
                      ) : (
                        <StatusBadge value={p.status} />
                      )}
                      {p.status === 'REJECTED' && p.rejectionReason ? <div className="reason-box">{p.rejectionReason}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <ReceiptModal open={receipt !== null} url={receipt?.url ?? ''} error={receipt?.error ?? null} onClose={closeReceipt} />
    </>
  );
}

/* ------------------------------ receipt viewer --------------------------- */

function ReceiptModal(props: { open: boolean; url: string; error: string | null; onClose: () => void }) {
  if (!props.open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Payment receipt" onClick={props.onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Payment receipt</h2>
          <button className="btn btn-ghost btn-sm" onClick={props.onClose}>
            Close
          </button>
        </div>
        {props.error ? <div className="form-error">{props.error}</div> : null}
        {props.url ? <img className="receipt-img" src={props.url} alt="Uploaded payment receipt" /> : null}
      </div>
    </div>
  );
}

/* ------------------------------- audit log ------------------------------ */

function AuditLog() {
  const entries = useAsync(() => api.listAuditLog(''), []);
  if (entries.loading) return <div className="loading">Loading audit log…</div>;
  if (entries.error) return <div className="form-error">{entries.error}</div>;
  return (
    <div className="panel">
      <h2>Recent admin activity ({entries.data!.length})</h2>
      {entries.data!.length === 0 ? (
        <div className="empty">No audit entries yet.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {entries.data!.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString('en-PK')}</td>
                <td>{e.actor?.email ?? 'system'}</td>
                <td>
                  <span className="badge badge-info">{e.action}</span>
                </td>
                <td className="mono">
                  {e.entityType}/{e.entityId.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* --------------------------------- shell -------------------------------- */

function AdminApp() {
  const [session, setSessionState] = useState<api.Session | null>(api.getSession());
  const [section, setSection] = useState<Section>('dashboard');

  useEffect(() => {
    // Keep in sync with logout triggered by a 401 inside the API client.
    const timer = window.setInterval(() => setSessionState(api.getSession()), 1500);
    return () => window.clearInterval(timer);
  }, []);

  if (!session) return <LoginScreen />;

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <p className="admin-logo">NearbyOrders</p>
        <p className="admin-side-sub">Admin panel</p>
        <nav aria-label="Admin sections">
          {SECTIONS.map((s) => (
            <button key={s.key} className={`admin-nav-item${section === s.key ? ' active' : ''}`} onClick={() => setSection(s.key)}>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="admin-main">
        <div className="admin-head">
          <h1>{SECTIONS.find((s) => s.key === section)!.label}</h1>
          <div className="admin-who">
            <span>{session.user.email}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                api.logout();
                setSessionState(null);
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        {section === 'dashboard' ? <Dashboard /> : null}
        {section === 'users' ? <Users /> : null}
        {section === 'businesses' ? <Businesses /> : null}
        {section === 'orders' ? <Orders /> : null}
        {section === 'bookings' ? <Bookings /> : null}
        {section === 'reviews' ? <Reviews /> : null}
        {section === 'categories' ? <Categories /> : null}
        {section === 'subscriptions' ? <Subscriptions /> : null}
        {section === 'payments' ? <PaymentRequests /> : null}
        {section === 'audit' ? <AuditLog /> : null}
      </main>
    </div>
  );
}

const mount = document.getElementById('root');
if (mount) createRoot(mount).render(<AdminApp />);
