// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { VerifyEmailScreen } from './VerifyEmailScreen.js';
import { ForgotPasswordScreen } from './ForgotPasswordScreen.js';
import { ResetCodeScreen } from './ResetCodeScreen.js';
import { NewPasswordScreen } from './NewPasswordScreen.js';
import { CodeInput } from '../components/CodeInput.js';
import { ResendCodeRow } from '../components/ResendCodeRow.js';
import * as api from '../api.js';
import { ApiError } from '../api.js';
import { clearAuthFlowState, getAuthFlowState, setAuthFlowState } from '../authFlow.js';

afterEach(() => {
  cleanup();
  clearAuthFlowState();
});

beforeEach(() => {
  vi.restoreAllMocks();
  clearAuthFlowState();
});

function fillCode(code: string) {
  fireEvent.change(screen.getByLabelText('6-digit verification code'), { target: { value: code } });
}

function fillResetCode(code: string) {
  fireEvent.change(screen.getByLabelText('6-digit reset code'), { target: { value: code } });
}

describe('CodeInput', () => {
  it('strips non-digits and caps at 6', () => {
    const onChange = vi.fn();
    render(<CodeInput value="" onChange={onChange} label="code" />);
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'a1b2c3d4e5f6g7' } });
    expect(onChange).toHaveBeenCalledWith('123456');
  });

  it('uses numeric keyboard hints and one-time-code autofill', () => {
    render(<CodeInput value="" onChange={() => {}} label="code" />);
    const input = screen.getByLabelText('code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
  });
});

