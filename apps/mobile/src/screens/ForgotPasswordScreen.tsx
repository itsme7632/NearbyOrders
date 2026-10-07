import { useState } from 'react';
import { ApiError, requestPasswordReset } from '../api.js';
import { setAuthFlowState } from '../authFlow.js';
import { AuthScreenShell } from '../components/AuthScreenShell.js';
import { AlertIcon, MailIcon } from '../components/icons.js';
import { Button, Field } from '../components/ui.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password-reset request screen (`#/forgot-password`).
 *
 * The backend always returns { accepted: true } — the UI has exactly one
 * success path and never reveals whether the account exists.
 */
export function ForgotPasswordScreen(props: { onBack: () => void; onCodeSent: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = emailValid && !busy;

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const normalized = email.trim();
    try {
      await requestPasswordReset(normalized);
    } catch (e) {
      // The endpoint is generic by design, but transport failures are real.
      if (e instanceof ApiError && e.status === 0) setError(e.message);
      else setError(e instanceof Error ? e.message : 'Could not send the reset code. Please try again.');
      setBusy(false);
      return;
    }
    setAuthFlowState({ email: normalized, mode: 'password-reset' });
    setBusy(false);
    props.onCodeSent(normalized);
  };

  return (
    <AuthScreenShell
      title="Reset your password"
      lede="Enter the email address you signed up with."
      onBack={props.onBack}
      backLabel="Back"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <Field
          label="Email"
          hint={touched && email.length > 0 && !emailValid ? 'Enter a valid email address, e.g. you@example.com' : undefined}
        >
          <div className={`auth-input${touched && email.length > 0 && !emailValid ? ' input-invalid' : ''}`}>
            <span className="auth-input-icon" aria-hidden>
              <MailIcon size={19} />
            </span>
            <span className="auth-input-field">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-label="Email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                enterKeyHint="send"
                disabled={busy}
              />
            </span>
          </div>
        </Field>

        {error ? (
          <div className="auth-error" role="alert">
            <AlertIcon size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        <Button full type="submit" disabled={!canSubmit}>
          {busy ? 'Sending…' : 'Send reset code'}
        </Button>

        <p className="hint">If an account exists for this email, we'll send a 6-digit reset code.</p>
      </form>
    </AuthScreenShell>
  );
}
