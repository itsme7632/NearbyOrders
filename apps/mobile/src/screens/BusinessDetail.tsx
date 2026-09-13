import { useEffect, useState } from 'react';
import { getBusiness, listBusinessReviews, type Business, type Product, type PublicReview, type ReviewPage } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Loading, Money, OpenBadge, VerifiedBadge, RatingChip } from '../components/ui.js';
import { StoreIcon } from '../components/icons.js';
import { formatSlotTime } from '../time.js';
import { addToCart, replaceWith } from '../cart.js';
import { useCartCount } from '../useCartCount.js';
import { Stars } from '../components/ReviewForm.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function BusinessDetailScreen(props: {
  idOrSlug: string;
  onBack: () => void;
  onBook?: (serviceId?: string) => void;
  /** Signed-in customers can order; owners/others only browse. */
  canOrder?: boolean;
  onOpenCart?: () => void;
}) {
  const business = useAsyncData<Business>(() => getBusiness(props.idOrSlug), [props.idOrSlug]);
  const cartCount = useCartCount();
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);

  /** Adds to cart; a foreign-business cart asks the user before replacing. */
  const handleAdd = (p: Product) => {
    const b = business.data;
    if (!b) return;
    const result = addToCart({ businessId: b.id, businessName: b.name, product: p });
    if (result.added) {
      setCartNotice(`Added ${p.name} to your cart.`);
      setPendingProduct(null);
      return;
    }
    setPendingProduct(p);
  };

  const confirmReplace = () => {
    const b = business.data;
    if (!b || !pendingProduct) return;
    replaceWith({ businessId: b.id, businessName: b.name, product: pendingProduct });
    setCartNotice(`Cart updated: now showing items from ${b.name}.`);
    setPendingProduct(null);
  };

  if (business.loading) return <Loading label="Loading business…" />;
  if (business.error) return <ErrorState message={business.error} onRetry={business.reload} />;
  if (!business.data)
    return <EmptyState icon={<StoreIcon size={30} />} title="Business not found" body="It may have been removed or is not approved yet." />;

  const b = business.data;
  const place = [b.locality, b.city].filter(Boolean).join(', ');
  const bookable = b.services?.some((s) => s.isActive && s.durationMinutes);
  const mapsQuery = encodeURIComponent([b.address, b.city].filter(Boolean).join(', '));

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>

      {/* Hero image with a branded fallback; never a broken image. */}
      <div className="detail-hero-media" role="img" aria-label={b.imageUrl ? `${b.name} photo` : undefined}>
        {b.imageUrl ? (
          <img src={b.imageUrl} alt={`${b.name} photo`} />
        ) : (
          <span className="detail-hero-fallback" aria-hidden>
            <StoreIcon size={48} />
          </span>
        )}
      </div>

      <header className="biz-hero">
        <h1 className="biz-hero-name">{b.name}</h1>
        <div className="biz-hero-badges">
          <VerifiedBadge verified={b.isVerified} />
          {b.categories.map((c) => (
            <span key={c.id} className="pill">
              {c.name}
            </span>
          ))}
          {b.isOpenNow !== undefined ? <OpenBadge open={b.isOpenNow} /> : null}
        </div>
        {b.description ? <p className="biz-hero-desc">{b.description}</p> : null}
        {place || b.phone ? (
          <div className="detail-quick">
            {place ? (
              <a
                className="quick-action"
                href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
                target="_blank"
                rel="noreferrer"
              >
                📍 Directions
              </a>
            ) : null}
            {b.phone ? (
              <a className="quick-action" href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}>
                📞 Call
              </a>
            ) : null}
            {b.hours?.length ? (
              <a className="quick-action" href="#hours">
                🕘 Hours
              </a>
            ) : null}
          </div>
        ) : null}
      </header>

      {b.hours?.length ? (
        <section className="card" id="hours" aria-label="Opening hours">
          <h2>Opening hours</h2>
          <ul className="hours-list">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
              const h = b.hours!.find((x) => x.dayOfWeek === day);
              if (!h) return null;
              return (
                <li key={h.id} className={h.isClosed ? 'closed' : ''}>
                  <span>{DAY_NAMES[day] ?? `Day ${day}`}</span>
                  <span>{h.isClosed ? 'Closed' : `${formatSlotTime(h.opensAt ?? '')} – ${formatSlotTime(h.closesAt ?? '')}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {b.services?.length ? (
        <section className="card" aria-label="Services">
          <h2>Services</h2>
          <div className="svc-list">
            {b.services.map((s) => (
              <div key={s.id} className="svc-card">
                <div className="svc-card-row">
                  <div className="svc-main">
                    <div className="item-row">
                      <span className="item-name">{s.name}</span>
                      <Money minor={s.priceMinor} currency={s.currency} />
                    </div>
                    {s.description ? <p className="item-desc">{s.description}</p> : null}
                    <div className="svc-tags">
                      {s.durationMinutes ? <span className="pill">{s.durationMinutes} min</span> : null}
                      {props.onBook && s.isActive && s.durationMinutes ? (
                        <button type="button" className="pill pill-action" onClick={() => props.onBook?.(s.id)}>
                          Book
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {props.onBook && bookable ? (
            <Button full onClick={() => props.onBook?.()}>
              Book this service
            </Button>
          ) : (
            <Button full disabled>
              Booking unavailable
            </Button>
          )}
        </section>
      ) : null}

      {b.products?.length ? (
        <section className="card" aria-label="Products">
          <h2>Products</h2>
          {cartNotice ? (
            <div className="cart-notice" role="status">
              <span>{cartNotice}</span>
              {props.onOpenCart && cartCount > 0 ? (
                <button type="button" className="pill pill-action" onClick={props.onOpenCart}>
                  View cart ({cartCount})
                </button>
              ) : null}
            </div>
          ) : null}
          {/* Cross-business guard: never silently replace another shop's items. */}
          {pendingProduct ? (
            <div className="cart-conflict" role="alertdialog" aria-label="Cart contains items from another business">
              <p>
                Your cart contains items from <strong>another business</strong>. Clear it and add{' '}
                <strong>{pendingProduct.name}</strong>?
              </p>
              <div className="btn-row">
                <Button sm onClick={confirmReplace}>
                  Clear cart and add
                </Button>
                <Button sm variant="ghost" onClick={() => setPendingProduct(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <div className="svc-list">
            {b.products.map((p) => (
              <div key={p.id} className="svc-card">
                <div className="svc-card-row">
                  {p.imageUrl ? (
                    <img className="svc-thumb" src={p.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="svc-thumb detail-hero-fallback" aria-hidden>
                      <StoreIcon size={22} />
                    </span>
                  )}
                  <div className="svc-main">
                    <div className="item-row">
                      <span className="item-name">{p.name}</span>
                      <Money minor={p.priceMinor} currency={p.currency} />
                    </div>
                    {p.description ? <p className="item-desc">{p.description}</p> : null}
                    {props.canOrder ? (
                      <div className="svc-tags">
                        <button
                          type="button"
                          className="pill pill-action"
                          onClick={() => handleAdd(p)}
                          aria-label={`Add ${p.name} to cart`}
                        >
                          + Add
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {props.canOrder && props.onOpenCart ? (
            <Button full variant="secondary" onClick={props.onOpenCart}>
              {cartCount > 0 ? `Go to cart (${cartCount})` : 'Go to cart'}
            </Button>
          ) : (
            <Button full disabled>
              Sign in as a customer to order
            </Button>
          )}
        </section>
      ) : null}

      <ReviewsSection businessId={b.id} />
    </div>
  );
}

/** Public reviews + rating summary, with cursor pagination. */
function ReviewsSection(props: { businessId: string }) {
  const [state, setState] = useState<{ items: PublicReview[]; cursor: string | null; avg: number | null; count: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const page = useAsyncData<ReviewPage>(() => listBusinessReviews(props.businessId), [props.businessId]);

  useEffect(() => {
    if (page.data)
      setState({ items: page.data.items, cursor: page.data.nextCursor, avg: page.data.averageRating, count: page.data.reviewCount });
  }, [page.data]);

  const loadMore = async () => {
    if (!state?.cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const next = await listBusinessReviews(props.businessId, 10, state.cursor);
      setState({
        items: [...state.items, ...next.items],
        cursor: next.nextCursor,
        avg: next.averageRating,
        count: next.reviewCount,
      });
    } catch {
      setLoadMoreError('Could not load more reviews.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (page.loading && !state) return <Loading label="Loading reviews…" />;
  if (page.error && !state)
    return (
      <section className="card" aria-label="Reviews">
        <h2>Reviews</h2>
        <ErrorState message={page.error} onRetry={page.reload} />
      </section>
    );
  if (!state) return null;

  return (
    <section className="card" aria-label="Reviews">
      <h2>Reviews</h2>
      <div className="rating-summary">
        <span className="rating-average">{state.avg !== null ? state.avg.toFixed(1) : '—'}</span>
        <Stars value={state.avg} count={state.count} />
      </div>
      {state.items.length === 0 ? (
        <p className="muted">No reviews yet. Customers can review after a completed booking or order.</p>
      ) : (
        <ul className="review-list">
          {state.items.map((rv) => (
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
      )}
      {loadMoreError ? (
        <p className="auth-error" role="alert">
          {loadMoreError}
        </p>
      ) : null}
      {state.cursor ? (
        <Button full variant="secondary" sm onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more reviews'}
        </Button>
      ) : null}
    </section>
  );
}
