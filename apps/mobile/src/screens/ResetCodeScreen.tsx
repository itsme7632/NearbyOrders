import { useState } from 'react';
import { requestPasswordReset } from '../api.js';
import { clearAuthFlowState, getAuthFlowState, patchAuthFlowState } from '../authFlow.js';
import { AuthScreenShell } from '../components/AuthScreenShell.js';
import { CODE_LENGTH, CodeInput } from '../components/CodeInput.js';
import { ResendCodeRow } from '../components/ResendCodeRow.js';
import { Button } from '../components/ui.js';

/**
 * Reset-code entry screen (`#/reset-code`).
 *
 * Shares CodeInput and ResendCodeRow with the verify-email screen.
 * The backend validates { email, code, newPassword } together, so this
 * screen cannot confirm the code yet — "Continue" carries the code (in
 * memory only) to the new-password screen, where validity is established.
 * Copy must not promise "code accepted".
 */
export function ResetCodeScreen(props: { onBack: () => void; onContinue: () => void }) {
  const flow = getAuthFlowState();
  const email = flow?.email ?? '';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (!flow || !email || flow.mode !== 'password-reset') {
    return (
      <AuthScreenShell title="Enter reset code" onBack={props.onBack}>
        <p className="muted">This password-reset session has expired. Please start again.</p>
        <Button full onClick={props.onBack}>
          Back
        </Button>
      </AuthScreenShell>
    );
  }

  const canContinue = code.length === CODE_LENGTH && !busy;

  const cont = () => {
    if (!canContinue) return;
    // The code travels in memory only — never in the URL.
    patchAuthFlowState({ code });
    props.onContinue();
  };

  return (
    <AuthScreenShell
      title="Enter reset code"
      lede={
        <>
          If an account exists for <b>{email}</b>, we sent a 6-digit code. It expires in 10 minutes.
        </>
      }
      onBack={() => {
        clearAuthFlowState();
        props.onBack();
      }}
      backLabel="Back"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          cont();
        }}
        noValidate
      >
        <CodeInput
          value={code}
          onChange={setCode}
          disabled={busy}
          label="6-digit reset code"
          autoFocus
        />

        <Button full type="submit" disabled={!canContinue}>
          Continue
        </Button>

        <ResendCodeRow
          onResend={() => requestPasswordReset(email)}
          startCoolingDown
          hint="Codes can take a minute to arrive. Check your spam folder."
        />

        <p className="hint">
          Wrong email?{' '}
          <button
            type="button"
            className="link-inline"
            onClick={() => {
              clearAuthFlowState();
              props.onBack();
            }}
            disabled={busy}
          >
            Use a different email
          </button>
        </p>
      </form>
    </AuthScreenShell>
  );
}
