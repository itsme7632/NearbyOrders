import React from 'react';

/* ------------------------------------------------------------------
   NearbyOrders Admin — Ops Refined design primitives.

   Every admin screen is composed from these primitives so the panel
   feels like ONE product. Screens must not invent their own
   spacing/typography/badge/button patterns.
------------------------------------------------------------------- */

/* ------------------------- brand mark ------------------------------ */

/**
 * The approved NearbyOrders N+O mark (Phase 9 geometry, frozen 2026-09-30;
 * Phase 9B production color application), taken from
 * apps/mobile/brand/mark.svg. Same paths, no reinterpretation.
 * `dark` renders the porcelain-N variant for dark surfaces.
 */
export function NearbyOrdersMark(props: { size?: number; dark?: boolean }) {
  const n = props.dark ? '#F2F5F7' : '#16222E';
  const size = props.size ?? 24;
  const welds = [
    'M49.09 39.70 L57.00 47.35 L55.69 47.74 L54.43 48.25 L53.23 48.90 L52.11 49.67 L51.07 50.55 L50.14 51.53 L49.30 52.61 L48.59 53.77 L48.00 55.00 L47.54 56.28 C50.12 47.65 55.56 45.96 49.09 39.70 Z',
    'M39.36 49.76 L47.26 57.41 L47.60 56.09 L48.08 54.82 L48.68 53.60 L49.41 52.45 L50.26 51.39 L51.21 50.42 L52.26 49.55 L53.40 48.80 L54.61 48.17 L55.87 47.67 C47.34 50.53 45.82 56.02 39.36 49.76 Z',
    'M70.91 80.30 L63.00 72.65 L64.31 72.26 L65.57 71.75 L66.77 71.10 L67.89 70.33 L68.93 69.45 L69.86 68.47 L70.70 67.39 L71.41 66.23 L72.00 65.00 L72.46 63.72 C69.88 72.35 64.44 74.04 70.91 80.30 Z',
    'M80.64 70.24 L72.74 62.59 L72.40 63.91 L71.92 65.18 L71.32 66.40 L70.59 67.55 L69.74 68.61 L68.79 69.58 L67.74 70.45 L66.60 71.20 L65.39 71.83 L64.13 72.33 C72.66 69.47 74.18 63.98 80.64 70.24 Z',
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="NearbyOrders mark"
      focusable="false"
    >
      <title>NearbyOrders mark, N+O</title>
      <path d="M29 90 L29 30 L52.17 52.42" stroke={n} strokeWidth={14} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M67.83 67.58 L91 90 L91 30" stroke={n} strokeWidth={14} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M50 60 A10 10 0 1 1 70 60 A10 10 0 1 1 50 60 Z" fill="none" stroke="#E23A2E" strokeWidth={6} />
      {welds.map((d) => (
        <path key={d.slice(0, 12)} d={d} fill="#E23A2E" />
      ))}
    </svg>
  );
}

/* ------------------------------ badges ----------------------------- */

type BadgeTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'ok',
  APPROVED: 'ok',
  COMPLETED: 'ok',
  PAID: 'ok',
  VERIFIED: 'ok',
  VISIBLE: 'ok',
  AVAILABLE: 'ok',
  PUBLISHED: 'ok',
  IN_STOCK: 'ok',
  ON: 'ok',
  YES: 'ok',
  PENDING: 'warn',
  PENDING_VERIFICATION: 'warn',
  PENDING_REVIEW: 'warn',
  TRIAL: 'warn',
  TRIALING: 'warn',
  DRAFT: 'warn',
  UNDER_REVIEW: 'warn',
  CHANGES_REQUESTED: 'warn',
  PAYMENT_REQUIRED: 'warn',
  PAYMENT_UNDER_REVIEW: 'warn',
  SUSPENDED: 'bad',
  REJECTED: 'bad',
  CANCELLED: 'bad',
  FAILED: 'bad',
  EXPIRED: 'bad',
  HIDDEN: 'bad',
  INACTIVE: 'bad',
  OFF: 'bad',
  NO: 'bad',
  DELETED: 'bad',
};

const TONE_GLYPH: Record<BadgeTone, string> = {
  ok: '●',
  warn: '◐',
  bad: '■',
  info: '◆',
  neutral: '○',
};

export function badgeTone(value: string): BadgeTone {
  return STATUS_TONE[value] ?? 'info';
}

/** Human-readable label for a raw enum status. No em dashes. */
export function statusLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Badge(props: { value: string; tone?: BadgeTone }) {
  const tone = props.tone ?? badgeTone(props.value);
  return (
    <span className={`nb-badge nb-badge-${tone}`}>
      <span className="nb-badge-dot" aria-hidden>
        {TONE_GLYPH[tone]}
      </span>
      {statusLabel(props.value)}
    </span>
  );
}

