import { useEffect, useState } from 'react';
import { getBusiness, listBusinessReviews, getSession, type Business, type Product, type PublicReview, type ReviewPage } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Loading, Money, OpenBadge, VerifiedBadge } from '../components/ui.js';
import { StoreIcon } from '../components/icons.js';
import { formatSlotTime } from '../time.js';
import { addToCart, replaceWith } from '../cart.js';
import { useCartCount } from '../useCartCount.js';
import { Stars } from '../components/ReviewForm.js';
import { directionsUrl, formatDistanceKm, hasCoordinates } from '../location.js';
import { useSavedBusiness } from './customer-experience.js';
import { HeartIcon } from '../components/icons.js';
import { BusinessMapContext } from './BusinessMapContext.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

type DetailTab = 'overview' | 'services' | 'products' | 'reviews' | 'photos';

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
  const [tab, setTab] = useState<DetailTab>('overview');
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
  // Phase 11: distance comes only from the server when the customer searched
  // nearby; coordinates exist only when the owner configured a real location.
  const distanceLabel =
    b.distanceKm !== undefined && b.distanceKm !== null && hasCoordinates(b) ? formatDistanceKm(b.distanceKm) : null;
  const directions = directionsUrl(b);
  const closings = b.hours?.length
    ? b.hours
        .filter((h) => !h.isClosed && h.closesAt)
        .sort((x, y) => (x.closesAt ?? '').localeCompare(y.closesAt ?? ''))
    : [];
  const closingNote = closings.length ? `Closes ${formatSlotTime(closings[closings.length - 1].closesAt ?? '')}` : undefined;

  const tabs: { key: DetailTab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'services', label: 'Services', show: Boolean(b.services?.length) },
    { key: 'products', label: 'Products', show: Boolean(b.products?.length) },
    { key: 'reviews', label: 'Reviews', show: true },
    { key: 'photos', label: 'Photos', show: Boolean(b.imageUrl) },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : 'overview';

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>

      {/* Full-bleed hero: media behind, gradient scrim, identity overlaid —
          then the floating action bar. Back control floats on the media. */}
      <div className="biz-hero-full">
        <div className="biz-hero-media" role="img" aria-label={b.imageUrl ? `${b.name} photo` : undefined}>
          {b.imageUrl ? (
            <img src={b.imageUrl} alt={`${b.name} photo`} />
          ) : (
            <span className="hero-initial" aria-hidden>
              {b.name[0]?.toUpperCase() ?? '?'}
            </span>
          )}
          <div className="biz-hero-scrim" aria-hidden />
        </div>
        <button className="back-float" onClick={props.onBack} aria-label="Back">
          ‹
        </button>

        <header className="biz-hero-overlay">
          <div className="biz-hero-overlay-badges">
            <VerifiedBadge verified={b.isVerified} />
            {b.isOpenNow !== undefined ? <OpenBadge open={b.isOpenNow} /> : null}
            {closingNote && b.isOpenNow ? <span className="biz-hero-close">{closingNote}</span> : null}
          </div>
          <h1 className="biz-hero-name">{b.name}</h1>
          <div className="biz-hero-meta">
            <RatingLine businessId={b.id} fallbackAverage={b.averageRating} fallbackCount={b.reviewCount} />
            <span className="biz-hero-meta-item">
              {b.categories.map((c) => c.name).join(' • ') || 'Local business'}
            </span>
            {distanceLabel ? <span className="biz-hero-meta-item">📍 {distanceLabel} away</span> : place ? <span className="biz-hero-meta-item">📍 {place}</span> : null}
          </div>
        </header>
      </div>

      {/* Primary actions: Book / Order lead, utility actions follow. */}
      <div className="biz-action-bar">
        {props.onBook && bookable ? (
          <button type="button" className="biz-action biz-action-primary" onClick={() => props.onBook?.()}>
            Book a service
          </button>
        ) : null}
        {props.canOrder && b.products?.length ? (
          <button
            type="button"
            className={`biz-action${props.onBook && bookable ? '' : ' biz-action-primary'}`}
            onClick={() => setTab('products')}
          >
            Order products
          </button>
        ) : null}
        <SaveHeart businessId={b.id} />
        {b.phone ? (
          <a className="biz-action biz-action-ghost" href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}>
            Call
          </a>
        ) : null}
        {directions ? (
          <a className="biz-action biz-action-ghost" href={directions} target="_blank" rel="noreferrer">
            Directions
          </a>
        ) : null}
        <ShareButton name={b.name} />
      </div>

      {/* Primary content navigation: Reviews is a first-class tab. */}
      <div className="tab-strip" role="tablist" aria-label="Business sections">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={activeTab === t.key ? 'tab-active' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <>
          {b.description ? (
            <section className="card" aria-label="About">
              <h2>About</h2>
              <p className="biz-hero-desc" style={{ margin: 0 }}>
                {b.description}
              </p>
            </section>
          ) : null}
          {b.hours?.length ? (
            <section className="card" aria-label="Opening hours">
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
            <section className="card" aria-label="Top services" style={{ paddingBottom: 8 }}>
              <h2>Popular services</h2>
              <ServicePreviewList
                services={b.services.slice(0, 3)}
                onBook={props.onBook}
              />
              {b.services.length > 3 && props.onBook ? (
                <Button full variant="ghost" sm onClick={() => setTab('services')}>
                  See all services
                </Button>
              ) : null}
            </section>
          ) : null}
          {hasCoordinates(b) ? <BusinessMapContext business={b} placeLabel={place} /> : null}
          {props.onBook && bookable ? (
            <Button full onClick={() => props.onBook?.()}>
              Book this service
            </Button>
          ) : null}
        </>
      ) : null}

      {activeTab === 'services' && b.services?.length ? (
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

      {activeTab === 'products' && b.products?.length ? (
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
                    <span className="svc-thumb pop-card-initial" aria-hidden>
                      {p.name[0]?.toUpperCase() ?? '?'}
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

      {activeTab === 'reviews' ? <ReviewsTab businessId={b.id} /> : null}

      {activeTab === 'photos' && b.imageUrl ? (
        <section className="card" aria-label="Photos">
          <h2>Photos</h2>
          <div className="detail-hero-media-v3" style={{ height: 220, marginTop: 10 }}>
            <img src={b.imageUrl} alt={`${b.name} photo`} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Rating line for the hero; renders only when real data exists. */
function RatingLine(props: { businessId: string; fallbackAverage?: number | null; fallbackCount?: number | null }) {
  const page = useAsyncData<ReviewPage>(() => listBusinessReviews(props.businessId), [props.businessId]);
  const avg = page.data?.averageRating ?? props.fallbackAverage ?? null;
  const count = page.data?.reviewCount ?? props.fallbackCount ?? 0;
  if (avg === null) return null;
  return (
    <span className="detail-meta-line">
      <span aria-hidden>⭐</span>
      <strong>{avg.toFixed(1)}</strong>
      {count > 0 ? <span>({count} {count === 1 ? 'review' : 'reviews'})</span> : null}
    </span>
  );
}

/** Web Share API with a clipboard fallback; both are real, local actions. */
/** Phase 17: per-business save (favorite) heart. Hidden signed-out. */
function SaveHeart(props: { businessId: string }) {
  const { saved, toggle } = useSavedBusiness(props.businessId);
  const session = getSession();
  if (!session) return null;
  return (
    <button
      type="button"
      className={`biz-action biz-action-ghost save-heart${saved ? ' save-heart-on' : ''}`}
      aria-pressed={saved === true}
      aria-label={saved ? 'Remove from saved businesses' : 'Save this business'}
      onClick={() => void toggle()}
    >
      <HeartIcon size={16} filled={saved === true} />
      {saved ? 'Saved' : 'Save'}
    </button>
  );
}

function ShareButton(props: { name: string }) {
  const [shared, setShared] = useState(false);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: props.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      /* User cancelled sharing; nothing to report. */
    }
  };
  return (
    <button type="button" className="biz-action biz-action-ghost" onClick={() => void share()}>
      {shared ? 'Copied' : 'Share'}
    </button>
  );
}

/** Compact service rows for the Overview tab preview. */
function ServicePreviewList(props: { services: NonNullable<Business['services']>; onBook?: (serviceId?: string) => void }) {
  return (
    <ul className="item-list">
      {props.services.map((s) => (
        <li key={s.id}>
          <div className="item-row">
            <span className="item-name">{s.name}</span>
            <Money minor={s.priceMinor} currency={s.currency} />
          </div>
          <div className="item-tags">
            {s.durationMinutes ? <span className="pill">{s.durationMinutes} min</span> : null}
            {props.onBook && s.isActive && s.durationMinutes ? (
              <button type="button" className="pill pill-action" onClick={() => props.onBook?.(s.id)}>
                Book
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Reviews as a first-class tab: summary + list + pagination. */
function ReviewsTab(props: { businessId: string }) {
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

  if (page.loading && !state) return <ListSkeleton count={3} />;
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
