// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HomeScreen } from './Home.js';
import * as api from '../api.js';
import type { Category } from '../api.js';

afterEach(cleanup);

const manyCategories: Category[] = [
  'Automotive',
  'Beauty & Salon',
  'Education',
  'Events & Entertainment',
  'Fitness',
  'Food & Restaurants',
  'Health & Medical',
  'Home Services',
  'Professional Services',
  'Shopping',
].map((name, i) => ({ id: `cat-${i}`, name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-'), isActive: true }));

const businesses = [] as never[];

beforeEach(() => {
  vi.spyOn(api, 'listCategories').mockResolvedValue(manyCategories);
  vi.spyOn(api, 'listBusinesses').mockResolvedValue(businesses);
});

describe('Home category display', () => {
  it('shows at most 8 primary categories and never the full wall', async () => {
    render(
      <HomeScreen
        onSearch={() => {}}
        onOpenBusiness={() => {}}
        onExploreCategory={() => {}}
        onSeeAllCategories={() => {}}
      />,
    );
    await screen.findByRole('button', { name: 'Beauty & Salon' });
    const chips = screen.getAllByRole('button', { name: /Automotive|Beauty & Salon|Education|Events & Entertainment|Fitness|Food & Restaurants|Health & Medical|Home Services|Professional Services|Shopping/ });
    expect(chips.length).toBe(8);
    expect(screen.queryByRole('button', { name: 'Shopping' })).toBeNull();
  });

  it('shows See all only when more categories exist and wires it to Explore', async () => {
    const onSeeAll = vi.fn();
    render(
      <HomeScreen onSearch={() => {}} onOpenBusiness={() => {}} onExploreCategory={() => {}} onSeeAllCategories={onSeeAll} />,
    );
    await screen.findByText('See all');
    fireEvent.click(screen.getByText('See all'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('omits See all when there are exactly 8 categories', async () => {
    vi.spyOn(api, 'listCategories').mockResolvedValue(manyCategories.slice(0, 8));
    render(
      <HomeScreen onSearch={() => {}} onOpenBusiness={() => {}} onExploreCategory={() => {}} onSeeAllCategories={() => {}} />,
    );
    await screen.findByRole('button', { name: 'Beauty & Salon' });
    await waitFor(() => expect(screen.queryByText('See all')).toBeNull());
  });

  it('navigates to Explore with the chosen category slug', async () => {
    const onExplore = vi.fn();
    render(
      <HomeScreen onSearch={() => {}} onOpenBusiness={() => {}} onExploreCategory={onExplore} onSeeAllCategories={() => {}} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Food & Restaurants' }));
    expect(onExplore).toHaveBeenCalledWith('food-restaurants');
  });
});