describe('ResendCodeRow', () => {
  it('starts a 60s cooldown after a successful resend', async () => {
    const onResend = vi.fn().mockResolvedValue({ accepted: true });
    render(<ResendCodeRow onResend={onResend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(onResend).toHaveBeenCalled());
    expect(screen.getByText(/Resend code in 1:00/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend' })).toBeNull();
  });

  it('surfaces the 429 message and cools down (keyed off status, not wire code)', async () => {
    const onResend = vi.fn().mockRejectedValue(new ApiError(429, 'CONFLICT', 'Please wait a minute before requesting another code.'));
    render(<ResendCodeRow onResend={onResend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(screen.getByText('Please wait a minute before requesting another code.')).toBeTruthy());
    expect(screen.getByText(/Resend code in/)).toBeTruthy();
  });
});

describe('VerifyEmailScreen', () => {
  it('verifies the code then auto-logs in with the in-memory password and clears it', async () => {
    setAuthFlowState({ email: 'new@example.com', password: 'supersecretpassword1', mode: 'register' });
    const verifyMock = vi.spyOn(api, 'verifyEmail').mockResolvedValue({ verified: true });
    const loginMock = vi.spyOn(api, 'login').mockResolvedValue({ accessToken: 't', user: { id: 'u1', email: 'new@example.com', role: 'CUSTOMER' } });
    const onVerified = vi.fn();

    render(<VerifyEmailScreen onBack={() => {}} onVerified={onVerified} />);
    expect(screen.getByText('new@example.com')).toBeTruthy();
    fillCode('482913');
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    await waitFor(() => expect(verifyMock).toHaveBeenCalledWith('new@example.com', '482913'));
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('new@example.com', 'supersecretpassword1'));
    // The temporary password is cleared immediately after use.
    expect(getAuthFlowState()).toBeNull();
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
  });

  it('shows an invalid-code error and keeps the flow state for retry', async () => {
    setAuthFlowState({ email: 'new@example.com', password: 'pw', mode: 'register' });
    vi.spyOn(api, 'verifyEmail').mockRejectedValue(new ApiError(400, 'INVALID_CODE', 'Invalid or expired verification code'));

    render(<VerifyEmailScreen onBack={() => {}} onVerified={() => {}} />);
    fillCode('000000');
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    await screen.findByText(/Invalid or expired code/);
    // Flow state (including the password) survives for a retry.
    expect(getAuthFlowState()?.email).toBe('new@example.com');
  });

  it('verify button stays disabled until 6 digits are entered', () => {
    setAuthFlowState({ email: 'new@example.com', mode: 'register' });
    render(<VerifyEmailScreen onBack={() => {}} onVerified={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Verify email' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fillCode('123');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fillCode('123456');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('login-recovery mode auto-resends a fresh code on mount', async () => {
    setAuthFlowState({ email: 'user@example.com', password: 'pw', mode: 'login-recovery' });
    const resendMock = vi.spyOn(api, 'resendVerification').mockResolvedValue({ accepted: true });

    render(<VerifyEmailScreen onBack={() => {}} onVerified={() => {}} />);
    await waitFor(() => expect(resendMock).toHaveBeenCalledWith('user@example.com'));
    expect(screen.getByText(/isn't verified yet/)).toBeTruthy();
  });

  it('shows a bounce state when there is no flow state', () => {
    const onBack = vi.fn();
    render(<VerifyEmailScreen onBack={onBack} onVerified={() => {}} />);
    expect(screen.getByText(/verification link has expired/i)).toBeTruthy();
  });
});

describe('ForgotPasswordScreen', () => {
  it('sends the reset request then advances with the email in flow state', async () => {
    const reqMock = vi.spyOn(api, 'requestPasswordReset').mockResolvedValue({ accepted: true });
    const onCodeSent = vi.fn();

    render(<ForgotPasswordScreen onBack={() => {}} onCodeSent={onCodeSent} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    await waitFor(() => expect(reqMock).toHaveBeenCalledWith('user@example.com'));
    expect(getAuthFlowState()).toMatchObject({ email: 'user@example.com', mode: 'password-reset' });
    await waitFor(() => expect(onCodeSent).toHaveBeenCalledWith('user@example.com'));
  });

  it('uses generic copy that never reveals account existence', () => {
    render(<ForgotPasswordScreen onBack={() => {}} onCodeSent={() => {}} />);
    expect(screen.getByText(/If an account exists for this email/)).toBeTruthy();
    expect(screen.queryByText(/no account/i)).toBeNull();
    expect(screen.queryByText(/doesn't exist/i)).toBeNull();
  });
});

describe('ResetCodeScreen', () => {
  it('carries the code in memory (never in the URL) to the next step', () => {
    setAuthFlowState({ email: 'user@example.com', mode: 'password-reset' });
    const onContinue = vi.fn();

    render(<ResetCodeScreen onBack={() => {}} onContinue={onContinue} />);
    fillResetCode('654321');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(getAuthFlowState()).toMatchObject({ code: '654321' });
    expect(window.location.hash).not.toContain('654321');
    expect(onContinue).toHaveBeenCalled();
  });

  it('reuses the shared resend row with cooldown', async () => {
    setAuthFlowState({ email: 'user@example.com', mode: 'password-reset' });
    vi.spyOn(api, 'requestPasswordReset').mockResolvedValue({ accepted: true });

    render(<ResetCodeScreen onBack={() => {}} onContinue={() => {}} />);
    // Starts cooling down because the request screen just sent a code.
    expect(screen.getByText(/Resend code in/)).toBeTruthy();
  });
});

describe('NewPasswordScreen', () => {
  function setup() {
    setAuthFlowState({ email: 'user@example.com', code: '654321', mode: 'password-reset' });
    render(<NewPasswordScreen onBack={() => {}} onGetNewCode={() => {}} onDone={() => {}} />);
  }

  function fillPasswords(next: string, confirm: string) {
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
  }

  it('completes the reset, clears flow state, and shows the terminal changed state', async () => {
    setup();
    const completeMock = vi.spyOn(api, 'completePasswordReset').mockResolvedValue({ reset: true });

    fillPasswords('anewsecurepassword1', 'anewsecurepassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(completeMock).toHaveBeenCalledWith('user@example.com', '654321', 'anewsecurepassword1'));
    expect(getAuthFlowState()).toBeNull();
    await screen.findByText('Password changed');
    // No auto-login: the backend revoked every session.
    expect(screen.getByRole('button', { name: 'Back to login' })).toBeTruthy();
  });

  it('shows a mismatch hint and disables submit', () => {
    setup();
    fillPasswords('anewsecurepassword1', 'differentpassword2');
    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reset password' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enforces the 12-character minimum without inventing complexity rules', () => {
    setup();
    fillPasswords('short1!', 'short1!');
    expect(screen.getByText(/Use at least 12 characters/)).toBeTruthy();
    expect(screen.queryByText(/uppercase|number|symbol/i)).toBeNull();
  });

  it('invalid code offers a recovery path back to resend', async () => {
    setup();
    vi.spyOn(api, 'completePasswordReset').mockRejectedValue(new ApiError(400, 'INVALID_CODE', 'Invalid or expired reset code'));

    fillPasswords('anewsecurepassword1', 'anewsecurepassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await screen.findByText('This code is invalid or expired.');
    expect(screen.getByRole('button', { name: 'Get a new code' })).toBeTruthy();
  });

  it('regression: "Get a new code" explicitly navigates to the reset-code step (not generic back)', async () => {
    // 1. User reaches the New Password screen with a (stale) code in flow state.
    setAuthFlowState({ email: 'user@example.com', code: '000000', mode: 'password-reset' });
    // 2. The reset fails: invalid/expired code.
    vi.spyOn(api, 'completePasswordReset').mockRejectedValue(new ApiError(400, 'INVALID_CODE', 'Invalid or expired reset code'));
    const onBack = vi.fn();
    const onGetNewCode = vi.fn();
    const onDone = vi.fn();

    render(<NewPasswordScreen onBack={onBack} onGetNewCode={onGetNewCode} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'anewsecurepassword1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'anewsecurepassword1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    // 3. The recovery UI is shown.
    const getNewCode = await screen.findByRole('button', { name: 'Get a new code' });

    // 4. Tapping it fires the explicit recovery navigation…
    fireEvent.click(getNewCode);
    expect(onGetNewCode).toHaveBeenCalledTimes(1);
    // …and NOT the generic back callback.
    expect(onBack).not.toHaveBeenCalled();

    // 5+6. The password-reset flow state is preserved (email intact, stale
    // code still present until overwritten), so the reset-code step remains
    // usable for entering a fresh code.
    expect(getAuthFlowState()).toMatchObject({ email: 'user@example.com', mode: 'password-reset' });

    // The reset-code screen renders for the same email with a working resend row.
    cleanup();
    const onContinue = vi.fn();
    render(<ResetCodeScreen onBack={() => {}} onContinue={onContinue} />);
    expect(screen.getByText('user@example.com')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('6-digit reset code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(getAuthFlowState()).toMatchObject({ email: 'user@example.com', code: '654321' });
    expect(onContinue).toHaveBeenCalled();
  });

  it('normal back from New Password still uses the back callback', () => {
    setAuthFlowState({ email: 'user@example.com', code: '654321', mode: 'password-reset' });
    const onBack = vi.fn();
    const onGetNewCode = vi.fn();

    render(<NewPasswordScreen onBack={onBack} onGetNewCode={onGetNewCode} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onGetNewCode).not.toHaveBeenCalled();
  });
});
