import React from 'react';
import * as api from './api.js';
import type {
  AdminBusiness,
  AdminCategory,
  AdminReview,
  AdminUser,
} from './api.js';
import {
  Avatar,
  Badge,
  ConfirmDialog,
  Consequence,
  DataTable,
  DefinitionList,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FilterSelect,
  FormActions,
  FormError,
  LoadingState,
  Modal,
  PageHeader,
  SearchInput,
  SectionTitle,
  Skeleton,
  Tabs,
  Toolbar,
  statusLabel,
  useAsync,
  fmtDate,
  fmtDateTime,
} from './ds.js';
import type { Column } from './ds.js';

/* ------------------------------------------------------------------
   Marketplace screens: Users, Businesses, Categories, Reviews.
   All data comes from the shared api.* client; no fabricated data.
------------------------------------------------------------------- */

function fullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ');
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

const muted: React.CSSProperties = { color: 'var(--muted)' };

/* ================================ Users ================================ */

function UserDrawer(props: {
  user: AdminUser;
  onClose: () => void;
  onChanged: (updated: AdminUser) => void;
}) {
  const { user } = props;
  const [confirmSuspend, setConfirmSuspend] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const name = fullName(user.firstName, user.lastName) || 'N/A';
  const counts = user.counts;

  const runSuspension = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.setUserSuspended(user.id, !user.isSuspended);
      setConfirmSuspend(false);
      props.onChanged(updated);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={name}
      subtitle={user.email}
      meta={`User · ${user.id.slice(0, 8)}`}
      status={<Badge value={user.isSuspended ? 'SUSPENDED' : 'ACTIVE'} />}
      onClose={props.onClose}
      actions={
        user.role !== 'ADMIN' ? (
          user.isSuspended ? (
            <button type="button" className="nb-btn nb-btn-secondary" disabled={busy} onClick={runSuspension}>
              {busy ? 'Working…' : 'Reinstate account'}
            </button>
          ) : (
            <button type="button" className="nb-btn nb-btn-danger" disabled={busy} onClick={() => setConfirmSuspend(true)}>
              Suspend account
            </button>
          )
        ) : undefined
      }
    >
      <SectionTitle>Identity</SectionTitle>
      <DefinitionList
        items={[
          { label: 'Name', value: name },
          { label: 'Email', value: user.email },
          { label: 'Phone', value: user.phone ?? 'Not provided' },
          { label: 'Role', value: statusLabel(user.role) },
          { label: 'Joined', value: fmtDateTime(user.createdAt) },
        ]}
      />
      <SectionTitle>Activity</SectionTitle>
      <DefinitionList
        items={[
          { label: 'Businesses', value: counts?.businesses ?? 0 },
          { label: 'Bookings placed', value: counts?.bookings ?? 0 },
          { label: 'Orders placed', value: counts?.orders ?? 0 },
          { label: 'Reviews written', value: counts?.reviews ?? 0 },
        ]}
      />
      {error ? <FormError message={error} /> : null}
      {user.role !== 'ADMIN' && !user.isSuspended ? (
        <Consequence>
          <strong>Suspending this account</strong> blocks sign-in immediately. The owner keeps
          read access to past records but cannot operate the business until reinstated.
        </Consequence>
      ) : null}
      {confirmSuspend ? (
        <ConfirmDialog
          title="Suspend account"
          body={`Suspend ${user.email}? They will not be able to sign in until reinstated.`}
          confirmLabel="Suspend account"
          danger
          busy={busy}
          onConfirm={runSuspension}
          onCancel={() => setConfirmSuspend(false)}
        />
      ) : null}
    </Drawer>
  );
}

