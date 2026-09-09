import { getBusiness, type Business } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, CategoryPill, EmptyState, ErrorState, Loading, Money, OpenBadge, VerifiedBadge } from '../components/ui.js';
import { StoreIcon } from '../components/icons.js';
import { formatSlotTime } from '../time.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function BusinessDetailScreen(props: { idOrSlug: string; onBack: () => void; onBook?: (serviceId?: string) => void }) {
  const business = useAsyncData<Business>(() => getBusiness(props.idOrSlug), [props.idOrSlug]);

  if (business.loading) return <Loading label="Loading business…" />;
  if (business.error) return <ErrorState message={business.error} onRetry={business.reload} />;
  if (!business.data)
    return <EmptyState icon={<StoreIcon size={30} />} title="Business not found" body="It may have been removed or is not approved yet." />;

  const b = business.data;
  const place = [b.locality, b.city].filter(Boolean).join(', ');

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>

      <header className="biz-hero">
        <h1 className="biz-hero-name">{b.name}</h1>
        <div className="biz-hero-badges">
          <VerifiedBadge verified={b.isVerified} />
          {b.categories.map((c) => (
            <CategoryPill key={c.id} name={c.name} />
          ))}
          {b.isOpenNow !== undefined ? <OpenBadge open={b.isOpenNow} /> : null}
        </div>
        {b.description ? <p className="biz-hero-desc">{b.description}</p> : null}
        <div className="contact-card">
          <h2 className="contact-card-title">Contact &amp; location</h2>
          <a className="contact-row" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([b.address, b.city].filter(Boolean).join(', '))}`} target="_blank" rel="noreferrer">
            <span className="contact-icon" aria-hidden>📍</span>
            <span className="contact-text">
              <span className="contact-main">{b.address}</span>
              {place ? <span className="contact-sub">{place}</span> : null}
            </span>
            <span className="contact-chevron" aria-hidden>›</span>
          </a>
          {b.phone ? (
            <a className="contact-row" href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}>
              <span className="contact-icon" aria-hidden>📞</span>
              <span className="contact-text">
                <span className="contact-main">{b.phone}</span>
                <span className="contact-sub">Tap to call</span>
              </span>
              <span className="contact-chevron" aria-hidden>›</span>
            </a>
          ) : null}
          {b.email ? (
            <a className="contact-row" href={`mailto:${b.email}`}>
              <span className="contact-icon" aria-hidden>✉️</span>
              <span className="contact-text">
                <span className="contact-main">{b.email}</span>
                <span className="contact-sub">Tap to email</span>
              </span>
              <span className="contact-chevron" aria-hidden>›</span>
            </a>
          ) : null}
        </div>
      </header>

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
        <section className="card" aria-label="Services">
          <h2>Services</h2>
          <ul className="item-list">
            {b.services.map((s) => (
              <li key={s.id}>
                <div className="item-row">
                  <span className="item-name">{s.name}</span>
                  <Money minor={s.priceMinor} currency={s.currency} />
                </div>
                {s.description ? <p className="item-desc">{s.description}</p> : null}
                <div className="item-tags">
                  {s.durationMinutes ? <span className="pill">{s.durationMinutes} min</span> : null}
                  {props.onBook && s.isActive && s.durationMinutes ? (
                    <button
                      type="button"
                      className="pill pill-action"
                      onClick={() => props.onBook?.(s.id)}
                    >
                      Book
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {props.onBook && b.services?.some((s) => s.isActive && s.durationMinutes) ? (
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
          <h2>Menu / Products</h2>
          <ul className="item-list">
            {b.products.map((p) => (
              <li key={p.id}>
                <div className="item-row">
                  <span className="item-name">{p.name}</span>
                  <Money minor={p.priceMinor} currency={p.currency} />
                </div>
                {p.description ? <p className="item-desc">{p.description}</p> : null}
              </li>
            ))}
          </ul>
          <Button full disabled>
            Order now — coming soon
          </Button>
        </section>
      ) : null}
    </div>
  );
}
