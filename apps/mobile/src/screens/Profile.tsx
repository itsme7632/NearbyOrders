import { useEffect, useState, type ReactNode } from 'react';
import {
  ApiError,
  changeMyPassword,
  getSession,
  login,
  logout,
  onSessionChange,
  updateMyProfile,
  whoami,
  type MyProfile,
  type Session,
} from '../api.js';
import { Button, ErrorState, Field } from '../components/ui.js';
import {
  AlertIcon,
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  HelpIcon,
  InfoIcon,
  KeyIcon,
  LockIcon,
  MailIcon,
  OrdersIcon,
  PinIcon,
  StoreIcon,
  UserIcon,
  UserPlusIcon,
} from '../components/icons.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 12;

type Mode = 'login' | 'register';
type Role = 'CUSTOMER' | 'BUSINESS_OWNER';

/**
 * Input row with a leading icon. The permanent label lives outside (via the
 * wrapping Field); the input shows only a placeholder, per the auth reference.
 */
function AuthInput(props: { icon: ReactNode; invalid?: boolean; children: ReactNode }) {
  return (
    <div className={`auth-input${props.invalid ? ' input-invalid' : ''}`}>
      <span className="auth-input-icon" aria-hidden>
        {props.icon}
      </span>
      <span className="auth-input-field">{props.children}</span>
    </div>
  );
}

