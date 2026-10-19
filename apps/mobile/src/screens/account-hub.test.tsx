// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ProfileScreen, EditProfileScreen, ChangePasswordScreen } from './Profile.js';
import * as sessionApi from '../api.js';
import * as api from '../api.js';
import type { MyProfile, Session } from '../api.js';

afterEach(cleanup);

const session: Session = {
  accessToken: 'tok',
  user: { id: 'u1', email: 'ayesha@example.com', role: 'CUSTOMER' },
};

const profile: MyProfile = {
  id: 'u1',
  email: 'ayesha@example.com',
  role: 'CUSTOMER',
  firstName: 'Ayesha',
  lastName: 'Khan',
  phone: '+92 300 1234567',
};

beforeEach(() => {
  vi.spyOn(api, 'whoami').mockResolvedValue(profile);
  // AccountHub reads the session directly (no props) — provide a stable one.
  vi.spyOn(sessionApi, 'getSession').mockReturnValue(session);
  vi.spyOn(sessionApi, 'onSessionChange').mockReturnValue(() => {});
  vi.spyOn(sessionApi, 'logout').mockResolvedValue(undefined);
});

const noop = () => {};

describe('AccountHub (signed-in Profile tab)', () => {
  it('renders the user identity, sections and role', async () => {
    render(
      <ProfileScreen
        onOwnerDashboard={noop}
        onEditProfile={noop}
        onChangePassword={noop}
        onOpenOrders={noop}
        onOpenBookings={noop}
        onOpenNotifications={noop}
        onOpenSaved={noop}
        onOpenMyReviews={noop}
        onOpenAddresses={noop}
        onOpenAppearance={noop}
        onOpenInfo={noop}
        onForgotPassword={noop}
        onRegisterSuccess={noop}
      />,
    );
    await screen.findByText('Ayesha Khan');
    expect(screen.getByText('ayesha@example.com')).toBeTruthy();
    expect(screen.getByText('Customer')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
  });

  it('navigates from hub rows to Edit Profile, Change Password, Orders, Bookings and Notifications', async () => {
    const handlers = { edit: vi.fn(), pw: vi.fn(), orders: vi.fn(), bookings: vi.fn(), notifs: vi.fn(), saved: vi.fn(), reviews: vi.fn(), addresses: vi.fn(), info: vi.fn(), forgotPassword: vi.fn(), registerSuccess: vi.fn() };
    render(
      <ProfileScreen
        onOwnerDashboard={noop}
        onEditProfile={handlers.edit}
        onChangePassword={handlers.pw}
        onOpenOrders={handlers.orders}
        onOpenBookings={handlers.bookings}
        onOpenNotifications={handlers.notifs}
        onOpenSaved={handlers.saved}
        onOpenMyReviews={handlers.reviews}
        onOpenAddresses={handlers.addresses}
        onOpenAppearance={noop}
        onOpenInfo={handlers.info}
        onForgotPassword={handlers.forgotPassword}
        onRegisterSuccess={handlers.registerSuccess}
      />,
    );
    await screen.findByText('Ayesha Khan');
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }));
    expect(handlers.edit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Change password/i }));
    expect(handlers.pw).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /My orders/i }));
    expect(handlers.orders).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /My bookings/i }));
    expect(handlers.bookings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(handlers.notifs).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Saved businesses/i }));
    expect(handlers.saved).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /My reviews/i }));
    expect(handlers.reviews).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Addresses/i }));
    expect(handlers.addresses).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Help & support/i }));
    expect(handlers.info).toHaveBeenCalledWith('help');
    expect(api.whoami).toHaveBeenCalled();
  });

  it('every account-hub row is a real, clickable destination (Phase 17)', async () => {
    render(
      <ProfileScreen
        onOwnerDashboard={noop}
        onEditProfile={noop}
        onChangePassword={noop}
        onOpenOrders={noop}
        onOpenBookings={noop}
        onOpenNotifications={noop}
        onOpenSaved={noop}
        onOpenMyReviews={noop}
        onOpenAddresses={noop}
        onOpenAppearance={noop}
        onOpenInfo={noop}
        onForgotPassword={noop}
        onRegisterSuccess={noop}
      />,
    );
    await screen.findByText('Ayesha Khan');
    // No "Soon" badges remain: every listed feature actually works.
    expect(screen.queryByText('Soon')).toBeNull();
    for (const name of ['Help & support', 'Terms & conditions', 'Privacy policy', 'About NearbyOrders', 'Saved businesses', 'My reviews', 'Addresses']) {
      expect(screen.getByText(name).closest('button')).not.toBeNull();
    }
  });

  it('shows the business dashboard entry for owners', async () => {
    vi.spyOn(sessionApi, 'getSession').mockReturnValue({ ...session, user: { ...session.user, role: 'BUSINESS_OWNER' } });
    vi.spyOn(api, 'whoami').mockResolvedValue({ ...profile, role: 'BUSINESS_OWNER' });
    render(
      <ProfileScreen
        onOwnerDashboard={noop}
        onEditProfile={noop}
        onChangePassword={noop}
        onOpenOrders={noop}
        onOpenBookings={noop}
        onOpenNotifications={noop}
        onOpenSaved={noop}
        onOpenMyReviews={noop}
        onOpenAddresses={noop}
        onOpenAppearance={noop}
        onOpenInfo={noop}
        onForgotPassword={noop}
        onRegisterSuccess={noop}
      />,
    );
    expect(await screen.findByText('Ayesha Khan')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage my business' })).toBeTruthy();
  });
});

