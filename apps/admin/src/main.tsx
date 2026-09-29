import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import * as api from './api.js';
import { Avatar, Field, FormActions, FormError, MeridianMark, useAsync } from './ds.js';
import { Dashboard } from './screen-dashboard.js';
import { Businesses, Categories, Reviews, Users } from './screen-marketplace.js';
import { Bookings, Orders, VerificationReview } from './screen-operations.js';
import { PaymentMethods, PaymentRequests, Subscriptions, SubscriptionPlans } from './screen-billing.js';
import { PromotionCenter } from './promotion-center.js';
import { AuditLog } from './screen-system.js';

export type Section =
  | 'dashboard'
  | 'users'
  | 'businesses'
  | 'verifications'
  | 'orders'
  | 'bookings'
  | 'reviews'
  | 'categories'
  | 'subscriptions'
  | 'plans'
  | 'payments'
  | 'paymentMethods'
  | 'promotions'
  | 'audit';

const SECTION_ICONS: Record<Section, string> = {
  dashboard: '▦',
  users: '◉',
  businesses: '⌂',
  verifications: '☑',
  orders: '▣',
  bookings: '▤',
  reviews: '★',
  categories: '⌗',
  subscriptions: '⟳',
  plans: '◆',
  payments: '₨',
  paymentMethods: '◈',
  promotions: '✦',
  audit: '☰',
};

const SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Dashboard',
  users: 'Users',
  businesses: 'Businesses',
  verifications: 'Verifications',
  orders: 'Orders',
  bookings: 'Bookings',
  reviews: 'Reviews',
  categories: 'Categories',
  subscriptions: 'Subscriptions',
  plans: 'Plans',
  payments: 'Payment review',
  paymentMethods: 'Payment methods',
  promotions: 'Promotions',
  audit: 'Audit log',
};

/** Navigation groups. Every route is preserved; grouping is visual only. */
const NAV_GROUPS: { label: string; sections: Section[] }[] = [
  { label: 'Overview', sections: ['dashboard'] },
  { label: 'Marketplace', sections: ['businesses', 'verifications'] },
  { label: 'Operations', sections: ['orders', 'bookings', 'reviews', 'categories'] },
  { label: 'Billing', sections: ['subscriptions', 'plans', 'payments', 'paymentMethods'] },
  { label: 'Growth', sections: ['promotions'] },
  { label: 'System', sections: ['users', 'audit'] },
];

function groupOf(section: Section): string {
  return NAV_GROUPS.find((g) => g.sections.includes(section))?.label ?? '';
}

/**
 * Real queue counts for the rail badges. Every count comes from a live API
 * call; a failed fetch simply shows no badge. Counts are never fabricated.
 */
function useQueueBadges(session: api.Session | null): Partial<Record<Section, number>> {
  const [badges, setBadges] = useState<Partial<Record<Section, number>>>({});
  // Key on a stable session identity (user + token), not the object reference.
  // getSession() JSON.parses on every call, so object identity is never stable;
  // keying the effect on the object would refetch the 5 badge endpoints every
  // time a new-but-equivalent session object flows through (the 429 pattern).
  const sessionKey = session ? `${session.user.id}:${session.accessToken}` : '';
  useEffect(() => {
    if (!sessionKey) return;
    let alive = true;
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);
    Promise.allSettled([
      api.getDashboard(),
      api.listVerifications({ status: 'SUBMITTED' }),
      api.listVerifications({ status: 'UNDER_REVIEW' }),
      api.listPromotionRequests('PENDING'),
      api.listPromotionPaymentRequests({ status: 'PENDING' }),
    ]).then(([dash, vSub, vRev, promoReq, promoPay]) => {
      if (!alive) return;
      const next: Partial<Record<Section, number>> = {};
      if (dash.status === 'fulfilled') {
        const d = dash.value;
        if (num(d.pendingBusinesses)) next.businesses = d.pendingBusinesses;
        if (num(d.pendingOrders)) next.orders = d.pendingOrders;
        if (num(d.pendingBookings)) next.bookings = d.pendingBookings;
        if (num(d.pendingSubscriptionPayments)) next.payments = d.pendingSubscriptionPayments;
        if (num(d.hiddenReviews)) next.reviews = d.hiddenReviews;
      }
      const verif =
        (vSub.status === 'fulfilled' ? vSub.value.length : 0) +
        (vRev.status === 'fulfilled' ? vRev.value.length : 0);
      if (verif > 0) next.verifications = verif;
      const promo =
        (promoReq.status === 'fulfilled' ? promoReq.value.length : 0) +
        (promoPay.status === 'fulfilled' ? promoPay.value.items.length : 0);
      if (promo > 0) next.promotions = promo;
      setBadges(next);
    });
    return () => {
      alive = false;
    };
  }, [sessionKey]);
  return badges;
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
    <div className="nb-auth-wrap">
      <form className="nb-auth-card" onSubmit={submit}>
        <div className="nb-auth-brand">
          <span className="nb-brand-mark" aria-hidden>
            <MeridianMark size={20} />
          </span>
          NearbyOrders
        </div>
        <h1>Control Center</h1>
        <p className="sub">Platform administration. Administrator accounts only.</p>
        <p className="sub">Admin accounts are created with the secure provisioning script. See apps/api/ADMIN_ACCESS.md.</p>
        {error ? <FormError message={error} /> : null}
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <FormActions>
          <button type="submit" className="nb-btn" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </FormActions>
      </form>
    </div>
  );
}

