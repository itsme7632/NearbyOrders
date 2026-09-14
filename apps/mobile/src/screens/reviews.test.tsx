import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ReviewForm, Stars } from '../components/ReviewForm.js';
import { BusinessDetailScreen } from './BusinessDetail.js';
import { OrderDetailScreen } from './Orders.js';
import * as api from '../api.js';
import type { Business, Order, ReviewPage } from '../api.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/* ----------------------------- ReviewForm ----------------------------- */

describe('ReviewForm', () => {
  it('submits a star-only review (comment optional)', async () => {
    const spy = vi.spyOn(api, 'createReview').mockResolvedValue({
      id: 'r1',
      rating: 5,
      comment: null,
      createdAt: new Date().toISOString(),
      reviewerName: 'Me',
    });
    const onSubmitted = vi.fn();
    render(<ReviewForm businessId="b1" source={{ orderId: 'o1' }} onSubmitted={onSubmitted} />);

    fireEvent.click(screen.getByRole('radio', { name: /5 stars: Excellent/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('b1', { orderId: 'o1' }, 5, undefined);
  });

  it('sends a trimmed comment when provided', async () => {
    const spy = vi.spyOn(api, 'createReview').mockResolvedValue({
      id: 'r1',
      rating: 4,
      comment: 'Great!',
      createdAt: new Date().toISOString(),
      reviewerName: 'Me',
    });
    render(<ReviewForm businessId="b1" source={{ bookingId: 'bk1' }} onSubmitted={() => {}} />);

    fireEvent.click(screen.getByRole('radio', { name: /4 stars/ }));
    fireEvent.change(screen.getByLabelText(/Share your experience/), { target: { value: '  Great!  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('b1', { bookingId: 'bk1' }, 4, 'Great!'));
  });

  it('disables submit until a rating is chosen', () => {
    render(<ReviewForm businessId="b1" source={{ orderId: 'o1' }} onSubmitted={() => {}} />);
    expect((screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /3 stars/ }));
    expect((screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a friendly error when submission fails', async () => {
    vi.spyOn(api, 'createReview').mockRejectedValue(new api.ApiError(500, 'X', 'boom'));
    render(<ReviewForm businessId="b1" source={{ orderId: 'o1' }} onSubmitted={() => {}} />);

    fireEvent.click(screen.getByRole('radio', { name: /5 stars/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('Stars display', () => {
  it('renders full stars and a count label', () => {
    render(<Stars value={4.2} count={128} />);
    expect(screen.getAllByText('★').length).toBe(5);
    expect(screen.getByText('128 reviews')).toBeTruthy();
  });

  it('handles the empty state', () => {
    render(<Stars value={null} count={0} />);
    expect(screen.getByText('No reviews yet')).toBeTruthy();
  });
});

/* -------------------------- BusinessDetail --------------------------- */

const business = (patch: Partial<Business> = {}): Business => ({
  id: 'b1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  description: null,
  imageUrl: null,
  isVerified: true,
  address: '12 Test Rd',
  city: 'Lahore',
  locality: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
  ...patch,
});

const reviewPage = (patch: Partial<ReviewPage> = {}): ReviewPage => ({
  items: [
    { id: 'rv1', rating: 5, comment: 'Loved it', createdAt: new Date().toISOString(), reviewerName: 'Ayesha K.' },
  ],
  nextCursor: null,
  averageRating: 5,
  reviewCount: 1,
  ...patch,
});

function renderDetail() {
  return render(
    <BusinessDetailScreen idOrSlug="b1" onBack={() => {}} canOrder={false} />,
  );
}

describe('BusinessDetail reviews section', () => {
  /** Reviews are a first-class tab; open it before asserting content. */
  async function openReviewsTab() {
    fireEvent.click(await screen.findByRole('tab', { name: 'Reviews' }));
  }

  it('shows the rating summary, count and review cards', async () => {
    vi.spyOn(api, 'getBusiness').mockResolvedValue(business());
    vi.spyOn(api, 'listBusinessReviews').mockResolvedValue(reviewPage());

    renderDetail();
    await openReviewsTab();
    expect(await screen.findByText('4.8'.slice(0, 0) + '5.0')).toBeTruthy();
    expect(screen.getByText('1 review')).toBeTruthy();
    expect(screen.getByText('Ayesha K.')).toBeTruthy();
    expect(screen.getByText('Loved it')).toBeTruthy();
  });

  it('shows the empty state when there are no reviews', async () => {
    vi.spyOn(api, 'getBusiness').mockResolvedValue(business());
    vi.spyOn(api, 'listBusinessReviews').mockResolvedValue(reviewPage({ items: [], averageRating: null, reviewCount: 0 }));

    renderDetail();
    await openReviewsTab();
    expect(await screen.findByText('No reviews yet. Customers can review after a completed booking or order.')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows an error state with retry', async () => {
    vi.spyOn(api, 'getBusiness').mockResolvedValue(business());
    vi.spyOn(api, 'listBusinessReviews').mockRejectedValue(new api.ApiError(500, 'X', 'boom'));

    renderDetail();
    await openReviewsTab();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('long comments wrap without breaking layout', async () => {
    vi.spyOn(api, 'getBusiness').mockResolvedValue(business());
    vi.spyOn(api, 'listBusinessReviews').mockResolvedValue(
      reviewPage({
        items: [
          { id: 'rv1', rating: 4, comment: 'x'.repeat(300), createdAt: new Date().toISOString(), reviewerName: 'Very Long Reviewer Name That Should Wrap' },
        ],
      }),
    );

    renderDetail();
    await openReviewsTab();
    expect(await screen.findByText('x'.repeat(300))).toBeTruthy();
  });
});

/* ------------------------- Order detail CTA -------------------------- */

const order = (patch: Partial<Order> = {}): Order => ({
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status: 'COMPLETED',
  subtotalMinor: 90000,
  currency: 'PKR',
  fulfillmentType: 'PICKUP',
  notes: null,
  createdAt: new Date().toISOString(),
  business: { id: 'b1', name: 'Butt Spices', slug: 'butt-spices' },
  customer: null,
  items: [{ id: 'i1', productId: 'p1', name: 'Cake', unitPriceMinor: 45000, quantity: 2, lineTotalMinor: 90000 }],
  ...patch,
});

describe('OrderDetail review CTA', () => {
  it('shows Leave a review for a completed, unreviewed order', async () => {
    vi.spyOn(api, 'getMyOrder').mockResolvedValue(order());
    vi.spyOn(api, 'listMyReviews').mockResolvedValue([]);

    render(<OrderDetailScreen orderId="o1" onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Leave a review' })).toBeTruthy();
  });

  it('shows Reviewed for a completed, already-reviewed order', async () => {
    vi.spyOn(api, 'getMyOrder').mockResolvedValue(order());
    vi.spyOn(api, 'listMyReviews').mockResolvedValue([
      { id: 'rv1', rating: 5, comment: null, createdAt: new Date().toISOString(), bookingId: null, orderId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', business: { id: 'b1', name: 'Butt Spices', slug: 'butt-spices' } },
    ]);

    render(<OrderDetailScreen orderId="o1" onBack={() => {}} />);
    expect(await screen.findByText('★ Reviewed: thank you for your feedback.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Leave a review' })).toBeNull();
  });

  it('shows no review CTA for a pending order', async () => {
    vi.spyOn(api, 'getMyOrder').mockResolvedValue(order({ status: 'PENDING' }));
    render(<OrderDetailScreen orderId="o1" onBack={() => {}} />);
    await screen.findByText('Order #' + 'F90AE7');
    expect(screen.queryByRole('button', { name: 'Leave a review' })).toBeNull();
  });
});
