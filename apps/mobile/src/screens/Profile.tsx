import { useEffect, useState, type ReactNode } from 'react';
import {
  ApiError,
  changeMyPassword,
  getSession,
  login,
  logout,
  onSessionChange,
  register,
  updateMyProfile,
  whoami,
  type MyProfile,
  type Session,
} from '../api.js';
import { Button, ErrorState, Field } from '../components/ui.js';
import { PasswordInput } from '../components/PasswordInput.js';
import { setAuthFlowState } from '../authFlow.js';
import {
  AlertIcon,
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  HeartIcon,
  HelpIcon,
  InfoIcon,
  KeyIcon,
  LockIcon,
  MailIcon,
  MoonIcon,
  ThemedMark,
  OrdersIcon,
  PinIcon,
  StoreIcon,
  UserIcon,
} from '../components/icons.js';
import { useTheme } from '../theme.js';

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
  // The fetch must fire exactly once per mount and once per manual retry,
  // never on re-render.
  const [loadRetry, setLoadRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRetry]);

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
          <ErrorState message={loadError} onRetry={() => setLoadRetry((n) => n + 1)} />
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
  onOpenSaved: () => void;
  onOpenMyReviews: () => void;
  onOpenAddresses: () => void;
  onOpenAppearance: () => void;
  onOpenInfo: (page: 'help' | 'terms' | 'privacy' | 'about') => void;
}) {
  const { preference } = useTheme();
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
    <div className="screen profile-screen">
      {/* Identity band: the person, clearly, on the brand surface. Business
          management is a distinct section below, never the identity. */}
      <div className="me-band">
        <div className="me-band-row">
          <div className="avatar-v4" aria-hidden>
            {initial}
          </div>
          <div className="profile-hero-text">
            <h2 className="profile-hero-name">{displayName || props.session.user.email}</h2>
            <p className="profile-hero-email">{props.session.user.email}</p>
          </div>
          <button type="button" className="btn btn-sm me-edit-btn" onClick={props.onEditProfile}>
            Edit profile
          </button>
        </div>
        <div className="me-band-foot">
          <span className="me-role">{isOwner ? 'Business owner' : isAdmin ? 'Administrator' : 'Customer'}</span>
          {isOwner ? (
            <button type="button" className="manage-cta" onClick={props.onOwnerDashboard}>
              <StoreIcon size={15} />
              Manage my business
            </button>
          ) : null}
        </div>
      </div>

      <HubSection label="Account">
        <HubRow icon={<UserIcon size={19} />} title="Personal information" subtitle="Name and phone number" onClick={props.onEditProfile} />
        <HubRow icon={<KeyIcon size={19} />} title="Change password" onClick={props.onChangePassword} />
      </HubSection>

      <HubSection label="Activity">
        <HubRow icon={<OrdersIcon size={19} />} title="My orders" onClick={props.onOpenOrders} />
        <HubRow icon={<BookingsHubIcon size={19} />} title="My bookings" onClick={props.onOpenBookings} />
        <HubRow icon={<HeartIcon size={19} />} title="Saved businesses" onClick={props.onOpenSaved} />
        <HubRow icon={<span aria-hidden>★</span>} title="My reviews" subtitle="Reviews you've written" onClick={props.onOpenMyReviews} />
      </HubSection>

      <HubSection label="Preferences">
        <HubRow icon={<BellIcon size={19} />} title="Notifications" subtitle="Updates about your bookings and orders" onClick={props.onOpenNotifications} />
        <HubRow icon={<PinIcon size={19} />} title="Addresses" subtitle="Delivery addresses for orders" onClick={props.onOpenAddresses} />
        <HubRow
          icon={<MoonIcon size={19} />}
          title="Appearance"
          subtitle={preference === 'light' ? 'Light' : preference === 'dark' ? 'Dark' : 'System'}
          onClick={props.onOpenAppearance}
        />
      </HubSection>

      <HubSection label="Support & information">
        <HubRow icon={<HelpIcon size={19} />} title="Help & support" onClick={() => props.onOpenInfo('help')} />
        <HubRow icon={<InfoIcon size={19} />} title="Terms & conditions" onClick={() => props.onOpenInfo('terms')} />
        <HubRow icon={<InfoIcon size={19} />} title="Privacy policy" onClick={() => props.onOpenInfo('privacy')} />
        <HubRow icon={<InfoIcon size={19} />} title="About NearbyOrders" subtitle="Find nearby. Book or order." onClick={() => props.onOpenInfo('about')} />
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
  onOpenSaved: () => void;
  onOpenMyReviews: () => void;
  onOpenAddresses: () => void;
  onOpenAppearance: () => void;
  onOpenInfo: (page: 'help' | 'terms' | 'privacy' | 'about') => void;
  onForgotPassword: () => void;
  onRegisterSuccess: () => void;
}) {
  const [session, setSessionState] = useState<Session | null>(getSession());
  useEffect(() => onSessionChange(setSessionState), []);

  const [mode, setMode] = useState<Mode>('login');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
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
        onOpenSaved={props.onOpenSaved}
        onOpenMyReviews={props.onOpenMyReviews}
        onOpenAddresses={props.onOpenAddresses}
        onOpenAppearance={props.onOpenAppearance}
        onOpenInfo={props.onOpenInfo}
      />
    );
  }

  const registering = mode === 'register';
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= MIN_PASSWORD;
  const confirmValid = password === confirm;
  const phoneValid = /^[+\d][\d\s-]{6,19}$/.test(phone.trim());
  const profileFieldsValid = firstName.trim().length > 0 && lastName.trim().length > 0 && phoneValid;
  const canSubmit = emailValid && passwordValid && (!registering || (profileFieldsValid && confirmValid && agree)) && !busy;

  let emailMessage: string | null = null;
  if (touched && email.length > 0 && !emailValid) emailMessage = 'Enter a valid email address, e.g. you@example.com';
  let passwordMessage: string | null = null;
  if (touched && password.length > 0 && !passwordValid) passwordMessage = `Password must be at least ${MIN_PASSWORD} characters.`;
  let confirmMessage: string | null = null;
  if (touched && confirm.length > 0 && !confirmValid) confirmMessage = 'Passwords do not match.';
  let firstNameMessage: string | null = null;
  if (touched && registering && firstName.trim().length === 0) firstNameMessage = 'Enter your first name.';
  let lastNameMessage: string | null = null;
  if (touched && registering && lastName.trim().length === 0) lastNameMessage = 'Enter your last name.';
  let phoneMessage: string | null = null;
  if (touched && registering && !phoneValid) phoneMessage = 'Enter a valid phone number, e.g. +92 300 1234567';

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (registering) {
        // Create the account, then route to email verification. The backend
        // sends a 6-digit code and returns emailVerificationRequired: true.
        // Do NOT call login() here: it returns 403 EMAIL_NOT_VERIFIED until
        // the email is verified. The password is retained in memory only
        // for the verification flow's auto-login.
        try {
          await register(email.trim(), password, role, firstName.trim(), lastName.trim(), phone.trim());
        } catch (regErr) {
          if (regErr instanceof ApiError && regErr.status === 409)
            setError('An account with this email already exists. Try signing in instead.');
          else if (regErr instanceof ApiError && regErr.status === 400)
            setError(regErr.message || 'Please check the highlighted fields and try again.');
          else if (regErr instanceof ApiError && regErr.status === 0) setError(regErr.message);
          else setError(regErr instanceof Error ? regErr.message : 'Could not create your account. Please try again.');
          return;
        }
        setAuthFlowState({ email: email.trim(), password, mode: 'register' });
        props.onRegisterSuccess();
        return;
      } else {
        try {
          await login(email.trim(), password);
        } catch (loginErr) {
          if (
            loginErr instanceof ApiError &&
            loginErr.status === 403 &&
            loginErr.code === 'EMAIL_NOT_VERIFIED'
          ) {
            // Correct password, unverified email: route to verification with
            // a recovery path instead of showing a sign-in failure.
            setAuthFlowState({ email: email.trim(), password, mode: 'login-recovery' });
            props.onRegisterSuccess();
            return;
          }
          if (loginErr instanceof ApiError && loginErr.status === 401)
            setError('Incorrect email or password. Please try again.');
          else if (loginErr instanceof ApiError && loginErr.status === 0) setError(loginErr.message);
          else setError(loginErr instanceof Error ? loginErr.message : 'Sign in failed. Please try again.');
        }
      }
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
    <div className={`screen auth-screen${registering ? ' auth-mode-register' : ' auth-mode-login'}`}>
      {/* Brand lockup: real N+O mark + wordmark, matching the in-app header. */}
      <header className="auth-brand">
        <span className="auth-brand-mark auth-brand-mark-real" aria-hidden>
          <ThemedMark size={30} />
        </span>
        <span className="auth-brand-lockup">
          <span className="auth-brand-name">
            Nearby<b>Orders</b>
          </span>
          <span className="auth-brand-tag">Find nearby. Book or order.</span>
        </span>
      </header>

      <div className="auth-panel">
        <div
          className="auth-mode-switch"
          role="tablist"
          aria-label="Choose between signing in and creating an account"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!registering}
            className={`auth-mode-tab${!registering ? ' auth-mode-tab-active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={registering}
            className={`auth-mode-tab${registering ? ' auth-mode-tab-active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Create account
          </button>
        </div>

        <div className="auth-intro">
          <p className="auth-kicker">{registering ? 'Join NearbyOrders' : 'Welcome back'}</p>
          <h1>{registering ? 'Create your account' : 'Sign in to continue'}</h1>
          <p className="auth-lede">
            {registering
              ? 'One account for discovering local businesses, booking services, and placing orders.'
              : 'Pick up where you left off: your orders, bookings, and saved places are here.'}
          </p>
        </div>

        <form className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          {registering ? (
            <>
              <Field label="First name" hint={firstNameMessage ?? undefined}>
                <AuthInput icon={<UserIcon size={18} />} invalid={Boolean(firstNameMessage)}>
                  <input name="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} onBlur={() => setTouched(true)} autoComplete="given-name" placeholder="Your first name" aria-label="First name" aria-invalid={Boolean(firstNameMessage)} enterKeyHint="next" />
                </AuthInput>
              </Field>
              <Field label="Last name" hint={lastNameMessage ?? undefined}>
                <AuthInput icon={<UserIcon size={18} />} invalid={Boolean(lastNameMessage)}>
                  <input name="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} onBlur={() => setTouched(true)} autoComplete="family-name" placeholder="Your last name" aria-label="Last name" aria-invalid={Boolean(lastNameMessage)} enterKeyHint="next" />
                </AuthInput>
              </Field>
              <Field label="Phone" hint={phoneMessage ?? undefined}>
                <AuthInput icon={<PinIcon size={18} />} invalid={Boolean(phoneMessage)}>
                  <input type="tel" name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setTouched(true)} autoComplete="tel" inputMode="tel" placeholder="e.g. +92 300 1234567" aria-label="Phone" aria-invalid={Boolean(phoneMessage)} enterKeyHint="next" />
                </AuthInput>
              </Field>
            </>
          ) : null}

          <Field label="Email" hint={emailMessage ?? undefined}>
            <AuthInput icon={<MailIcon size={18} />} invalid={Boolean(emailMessage)}>
              <input
                type="email"
                inputMode="email"
                name="email"
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

          <Field
            label="Password"
            hint={passwordMessage ?? (registering ? 'Use at least 12 characters.' : undefined)}
          >
            <AuthInput icon={<LockIcon size={18} />} invalid={Boolean(passwordMessage)}>
              <PasswordInput
                value={password}
                onChange={setPassword}
                name={registering ? 'new-password' : 'current-password'}
                autoComplete={registering ? 'new-password' : 'current-password'}
                invalid={Boolean(passwordMessage)}
                placeholder={registering ? 'At least 12 characters' : 'Enter your password'}
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
                    name="new-password"
                    autoComplete="new-password"
                    invalid={Boolean(confirmMessage)}
                    placeholder="Repeat your password"
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
                    className={`role-seg${role === 'CUSTOMER' ? ' role-seg-active' : ''}`}
                    onClick={() => setRole('CUSTOMER')}
                  >
                    <span className="role-seg-name">Customer</span>
                    <span className="role-seg-desc">Discover & order</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={role === 'BUSINESS_OWNER'}
                    className={`role-seg${role === 'BUSINESS_OWNER' ? ' role-seg-active' : ''}`}
                    onClick={() => setRole('BUSINESS_OWNER')}
                  >
                    <span className="role-seg-name">Business owner</span>
                    <span className="role-seg-desc">List & manage</span>
                  </button>
                </div>
                <p className="hint">{roleCopy(role)}</p>
              </fieldset>

              <label className="agree-row">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>
                  I agree to the <b>Terms of Service</b> and <b>Privacy Policy</b>
                </span>
              </label>
            </>
          ) : (
            <div className="auth-row">
              <button type="button" className="forgot-link" onClick={props.onForgotPassword}>
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
        </form>

        <ul className="auth-assurances" aria-label="Why create an account">
          <li>
            <CheckIcon size={15} />
            <span>Real local businesses near you</span>
          </li>
          <li>
            <CheckIcon size={15} />
            <span>Orders and bookings in one place</span>
          </li>
          <li>
            <CheckIcon size={15} />
            <span>Free for customers</span>
          </li>
        </ul>

        <p className="auth-switch">
          {registering ? 'Already have an account? ' : 'New here? '}
          <button type="button" className="link-inline" onClick={() => switchMode(registering ? 'login' : 'register')}>
            {registering ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </div>
    </div>
  );
}
