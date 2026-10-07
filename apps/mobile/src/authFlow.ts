/**
 * In-memory state for the email-auth flows (verification + password reset).
 *
 * The registration/login-recovery password and the reset code are sensitive:
 * they live ONLY here, in module memory, for the lifetime of the flow.
 * They are NEVER put in the URL/hash, NEVER in localStorage/sessionStorage,
 * and NEVER persisted anywhere. If the app is killed mid-flow the state is
 * gone and the user verifies / signs in normally.
 *
 * Email alone is not sensitive and may be shown on screen.
 */

export type AuthFlowMode = 'register' | 'login-recovery' | 'password-reset';

export interface AuthFlowState {
  /** The email address the flow is for (shown on screen). */
  email: string;
  /** Which flow this state belongs to. */
  mode: AuthFlowMode;
  /**
   * Registration / login-recovery password, retained ONLY so the app can
   * auto-login immediately after successful verification. Cleared the
   * moment verification completes or the flow is abandoned.
   */
  password?: string;
  /**
   * The 6-digit reset code, carried from the reset-code screen to the
   * new-password screen (the backend validates code+password together).
   * Never rendered after entry.
   */
  code?: string;
}

let state: AuthFlowState | null = null;

export function setAuthFlowState(next: AuthFlowState): void {
  state = { ...next };
}

export function getAuthFlowState(): AuthFlowState | null {
  return state ? { ...state } : null;
}

/** Patches the in-memory state (e.g. attaching the reset code). No-op when empty. */
export function patchAuthFlowState(patch: Partial<AuthFlowState>): void {
  if (state) state = { ...state, ...patch };
}

/** Clears all flow state, including any retained password or code. */
export function clearAuthFlowState(): void {
  state = null;
}
