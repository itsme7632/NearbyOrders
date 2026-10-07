import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api.js';

/**
 * Minimum interval between code resends, matching the server's
 * MIN_RESEND_INTERVAL_MS (60s) in apps/api/src/emailAuth.ts.
 */
export const RESEND_INTERVAL_S = 60;

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * "Didn't get the code? Resend" row with a 60-second cooldown.
 *
 * Owns the countdown timer. The parent supplies the resend action; this
 * component maps outcomes to UI:
 * - success → starts the 60s cooldown
 * - HTTP 429 (resend-interval 'CONFLICT' or quota 'RATE_LIMITED';
 *   key off status, not the wire code) → shows the server message +
 *   starts the cooldown
 * - network failure (status 0) → shows a retryable message, no cooldown
 *
 * Shared by the verify-email and reset-code screens — one implementation.
 */
export function ResendCodeRow(props: {
  onResend: () => Promise<unknown>;
  /** Starts in cooldown (e.g. a code was just sent on the previous screen). */
  startCoolingDown?: boolean;
  hint?: string;
}) {
  const [cooldown, setCooldown] = useState(props.startCoolingDown ? RESEND_INTERVAL_S : 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const startCooldown = () => setCooldown(RESEND_INTERVAL_S);

  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [cooldown]);

  // Keep the timer across unmounts clean.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const resend = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setNotice(null);
    try {
      await props.onResend();
      startCooldown();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        // 60s interval or endpoint quota — the server message is user-safe.
        setNotice(e.message || 'Please wait a minute before requesting another code.');
        startCooldown();
      } else if (e instanceof ApiError && e.status === 0) {
        setNotice(e.message);
      } else {
        setNotice(e instanceof Error ? e.message : 'Could not resend the code. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="resend-row">
      <p className="resend-line">
        Didn't get the code?{' '}
        {cooldown > 0 ? (
          <span className="resend-cooldown" aria-live="polite">
            Resend code in {formatCountdown(cooldown)}
          </span>
        ) : (
          <button type="button" className="link-inline" onClick={resend} disabled={busy}>
            {busy ? 'Sending…' : 'Resend'}
          </button>
        )}
      </p>
      {notice ? (
        <p className="hint" role="status">
          {notice}
        </p>
      ) : null}
      {props.hint && !notice ? <p className="hint">{props.hint}</p> : null}
    </div>
  );
}
