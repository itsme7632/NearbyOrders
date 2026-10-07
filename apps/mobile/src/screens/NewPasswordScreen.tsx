import { useState } from 'react';
import { ApiError, completePasswordReset } from '../api.js';
import { clearAuthFlowState, getAuthFlowState } from '../authFlow.js';
import { AuthScreenShell } from '../components/AuthScreenShell.js';
import { PasswordInput } from '../components/PasswordInput.js';
import { AlertIcon, CheckIcon } from '../components/icons.js';
import { Button, Field } from '../components/ui.js';

/** Mirrors the server rule (z.string().min(12).max(128)) — no complexity claims. */
const MIN_PASSWORD = 12;

/**
 * New-password screen (`#/new-password`) with a terminal password-changed
 * state.
 *
 * Submit calls password-reset/complete with { email, code, newPassword } —
 * the code's validity is established here. On success the code is consumed,
 * the password changes, all refresh tokens are revoked, and a
 * password-changed email is sent server-side.
 *
 * The user is NOT auto-logged in: the backend revoked every session, so the
 * UX ends at "Back to login".
 *
 * Props make the two exits explicit:
 * - onBack: normal back → the reset-code step (history back).
 * - onGetNewCode: recovery from an invalid/expired code → explicitly
 *   navigates to the reset-code step (not history-dependent).
 * - onDone: password changed → back to login.
 */
export function NewPasswordScreen(props: { onBack: () => void; onGetNewCode: () => void; onDone: () => void }) {
  const flow = getAuthFlowState();
  const email = flow?.email ?? '';
  const code = flow?.code ?? '';

  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  if (changed) {
    return (
      <div className="screen auth-screen">
        <div className="password-changed">
          <span className="password-changed-icon" aria-hidden>
            <CheckIcon size={28} />
          </span>
          <h1>Password changed</h1>
          <p className="muted">
            Your password was updated successfully. For your security, you've been signed out on all devices. We've
            also sent a confirmation email.
          </p>
          <Button
            full
            onClick={() => {
              clearAuthFlowState();
              props.onDone();
            }}
          >
            Back to login
          </Button>
        </div>
      </div>
    );
  }

  if (!flow || !email || !code || flow.mode !== 'password-reset') {
    return (
      <AuthScreenShell title="Create new password" onBack={props.onBack}>
        <p className="muted">This password-reset session has expired. Please start again.</p>
        <Button full onClick={props.onBack}>
          Back
        </Button>
      </AuthScreenShell>
    );
  }

  const nextValid = next.length >= MIN_PASSWORD;
  const confirmValid = next === confirm;
  const canSubmit = !busy && !changed && nextValid && confirmValid;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      await completePasswordReset(email, code, next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.code === 'INVALID_CODE') {
        setError('This code is invalid or expired.');
      } else if (e instanceof ApiError && e.status === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else if (e instanceof ApiError && e.status === 0) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Could not reset your password. Please try again.');
      }
      setBusy(false);
      return;
    }
    clearAuthFlowState();
    setBusy(false);
    setChanged(true);
  };

  return (
    <AuthScreenShell
      title="Create new password"
      lede={
        <>
          Choose a new password for <b>{email}</b>.
        </>
      }
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
          label="New password"
          hint={next.length > 0 && !nextValid ? `Use at least ${MIN_PASSWORD} characters.` : undefined}
        >
          <PasswordInput
            value={next}
            onChange={(v) => {
              setNext(v);
              setError(null);
            }}
            autoComplete="new-password"
            invalid={next.length > 0 && !nextValid}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            label="New password"
            enterKeyHint="next"
            disabled={busy}
          />
        </Field>
        <Field
          label="Confirm new password"
          hint={confirm.length > 0 && !confirmValid ? 'Passwords do not match.' : undefined}
        >
          <PasswordInput
            value={confirm}
            onChange={(v) => {
              setConfirm(v);
              setError(null);
            }}
            autoComplete="new-password"
            invalid={confirm.length > 0 && !confirmValid}
            placeholder="Repeat your new password"
            label="Confirm new password"
            enterKeyHint="done"
            disabled={busy}
          />
        </Field>

        {error ? (
          <div className="auth-error" role="alert">
            <AlertIcon size={18} />
            <span>
              {error}{' '}
              {error === 'This code is invalid or expired.' ? (
                <button type="button" className="link-inline" onClick={props.onGetNewCode}>
                  Get a new code
                </button>
              ) : null}
            </span>
          </div>
        ) : null}

        <Button full type="submit" disabled={!canSubmit}>
          {busy ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>
    </AuthScreenShell>
  );
}
