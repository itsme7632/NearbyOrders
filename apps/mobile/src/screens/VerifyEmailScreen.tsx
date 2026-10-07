import { useEffect, useRef, useState } from 'react';
import { ApiError, login, resendVerification, verifyEmail } from '../api.js';
import { clearAuthFlowState, getAuthFlowState, type AuthFlowMode } from '../authFlow.js';
import { AuthScreenShell } from '../components/AuthScreenShell.js';
import { CODE_LENGTH, CodeInput } from '../components/CodeInput.js';
import { ResendCodeRow } from '../components/ResendCodeRow.js';
import { AlertIcon, CheckIcon } from '../components/icons.js';
import { Button } from '../components/ui.js';

/**
 * Email verification screen (`#/verify-email`).
 *
 * Two modes, one screen:
 * - 'register': reached after sign-up. On success, auto-logs in with the
 *   in-memory credentials, then clears them.
 * - 'login-recovery': reached from a 403 EMAIL_NOT_VERIFIED on sign-in.
 *   Fires a fresh resend on mount (the sign-up code may be expired), then
 *   auto-logs in on success.
 *
 * The password lives only in the in-memory auth-flow state — never in the
 * URL, never persisted. It is cleared the moment verification completes or
 * the flow is abandoned.
 */
export function VerifyEmailScreen(props: { onBack: () => void; onVerified: () => void }) {
  const flow = getAuthFlowState();
  const email = flow?.email ?? '';
  const mode: AuthFlowMode = flow?.mode ?? 'register';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // In login-recovery the sign-up code may be long expired: send a fresh one
  // on entry so the user isn't staring at a dead code.
  const [autoResent, setAutoResent] = useState(mode !== 'login-recovery');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'login-recovery' || autoResent || !email) return;
    let cancelled = false;
    resendVerification(email)
      .catch(() => {
        /* ResendCodeRow surfaces 429/network states; a silent failure here
           just leaves the manual resend available. */
      })
      .finally(() => {
        if (!cancelled && mounted.current) setAutoResent(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) {
    return (
      <AuthScreenShell title="Verify your email" onBack={props.onBack}>
        <div className="created-banner" role="status">
          <CheckIcon size={16} />
          <span>Email verified. Please sign in with your new credentials.</span>
        </div>
        <Button full onClick={props.onBack}>
          Back to sign in
        </Button>
      </AuthScreenShell>
    );
  }

  if (!flow || !email) {
    // No flow state (e.g. cold launch straight to this hash): bounce to auth.
    return (
      <AuthScreenShell title="Verify your email" onBack={props.onBack}>
        <p className="muted">This verification link has expired. Please sign in or create an account to continue.</p>
        <Button full onClick={props.onBack}>
          Back to sign in
        </Button>
      </AuthScreenShell>
    );
  }

  const codeComplete = code.length === CODE_LENGTH;
  const canSubmit = codeComplete && !busy && !done;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(email, code);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.code === 'INVALID_CODE') {
        setError('Invalid or expired code. Check the code and try again, or resend a new one.');
      } else if (e instanceof ApiError && e.status === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else if (e instanceof ApiError && e.status === 0) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Could not verify your email. Please try again.');
      }
      setBusy(false);
      return;
    }

    // Verified (the backend also returns { verified: true } when the account
    // was already verified — both are success here).
    const password = getAuthFlowState()?.password;
    if (password) {
      try {
        await login(email, password);
      } catch {
        // Verified but auto sign-in failed (shouldn't happen — the password
        // was just used): fall through to manual sign-in.
        clearAuthFlowState();
        if (mounted.current) {
          setBusy(false);
          setDone(true);
        }
        return;
      }
    }
    clearAuthFlowState();
    if (mounted.current) setBusy(false);
    props.onVerified();
  };

  const lede =
    mode === 'login-recovery' ? (
      <>
        Your email isn't verified yet. We sent a new 6-digit code to <b>{email}</b>.
      </>
    ) : (
      <>
        We sent a 6-digit code to <b>{email}</b>. Enter it below to finish creating your account.
      </>
    );

  return (
    <AuthScreenShell title="Verify your email" lede={lede} onBack={props.onBack} backLabel="Back">
      <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <CodeInput
            value={code}
            onChange={(v) => {
              setCode(v);
              setError(null);
            }}
            invalid={!!error}
            disabled={busy}
            label="6-digit verification code"
            autoFocus
          />
          <p className="hint">The code expires in 10 minutes.</p>

          {error ? (
            <div className="auth-error" role="alert">
              <AlertIcon size={18} />
              <span>{error}</span>
            </div>
          ) : null}

          <Button full type="submit" disabled={!canSubmit}>
            {busy ? 'Verifying…' : 'Verify email'}
          </Button>

          <ResendCodeRow
            onResend={() => resendVerification(email)}
            startCoolingDown={mode === 'login-recovery'}
            hint="Codes can take a minute to arrive. Check your spam folder."
          />

          {mode === 'register' ? (
            <p className="hint">
              Wrong email?{' '}
              <button
                type="button"
                className="link-inline"
                onClick={() => {
                  clearAuthFlowState();
                  props.onBack();
                }}
              >
                Use a different email
              </button>
            </p>
          ) : null}
        </form>
    </AuthScreenShell>
  );
}
