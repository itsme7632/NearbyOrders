import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, getSession, login, logout, onSessionChange, type Session } from '../api.js';
import { Button, Field } from '../components/ui.js';
import {
  AlertIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
  PinIcon,
  StoreIcon,
  UserPlusIcon,
} from '../components/icons.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 12;

type Mode = 'login' | 'register';
type Role = 'CUSTOMER' | 'BUSINESS_OWNER';

/** Input row with a leading icon and floating label, per the auth design reference. */
function AuthInput(props: { label: string; icon: ReactNode; invalid?: boolean; children: ReactNode }) {
  return (
    <div className={`auth-input${props.invalid ? ' input-invalid' : ''}`}>
      <span className="auth-input-icon" aria-hidden>
        {props.icon}
      </span>
      <span className="auth-input-field">
        <span className="auth-input-label" aria-hidden>
          {props.label}
        </span>
        {props.children}
      </span>
    </div>
  );
}

function PasswordInput(props: { value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-slot">
      <input
        type={visible ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        aria-label="Password"
        aria-invalid={props.invalid || undefined}
        enterKeyHint="done"
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOffIcon size={19} /> : <EyeIcon size={19} />}
      </button>
    </div>
  );
}

function roleCopy(role: Role): string {
  return role === 'CUSTOMER'
    ? 'Discover local businesses, book services and place orders.'
    : 'List your business, manage services, products and hours.';
}

export function ProfileScreen(props: { onOwnerDashboard: () => void }) {
  const [session, setSessionState] = useState<Session | null>(getSession());
  useEffect(() => onSessionChange(setSessionState), []);

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<Role>('CUSTOMER');
  const [agree, setAgree] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    const isOwner = session.user.role === 'BUSINESS_OWNER';
    const isAdmin = session.user.role === 'ADMIN';
    return (
      <div className="screen">
        <div className="card profile-card auth-card">
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

  const registering = mode === 'register';
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= MIN_PASSWORD;
  const confirmValid = password === confirm;
  const canSubmit = emailValid && passwordValid && (!registering || (confirmValid && agree)) && !busy;

  let emailMessage: string | null = null;
  if (touched && email.length > 0 && !emailValid) emailMessage = 'Enter a valid email address, e.g. you@example.com';
  let passwordMessage: string | null = null;
  if (touched && password.length > 0 && !passwordValid) passwordMessage = `Password must be at least ${MIN_PASSWORD} characters.`;
  let confirmMessage: string | null = null;
  if (touched && confirm.length > 0 && !confirmValid) confirmMessage = 'Passwords do not match.';

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (registering) {
        const res = await fetch('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password, role }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? 'Registration failed');
      }
      await login(email.trim(), password);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError('Incorrect email or password. Please try again.');
      else if (e instanceof ApiError && e.status === 409) setError('An account with this email already exists. Try signing in instead.');
      else if (e instanceof ApiError && e.status === 0) setError(e.message);
      else setError(e instanceof Error ? e.message : 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setTouched(false);
  };

  return (
    <div className="screen auth-screen">
      <header className="auth-brand">
        <span className="auth-brand-mark" aria-hidden>
          <PinIcon size={26} />
        </span>
        <span className="auth-brand-name">
          Nearby<b>Orders</b>
        </span>
        <span className="auth-brand-tag">Find nearby. Book or order.</span>
      </header>

      <section className="auth-card" aria-label={registering ? 'Create account' : 'Sign in'}>
        <h1>{registering ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-lede">
          {registering ? 'Join as a customer or list your business.' : 'Sign in to book services and order from local businesses.'}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <Field label="Email" hint={emailMessage ?? undefined}>
            <AuthInput label="Email" icon={<MailIcon size={18} />} invalid={Boolean(emailMessage)}>
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
                autoComplete="email"
                placeholder="you@example.com"
                enterKeyHint="next"
                aria-label="Email"
                aria-invalid={Boolean(emailMessage)}
              />
            </AuthInput>
          </Field>

          <Field label="Password" hint={passwordMessage ?? undefined}>
            <AuthInput label="Password" icon={<LockIcon size={18} />} invalid={Boolean(passwordMessage)}>
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoComplete={registering ? 'new-password' : 'current-password'}
                invalid={Boolean(passwordMessage)}
              />
            </AuthInput>
          </Field>

          {registering ? (
            <>
              <Field label="Confirm password" hint={confirmMessage ?? undefined}>
                <AuthInput label="Confirm password" icon={<LockIcon size={18} />} invalid={Boolean(confirmMessage)}>
                  <PasswordInput
                    value={confirm}
                    onChange={setConfirm}
                    autoComplete="new-password"
                    invalid={Boolean(confirmMessage)}
                  />
                </AuthInput>
              </Field>

              <fieldset className="role-picker-field">
                <legend className="label">I am joining as</legend>
                <div className="role-picker" role="radiogroup" aria-label="I am joining as">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={role === 'CUSTOMER'}
                    className={`role-option${role === 'CUSTOMER' ? ' role-option-active' : ''}`}
                    onClick={() => setRole('CUSTOMER')}
                  >
                    {role === 'CUSTOMER' ? (
                      <span className="role-check" aria-hidden>
                        <CheckIcon size={12} />
                      </span>
                    ) : null}
                    <UserPlusIcon size={22} />
                    <span className="role-option-name">Customer</span>
                    <span className="role-option-desc">Find &amp; book nearby businesses</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={role === 'BUSINESS_OWNER'}
                    className={`role-option${role === 'BUSINESS_OWNER' ? ' role-option-active' : ''}`}
                    onClick={() => setRole('BUSINESS_OWNER')}
                  >
                    {role === 'BUSINESS_OWNER' ? (
                      <span className="role-check" aria-hidden>
                        <CheckIcon size={12} />
                      </span>
                    ) : null}
                    <StoreIcon size={22} />
                    <span className="role-option-name">Business owner</span>
                    <span className="role-option-desc">List &amp; manage your business</span>
                  </button>
                </div>
                <p className="hint">{roleCopy(role)}</p>
              </fieldset>
            </>
          ) : (
            <div className="auth-row">
              {/* Password recovery is not implemented in the API yet; the link is
                  shown disabled rather than pretending to work. */}
              <button type="button" className="forgot-link" disabled title="Password reset is coming soon">
                Forgot password?
              </button>
            </div>
          )}

          {error ? (
            <div className="auth-error" role="alert">
              <AlertIcon size={18} />
              <span>{error}</span>
            </div>
          ) : null}

          <Button full type="submit" disabled={!canSubmit}>
            {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
          </Button>

          {registering ? (
            <label className="agree-row">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                I agree to the <b>Terms of Service</b> and <b>Privacy Policy</b>
              </span>
            </label>
          ) : null}
        </form>

        <p className="auth-switch">
          {registering ? 'Already have an account? ' : 'New here? '}
          <button type="button" className="link-inline" onClick={() => switchMode(registering ? 'login' : 'register')}>
            {registering ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </section>
    </div>
  );
}
