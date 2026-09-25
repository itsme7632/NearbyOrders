import React from 'react';
import * as api from './api.js';
import type { Column } from './ds.js';
import {
  PageHeader,
  Badge,
  Tabs,
  Toolbar,
  SearchInput,
  DataTable,
  EmptyState,
  LoadingState,
  ErrorState,
  Drawer,
  ConfirmDialog,
  Consequence,
  Modal,
  Field,
  FormError,
  FormActions,
  FormSection,
  DefinitionList,
  SectionTitle,
  Skeleton,
  useAsync,
  fmtMoney,
  fmtDate,
  fmtDateTime,
  statusLabel,
} from './ds.js';

/* ------------------------------------------------------------------
   Billing screens: Subscriptions, SubscriptionPlans, PaymentRequests,
   PaymentMethods. All data is read live from the API; nothing here is
   hardcoded or fabricated.
------------------------------------------------------------------- */

function apiMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/* ============================== Subscriptions ============================== */

const SUBSCRIPTION_TABS = [
  { key: '', label: 'All' },
  { key: 'TRIAL', label: 'Trial' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'SUSPENDED', label: 'Suspended' },
];

const subscriptionColumns: Column<api.AdminSubscription>[] = [
  {
    key: 'business',
    header: 'Business',
    render: (s) => (
      <>
        <div>{s.business.name}</div>
        <div className="nb-plan-meta nb-mono">{s.business.id}</div>
      </>
    ),
  },
  {
    key: 'plan',
    header: 'Plan',
    render: (s) =>
      s.plan ? (
        <>
          <div>{s.plan.name}</div>
          <div className="nb-plan-meta">{fmtMoney(s.plan.monthlyPriceMinor, s.plan.currency)}</div>
        </>
      ) : (
        'N/A'
      ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (s) => <Badge value={s.status} />,
  },
  {
    key: 'renews',
    header: 'Renews / ended',
    render: (s) => fmtDate(s.currentPeriodEndAt),
  },
  {
    key: 'started',
    header: 'Started',
    render: (s) => fmtDate(s.createdAt),
  },
];

export function Subscriptions() {
  const [status, setStatus] = React.useState('');
  const { data, loading, error, reload } = useAsync(() => api.listSubscriptions(status), [status]);
  const [selected, setSelected] = React.useState<api.AdminSubscription | null>(null);

  const subtitle = data ? `${data.length} subscription${data.length === 1 ? '' : 's'}` : undefined;

  return (
    <>
      <PageHeader kicker="Billing" title="Subscriptions" subtitle={subtitle} />
      <Toolbar>
        <Tabs tabs={SUBSCRIPTION_TABS} active={status} onChange={(k) => { setStatus(k); setSelected(null); }} />
        <span className="nb-toolbar-end">
          <span className="nb-result-count" aria-live="polite">
            {loading ? 'Loading…' : `${(data ?? []).length} in view`}
          </span>
        </span>
      </Toolbar>
      {loading ? (
        <Skeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          columns={subscriptionColumns}
          rows={data ?? []}
          rowKey={(s) => s.id}
          onRowClick={setSelected}
          empty={<EmptyState title="No subscriptions" body="No subscriptions match this filter." />}
        />
      )}
      {selected ? (
        <Drawer
          title={selected.business.name}
          subtitle={selected.plan ? selected.plan.name : 'No plan'}
          meta={`Subscription · ${selected.id.slice(0, 8)}`}
          status={<Badge value={selected.status} />}
          onClose={() => setSelected(null)}
        >
          <SectionTitle>Subscription details</SectionTitle>
          <DefinitionList
            items={[
              { label: 'Business', value: selected.business.name },
              { label: 'Plan', value: selected.plan ? selected.plan.name : 'N/A' },
              {
                label: 'Price',
                value: selected.plan ? <strong>{fmtMoney(selected.plan.monthlyPriceMinor, selected.plan.currency)}</strong> : 'N/A',
              },
              { label: 'Started', value: fmtDate(selected.createdAt) },
              { label: 'Renews / ended', value: fmtDate(selected.currentPeriodEndAt) },
            ]}
          />
          <Consequence>
            Subscriptions are read-only here. Changes happen through the
            payment review flow so every change leaves an audit trail.
          </Consequence>
        </Drawer>
      ) : null}
    </>
  );
}

/* ============================ SubscriptionPlans ============================ */

function trialLabel(days: number): string {
  if (days <= 0) return 'No trial';
  return days === 1 ? '1 day trial' : `${days} days trial`;
}

function PlanCard(props: {
  plan: api.AdminSubscriptionPlan;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const { plan } = props;
  return (
    <article className={`nb-plan${plan.isHighlighted ? ' nb-plan-highlighted' : ''}`}>
      {plan.isHighlighted ? <span className="nb-plan-flag">Recommended</span> : null}
      <h3 className="nb-plan-name">{plan.name}</h3>
      <div className="nb-plan-price">
        {fmtMoney(plan.monthlyPriceMinor, plan.currency)} <span>/ {statusLabel(plan.billingInterval)}</span>
      </div>
      <div className="nb-plan-meta nb-mono">{plan.slug}</div>
      <div className="nb-plan-meta">{trialLabel(plan.trialDays)}</div>
      {plan.description ? <p className="nb-plan-meta">{plan.description}</p> : null}
      {plan.benefits.length > 0 ? (
        <ul className="nb-plan-benefits">
          {plan.benefits.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="nb-plan-meta">No benefits listed.</p>
      )}
      <div className="nb-plan-meta">
        <Badge value={plan.isActive ? 'ACTIVE' : 'INACTIVE'} />{' '}
        <span>
          {plan.usageCount} business{plan.usageCount === 1 ? '' : 'es'} on this plan
        </span>
      </div>
      <div className="nb-plan-actions">
        <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={props.onEdit} disabled={props.busy}>
          Edit
        </button>
        <button
          type="button"
          className={`nb-btn nb-btn-sm${plan.isActive ? ' nb-btn-danger' : ''}`}
          onClick={props.onToggleActive}
          disabled={props.busy}
        >
          {plan.isActive ? 'Deactivate' : 'Activate'}
        </button>
        <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={props.onDelete} disabled={props.busy}>
          Delete
        </button>
      </div>
    </article>
  );
}

function PlanDialog(props: {
  plan: api.AdminSubscriptionPlan | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const p = props.plan;
  const [name, setName] = React.useState(p?.name ?? '');
  const [slug, setSlug] = React.useState(p?.slug ?? '');
  const [description, setDescription] = React.useState(p?.description ?? '');
  const [priceRupees, setPriceRupees] = React.useState(p ? String(p.monthlyPriceMinor / 100) : '');
  const [currency, setCurrency] = React.useState(p?.currency ?? 'PKR');
  const [trialDays, setTrialDays] = React.useState(String(p?.trialDays ?? 0));
  const [billingInterval, setBillingInterval] = React.useState(p?.billingInterval ?? 'MONTHLY');
  const [benefitsText, setBenefitsText] = React.useState(p ? p.benefits.join('\n') : '');
  const [displayOrder, setDisplayOrder] = React.useState(String(p?.displayOrder ?? 0));
  const [isHighlighted, setIsHighlighted] = React.useState(p?.isHighlighted ?? false);
  const [isActive, setIsActive] = React.useState(p?.isActive ?? true);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    const trimmedName = name.trim();
    const rupees = Number(priceRupees);
    if (!trimmedName || priceRupees.trim() === '' || Number.isNaN(rupees) || rupees < 0) {
      setFormError('Enter a plan name and a valid price in rupees.');
      return;
    }
    setFormError(null);
    setBusy(true);
    const input: api.SubscriptionPlanInput = {
      name: trimmedName,
      description: description.trim() ? description.trim() : null,
      monthlyPriceMinor: Math.round(rupees * 100),
      currency: currency.trim() || 'PKR',
      trialDays: Math.max(0, parseInt(trialDays, 10) || 0),
      billingInterval: billingInterval.trim() || 'MONTHLY',
      benefits: benefitsText
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean),
      displayOrder: parseInt(displayOrder, 10) || 0,
      isHighlighted,
      isActive,
    };
    try {
      if (p) {
        // Slug is locked once a plan exists.
        await api.updateSubscriptionPlan(p.id, input);
      } else {
        if (slug.trim()) input.slug = slug.trim();
        await api.createSubscriptionPlan(input);
      }
      props.onSaved();
      props.onClose();
    } catch (e) {
      setFormError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={p ? `Edit plan: ${p.name}` : 'New plan'} onClose={props.onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {formError ? <FormError message={formError} /> : null}
        <FormSection title="Basics" description="Identity of the plan shown to businesses.">
          <Field label="Name" required>
            <input value={name} maxLength={80} placeholder="Business Plus" onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Slug" hint={p ? 'The slug is locked after creation.' : 'Optional. Generated automatically when left blank.'}>
            <input value={slug} maxLength={80} onChange={(e) => setSlug(e.target.value)} disabled={!!p} />
          </Field>
          <Field label="Description">
            <textarea value={description} placeholder="Short pitch shown on the plans screen." onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </FormSection>
        <FormSection title="Pricing" description="Charges apply to future subscriptions when plans change.">
          <Field label="Price (PKR per month)" required>
            <input
              value={priceRupees}
              inputMode="decimal"
              placeholder="2999"
              onChange={(e) => setPriceRupees(e.target.value)}
              required
            />
          </Field>
          <Field label="Currency">
            <input value={currency} maxLength={8} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
          <Field label="Billing interval">
            <input value={billingInterval} maxLength={24} onChange={(e) => setBillingInterval(e.target.value)} />
          </Field>
          <Field label="Trial days">
            <input value={trialDays} inputMode="numeric" onChange={(e) => setTrialDays(e.target.value)} />
          </Field>
        </FormSection>
        <FormSection title="Presentation">
          <Field label="Benefits (one per line)">
            <textarea value={benefitsText} rows={4} onChange={(e) => setBenefitsText(e.target.value)} />
          </Field>
          <Field label="Display order">
            <input value={displayOrder} inputMode="numeric" onChange={(e) => setDisplayOrder(e.target.value)} />
          </Field>
          <Field label="Highlighted (recommended card)">
            <input type="checkbox" checked={isHighlighted} onChange={(e) => setIsHighlighted(e.target.checked)} />
          </Field>
          <Field label="Active">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          </Field>
        </FormSection>
        <FormActions>
          <button type="button" className="nb-btn nb-btn-secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="nb-btn" disabled={busy}>
            {busy ? 'Saving…' : p ? 'Save changes' : 'Create plan'}
          </button>
        </FormActions>
      </form>
    </Modal>
  );
}

export function SubscriptionPlans() {
  const { data: plans, loading, error, reload } = useAsync(() => api.listSubscriptionPlans(), []);
  const [dialog, setDialog] = React.useState<{ plan: api.AdminSubscriptionPlan | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<api.AdminSubscriptionPlan | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const toggleActive = async (plan: api.AdminSubscriptionPlan) => {
    setActionError(null);
    setBusyId(plan.id);
    try {
      await api.updateSubscriptionPlan(plan.id, { isActive: !plan.isActive });
      reload();
    } catch (e) {
      setActionError(apiMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const plan = deleteTarget;
    if (!plan) return;
    setActionError(null);
    setBusyId(plan.id);
    try {
      await api.deleteSubscriptionPlan(plan.id);
      setDeleteTarget(null);
      reload();
    } catch (e) {
      if (e instanceof api.ApiError && (e.code === 'PLAN_IN_USE' || e.status === 409)) {
        setActionError(
          `Cannot delete "${plan.name}": ${plan.usageCount} businesses are on this plan. Deactivate it instead so existing subscribers keep their plan.`,
        );
      } else {
        setActionError(apiMessage(e));
      }
      setDeleteTarget(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Plans"
        kicker="Billing"
        subtitle="Plans are read live from the API. Changes apply to future subscriptions."
        actions={
          <button type="button" className="nb-btn" onClick={() => setDialog({ plan: null })}>
            New plan
          </button>
        }
      />
      {actionError ? <FormError message={actionError} /> : null}
      {loading ? (
        <Skeleton rows={3} height={120} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (plans ?? []).length === 0 ? (
        <EmptyState
          title="No plans yet"
          body="Create the first one to let businesses subscribe."
          action={
            <button type="button" className="nb-btn" onClick={() => setDialog({ plan: null })}>
              New plan
            </button>
          }
        />
      ) : (
        <div className="nb-plan-grid">
          {plans!.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              busy={busyId === plan.id}
              onEdit={() => setDialog({ plan })}
              onToggleActive={() => void toggleActive(plan)}
              onDelete={() => setDeleteTarget(plan)}
            />
          ))}
        </div>
      )}
      {dialog ? (
        <PlanDialog plan={dialog.plan} onClose={() => setDialog(null)} onSaved={reload} />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete plan "${deleteTarget.name}"?`}
          body="This cannot be undone. If businesses are subscribed to this plan, deleting is blocked and you should deactivate it instead."
          confirmLabel="Delete plan"
          danger
          busy={busyId === deleteTarget.id}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </>
  );
}

/* ============================= PaymentRequests ============================= */

const PAYMENT_REQUEST_TABS = [
  { key: 'PENDING', label: 'Pending review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

function ReceiptImage({ storageKey }: { storageKey: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    let objectUrl = '';
    api
      .fetchReceiptObjectUrl(storageKey)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch((e: unknown) => {
        if (alive) setError(apiMessage(e));
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storageKey]);

  if (error) return <FormError message={error} />;
  if (!url) return <LoadingState label="Loading receipt…" />;
  return <img className="nb-receipt receipt-img" src={url} alt="Payment receipt" />;
}

function PaymentRequestDrawer(props: { request: api.AdminPaymentRequest; onDecided: () => void; onClose: () => void }) {
  const r = props.request;
  const [confirmApprove, setConfirmApprove] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const isPending = r.status === 'PENDING';

  const approve = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await api.approvePaymentRequest(r.id);
      props.onDecided();
      props.onClose();
    } catch (e) {
      setActionError(apiMessage(e));
    } finally {
      setBusy(false);
      setConfirmApprove(false);
    }
  };

  const reject = async () => {
    if (reason.trim().length < 4) return;
    setActionError(null);
    setBusy(true);
    try {
      await api.rejectPaymentRequest(r.id, reason.trim());
      props.onDecided();
      props.onClose();
    } catch (e) {
      setActionError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Drawer
        title={`Payment from ${r.business.name}`}
        subtitle={r.plan ? `${r.plan.name} · ${fmtMoney(r.amountMinor, r.currency)}` : fmtMoney(r.amountMinor, r.currency)}
        meta={`Payment · ${r.id.slice(0, 8)}`}
        status={<Badge value={r.status} />}
        onClose={props.onClose}
        actions={
          isPending && !rejecting ? (
            <>
              <button
                type="button"
                className="nb-btn nb-btn-danger"
                onClick={() => setRejecting(true)}
                disabled={busy}
              >
                Reject payment
              </button>
              <button type="button" className="nb-btn" onClick={() => setConfirmApprove(true)} disabled={busy}>
                Approve payment
              </button>
            </>
          ) : undefined
        }
      >
        {actionError ? <FormError message={actionError} /> : null}
        <SectionTitle>Payment details</SectionTitle>
        <DefinitionList
          items={[
            { label: 'Business', value: r.business.name },
            { label: 'Plan', value: r.plan ? r.plan.name : 'N/A' },
            { label: 'Amount', value: <strong>{fmtMoney(r.amountMinor, r.currency)}</strong> },
            {
              label: 'Payment method',
              value: r.paymentMethod ? `${r.paymentMethod.name} (${statusLabel(r.paymentMethod.type)})` : 'N/A',
            },
            {
              label: 'Transaction reference',
              value: r.transactionReference ? <span className="nb-mono">{r.transactionReference}</span> : 'N/A',
            },
            { label: 'Paid date', value: r.paidAt ? fmtDate(r.paidAt) : 'Not provided' },
            { label: 'Submitted', value: fmtDateTime(r.createdAt) },
            ...(r.note ? [{ label: 'Business note', value: r.note }] : []),
            ...(r.reviewedAt
              ? [
                  {
                    label: 'Decision',
                    value: (
                      <>
                        <div>Decided {fmtDateTime(r.reviewedAt)}</div>
                        {r.reviewer ? <div className="nb-plan-meta">{r.reviewer.email}</div> : null}
                        {r.rejectionReason ? <div className="nb-form-error">{r.rejectionReason}</div> : null}
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
        <SectionTitle>Receipt</SectionTitle>
        {r.receiptStorageKey ? <ReceiptImage storageKey={r.receiptStorageKey} /> : <p className="nb-plan-meta">No receipt uploaded.</p>}
        {isPending ? (
          <>
            <SectionTitle>Decision</SectionTitle>
            <Consequence>
              <strong>Approving this payment</strong> activates the business
              subscription immediately. A rejection requires a reason, which is
              shown to the business owner.
            </Consequence>
            {rejecting ? (
              <>
                <Field label="Rejection reason" hint="Shown to the business owner. Minimum 4 characters." required>
                  <input
                    aria-label="Rejection reason"
                    value={reason}
                    placeholder="Tell the business owner what to fix."
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <FormActions>
                  <button type="button" className="nb-btn nb-btn-secondary" onClick={() => setRejecting(false)} disabled={busy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="nb-btn nb-btn-danger"
                    onClick={() => void reject()}
                    disabled={busy || reason.trim().length < 4}
                  >
                    {busy ? 'Working…' : 'Confirm rejection'}
                  </button>
                </FormActions>
              </>
            ) : null}
          </>
        ) : null}
      </Drawer>
      {confirmApprove ? (
        <ConfirmDialog
          title="Approve this payment?"
          body={`Approve this payment of ${fmtMoney(r.amountMinor, r.currency)} from ${r.business.name}? The subscription activates immediately.`}
          confirmLabel="Approve payment"
          busy={busy}
          onConfirm={() => void approve()}
          onCancel={() => setConfirmApprove(false)}
        />
      ) : null}
    </>
  );
}

export function PaymentRequests(props: { initialStatus?: string; initialBusinessId?: string }) {
  const validTabs = PAYMENT_REQUEST_TABS.map((t) => t.key);
  const initialTab = props.initialStatus && validTabs.includes(props.initialStatus) ? props.initialStatus : 'PENDING';
  const [tab, setTab] = React.useState(initialTab);
  const [businessIdDraft, setBusinessIdDraft] = React.useState(props.initialBusinessId ?? '');
  const [businessId, setBusinessId] = React.useState(props.initialBusinessId ?? '');
  const [selected, setSelected] = React.useState<api.AdminPaymentRequest | null>(null);

  const statusParam = tab === 'ALL' ? undefined : tab;
  const { data, loading, error, reload } = useAsync(
    () => api.listPaymentRequests({ status: statusParam, businessId: businessId || undefined }),
    [statusParam, businessId],
  );

  const columns: Column<api.AdminPaymentRequest>[] = [
    {
      key: 'business',
      header: 'Business',
      render: (r) => (
        <>
          <span className="nb-cell-main">{r.business.name}</span>
          <span className="nb-cell-sub nb-mono">{r.business.id.slice(0, 8)}</span>
        </>
      ),
    },
    { key: 'plan', header: 'Plan', render: (r) => (r.plan ? r.plan.name : 'N/A') },
    { key: 'amount', header: 'Amount', render: (r) => fmtMoney(r.amountMinor, r.currency) },
    {
      key: 'method',
      header: 'Method',
      render: (r) => (
        <>
          <span className="nb-cell-main">{r.paymentMethod ? r.paymentMethod.name : 'N/A'}</span>
          <span className="nb-cell-sub">
            {r.transactionReference ? <span className="nb-mono">{r.transactionReference}</span> : 'No reference'}
          </span>
        </>
      ),
    },
    { key: 'submitted', header: 'Submitted', render: (r) => fmtDateTime(r.createdAt), hideBelow: 'md' },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
  ];

  return (
    <>
      <PageHeader kicker="Billing" title="Payment review" subtitle="Review manual subscription payments." />
      <Toolbar>
      <Tabs
        tabs={PAYMENT_REQUEST_TABS}
        active={tab}
        onChange={(k) => {
          setTab(k);
          setSelected(null);
        }}
      />
      <span className="nb-toolbar-end">
        <span className="nb-result-count" aria-live="polite">
          {loading ? 'Loading…' : `${(data ?? []).length} in view`}
        </span>
      </span>
      </Toolbar>
      <Toolbar>
        <SearchInput
          label="Business ID"
          placeholder="Filter by business ID"
          value={businessIdDraft}
          onChange={setBusinessIdDraft}
        />
        <button type="button" className="nb-btn nb-btn-secondary" onClick={() => setBusinessId(businessIdDraft.trim())}>
          Apply
        </button>
        {businessId ? (
          <button
            type="button"
            className="nb-btn nb-btn-secondary"
            onClick={() => {
              setBusinessId('');
              setBusinessIdDraft('');
            }}
          >
            Clear business filter
          </button>
        ) : null}
      </Toolbar>
      {loading ? (
        <Skeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(r) => r.id}
          onRowClick={setSelected}
          empty={<EmptyState title="No payment requests" body="No payment requests match these filters." />}
        />
      )}
      {selected ? (
        <PaymentRequestDrawer request={selected} onClose={() => setSelected(null)} onDecided={reload} />
      ) : null}
    </>
  );
}

/* ============================= PaymentMethods ============================= */

function MethodCard(props: {
  method: api.AdminPaymentMethod;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const { method } = props;
  const hasAccount = method.accountTitle || method.accountNumber || method.iban;
  return (
    <article className="nb-plan">
      <h3 className="nb-plan-name">{method.name}</h3>
      <div>
        <Badge value={method.type} tone={method.type === 'OTHER' ? 'neutral' : 'info'} />
      </div>
      {hasAccount ? (
        <div className="nb-plan-meta">
          {method.accountTitle ? <div>{method.accountTitle}</div> : null}
          {method.accountNumber ? <div className="nb-mono">{method.accountNumber}</div> : null}
          {method.iban ? <div className="nb-mono">{method.iban}</div> : null}
        </div>
      ) : (
        <p className="nb-plan-meta">No account details.</p>
      )}
      {method.instructions ? <p className="nb-plan-meta">{method.instructions}</p> : null}
      <div className="nb-plan-meta">
        <Badge value={method.isActive ? 'ACTIVE' : 'INACTIVE'} /> <span>Order {method.displayOrder}</span>
      </div>
      <div className="nb-plan-actions">
        <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={props.onEdit} disabled={props.busy}>
          Edit
        </button>
        <button
          type="button"
          className={`nb-btn nb-btn-sm${method.isActive ? ' nb-btn-danger' : ''}`}
          onClick={props.onToggleActive}
          disabled={props.busy}
        >
          {method.isActive ? 'Deactivate' : 'Activate'}
        </button>
        <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={props.onDelete} disabled={props.busy}>
          Delete
        </button>
      </div>
    </article>
  );
}

function PaymentMethodDialog(props: {
  method: api.AdminPaymentMethod | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const m = props.method;
  const [name, setName] = React.useState(m?.name ?? '');
  const [type, setType] = React.useState<string>(m?.type ?? 'EASYPAISA');
  const [accountTitle, setAccountTitle] = React.useState(m?.accountTitle ?? '');
  const [accountNumber, setAccountNumber] = React.useState(m?.accountNumber ?? '');
  const [iban, setIban] = React.useState(m?.iban ?? '');
  const [instructions, setInstructions] = React.useState(m?.instructions ?? '');
  const [qrImageUrl, setQrImageUrl] = React.useState(m?.qrImageUrl ?? '');
  const [displayOrder, setDisplayOrder] = React.useState(String(m?.displayOrder ?? 0));
  const [isActive, setIsActive] = React.useState(m?.isActive ?? true);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const opt = (v: string): string | null => (v.trim() ? v.trim() : null);

  const save = async () => {
    if (!name.trim()) {
      setFormError('Enter a display name for this payment method.');
      return;
    }
    setFormError(null);
    setBusy(true);
    const input: api.PaymentMethodInput = {
      name: name.trim(),
      type,
      accountTitle: opt(accountTitle),
      accountNumber: opt(accountNumber),
      iban: opt(iban),
      instructions: opt(instructions),
      qrImageUrl: opt(qrImageUrl),
      isActive,
      displayOrder: parseInt(displayOrder, 10) || 0,
    };
    try {
      if (m) await api.updatePaymentMethod(m.id, input);
      else await api.createPaymentMethod(input);
      props.onSaved();
      props.onClose();
    } catch (e) {
      setFormError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={m ? `Edit payment method: ${m.name}` : 'New payment method'} onClose={props.onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {formError ? <FormError message={formError} /> : null}
        <FormSection title="Method">
        <Field label="Display name" required>
          <input
            value={name}
            maxLength={80}
            placeholder="Easypaisa (business account)"
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Payment method type">
            <option value="EASYPAISA">Easypaisa</option>
            <option value="JAZZCASH">JazzCash</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        </FormSection>
        <FormSection title="Account details" description="Shown to businesses when they pay manually.">
        <Field label="Account title">
          <input
            value={accountTitle}
            maxLength={120}
            placeholder="NearbyOrders Pvt Ltd"
            onChange={(e) => setAccountTitle(e.target.value)}
          />
        </Field>
        <Field label="Account number">
          <input
            value={accountNumber}
            maxLength={64}
            placeholder="0345 1234567"
            onChange={(e) => setAccountNumber(e.target.value)}
          />
        </Field>
        <Field label="IBAN">
          <input value={iban} maxLength={64} placeholder="PK36…" onChange={(e) => setIban(e.target.value)} />
        </Field>
        <Field label="Payment instructions">
          <textarea
            value={instructions}
            placeholder="Send the exact plan amount to the number above, then upload your receipt here."
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <Field label="QR image URL">
          <input value={qrImageUrl} maxLength={500} onChange={(e) => setQrImageUrl(e.target.value)} />
        </Field>
        </FormSection>
        <Field label="Display order">
          <input value={displayOrder} inputMode="numeric" onChange={(e) => setDisplayOrder(e.target.value)} />
        </Field>
        <Field label="Active">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        </Field>
        <FormActions>
          <button type="button" className="nb-btn nb-btn-secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="nb-btn" disabled={busy}>
            {busy ? 'Saving…' : m ? 'Save changes' : 'Add payment method'}
          </button>
        </FormActions>
      </form>
    </Modal>
  );
}

export function PaymentMethods() {
  const { data: methods, loading, error, reload } = useAsync(() => api.listPaymentMethods(), []);
  const [dialog, setDialog] = React.useState<{ method: api.AdminPaymentMethod | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<api.AdminPaymentMethod | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const toggleActive = async (method: api.AdminPaymentMethod) => {
    setActionError(null);
    setBusyId(method.id);
    try {
      await api.updatePaymentMethod(method.id, { isActive: !method.isActive });
      reload();
    } catch (e) {
      setActionError(apiMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const method = deleteTarget;
    if (!method) return;
    setActionError(null);
    setBusyId(method.id);
    try {
      await api.deletePaymentMethod(method.id);
      setDeleteTarget(null);
      reload();
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 409) {
        setActionError(
          `Cannot delete "${method.name}": payment requests reference it. Deactivate it instead so past requests keep their records.`,
        );
      } else {
        setActionError(apiMessage(e));
      }
      setDeleteTarget(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Payment methods"
        subtitle="Where businesses send manual payments. No developer needed to change these."
        actions={
          <button type="button" className="nb-btn" onClick={() => setDialog({ method: null })}>
            New payment method
          </button>
        }
      />
      {actionError ? <FormError message={actionError} /> : null}
      {loading ? (
        <Skeleton rows={3} height={120} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (methods ?? []).length === 0 ? (
        <EmptyState
          title="No payment methods yet"
          body="Add one so businesses can pay for subscriptions manually."
          action={
            <button type="button" className="nb-btn" onClick={() => setDialog({ method: null })}>
              New payment method
            </button>
          }
        />
      ) : (
        <div className="nb-plan-grid">
          {methods!.map((method) => (
            <MethodCard
              key={method.id}
              method={method}
              busy={busyId === method.id}
              onEdit={() => setDialog({ method })}
              onToggleActive={() => void toggleActive(method)}
              onDelete={() => setDeleteTarget(method)}
            />
          ))}
        </div>
      )}
      {dialog ? (
        <PaymentMethodDialog method={dialog.method} onClose={() => setDialog(null)} onSaved={reload} />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete payment method "${deleteTarget.name}"?`}
          body="This cannot be undone. If payment requests reference this method, deleting is blocked and you should deactivate it instead."
          confirmLabel="Delete method"
          danger
          busy={busyId === deleteTarget.id}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </>
  );
}
