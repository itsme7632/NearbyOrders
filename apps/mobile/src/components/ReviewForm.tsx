import { useState } from 'react';
import { createReview, type ReviewSource } from '../api.js';
import { Button } from './ui.js';

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

/**
 * Star input + optional comment for one qualifying transaction. A star-only
 * review is valid — text is never required. The server remains authoritative
 * about eligibility and duplicates; API errors surface as friendly messages.
 */
export function ReviewForm(props: {
  businessId: string;
  source: ReviewSource;
  heading?: string;
  onSubmitted: () => void;
  onCancel?: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = hovered || rating;
  const canSubmit = rating >= 1 && rating <= 5 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await createReview(props.businessId, props.source, rating, comment.trim() || undefined);
      props.onSubmitted();
    } catch {
      setError('Could not submit your review. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review-form">
      {props.heading ? <h3 className="review-form-title">{props.heading}</h3> : null}
      <div className="star-input" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value > 1 ? 's' : ''}: ${RATING_LABELS[value - 1]}`}
            className={`star-btn${shown >= value ? ' star-on' : ''}`}
            onMouseEnter={() => setHovered(value)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => setRating(value)}
          >
            ★
          </button>
        ))}
      </div>
      <p className="star-label" aria-hidden>
        {shown >= 1 ? RATING_LABELS[shown - 1] : 'Tap to rate'}
      </p>
      <textarea
        className="review-comment"
        rows={3}
        maxLength={1000}
        placeholder="Share your experience (optional)"
        aria-label="Share your experience (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="btn-row">
        <Button sm disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? 'Submitting…' : 'Submit review'}
        </Button>
        {props.onCancel ? (
          <Button sm variant="ghost" onClick={props.onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Compact display-only stars used in review lists and summaries. */
export function Stars(props: { value: number | null; count?: number; className?: string }) {
  const full = props.value === null ? 0 : Math.round(props.value);
  return (
    <span className={`stars${props.className ? ` ${props.className}` : ''}`} aria-label={props.value === null ? 'No ratings yet' : `${props.value} out of 5 stars`}>
      <span aria-hidden className="stars-row">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={props.value !== null && i <= full ? 'star-on' : 'star-off'}>
            ★
          </span>
        ))}
      </span>
      {props.count !== undefined ? <span className="stars-count">{props.count === 0 ? 'No reviews yet' : `${props.count} review${props.count > 1 ? 's' : ''}`}</span> : null}
    </span>
  );
}
