// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ProfileScreen } from './Profile.js';
import * as api from '../api.js';
import { ApiError, register } from '../api.js';

afterEach(cleanup);

const noop = () => {};

const authProps = {
  onOwnerDashboard: noop,
  onEditProfile: noop,
  onChangePassword: noop,
  onOpenOrders: noop,
  onOpenBookings: noop,
  onOpenNotifications: noop,
  onOpenSaved: noop,
  onOpenMyReviews: noop,
  onOpenAddresses: noop,
  onOpenAppearance: noop,
  onOpenInfo: noop,
  onForgotPassword: noop,
  onRegisterSuccess: noop,
};

const session = {
  accessToken: 'tok',
  user: { id: 'u1', email: 'new@example.com', role: 'CUSTOMER' },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSession').mockReturnValue(null);
  vi.spyOn(api, 'onSessionChange').mockReturnValue(() => {});
});

function fillLoginForm(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

function switchToRegister() {
  fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));
}

function fillRegisterForm(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Test' } });
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'User' } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+92 300 1234567' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('register() API layer', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('posts to the configured API base, never a raw relative fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'u1', email: 'a@b.c', role: 'CUSTOMER' } }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await register('a@b.c', 'supersecretpassword1', 'CUSTOMER', 'Test', 'User', '+92 300 1234567');

    expect(res).toEqual({ id: 'u1', email: 'a@b.c', role: 'CUSTOMER' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // Goes through API_BASE ('/api/v1' in tests) — the Capacitor-safe path.
    expect(url).toBe('/api/v1/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@b.c',
      password: 'supersecretpassword1',
      role: 'CUSTOMER',
      firstName: 'Test',
      lastName: 'User',
      phone: '+92 300 1234567',
    });
  });

  it('surfaces duplicate-email (409) and validation (400) failures honestly', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Email already in use' } }), { status: 409 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: { fieldErrors: { password: ['Too short'] } } },
          }),
          { status: 400 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const dup = await register('a@b.c', 'supersecretpassword1', 'CUSTOMER', 'Test', 'User', '+92 300 1234567').catch((e) => e);
    expect(dup).toBeInstanceOf(ApiError);
    expect(dup.status).toBe(409);

    const invalid = await register('a@b.c', 'short', 'CUSTOMER', 'Test', 'User', '+92 300 1234567').catch((e) => e);
    expect(invalid).toBeInstanceOf(ApiError);
    expect(invalid.status).toBe(400);
    expect(invalid.message).toContain('password');
  });
});

describe('ProfileScreen auth flows', () => {
  it('signs up successfully: registers then routes to email verification (no auto-login)', async () => {
    const registerMock = vi.spyOn(api, 'register').mockResolvedValue({ id: 'u1', email: 'new@example.com', role: 'CUSTOMER', emailVerificationRequired: true });
    const loginMock = vi.spyOn(api, 'login').mockResolvedValue(session);
    const onRegisterSuccess = vi.fn();

    render(<ProfileScreen {...authProps} onRegisterSuccess={onRegisterSuccess} />);
    switchToRegister();
    fillRegisterForm('new@example.com', 'supersecretpassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(registerMock).toHaveBeenCalledWith('new@example.com', 'supersecretpassword1', 'CUSTOMER', 'Test', 'User', '+92 300 1234567'));
    // The new backend returns 403 EMAIL_NOT_VERIFIED on login until the email
    // is verified, so registration must NOT attempt login.
    expect(loginMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onRegisterSuccess).toHaveBeenCalled());
    // No login-style error may leak into the signup flow.
    expect(screen.queryByText('Incorrect email or password. Please try again.')).toBeNull();
  });

  it('signup with an existing email explains the account already exists', async () => {
    const registerMock = vi.spyOn(api, 'register').mockRejectedValue(new ApiError(409, 'CONFLICT', 'Email already in use'));
    const loginMock = vi.spyOn(api, 'login');
    const onRegisterSuccess = vi.fn();

    render(<ProfileScreen {...authProps} onRegisterSuccess={onRegisterSuccess} />);
    switchToRegister();
    fillRegisterForm('taken@example.com', 'supersecretpassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(registerMock).toHaveBeenCalled());
    expect(loginMock).not.toHaveBeenCalled();
    expect(onRegisterSuccess).not.toHaveBeenCalled();
    await screen.findByText('An account with this email already exists. Try signing in instead.');
    expect(screen.queryByText('Incorrect email or password. Please try again.')).toBeNull();
  });

  it('signup validation failures show the validation message, not login wording', async () => {
    vi.spyOn(api, 'register').mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'password: Too short'));
    const loginMock = vi.spyOn(api, 'login');

    render(<ProfileScreen {...authProps} />);
    switchToRegister();
    fillRegisterForm('new@example.com', 'supersecretpassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await screen.findByText('password: Too short');
    expect(loginMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Incorrect email or password. Please try again.')).toBeNull();
  });

  it('login with an unverified email routes to verification recovery, not a generic failure', async () => {
    const loginMock = vi.spyOn(api, 'login').mockRejectedValue(new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email before signing in'));
    const onRegisterSuccess = vi.fn();

    render(<ProfileScreen {...authProps} onRegisterSuccess={onRegisterSuccess} />);
    fillLoginForm('new@example.com', 'supersecretpassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('new@example.com', 'supersecretpassword1'));
    // No generic failure: the user gets the verification recovery path.
    await waitFor(() => expect(onRegisterSuccess).toHaveBeenCalled());
    expect(screen.queryByText('Incorrect email or password. Please try again.')).toBeNull();
    expect(screen.queryByText('Sign in failed. Please try again.')).toBeNull();
  });

  it('forgot password button is enabled and navigates to the reset flow', async () => {
    const onForgotPassword = vi.fn();

    render(<ProfileScreen {...authProps} onForgotPassword={onForgotPassword} />);
    const forgot = screen.getByRole('button', { name: 'Forgot password?' });
    expect(forgot).toBeEnabled();
    fireEvent.click(forgot);
    expect(onForgotPassword).toHaveBeenCalled();
  });

  it('login with wrong credentials shows the login-specific error', async () => {
    const loginMock = vi.spyOn(api, 'login').mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'));

    render(<ProfileScreen {...authProps} />);
    fillLoginForm('user@example.com', 'wrongpassword123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('user@example.com', 'wrongpassword123'));
    await screen.findByText('Incorrect email or password. Please try again.');
  });

  it('login success establishes the session', async () => {
    const loginMock = vi.spyOn(api, 'login').mockResolvedValue(session);

    render(<ProfileScreen {...authProps} />);
    fillLoginForm('user@example.com', 'correctpassword123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('user@example.com', 'correctpassword123'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