/* ------------------------------ navigation ---------------------------- */

function SideNav(props: { section: Section; onGo: (s: Section) => void; badges: Partial<Record<Section, number>> }) {
  return (
    <>
      <div className="nb-brand">
        <span className="nb-brand-mark" aria-hidden>
          <MeridianMark size={22} />
        </span>
        <span className="nb-brand-name">NearbyOrders</span>
      </div>
      <p className="nb-brand-sub">Operations</p>
      <nav className="nb-nav" aria-label="Admin sections">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <p className="nb-nav-group-label">{g.label}</p>
            {g.sections.map((key) => {
              const count = props.badges[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`nb-nav-item${props.section === key ? ' active' : ''}`}
                  aria-current={props.section === key ? 'page' : undefined}
                  onClick={() => props.onGo(key)}
                >
                  <span className="nb-nav-glyph" aria-hidden>
                    {SECTION_ICONS[key]}
                  </span>
                  {SECTION_LABELS[key]}
                  {typeof count === 'number' && count > 0 ? (
                    <span className="nb-nav-count" aria-label={`${count} pending`}>
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="nb-side-foot">ops console · v1</div>
    </>
  );
}

/** Command-style section search in the top bar. */
function SectionSearch(props: { onGo: (s: Section) => void }) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const matches: Section[] = q.trim()
    ? (Object.keys(SECTION_LABELS) as Section[]).filter(
        (s) =>
          SECTION_LABELS[s].toLowerCase().includes(q.trim().toLowerCase()) ||
          groupOf(s).toLowerCase().includes(q.trim().toLowerCase()),
      )
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <label className="nb-topbar-search">
        <span aria-hidden>⌕</span>
        <span className="nb-visually-hidden">Search admin sections</span>
        <input
          ref={inputRef}
          value={q}
          placeholder="Search sections…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length > 0) {
              props.onGo(matches[0]!);
              setQ('');
              inputRef.current?.blur();
            } else if (e.key === 'Escape') {
              setQ('');
              inputRef.current?.blur();
            }
          }}
          aria-expanded={matches.length > 0}
          role="combobox"
          aria-autocomplete="list"
        />
        <kbd>⌘K</kbd>
      </label>
      {matches.length > 0 ? (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#fff',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: 6,
            zIndex: 50,
          }}
        >
          {matches.slice(0, 6).map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={false}
              className="nb-nav-item"
              style={{ color: 'var(--ink)', width: '100%' }}
              onClick={() => {
                props.onGo(s);
                setQ('');
              }}
            >
              <span className="nb-nav-glyph" aria-hidden style={{ color: 'var(--muted)' }}>
                {SECTION_ICONS[s]}
              </span>
              {SECTION_LABELS[s]}
              <span className="nb-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                {groupOf(s)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- app --------------------------------- */

export function AdminApp() {
  const [session, setSessionState] = useState<api.Session | null>(api.getSession());
  const [section, setSection] = useState<Section>('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  // Dashboard triage carries a pre-applied filter into the target section.
  // Manual nav clears it so filters never leak between visits. Payment
  // triage can also carry a businessId to pre-filter the payment queue.
  const [triage, setTriage] = useState<{ section: Section; status?: string; businessId?: string } | null>(null);
  const badges = useQueueBadges(session);

  const goSection = (s: Section) => {
    setTriage(null);
    setSection(s);
    setNavOpen(false);
  };
  const triageTo = (s: Section, status?: string, businessId?: string) => {
    setTriage({ section: s, status, businessId });
    setSection(s);
    setNavOpen(false);
  };
  // Remounts a section when a triage shortcut targets it (including when it
  // is already open) so the pre-applied filter takes effect. Manual nav
  // clears triage, which also remounts and resets any triage filter.
  const triageKey = (s: Section) => {
    const t = triage?.section === s ? triage : null;
    return `${s}:${t?.status ?? ''}:${t?.businessId ?? ''}`;
  };

  useEffect(() => {
    // Keeps the shell in sync with session changes — login, explicit logout,
    // and 401-triggered logout inside the API client — via subscription.
    // (A 1.5s polling interval used to live here; getSession() JSON.parses on
    // every call, so each tick produced a new session identity, re-ran the
    // [session]-keyed badge effect, and fired 5 API requests every 1.5s —
    // ~200 req/min from one idle tab, exhausting the per-IP rate-limit bucket.)
    return api.onSessionChange(setSessionState);
  }, []);

  if (!session) return <LoginScreen />;

  return (
    <div className={`nb-shell${navOpen ? ' nb-nav-open' : ''}`}>
      {navOpen ? <div className="nb-nav-scrim" onClick={() => setNavOpen(false)} aria-hidden /> : null}
      <aside className="nb-side" aria-label="Admin navigation">
        <SideNav section={section} onGo={goSection} badges={badges} />
      </aside>
      <div className="nb-main">
        <header className="nb-topbar">
          <button
            type="button"
            className="nb-iconbtn nb-menu-btn"
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
          >
            ☰
          </button>
          <div className="nb-crumb" aria-live="polite">
            <span>{groupOf(section)}</span>
            <strong>{SECTION_LABELS[section]}</strong>
          </div>
          <SectionSearch onGo={goSection} />
          <div className="nb-topbar-spacer" />
          <div className="nb-admin-id">
            <Avatar name={session.user.email} size={32} />
            <span className="nb-admin-email">{session.user.email}</span>
            <button
              type="button"
              className="nb-btn nb-btn-secondary nb-btn-sm"
              onClick={() => {
                api.logout();
                setSessionState(null);
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="nb-content">
          {section === 'dashboard' ? <Dashboard onTriage={(s: string, status?: string) => triageTo(s as Section, status)} /> : null}
          {section === 'users' ? <Users /> : null}
          {section === 'businesses' ? (
            <Businesses
              key={triageKey('businesses')}
              initialStatus={triage?.section === 'businesses' ? triage.status : undefined}
              onOpenPayments={(businessId) => triageTo('payments', undefined, businessId)}
            />
          ) : null}
          {section === 'verifications' ? (
            <VerificationReview
              key={triageKey('verifications')}
              initialStatus={triage?.section === 'verifications' ? triage.status : undefined}
            />
          ) : null}
          {section === 'orders' ? <Orders key={triageKey('orders')} initialStatus={triage?.section === 'orders' ? triage.status : undefined} /> : null}
          {section === 'bookings' ? <Bookings key={triageKey('bookings')} initialStatus={triage?.section === 'bookings' ? triage.status : undefined} /> : null}
          {section === 'reviews' ? <Reviews key={triageKey('reviews')} initialStatus={triage?.section === 'reviews' ? (triage.status as '' | 'visible' | 'hidden' | undefined) : undefined} /> : null}
          {section === 'categories' ? <Categories /> : null}
          {section === 'subscriptions' ? <Subscriptions /> : null}
          {section === 'plans' ? <SubscriptionPlans /> : null}
          {section === 'payments' ? (
            <PaymentRequests
              key={triageKey('payments')}
              initialStatus={triage?.section === 'payments' ? triage.status : undefined}
              initialBusinessId={triage?.section === 'payments' ? triage.businessId : undefined}
            />
          ) : null}
          {section === 'paymentMethods' ? <PaymentMethods /> : null}
          {section === 'promotions' ? <PromotionCenter /> : null}
          {section === 'audit' ? <AuditLog /> : null}
        </main>
      </div>
    </div>
  );
}

const mount = document.getElementById('root');
if (mount) createRoot(mount).render(<AdminApp />);

/* Keep the previous module surface used by tests. */
export { useAsync };
export { Dashboard } from './screen-dashboard.js';
export { Businesses } from './screen-marketplace.js';
