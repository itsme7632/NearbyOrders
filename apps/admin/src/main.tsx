import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import * as api from './api.js';
import { Avatar, Field, FormActions, FormError, useAsync } from './ds.js';
import { Dashboard } from './screen-dashboard.js';
import { Businesses, Categories, Reviews, Users } from './screen-marketplace.js';
import { Bookings, Orders, VerificationReview } from './screen-operations.js';
import { PaymentMethods, PaymentRequests, Subscriptions, SubscriptionPlans } from './screen-billing.js';
import { PromotionCenter } from './promotion-center.js';
import { AuditLog } from './screen-system.js';

/** Same map-pin brand glyph the mobile app uses (single inline copy). */
function PinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

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
  verifications: 'Verification',
  orders: 'Orders',
  bookings: 'Bookings',
  reviews: 'Reviews',
  categories: 'Categories',
  subscriptions: 'Subscriptions',
  plans: 'Plans',
  payments: 'Payment requests',
  paymentMethods: 'Payment methods',
  promotions: 'Promotions',
  audit: 'Audit log',
};

/** Navigation groups. Every route is preserved; grouping is visual only. */
const NAV_GROUPS: { label: string; sections: Section[] }[] = [
  { label: 'Overview', sections: ['dashboard'] },
  { label: 'Marketplace', sections: ['businesses', 'categories', 'reviews'] },
  { label: 'Operations', sections: ['orders', 'bookings', 'verifications'] },
  { label: 'Billing', sections: ['subscriptions', 'plans', 'payments', 'paymentMethods'] },
  { label: 'Growth', sections: ['promotions'] },
  { label: 'System', sections: ['users', 'audit'] },
];

function groupOf(section: Section): string {
  return NAV_GROUPS.find((g) => g.sections.includes(section))?.label ?? '';
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
            <PinIcon size={16} />
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

function SideNav(props: { section: Section; onGo: (s: Section) => void }) {
  return (
    <>
      <div className="nb-brand">
        <span className="nb-brand-mark" aria-hidden>
          <PinIcon size={16} />
        </span>
        <span className="nb-brand-name">
          Nearby<b>Orders</b>
        </span>
      </div>
      <p className="nb-brand-sub">Control Center</p>
      <nav className="nb-nav" aria-label="Admin sections">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <p className="nb-nav-group-label">{g.label}</p>
            {g.sections.map((key) => (
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
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="nb-side-foot">Marketplace operations</div>
    </>
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
    // Keep in sync with logout triggered by a 401 inside the API client.
    const timer = window.setInterval(() => setSessionState(api.getSession()), 1500);
    return () => window.clearInterval(timer);
  }, []);

  if (!session) return <LoginScreen />;

  return (
    <div className={`nb-shell${navOpen ? ' nb-nav-open' : ''}`}>
      {navOpen ? <div className="nb-nav-scrim" onClick={() => setNavOpen(false)} aria-hidden /> : null}
      <aside className="nb-side" aria-label="Admin navigation">
        <SideNav section={section} onGo={goSection} />
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
          {section === 'verifications' ? <VerificationReview /> : null}
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