export function Users() {
  const [q, setQ] = React.useState('');
  const users = useAsync(() => api.listUsers(q), [q]);
  const [selected, setSelected] = React.useState<AdminUser | null>(null);

  const onChanged = (updated: AdminUser) => {
    setSelected(updated);
    users.reload();
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'user',
      header: 'User',
      label: 'User',
      render: (u) => {
        const name = fullName(u.firstName, u.lastName) || 'N/A';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={fullName(u.firstName, u.lastName) || u.email} />
            <span>
              <span style={{ display: 'block', fontWeight: 600 }}>{name}</span>
              <span className="nb-mono" style={muted}>
                {u.email}
              </span>
            </span>
          </span>
        );
      },
    },
    {
      key: 'role',
      header: 'Role',
      label: 'Role',
      render: (u) => <Badge value={u.role} />,
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      render: (u) => <Badge value={u.isSuspended ? 'SUSPENDED' : 'ACTIVE'} />,
    },
    {
      key: 'joined',
      header: 'Joined',
      label: 'Joined',
      render: (u) => fmtDate(u.createdAt),
    },
  ];

  return (
    <div>
      <PageHeader
        kicker="System"
        title="Users"
        subtitle={
          users.data
            ? `${users.data.length} ${users.data.length === 1 ? 'account' : 'accounts'}`
            : 'Search accounts by email or name.'
        }
      />
      <Toolbar>
        <form
          onSubmit={(e) => e.preventDefault()}
          style={{ display: 'contents' }}
        >
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search email or name"
            label="Search users"
          />
        </form>
        <span className="nb-toolbar-end">
          <span className="nb-result-count" aria-live="polite">
            {users.loading ? 'Loading…' : `${users.data?.length ?? 0} results`}
          </span>
        </span>
      </Toolbar>
      {users.loading ? (
        <Skeleton rows={6} />
      ) : users.error ? (
        <ErrorState message={users.error} onRetry={users.reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={users.data ?? []}
          rowKey={(u) => u.id}
          onRowClick={setSelected}
          empty={
            <EmptyState
              title="No users found"
              body={
                q
                  ? 'No users match this search.'
                  : 'There are no users on the platform yet.'
              }
              action={
                q ? (
                  <button
                    type="button"
                    className="nb-btn nb-btn-secondary"
                    onClick={() => setQ('')}
                  >
                    Clear search
                  </button>
                ) : undefined
              }
            />
          }
        />
      )}
      {selected ? (
        <UserDrawer
          user={selected}
          onClose={() => setSelected(null)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

/* ============================== Businesses ============================= */

const APPROVAL_OPTIONS = [
  { value: '', label: 'All approval statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const VERIFICATION_OPTIONS = [
  { value: '', label: 'All verification statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { value: 'DRAFT', label: 'Draft' },
];

function verificationBadge(b: AdminBusiness): React.ReactNode {
  if (b.verificationStatus) return <Badge value={b.verificationStatus} />;
  if (b.isVerified) return <Badge value="VERIFIED" tone="info" />;
  return <span style={muted}>None</span>;
}

/** Defensive: trial/subscription status values are not enumerated in admin code. */
function subscriptionBadge(b: AdminBusiness): React.ReactNode {
  const value = b.subscriptionStatus ?? b.trialStatus;
  if (!value) return <span style={muted}>None</span>;
  return <Badge value={value} />;
}

function BusinessDrawer(props: {
  business: AdminBusiness;
  onClose: () => void;
  onUpdated: (b: AdminBusiness) => void;
  onVerificationDecided: () => void;
  onOpenPayments: (businessId: string) => void;
}) {
  const { business: b } = props;
  const [confirm, setConfirm] = React.useState<'suspend' | 'reject' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reviewerMessage, setReviewerMessage] = React.useState('');
  const [adminNotes, setAdminNotes] = React.useState('');
  const [decisionError, setDecisionError] = React.useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = React.useState<string | null>(null);

  const ownerName = fullName(b.owner.firstName, b.owner.lastName) || 'N/A';
  // Canonical categories from the BusinessCategory join; a business may have several.
  const categoryNames = b.categories.map((c) => c.name).join(', ') || 'No category';

  const runStatus = async (status: AdminBusiness['status']) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.setBusinessStatus(b.id, status);
      setConfirm(null);
      props.onUpdated(updated);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runVerifyToggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setBusinessVerified(b.id, !b.isVerified);
      props.onUpdated({ ...b, isVerified: res.isVerified });
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const needsMessage = (kind: 'approve' | 'changes' | 'reject') => kind !== 'approve';

  const runDecision = async (kind: 'approve' | 'changes' | 'reject') => {
    if (!b.verificationApplicationId) return;
    const msg = reviewerMessage.trim();
    if (needsMessage(kind) && msg.length < 4) {
      setDecisionError(
        'A reviewer message is required so the business owner knows what to fix.',
      );
      return;
    }
    setDecisionBusy(kind);
    setDecisionError(null);
    try {
      if (kind === 'approve') {
        await api.approveVerification(b.verificationApplicationId, {
          reviewerMessage: msg || undefined,
          adminNotes: adminNotes.trim() || undefined,
        });
      } else if (kind === 'changes') {
        await api.requestVerificationChanges(b.verificationApplicationId, {
          reviewerMessage: msg,
          adminNotes: adminNotes.trim() || undefined,
        });
      } else {
        await api.rejectVerification(b.verificationApplicationId, {
          reviewerMessage: msg,
          adminNotes: adminNotes.trim() || undefined,
        });
      }
      props.onVerificationDecided();
    } catch (e) {
      setDecisionError(errMessage(e));
    } finally {
      setDecisionBusy(null);
    }
  };

  /* Pinned decision actions: the verification decision is primary when an
     application is pending, otherwise the business status decision. The
     non-primary set stays reachable inside the panel body. */
  const verificationActions = (
    <>
      <button
        type="button"
        className="nb-btn"
        disabled={decisionBusy !== null}
        onClick={() => runDecision('approve')}
      >
        {decisionBusy === 'approve' ? 'Working…' : 'Approve verification'}
      </button>
      <button
        type="button"
        className="nb-btn nb-btn-secondary"
        disabled={decisionBusy !== null}
        onClick={() => runDecision('changes')}
      >
        {decisionBusy === 'changes' ? 'Working…' : 'Request changes'}
      </button>
      <button
        type="button"
        className="nb-btn nb-btn-danger"
        disabled={decisionBusy !== null}
        onClick={() => runDecision('reject')}
      >
        {decisionBusy === 'reject' ? 'Working…' : 'Reject verification'}
      </button>
    </>
  );

  const statusActions = (
    <FormActions>
      {b.status !== 'APPROVED' ? (
        <button
          type="button"
          className="nb-btn"
          disabled={busy}
          onClick={() => runStatus('APPROVED')}
        >
          {busy ? 'Working…' : b.status === 'SUSPENDED' ? 'Reinstate business' : 'Approve business'}
        </button>
      ) : null}
      {b.status !== 'SUSPENDED' && b.status !== 'ARCHIVED' ? (
        <button
          type="button"
          className="nb-btn nb-btn-danger"
          disabled={busy}
          onClick={() => setConfirm('suspend')}
        >
          Suspend business
        </button>
      ) : null}
      {b.status !== 'REJECTED' ? (
        <button
          type="button"
          className="nb-btn nb-btn-secondary"
          disabled={busy}
          onClick={() => setConfirm('reject')}
        >
          Reject business
        </button>
      ) : null}
    </FormActions>
  );

  return (
    <Drawer
      title={b.name}
      subtitle={b.slug}
      meta={`Business · ${b.id.slice(0, 8)}`}
      status={
        <>
          <Badge value={b.status} />
          {verificationBadge(b)}
        </>
      }
      onClose={props.onClose}
      actions={b.verificationApplicationId ? verificationActions : statusActions}
    >
      <SectionTitle>Profile</SectionTitle>
      {api.resolveImageUrl(b.imageUrl) ? (
        <img
          src={api.resolveImageUrl(b.imageUrl) as string}
          alt={`${b.name} photo`}
          style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12, display: 'block', marginBottom: 12 }}
        />
      ) : null}
      <DefinitionList
        items={[
          { label: 'Name', value: b.name },
          { label: 'Slug', value: <span className="nb-mono">{b.slug}</span> },
          {
            label: 'Owner',
            value: (
              <span>
                {ownerName}{' '}
                <span className="nb-mono" style={muted}>
                  {b.owner.email}
                </span>
              </span>
            ),
          },
          { label: 'Category', value: categoryNames },
          { label: 'Submitted', value: fmtDate(b.createdAt) },
          { label: 'Approval', value: <Badge value={b.status} /> },
          { label: 'Verification', value: verificationBadge(b) },
          {
            label: 'Verified badge',
            value: b.isVerified ? (
              <Badge value="VERIFIED" tone="info" />
            ) : (
              <span style={muted}>Not verified</span>
            ),
          },
          {
            label: 'Activity',
            value: (
              <span className="nb-mono">
                {b.counts.orders} orders · {b.counts.bookings} bookings ·{' '}
                {b.counts.services} services · {b.counts.products} products ·{' '}
                {b.counts.reviews} reviews
              </span>
            ),
          },
        ]}
      />
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="nb-btn nb-btn-secondary"
          onClick={() => props.onOpenPayments(b.id)}
        >
          View payment history
        </button>
      </div>

      <SectionTitle>Subscription / trial</SectionTitle>
      <DefinitionList
        items={[
          {
            label: 'Trial',
            value: b.trialStatus ? <Badge value={b.trialStatus} /> : <span style={muted}>None</span>,
          },
          {
            label: 'Subscription',
            value: b.subscriptionStatus ? (
              <Badge value={b.subscriptionStatus} />
            ) : (
              <span style={muted}>None</span>
            ),
          },
        ]}
      />

      <SectionTitle>Location</SectionTitle>
      <DefinitionList
        items={[
          { label: 'City', value: b.city || 'Not provided' },
          { label: 'Address', value: b.address || 'Not provided' },
        ]}
      />

      <SectionTitle>Verification</SectionTitle>
      {b.verificationApplicationId ? (
        <>
          <Consequence>
            <strong>Approving</strong> grants the verified badge and makes the
            business eligible for a subscription trial. The reviewer message is
            shown to the business owner; admin notes stay internal.
          </Consequence>
          <Field
            label="Reviewer message"
            hint="Shown to the business owner. Required when requesting changes or rejecting."
          >
            <textarea
              rows={2}
              value={reviewerMessage}
              onChange={(e) => setReviewerMessage(e.target.value)}
              placeholder="Shown to the business owner"
            />
          </Field>
          <Field label="Admin notes" hint="Internal only, never shown to the business.">
            <textarea
              rows={2}
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Internal only"
            />
          </Field>
          {decisionError ? <FormError message={decisionError} /> : null}
        </>
      ) : (
        <EmptyState
          title="No verification application"
          body="This business has not submitted a verification application."
        />
      )}
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="nb-btn nb-btn-secondary"
          disabled={busy}
          onClick={runVerifyToggle}
        >
          {busy ? 'Working…' : b.isVerified ? 'Remove verified badge' : 'Grant verified badge'}
        </button>
      </div>

      <SectionTitle>Business status</SectionTitle>
      {b.verificationApplicationId ? (
        <p className="nb-hint" style={{ marginTop: 0 }}>
          Business status actions are available below. The pending verification
          decision is pinned at the bottom of this panel.
        </p>
      ) : (
        <Consequence>
          <strong>Suspending or rejecting</strong> removes the business from
          customer discovery immediately.
        </Consequence>
      )}
      {error ? <FormError message={error} /> : null}
      {b.verificationApplicationId ? statusActions : null}

      {confirm === 'suspend' ? (
        <ConfirmDialog
          title="Suspend business"
          body={`Suspend "${b.name}"? The business will disappear from customer discovery.`}
          confirmLabel="Suspend business"
          danger
          busy={busy}
          onConfirm={() => runStatus('SUSPENDED')}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm === 'reject' ? (
        <ConfirmDialog
          title="Reject business"
          body={`Reject "${b.name}"? It will leave customer discovery.`}
          confirmLabel="Reject business"
          busy={busy}
          onConfirm={() => runStatus('REJECTED')}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </Drawer>
  );
}

export function Businesses(props: {
  initialStatus?: string;
  onOpenPayments: (businessId: string) => void;
}) {
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState(props.initialStatus ?? '');
  const [verificationStatus, setVerificationStatus] = React.useState('');
  const businesses = useAsync(
    () =>
      api.listBusinesses({
        q: q || undefined,
        status: status || undefined,
        verificationStatus: verificationStatus || undefined,
      }),
    [q, status, verificationStatus],
  );
  const [selected, setSelected] = React.useState<AdminBusiness | null>(null);

  const columns: Column<AdminBusiness>[] = [
    {
      key: 'business',
      header: 'Business',
      label: 'Business',
      render: (b) => (
        <span>
          <span className="nb-cell-main">{b.name}</span>
          <span className="nb-cell-sub">
            {[b.categories.map((c) => c.name).join(', ') || 'No category', b.city].filter(Boolean).join(' · ')}
          </span>
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      label: 'Owner',
      render: (b) => {
        const name = fullName(b.owner.firstName, b.owner.lastName) || 'N/A';
        return (
          <span>
            <span className="nb-cell-main">{name}</span>
            <span className="nb-cell-sub nb-mono">{b.owner.email}</span>
          </span>
        );
      },
    },
    {
      key: 'approval',
      header: 'Approval',
      label: 'Approval',
      render: (b) => <Badge value={b.status} />,
    },
    {
      key: 'verification',
      header: 'Verification',
      label: 'Verification',
      render: verificationBadge,
    },
    {
      key: 'subscription',
      header: 'Subscription',
      label: 'Subscription',
      render: subscriptionBadge,
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      render: (b) => (
        <span
          style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="nb-btn nb-btn-secondary nb-btn-sm"
            onClick={() => setSelected(b)}
          >
            Review
          </button>
          <button
            type="button"
            className="nb-btn nb-btn-secondary nb-btn-sm"
            onClick={() => props.onOpenPayments(b.id)}
          >
            View payment history
          </button>
        </span>
      ),
    },
  ];

  const hasFilters = q !== '' || status !== '' || verificationStatus !== '';
  const clearFilters = () => {
    setQ('');
    setStatus('');
    setVerificationStatus('');
  };

  return (
    <div>
      <PageHeader
        kicker="Marketplace"
        title="Businesses"
        subtitle={
          businesses.data
            ? `${businesses.data.length} ${businesses.data.length === 1 ? 'business' : 'businesses'} on the platform`
            : undefined
        }
      />
      <Toolbar>
        <form onSubmit={(e) => e.preventDefault()} style={{ display: 'contents' }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search name, city or owner email"
            label="Search businesses"
          />
        </form>
        <FilterSelect
          label="Approval status"
          value={status}
          onChange={setStatus}
          options={APPROVAL_OPTIONS}
        />
        <FilterSelect
          label="Verification status"
          value={verificationStatus}
          onChange={setVerificationStatus}
          options={VERIFICATION_OPTIONS}
        />
        <span className="nb-toolbar-end">
          <span className="nb-result-count" aria-live="polite">
            {businesses.loading ? 'Loading…' : `${businesses.data?.length ?? 0} results`}
          </span>
        </span>
      </Toolbar>
      {businesses.loading ? (
        <Skeleton rows={6} />
      ) : businesses.error ? (
        <ErrorState message={businesses.error} onRetry={businesses.reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={businesses.data ?? []}
          rowKey={(b) => b.id}
          onRowClick={setSelected}
          empty={
            <EmptyState
              title="No businesses found"
              body={
                hasFilters
                  ? 'No businesses match these filters.'
                  : 'There are no businesses on the platform yet.'
              }
              action={
                hasFilters ? (
                  <button
                    type="button"
                    className="nb-btn nb-btn-secondary"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          }
        />
      )}
      {selected ? (
        <BusinessDrawer
          key={selected.id}
          business={selected}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => {
            setSelected(updated);
            businesses.reload();
          }}
          onVerificationDecided={() => {
            setSelected(null);
            businesses.reload();
          }}
          onOpenPayments={props.onOpenPayments}
        />
      ) : null}
    </div>
  );
}

/* ============================== Categories ============================= */

export function Categories() {
  const cats = useAsync(() => api.listCategories(), []);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = React.useState<AdminCategory | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await api.createCategory(trimmed);
      setName('');
      setModalOpen(false);
      cats.reload();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (c: AdminCategory, isActive: boolean) => {
    setBusyId(c.id);
    setError(null);
    try {
      await api.setCategoryActive(c.id, isActive);
      setConfirmDeactivate(null);
      cats.reload();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<AdminCategory>[] = [
    {
      key: 'name',
      header: 'Name',
      label: 'Name',
      render: (c) => <span style={{ fontWeight: 600 }}>{c.name}</span>,
    },
    {
      key: 'slug',
      header: 'Slug',
      label: 'Slug',
      render: (c) => <span className="nb-mono">{c.slug}</span>,
    },
    {
      key: 'businesses',
      header: 'Businesses',
      label: 'Businesses',
      render: (c) => c.businessCount,
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      render: (c) => <Badge value={c.isActive ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      render: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          {c.isActive ? (
            <button
              type="button"
              className="nb-btn nb-btn-danger nb-btn-sm"
              disabled={busyId === c.id}
              onClick={() => setConfirmDeactivate(c)}
            >
              {busyId === c.id ? 'Working…' : 'Deactivate'}
            </button>
          ) : (
            <button
              type="button"
              className="nb-btn nb-btn-secondary nb-btn-sm"
              disabled={busyId === c.id}
              onClick={() => setActive(c, true)}
            >
              {busyId === c.id ? 'Working…' : 'Activate'}
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        kicker="Marketplace"
        title="Categories"
        subtitle="Inactive categories disappear from customer discovery; existing businesses keep their links."
        actions={
          <button
            type="button"
            className="nb-btn"
            onClick={() => {
              setName('');
              setError(null);
              setModalOpen(true);
            }}
          >
            New category
          </button>
        }
      />
      {error ? <FormError message={error} /> : null}
      {cats.loading ? (
        <Skeleton rows={5} />
      ) : cats.error ? (
        <ErrorState message={cats.error} onRetry={cats.reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={cats.data ?? []}
          rowKey={(c) => c.id}
          empty={
            <EmptyState
              title="No categories yet"
              body="Create the first category to organize businesses."
              action={
                <button
                  type="button"
                  className="nb-btn nb-btn-secondary"
                  onClick={() => setModalOpen(true)}
                >
                  New category
                </button>
              }
            />
          }
        />
      )}
      {modalOpen ? (
        <Modal title="New category" onClose={() => setModalOpen(false)}>
          {error ? <FormError message={error} /> : null}
          <Field label="Category name" hint="2 to 60 characters, shown to customers.">
            <input
              type="text"
              value={name}
              minLength={2}
              maxLength={60}
              required
              placeholder="e.g. Home Services"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  create();
                }
              }}
            />
          </Field>
          <FormActions>
            <button
              type="button"
              className="nb-btn nb-btn-secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="nb-btn"
              disabled={busy || name.trim().length < 2}
              onClick={create}
            >
              {busy ? 'Adding…' : 'Add category'}
            </button>
          </FormActions>
        </Modal>
      ) : null}
      {confirmDeactivate ? (
        <ConfirmDialog
          title="Deactivate category"
          body={`Deactivate "${confirmDeactivate.name}"? It will disappear from customer discovery; existing businesses keep their links.`}
          confirmLabel="Deactivate"
          danger
          busy={busyId === confirmDeactivate.id}
          onConfirm={() => setActive(confirmDeactivate, false)}
          onCancel={() => setConfirmDeactivate(null)}
        />
      ) : null}
    </div>
  );
}

/* =============================== Reviews =============================== */

const REVIEW_TABS = [
  { key: '', label: 'All reviews' },
  { key: 'visible', label: 'Visible' },
  { key: 'hidden', label: 'Hidden' },
];

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function ReviewDrawer(props: {
  review: AdminReview;
  onClose: () => void;
  onChanged: (updated: AdminReview) => void;
}) {
  const { review: r } = props;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const customerName = fullName(r.customer.firstName, r.customer.lastName);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setReviewVisibility(r.id, !r.isHidden);
      props.onChanged({ ...r, isHidden: res.isHidden });
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title="Review"
      subtitle={r.business.name}
      meta={`Review · ${r.id.slice(0, 8)}`}
      status={r.isHidden ? <Badge value="HIDDEN" /> : <Badge value="PUBLIC" tone="ok" />}
      onClose={props.onClose}
      actions={
        r.isHidden ? (
          <button type="button" className="nb-btn nb-btn-secondary" disabled={busy} onClick={toggle}>
            {busy ? 'Working…' : 'Restore review'}
          </button>
        ) : (
          <button type="button" className="nb-btn nb-btn-danger" disabled={busy} onClick={toggle}>
            {busy ? 'Working…' : 'Hide review'}
          </button>
        )
      }
    >
      <DefinitionList
        items={[
          { label: 'Business', value: r.business.name },
          {
            label: 'Customer',
            value: (
              <span>
                {customerName ? `${customerName} ` : ''}
                <span className="nb-mono" style={muted}>
                  {r.customer.email}
                </span>
              </span>
            ),
          },
          {
            label: 'Rating',
            value: (
              <span>
                {'★'.repeat(r.rating)} <span className="nb-mono">{r.rating} / 5</span>
              </span>
            ),
          },
          { label: 'Posted', value: fmtDateTime(r.createdAt) },
          {
            label: 'Visibility',
            value: r.isHidden ? (
              <Badge value="HIDDEN" />
            ) : (
              <Badge value="PUBLIC" tone="ok" />
            ),
          },
        ]}
      />
      <SectionTitle>Comment</SectionTitle>
      <p>{r.comment ?? 'No comment'}</p>
      {error ? <FormError message={error} /> : null}
      {!r.isHidden ? (
        <Consequence info>
          <strong>Hiding this review</strong> removes it from customer discovery
          immediately. The customer is not notified.
        </Consequence>
      ) : null}
    </Drawer>
  );
}

export function Reviews(props: { initialStatus?: '' | 'visible' | 'hidden' }) {
  const [status, setStatus] = React.useState<'' | 'visible' | 'hidden'>(
    props.initialStatus ?? '',
  );
  const reviews = useAsync(() => api.listReviews(status), [status]);
  const [selected, setSelected] = React.useState<AdminReview | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const toggleVisibility = async (r: AdminReview) => {
    setBusyId(r.id);
    setActionError(null);
    try {
      const res = await api.setReviewVisibility(r.id, !r.isHidden);
      setSelected((s) => (s && s.id === r.id ? { ...s, isHidden: res.isHidden } : s));
      reviews.reload();
    } catch (e) {
      setActionError(errMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<AdminReview>[] = [
    {
      key: 'rating',
      header: 'Rating',
      label: 'Rating',
      render: (r) => (
        <span aria-label={`${r.rating} out of 5`}>
          {'★'.repeat(r.rating)} <span className="nb-mono">{r.rating}</span>
        </span>
      ),
    },
    {
      key: 'comment',
      header: 'Comment',
      label: 'Comment',
      render: (r) => (r.comment ? truncate(r.comment, 80) : <span style={muted}>No comment</span>),
    },
    {
      key: 'customer',
      header: 'Customer',
      label: 'Customer',
      render: (r) => <span className="nb-mono">{r.customer.email}</span>,
    },
    {
      key: 'business',
      header: 'Business',
      label: 'Business',
      render: (r) => r.business.name,
    },
    {
      key: 'date',
      header: 'Date',
      label: 'Date',
      render: (r) => fmtDate(r.createdAt),
    },
    {
      key: 'visibility',
      header: 'Visibility',
      label: 'Visibility',
      render: (r) =>
        r.isHidden ? <Badge value="HIDDEN" /> : <Badge value="PUBLIC" tone="ok" />,
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          {r.isHidden ? (
            <button
              type="button"
              className="nb-btn nb-btn-secondary nb-btn-sm"
              disabled={busyId === r.id}
              onClick={() => toggleVisibility(r)}
            >
              {busyId === r.id ? 'Working…' : 'Restore'}
            </button>
          ) : (
            <button
              type="button"
              className="nb-btn nb-btn-danger nb-btn-sm"
              disabled={busyId === r.id}
              onClick={() => toggleVisibility(r)}
            >
              {busyId === r.id ? 'Working…' : 'Hide'}
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        kicker="Operations"
        title="Reviews"
        subtitle="Customer reviews. Hidden reviews are removed from customer discovery."
      />
      <Toolbar>
        <Tabs
          tabs={REVIEW_TABS}
          active={status}
          onChange={(k) => setStatus(k as '' | 'visible' | 'hidden')}
        />
        <span className="nb-toolbar-end">
          <span className="nb-result-count" aria-live="polite">
            {reviews.loading ? 'Loading…' : `${reviews.data?.length ?? 0} results`}
          </span>
        </span>
      </Toolbar>
      {actionError ? <FormError message={actionError} /> : null}
      {reviews.loading ? (
        <Skeleton rows={6} />
      ) : reviews.error ? (
        <ErrorState message={reviews.error} onRetry={reviews.reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={reviews.data ?? []}
          rowKey={(r) => r.id}
          onRowClick={setSelected}
          empty={
            <EmptyState
              title="No reviews found"
              body="No reviews match this filter."
              action={
                status !== '' ? (
                  <button
                    type="button"
                    className="nb-btn nb-btn-secondary"
                    onClick={() => setStatus('')}
                  >
                    Show all reviews
                  </button>
                ) : undefined
              }
            />
          }
        />
      )}
      {selected ? (
        <ReviewDrawer
          review={selected}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setSelected(updated);
            reviews.reload();
          }}
        />
      ) : null}
    </div>
  );
}