/** Backwards-compatible status badge used across the admin app. */
export function StatusBadge(props: { value: string }) {
  return <Badge value={props.value} />;
}

/* ---------------------------- page chrome --------------------------- */

export function PageHeader(props: {
  title: string;
  subtitle?: string;
  /** Small mono kicker above the title (editorial treatment). */
  kicker?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="nb-pagehead">
      <div className="nb-pagehead-text">
        {props.kicker ? <p className="nb-kicker">{props.kicker}</p> : null}
        <h1>{props.title}</h1>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </div>
      {props.actions ? <div className="nb-pagehead-actions">{props.actions}</div> : null}
    </div>
  );
}

export function Card(props: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`nb-card${props.className ? ` ${props.className}` : ''}`}>
      {props.title ? (
        <div className="nb-card-head">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle ? <p className="nb-card-sub">{props.subtitle}</p> : null}
          </div>
          {props.action ? <div className="nb-card-action">{props.action}</div> : null}
        </div>
      ) : null}
      <div className="nb-card-body">{props.children}</div>
    </section>
  );
}

/* ------------------------------- KPIs -------------------------------- */

export function Kpi(props: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  onClick?: () => void;
  attention?: boolean;
}) {
  const inner = (
    <>
      <span className="nb-kpi-value">{props.value}</span>
      <span className="nb-kpi-label">{props.label}</span>
      {props.sub ? <span className="nb-kpi-sub">{props.sub}</span> : null}
    </>
  );
  const cls = `nb-kpi${props.attention ? ' nb-kpi-attention' : ''}`;
  return props.onClick ? (
    <button type="button" className={cls} onClick={props.onClick}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function AttentionItem(props: {
  label: string;
  count?: number;
  hint?: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="nb-attention stat-triage" onClick={props.onOpen} aria-label={`${props.label}${typeof props.count === 'number' ? `: ${props.count}` : ''} - open queue`}>
      {typeof props.count === 'number' ? <span className="nb-attention-count">{props.count}</span> : null}
      <span className="nb-attention-text">
        <span className="nb-attention-label">{props.label}</span>
        {props.hint ? <span className="nb-attention-hint">{props.hint}</span> : null}
      </span>
      <span className="nb-attention-go" aria-hidden>
        →
      </span>
    </button>
  );
}

/* --------------------------- filters / tabs -------------------------- */

export function Toolbar(props: { children: React.ReactNode }) {
  return <div className="nb-toolbar">{props.children}</div>;
}

export function SearchInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="nb-search">
      <span className="nb-visually-hidden">{props.label}</span>
      <span className="nb-search-icon" aria-hidden>
        ⌕
      </span>
      <input
        type="search"
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.label}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

export function FilterSelect(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="nb-filter">
      <span className="nb-visually-hidden">{props.label}</span>
      <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Tabs(props: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="nb-tabs" role="tablist">
      {props.tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === props.active}
          className={`nb-tab${t.key === props.active ? ' nb-tab-active' : ''}`}
          onClick={() => props.onChange(t.key)}
        >
          {t.label}
          {typeof t.count === 'number' ? <span className="nb-tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- table ------------------------------- */

export type Column<T> = {
  key: string;
  header: string;
  /** Short label used when the table collapses to cards on mobile. */
  label?: string;
  render: (row: T) => React.ReactNode;
  /** Hide this column below the given breakpoint label. */
  hideBelow?: 'md' | 'sm';
};

export function DataTable<T>(props: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
}) {
  if (props.rows.length === 0) {
    return <>{props.empty ?? <EmptyState title="No records" body="There is nothing here yet." />}</>;
  }
  return (
    <div className="nb-tablewrap">
      <table className="nb-table">
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th key={c.key} className={c.hideBelow ? `nb-hide-${c.hideBelow}` : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr
              key={props.rowKey(row, i)}
              className={props.onRowClick ? 'nb-row-clickable' : undefined}
              onClick={props.onRowClick ? () => props.onRowClick!(row) : undefined}
            >
              {props.columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.label ?? c.header}
                  className={c.hideBelow ? `nb-hide-${c.hideBelow}` : undefined}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------- states ---------------------------------- */

export function LoadingState(props: { label?: string }) {
  return (
    <div className="nb-state" role="status">
      <span className="nb-spinner" aria-hidden />
      <p>{props.label ?? 'Loading…'}</p>
    </div>
  );
}

export function EmptyState(props: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="nb-state">
      <p className="nb-state-title">{props.title}</p>
      {props.body ? <p className="nb-state-body">{props.body}</p> : null}
      {props.action ? <div className="nb-state-action">{props.action}</div> : null}
    </div>
  );
}

export function ErrorState(props: { message: string; onRetry?: () => void }) {
  return (
    <div className="nb-state nb-state-error" role="alert">
      <p className="nb-state-title">Something went wrong</p>
      <p className="nb-state-body">{props.message}</p>
      {props.onRetry ? (
        <div className="nb-state-action">
          <button type="button" className="nb-btn nb-btn-secondary" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Restrained skeleton placeholder for loading tables or cards.
 * `rows` controls how many shimmer lines render.
 */
export function Skeleton(props: { rows?: number; height?: number }) {
  const rows = props.rows ?? 4;
  const height = props.height ?? 16;
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="nb-skeleton-row" key={i}>
          <div className="nb-skeleton-block" style={{ height, flex: 2 }} />
          <div className="nb-skeleton-block" style={{ height, flex: 1 }} />
          <div className="nb-skeleton-block" style={{ height, flex: 1 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Plain-language consequence messaging for decision points
 * (from The Ledger). Never speculative: state what the action does.
 */
export function Consequence(props: { children: React.ReactNode; info?: boolean }) {
  return (
    <div className={`nb-consequence${props.info ? ' nb-consequence-info' : ''}`} role="note">
      {props.children}
    </div>
  );
}

/* --------------------------- overlays -------------------------------- */

export function Modal(props: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onClose]);
  return (
    <div className="nb-modal-backdrop" onClick={props.onClose}>
      <div
        className={`nb-modal${props.wide ? ' nb-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nb-modal-head">
          <h2>{props.title}</h2>
          <button type="button" className="nb-iconbtn" onClick={props.onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="nb-modal-body">{props.children}</div>
      </div>
    </div>
  );
}

export function Drawer(props: {
  title: string;
  subtitle?: string;
  /** Mono meta line under the title (IDs, references). */
  meta?: string;
  /** Status chips rendered in the header band. */
  status?: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onClose]);
  return (
    <div className="nb-drawer-root">
      <div className="nb-drawer-backdrop" onClick={props.onClose} aria-hidden />
      <aside className="nb-drawer" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="nb-drawer-head">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
            {props.meta ? <p className="nb-drawer-meta">{props.meta}</p> : null}
            {props.status ? <div className="nb-drawer-status">{props.status}</div> : null}
          </div>
          <button type="button" className="nb-iconbtn" onClick={props.onClose} aria-label="Close panel">
            ✕
          </button>
        </div>
        <div className="nb-drawer-body">{props.children}</div>
        {props.actions ? <div className="nb-drawer-actions">{props.actions}</div> : null}
      </aside>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={props.title} onClose={props.onCancel}>
      <p className="nb-confirm-body">{props.body}</p>
      <div className="nb-form-actions">
        <button type="button" className="nb-btn nb-btn-secondary" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </button>
        <button
          type="button"
          className={`nb-btn${props.danger ? ' nb-btn-danger' : ''}`}
          onClick={props.onConfirm}
          disabled={props.busy}
        >
          {props.busy ? 'Working…' : props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------ forms --------------------------------- */

export function Field(props: {
  label: string;
  hint?: string;
  /** Inline validation message shown under the control. */
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="nb-field">
      <span className="nb-field-label">
        {props.label}
        {props.required ? <span className="nb-required" aria-hidden>*</span> : null}
      </span>
      {React.Children.map(props.children, (child) =>
        React.isValidElement(child) && props.error
          ? React.cloneElement(child as React.ReactElement<{ 'aria-invalid'?: string }>, { 'aria-invalid': 'true' })
          : child,
      )}
      {props.hint ? <span className="nb-field-hint">{props.hint}</span> : null}
      {props.error ? <span className="nb-field-error" role="alert">{props.error}</span> : null}
    </label>
  );
}

export function FormError(props: { message: string }) {
  return (
    <div className="nb-form-error" role="alert">
      {props.message}
    </div>
  );
}

export function FormActions(props: { children: React.ReactNode }) {
  return <div className="nb-form-actions">{props.children}</div>;
}

/** Grouped form block with a heading and description. */
export function FormSection(props: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nb-form-section">
      <h3>{props.title}</h3>
      {props.description ? <p>{props.description}</p> : null}
      {props.children}
    </div>
  );
}

/* --------------------------- content bits ----------------------------- */

export function DefinitionList(props: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="nb-dl">
      {props.items.map((it) => (
        <div key={it.label} className="nb-dl-row">
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar(props: { name: string; size?: number }) {
  const initials = props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span className="nb-avatar" style={props.size ? { width: props.size, height: props.size } : undefined} aria-hidden>
      {initials || '?'}
    </span>
  );
}

export function SectionTitle(props: { children: React.ReactNode }) {
  return <h3 className="nb-section-title">{props.children}</h3>;
}

/** Async helper shared by screens. Mirrors the previous useAsync contract. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = React.useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
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

export const fmtMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
