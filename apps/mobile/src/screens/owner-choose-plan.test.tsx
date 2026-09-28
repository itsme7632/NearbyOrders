import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OwnerChoosePlan } from './OwnerChoosePlanScreen.js';
import * as api from '../api.js';
import type { SubscriptionPlan } from '../api.js';

afterEach(cleanup);

const plans: SubscriptionPlan[] = [
  {
    id: 'plan-basic',
    slug: 'nearbyorders-starter',
    maxBusinesses: 1,
    name: 'Starter',
    description: 'For new businesses finding their first customers.',
    monthlyPriceMinor: 99900,
    currency: 'PKR',
    trialDays: 14,
    billingInterval: 'MONTHLY',
    benefits: ['Business listing', 'Order management'],
    displayOrder: 0,
    isHighlighted: false,
    isActive: true,
  },
  {
    id: 'plan-pro',
    slug: 'nearbyorders-business',
    maxBusinesses: 3,
    name: 'Business',
    description: 'For growing businesses that want the full toolkit.',
    monthlyPriceMinor: 249900,
    currency: 'PKR',
    trialDays: 14,
    billingInterval: 'MONTHLY',
    benefits: ['Everything in Starter', 'Homepage promotion slot'],
    displayOrder: 1,
    isHighlighted: true,
    isActive: true,
  },
];

let plansSpy: MockInstance<() => Promise<SubscriptionPlan[]>>;

beforeEach(() => {
  vi.clearAllMocks();
  plansSpy = vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue(plans);
});

describe('OwnerChoosePlan', () => {
  it('renders every active plan from the API with price, trial, and benefits', async () => {
    plansSpy.mockResolvedValue([
      ...plans,
      { ...plans[0], id: 'plan-old', slug: 'legacy', name: 'Legacy', isActive: false },
    ]);
    render(<OwnerChoosePlan businessId="biz-1" />);
    const group = await screen.findByRole('radiogroup', { name: 'Subscription plans' });
    expect(group.textContent).toContain('Starter');
    expect(group.textContent).toContain('Business');
    expect(group.textContent).toContain('14-day free trial included');
    expect(group.textContent).toContain('Homepage promotion slot');
    // Inactive plans never render.
    expect(group.textContent).not.toContain('Legacy');
  });

  it('marks the highlighted plan as recommended', async () => {
    render(<OwnerChoosePlan businessId="biz-1" />);
    const business = await screen.findByRole('radio', { name: (n) => n.startsWith('Business') });
    expect(business.textContent).toContain('Recommended');
    const starter = await screen.findByRole('radio', { name: (n) => n.startsWith('Starter') });
    expect(starter.textContent).not.toContain('Recommended');
  });

  it('selects a plan and hands the server plan back to the caller', async () => {
    const onSelect = vi.fn();
    render(<OwnerChoosePlan businessId="biz-1" onSelect={onSelect} />);
    const business = await screen.findByRole('radio', { name: (n) => n.startsWith('Business') });
    expect(business).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(business);
    expect(business).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Business' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ slug: 'nearbyorders-business', id: 'plan-pro' }));
  });

  it('disables continue until a plan is selected', async () => {
    render(<OwnerChoosePlan businessId="biz-1" onSelect={vi.fn()} />);
    await screen.findByRole('radiogroup', { name: 'Subscription plans' });
    expect(screen.getByRole('button', { name: 'Select a plan to continue' })).toBeDisabled();
  });

  it('shows an honest empty state when no plans are active', async () => {
    plansSpy.mockResolvedValue([]);
    render(<OwnerChoosePlan businessId="biz-1" />);
    expect(await screen.findByText('No plans available right now')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('hides the continue row entirely when there is no selection callback', async () => {
    render(<OwnerChoosePlan businessId="biz-1" />);
    await screen.findByRole('radiogroup', { name: 'Subscription plans' });
    expect(screen.queryByRole('button', { name: /Continue with|Select a plan/ })).toBeNull();
  });
});
