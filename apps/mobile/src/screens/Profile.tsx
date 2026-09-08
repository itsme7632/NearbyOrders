import { useState } from 'react';
import { getSession, login, logout, onSessionChange, type Session } from '../api.js';
import { Button, ErrorState, Field } from '../components/ui.js';
import { useEffect } from 'react';

export function ProfileScreen(props: { onOwnerDashboard: () => void }) {
  const [session, setSessionState] = useState<Session | null>(getSession());
  useEffect(() => onSessionChange(setSessionState), []);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<'CUSTOMER' | 'BUSINESS_OWNER'>('CUSTOMER');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    const isOwner = session.user.role === 'BUSINESS_OWNER';
    const isAdmin = session.user.role === 'ADMIN';
    return (
      <div className="screen">
        <div className="card profile-card">
          <div className="avatar" aria-hidden>
            {(session.user.email[0] ?? '?').toUpperCase()}
          </div>
          <h2>{session.user.email}</h2>
          <p className="muted">{isOwner ? 'Business owner' : isAdmin ? 'Administrator' : 'Customer'}</p>
          {isOwner ? (
            <Button full onClick={props.onOwnerDashboard}>
              Manage my business
            </Button>
          ) : null}
          <Button full variant="ghost" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        if (password !== confirm) throw new Error('Passwords do not match');
        const res = await fetch('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, role }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? 'Registration failed');
      }
      await login(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="card profile-card">
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="muted">
          {mode === 'login' ? 'Sign in to book services and order from local businesses.' : 'Join as a customer or list your business.'}
        </p>

        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </Field>
        {mode === 'register' ? (
          <>
            <Field label="Confirm password">
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="I am joining as">
              <div className="role-picker">
                <button type="button" className={`chip${role === 'CUSTOMER' ? ' chip-active' : ''}`} onClick={() => setRole('CUSTOMER')}>
                  Customer
                </button>
                <button type="button" className={`chip${role === 'BUSINESS_OWNER' ? ' chip-active' : ''}`} onClick={() => setRole('BUSINESS_OWNER')}>
                  Business owner
                </button>
              </div>
            </Field>
          </>
        ) : null}

        {error ? <ErrorState message={error} /> : null}

        <Button full disabled={busy || !email || !password} onClick={submit}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
        <button className="link-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