function PasswordInput(props: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  invalid?: boolean;
  placeholder: string;
  label: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-slot">
      <input
        type={visible ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        aria-label={props.label}
        aria-invalid={props.invalid || undefined}
        placeholder={props.placeholder}
        enterKeyHint="done"
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
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

/* ------------------------------------------------------------------ */
/* Signed-in: Account & Settings hub                                   */
/* ------------------------------------------------------------------ */

/** One tappable settings row (or a static one when disabled). */
function HubRow(props: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span className="hub-row-icon" aria-hidden>
        {props.icon}
      </span>
      <span className="hub-row-text">
        <span className="hub-row-title">{props.title}</span>
        {props.subtitle ? <span className="hub-row-sub">{props.subtitle}</span> : null}
      </span>
      {props.disabled ? (
        <span className="hub-row-soon">Soon</span>
      ) : (
        <span className="hub-row-chevron" aria-hidden>
          <ChevronRightIcon size={18} />
        </span>
      )}
    </>
  );
  if (props.disabled || !props.onClick) return <div className="hub-row hub-row-disabled">{body}</div>;
  return (
    <button type="button" className="hub-row" onClick={props.onClick}>
      {body}
    </button>
  );
}

function HubSection(props: { label: string; children: ReactNode }) {
  return (
    <section className="hub-section" aria-label={props.label}>
      <h3 className="hub-section-label">{props.label}</h3>
      <div className="hub-card">{props.children}</div>
    </section>
  );
}

export function EditProfileScreen(props: { onBack: () => void; onSaved: () => void }) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    whoami()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setFirstName(p.firstName ?? '');
        setLastName(p.lastName ?? '');
        setPhone(p.phone ?? '');
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your profile. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const phoneProvided = phone.trim().length > 0;
  const phoneValid = !phoneProvided || /^[+\d][\d\s-]{6,19}$/.test(phone.trim());
  const canSubmit = !busy && !loadError && phoneValid;

  const submit = async () => {
    setTouched(true);
    setSaved(false);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await updateMyProfile({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        phone: phone.trim() || null,
      });
      setSaved(true);
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your profile. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <div className="screen-head">
        <h1>Edit profile</h1>
        <p className="muted">Update how your name appears in the app.</p>
      </div>

      {loadError ? (
        <div className="card">
          <ErrorState message={loadError} />
        </div>
      ) : !profile ? (
        <div className="loading" role="status">
          <span className="spinner" aria-hidden /> Loading your profile…
        </div>
      ) : (
        <div className="card">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            noValidate
          >
            <Field label="First name">
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" placeholder="Your first name" aria-label="First name" enterKeyHint="next" />
            </Field>
            <Field label="Last name">
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" placeholder="Your last name" aria-label="Last name" enterKeyHint="next" />
            </Field>
            <Field label="Phone" hint={phoneProvided && !phoneValid ? 'Enter a valid phone number, e.g. +92 300 1234567' : undefined}>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="e.g. +92 300 1234567"
                aria-label="Phone"
                aria-invalid={phoneProvided && !phoneValid}
                enterKeyHint="done"
              />
            </Field>
            <Field label="Email">
              <input value={profile.email} disabled aria-readonly readOnly aria-label="Email (cannot be changed)" />
            </Field>
            <p className="hint">Email is your sign-in identity and cannot be changed yet.</p>

            {error ? (
              <div className="auth-error" role="alert">
                <AlertIcon size={18} />
                <span>{error}</span>
              </div>
            ) : null}
            {saved && !error ? <p className="save-ok">Profile updated ✓</p> : null}

            <div className="btn-row">
              <Button type="submit" disabled={!canSubmit}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="ghost" onClick={props.onBack} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function ChangePasswordScreen(props: { onBack: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const nextValid = next.length >= 12;
  const confirmValid = next === confirm;
  const canSubmit = !busy && current.length > 0 && nextValid && confirmValid;

  const submit = async () => {
    setTouched(true);
    setDone(false);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await changeMyPassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      setTouched(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setError('Your current password is incorrect.');
      else setError(e instanceof Error ? e.message : 'Could not change your password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <div className="screen-head">
        <h1>Change password</h1>
        <p className="muted">Choose a strong password you don't use elsewhere.</p>
      </div>

      <div className="card">
        {done ? (
          <div className="created-banner" role="status">
            <CheckIcon size={16} />
            <span>Password changed. Other devices have been signed out.</span>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <Field label="Current password">
            <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" placeholder="Enter your current password" label="Current password" />
          </Field>
          <Field label="New password" hint={next.length > 0 && !nextValid ? 'Use at least 12 characters.' : undefined}>
            <PasswordInput value={next} onChange={setNext} autoComplete="new-password" invalid={next.length > 0 && !nextValid} placeholder="At least 12 characters" label="New password" />
          </Field>
          <Field label="Confirm new password" hint={confirm.length > 0 && !confirmValid ? 'Passwords do not match.' : undefined}>
            <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={confirm.length > 0 && !confirmValid} placeholder="Repeat your new password" label="Confirm new password" />
          </Field>

          {error ? (
            <div className="auth-error" role="alert">
              <AlertIcon size={18} />
              <span>{error}</span>
            </div>
          ) : null}

          <Button full type="submit" disabled={!canSubmit}>
            {busy ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </div>
    </div>
  );
}

function AccountHub(props: {
  session: Session;
  onOwnerDashboard: () => void;
  onEditProfile: () => void;
  onChangePassword: () => void;
  onOpenOrders: () => void;
  onOpenBookings: () => void;
  onOpenNotifications: () => void;
}) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    whoami()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        /* header falls back to email-derived name; refreshes on next visit */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOwner = props.session.user.role === 'BUSINESS_OWNER';
  const isAdmin = props.session.user.role === 'ADMIN';
  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  const initial = (displayName || props.session.user.email)[0]?.toUpperCase() ?? '?';

  return (
    <div className="screen">
      {/* v4 identity header: the person, clearly. Business management is a
          distinct section below — never the identity itself. */}
      <div className="card profile-hero-v4">
        <div className="avatar-v4" aria-hidden>
          {initial}
        </div>
        <div className="profile-hero-text">
          <h2 className="profile-hero-name">{displayName || props.session.user.email}</h2>
          <p className="profile-hero-email">{props.session.user.email}</p>
          <span className="pill">{isOwner ? 'Business owner' : isAdmin ? 'Administrator' : 'Customer'}</span>
        </div>
        <Button sm variant="secondary" className="profile-edit-btn" onClick={props.onEditProfile}>
          Edit profile
        </Button>
        {isOwner ? (
          <button type="button" className="manage-cta" onClick={props.onOwnerDashboard}>
            <StoreIcon size={16} />
            Manage my business
          </button>
        ) : null}
      </div>

      <HubSection label="Account">
        <HubRow icon={<UserIcon size={19} />} title="Personal information" subtitle="Name and phone number" onClick={props.onEditProfile} />
        <HubRow icon={<KeyIcon size={19} />} title="Change password" onClick={props.onChangePassword} />
      </HubSection>

      <HubSection label="Activity">
        <HubRow icon={<OrdersIcon size={19} />} title="My orders" onClick={props.onOpenOrders} />
        <HubRow icon={<BookingsHubIcon size={19} />} title="My bookings" onClick={props.onOpenBookings} />
        <HubRow icon={<span aria-hidden>★</span>} title="My reviews" subtitle="Reviews you've written" disabled />
      </HubSection>

      <HubSection label="Preferences">
        <HubRow icon={<BellIcon size={19} />} title="Notifications" subtitle="Updates about your bookings and orders" onClick={props.onOpenNotifications} />
      </HubSection>

      <HubSection label="Support & information">
        <HubRow icon={<HelpIcon size={19} />} title="Help & support" disabled />
        <HubRow icon={<InfoIcon size={19} />} title="Terms & conditions" disabled />
        <HubRow icon={<InfoIcon size={19} />} title="Privacy policy" disabled />
        <HubRow icon={<InfoIcon size={19} />} title="About NearbyOrders" subtitle="Find nearby. Book or order." disabled />
      </HubSection>

      <div className="card">
        <Button full variant="ghost" onClick={logout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

function BookingsHubIcon(props: { size?: number }) {
  return <BookingsIconSize {...props} />;
}

function BookingsIconSize(props: { size?: number }) {
  return (
    <svg width={props.size ?? 22} height={props.size ?? 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  );
}

export function ProfileScreen(props: {
  onOwnerDashboard: () => void;
  onEditProfile: () => void;
  onChangePassword: () => void;
  onOpenOrders: () => void;
  onOpenBookings: () => void;
  onOpenNotifications: () => void;
}) {
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
    return (
      <AccountHub
        session={session}
        onOwnerDashboard={props.onOwnerDashboard}
        onEditProfile={props.onEditProfile}
        onChangePassword={props.onChangePassword}
        onOpenOrders={props.onOpenOrders}
        onOpenBookings={props.onOpenBookings}
        onOpenNotifications={props.onOpenNotifications}
      />
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
    <div className="screen auth-screen auth-screen-v4">
      <header className="auth-brand auth-brand-v4">
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
            <AuthInput icon={<MailIcon size={18} />} invalid={Boolean(emailMessage)}>
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
            <AuthInput icon={<LockIcon size={18} />} invalid={Boolean(passwordMessage)}>
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoComplete={registering ? 'new-password' : 'current-password'}
                invalid={Boolean(passwordMessage)}
                placeholder="Enter your password"
                label="Password"
              />
            </AuthInput>
          </Field>

          {registering ? (
            <>
              <Field label="Confirm password" hint={confirmMessage ?? undefined}>
                <AuthInput icon={<LockIcon size={18} />} invalid={Boolean(confirmMessage)}>
                  <PasswordInput
                    value={confirm}
                    onChange={setConfirm}
                    autoComplete="new-password"
                    invalid={Boolean(confirmMessage)}
                    placeholder="Confirm your password"
                    label="Confirm password"
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
