import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { OwnerBusinessProfile } from './OwnerBusinessProfile.js';
import * as api from '../api.js';

afterEach(cleanup);

const business = {
  id: 'biz-1',
  name: 'Butt Spices',
  status: 'APPROVED',
  isVerified: true,
  locality: 'Food Street',
  city: 'Karachi',
  address: '12 Food Street',
  categories: [{ id: 'cat-food', name: 'Food', slug: 'food' }],
  averageRating: 4.5,
} as unknown as api.Business;

const noop = () => {};

const props = {
  onOpenDashboard: noop,
  onOpenBusinessScreen: noop,
  onEditProfile: noop,
  onChangePassword: noop,
  onOpenNotifications: noop,
  onSwitchToCustomer: noop,
};

let verificationSpy: MockInstance<(businessId: string) => Promise<api.VerificationState>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([business]);
  verificationSpy = vi.spyOn(api, 'getVerification').mockResolvedValue({ application: null, documents: [] });
  // The plan card's subscription/trial/payment calls stay out of this test's
  // way; the card renders its skeleton-free body from these.
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({
    businessId: 'biz-1',
    subscription: {
      id: 'sub-1',
      status: 'ACTIVE',
      trialStartAt: null,
      trialEndAt: null,
      currentPeriodStartAt: '2026-09-01T00:00:00.000Z',
      currentPeriodEndAt: '2026-10-01T00:00:00.000Z',
      cancelledAt: null,
      planNameSnapshot: 'Business',
      planPriceMinorSnapshot: 299900,
      plan: {
        slug: 'nearbyorders-business',
        name: 'Business',
        description: null,
        monthlyPriceMinor: 299900,
        currency: 'PKR',
        trialDays: 30,
        benefits: [],
        billingInterval: 'MONTHLY',
        displayOrder: 0,
        isHighlighted: true,
      },
    },
    status: 'ACTIVE',
    trial: null,
    planNameSnapshot: 'Business',
    planPriceMinorSnapshot: 299900,
    verificationStatus: null,
    trialStatus: 'CONVERTED',
  } satisfies api.BusinessSubscriptionState);
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
});

describe('OwnerBusinessProfile section order', () => {
  it('keeps the plan card prominent: identity first, plan card before management', async () => {
    const { container } = render(<OwnerBusinessProfile {...props} />);
    await screen.findByRole('heading', { name: 'Butt Spices' });
    // The plan card loads its own subscription data; wait for it.
    const planSection = await screen.findByRole('region', { name: 'NearbyOrders plan' });
    const firstHubSection = container.querySelector('section.hub-section');
    expect(planSection.compareDocumentPosition(firstHubSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And it sits below the identity hero.
    const hero = container.querySelector('.profile-hero');
    expect(hero!.compareDocumentPosition(planSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the platform section after management, before account', async () => {
    const { container } = render(<OwnerBusinessProfile {...props} />);
    await screen.findByRole('heading', { name: 'Butt Spices' });
    const sections = Array.from(container.querySelectorAll('section.hub-section')).map((s) =>
      s.getAttribute('aria-label'),
    );
    expect(sections).toEqual([
      'Manage my business',
      'Platform',
      'Account',
      'Switch context',
    ]);
  });
});

describe('OwnerBusinessProfile verification and promotions rows', () => {
  it('shows the live verification status, never a "Soon" placeholder', async () => {
    verificationSpy.mockResolvedValue({
      application: { status: 'UNDER_REVIEW' },
      documents: [],
    } as unknown as api.VerificationState);
    render(<OwnerBusinessProfile {...props} />);
    const platform = await screen.findByRole('region', { name: 'Platform' });
    const row = within(platform).getByRole('button', { name: /Verification/ });
    await waitFor(() => expect(row.textContent).toContain('Under review by the NearbyOrders team'));
    expect(row.textContent).not.toMatch(/soon/i);
  });

  it('shows the verified state with the badge on the verification row', async () => {
    verificationSpy.mockResolvedValue({
      application: { status: 'APPROVED' },
      documents: [],
    } as unknown as api.VerificationState);
    render(<OwnerBusinessProfile {...props} />);
    const platform = await screen.findByRole('region', { name: 'Platform' });
    const row = within(platform).getByRole('button', { name: /Verification/ });
    await waitFor(() => expect(row.textContent).toContain('Your business is verified'));
  });

  it('opens the verification screen from the row', async () => {
    const onOpenBusinessScreen = vi.fn();
    render(<OwnerBusinessProfile {...props} onOpenBusinessScreen={onOpenBusinessScreen} />);
    const platform = await screen.findByRole('region', { name: 'Platform' });
    fireEvent.click(within(platform).getByRole('button', { name: /Verification/ }));
    expect(onOpenBusinessScreen).toHaveBeenCalledWith('biz-1', 'verification');
  });

  it('has a live promotions row that opens the promotions screen', async () => {
    const onOpenBusinessScreen = vi.fn();
    render(<OwnerBusinessProfile {...props} onOpenBusinessScreen={onOpenBusinessScreen} />);
    const platform = await screen.findByRole('region', { name: 'Platform' });
    const row = within(platform).getByRole('button', { name: /Promotions/ });
    expect(row.textContent).not.toMatch(/soon/i);
    fireEvent.click(row);
    expect(onOpenBusinessScreen).toHaveBeenCalledWith('biz-1', 'promotions');
  });

  it('never renders "Soon" or "Coming soon" anywhere on the profile', async () => {
    const { container } = render(<OwnerBusinessProfile {...props} />);
    await screen.findByRole('heading', { name: 'Butt Spices' });
    expect(container.textContent).not.toMatch(/coming soon/i);
    // The only "soon" allowed is inside real words; the placeholder check:
    expect(container.textContent).not.toMatch(/\bsoon\b/i);
  });
});