describe('EditProfileScreen', () => {
  it('prefills existing values and saves trimmed changes', async () => {
    const spy = vi.spyOn(api, 'updateMyProfile').mockResolvedValue(profile);
    const onSaved = vi.fn();
    render(<EditProfileScreen onBack={noop} onSaved={onSaved} />);
    const first = await screen.findByLabelText('First name') as HTMLInputElement;
    expect(first.value).toBe('Ayesha');
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: ' Khan-Farooq ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ firstName: 'Ayesha', lastName: 'Khan-Farooq', phone: '+92 300 1234567' }));
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText('Profile updated ✓')).toBeTruthy();
  });

  it('validates the phone locally and shows the server error on failure', async () => {
    vi.spyOn(api, 'updateMyProfile').mockRejectedValue(new api.ApiError(400, 'VALIDATION_ERROR', 'phone: Invalid phone number'));
    render(<EditProfileScreen onBack={noop} onSaved={noop} />);
    fireEvent.change(await screen.findByLabelText('Phone'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/valid phone number/i)).toBeTruthy();
    expect(api.updateMyProfile).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+92 300 5555555' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/phone: Invalid phone number/)).toBeTruthy();
  });

  it('keeps email read-only', async () => {
    render(<EditProfileScreen onBack={noop} onSaved={noop} />);
    const email = (await screen.findByLabelText(/Email \(cannot be changed\)/)) as HTMLInputElement;
    expect(email.disabled).toBe(true);
  });
});

describe('ChangePasswordScreen', () => {
  it('validates length and match before submitting, then shows success', async () => {
    const spy = vi.spyOn(api, 'changeMyPassword').mockResolvedValue(undefined);
    render(<ChangePasswordScreen onBack={noop} />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Str0ngPassphrase!42' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/at least 12 characters/i)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'BrandNew$ecret77' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different!!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/do not match/i)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'BrandNew$ecret77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('Str0ngPassphrase!42', 'BrandNew$ecret77'));
    expect(await screen.findByText(/Password changed/)).toBeTruthy();
  });

  it('surfaces a friendly error when the current password is wrong', async () => {
    vi.spyOn(api, 'changeMyPassword').mockRejectedValue(new api.ApiError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect'));
    render(<ChangePasswordScreen onBack={noop} />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'WrongPass!12345' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'BrandNew$ecret77' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'BrandNew$ecret77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/current password is incorrect/i)).toBeTruthy();
  });
});
