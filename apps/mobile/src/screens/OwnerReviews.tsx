import { listMyBusinessReviews, type OwnerReview } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Loading, ErrorState } from '../components/ui.js';
import { Stars } from '../components/ReviewForm.js';

export function OwnerReviews(props: { businessId: string }) {
  const reviews = useAsyncData<OwnerReview[]>(() => listMyBusinessReviews(), []);

  if (reviews.loading) return <Loading label="Loading reviews…" />;
  if (reviews.error) return <ErrorState message={reviews.error} onRetry={reviews.reload} />;

  // The endpoint scopes by owner; filter to the business this tab acts on.
  const items = (reviews.data ?? []).filter((rv) => rv.business.id === props.businessId);

  if (items.length === 0)
    return (
      <section className="card" aria-label="Reviews">
        <h2>Reviews</h2>
        <p className="muted">No reviews yet. Customers can review after a completed booking or order.</p>
      </section>
    );

  const avg = items.reduce((sum, rv) => sum + rv.rating, 0) / items.length;

  return (
    <section className="card" aria-label="Reviews">
      <h2>Reviews</h2>
      <div className="rating-summary">
        <span className="rating-average">{(Math.round(avg * 10) / 10).toFixed(1)}</span>
        <Stars value={avg} count={items.length} />
      </div>
      <ul className="review-list">
        {items.map((rv) => (
          <li key={rv.id} className="review-item">
            <div className="review-head">
              <span className="review-author">{rv.reviewerName}</span>
              <span className="review-date">{new Date(rv.createdAt).toLocaleDateString()}</span>
            </div>
            <Stars value={rv.rating} />
            {rv.comment ? <p className="review-comment-text">{rv.comment}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

