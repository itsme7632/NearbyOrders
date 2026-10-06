import { useMemo, useState } from 'react';
import {
  createBooking,
  getMultiServiceAvailability,
  getBusiness,
  ApiError,
  type Availability,
  type Business,
  type Booking,
  type Service,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Loading, Money, EmptyState } from '../components/ui.js';
import { AlertIcon, CheckIcon, StoreIcon } from '../components/icons.js';
import {
  addDays,
  compactDateLabel,
  dayOfWeek,
  formatSlotTime,
  longDateLabel,
  todayPkt,
} from '../time.js';
import { groupSlotsByDaypart } from './bookingSlots.js';
import './BookService.css';

type Step = 'service' | 'time' | 'summary' | 'success';

const DATE_WINDOW_DAYS = 14;

/** Bookable = active service with a duration (the backend refuses others). */
const isBookable = (s: Service): boolean => s.isActive && s.durationMinutes !== null && s.durationMinutes > 0;

/**
 * Flat, selectable service row (editorial list, not a boxed card). The whole
 * row is the button; price and duration read as a right-aligned meta column,
 * and the chosen state is a hairline ring rather than a filled tile.
 */
function ServiceOption(props: { service: Service; selected: boolean; onSelect: () => void }) {
  const s = props.service;
  const bookable = isBookable(s);
  return (
    <button
      type="button"
      className={`svc-option${props.selected ? ' svc-option-active' : ''}${bookable ? '' : ' svc-option-off'}`}
      onClick={props.onSelect}
      disabled={!bookable}
      aria-pressed={props.selected}
    >
      <span className="svc-option-main">
        <span className="svc-option-name">{s.name}</span>
        {s.description ? <span className="svc-option-desc">{s.description}</span> : null}
      </span>
      <span className="svc-option-side">
        <span className="svc-option-price">
          <Money minor={s.priceMinor} currency={s.currency} />
        </span>
        <span className="svc-option-duration">{s.durationMinutes ? `${s.durationMinutes} min` : 'No duration'}</span>
        {!bookable ? <span className="svc-option-unavailable">Unavailable</span> : null}
      </span>
      <span className="svc-option-check" aria-hidden>
        <CheckIcon size={13} />
      </span>
    </button>
  );
}

export function BookServiceScreen(props: {
  businessId: string;
  preselectedServiceId?: string;
  onBack: () => void;
  onDone: (booking: Booking) => void;
}) {
  const business = useAsyncData<Business>(() => getBusiness(props.businessId), [props.businessId]);

  const [step, setStep] = useState<Step>(props.preselectedServiceId ? 'time' : 'service');
  const [serviceIds, setServiceIds] = useState<string[]>(props.preselectedServiceId ? [props.preselectedServiceId] : []);
  const [date, setDate] = useState<string>(todayPkt());
  const [slot, setSlot] = useState<{ start: string; end: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);
  const [created, setCreated] = useState<Booking | null>(null);

  const services = (business.data?.services ?? []).filter(isBookable);
  const selectedServices = serviceIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is Service => s !== undefined);
  const combinedDuration = selectedServices.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
  const combinedPrice = selectedServices.reduce((sum, s) => sum + s.priceMinor, 0);

  const toggleService = (id: string) => {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 10)));
    setSlot(null);
  };

  // The date strip always starts today (business-local) — no past dates.
  const dates = useMemo(() => Array.from({ length: DATE_WINDOW_DAYS }, (_, i) => addDays(todayPkt(), i)), []);

  const availability = useAsyncData<Availability | null>(
    () =>
      selectedServices.length > 0
        ? getMultiServiceAvailability(props.businessId, serviceIds, date)
        : Promise.resolve(null),
    [serviceIds.join(','), date, selectedServices.length],
  );

  const chooseSlot = (s: { start: string; end: string }) => {
    setSlot(s);
    setSubmitError(null);
    setSlotTaken(false);
    setStep('summary');
  };

  const backToSlots = () => {
    setSlot(null);
    setSubmitError(null);
    setSlotTaken(false);
    setStep('time');
  };

  const confirm = async () => {
    if (selectedServices.length === 0 || !slot || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSlotTaken(false);
    try {
      const booking = await createBooking({
        businessId: props.businessId,
        serviceIds,
        date,
        startTime: slot.start,
        notes: notes.trim() || undefined,
      });
      setCreated(booking);
      setStep('success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SLOT_TAKEN') {
        // Someone booked this slot between fetching availability and confirming.
        setSlotTaken(true);
        setStep('time');
        availability.reload();
      } else if (e instanceof ApiError && (e.code === 'IN_PAST' || e.code === 'OUTSIDE_HOURS' || e.code === 'CLOSED_DAY')) {
        setSubmitError('That time is no longer bookable. Please pick another slot.');
        setSlotTaken(true);
        setStep('time');
        availability.reload();
      } else if (e instanceof ApiError && e.status === 0) {
        setSubmitError(e.message);
      } else if (e instanceof ApiError && e.status === 401) {
        setSubmitError('Please sign in again to confirm your booking.');
      } else {
        setSubmitError('We could not complete your booking. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (business.loading) return <Loading label="Loading booking…" />;
  if (business.error) return <ErrorState message={business.error} onRetry={business.reload} />;
  if (!business.data)
    return <EmptyState icon={<StoreIcon size={30} />} title="Business not found" body="It may have been removed or is not approved yet." />;

  const b = business.data;

  if (step === 'service' && services.length === 0) {
    return (
      <div className="screen">
        <button className="back-link" onClick={props.onBack}>
          ‹ Back
        </button>
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Nothing to book yet"
          body={`${b.name} has not added bookable services. Check back soon.`}
        />
      </div>
    );
  }

  const place = [b.locality, b.city].filter(Boolean).join(', ');
  const stepIndex = step === 'service' ? 0 : step === 'time' ? 1 : 2;
  const stepNames = ['Service', 'Date & time', 'Review'];

  return (
    <div className="screen booking-screen">
      <button
        className="back-link"
        onClick={() => {
          if (step === 'summary') backToSlots();
          else if (step === 'time' && !props.preselectedServiceId) setStep('service');
          else props.onBack();
        }}
      >
        ‹ {step === 'summary' ? 'Back to times' : step === 'time' && !props.preselectedServiceId ? 'Back to services' : 'Back'}
      </button>

      {/* Editorial identity header: on the service step the business is the
          hero; once a service is chosen the service takes the headline (name,
          price, duration — all from the API) with the business as the
          supporting line. */}
      <header className="booking-head">
        <p className="booking-eyebrow">
          {step === 'service' ? 'Book a service' : step === 'time' ? 'Choose a time' : 'Review & confirm'}
        </p>
        {step === 'time' && selectedServices.length > 0 ? (
          <div className="book-service-identity">
            <h1 className="book-service-name">
              {selectedServices.length === 1 ? selectedServices[0].name : `${selectedServices.length} services`}
            </h1>
            <p className="book-service-meta">
              <span>{b.name}</span>
              <Money minor={combinedPrice} currency={selectedServices[0].currency} />
              {combinedDuration ? <span>{combinedDuration} min total</span> : null}
            </p>
            {selectedServices.length > 1 ? (
              <ul className="book-service-list">
                {selectedServices.map((s) => (
                  <li key={s.id}>
                    {s.name} · <Money minor={s.priceMinor} currency={s.currency} /> · {s.durationMinutes} min
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <>
            <h1 className="booking-title">{step === 'summary' ? 'Confirm your booking' : b.name}</h1>
            <p className="booking-head-biz">
              {step === 'summary' ? (
                <>{place ? <span className="booking-head-place">{place}</span> : null}</>
              ) : (
                <>
                  {b.isVerified ? (
                    <span className="booking-head-verified" title="Verified by NearbyOrders">
                      ✓ Verified
                    </span>
                  ) : null}
                  {b.isOpenNow !== undefined ? (
                    <span className={`biz-open${b.isOpenNow ? '' : ' biz-open-closed'}`}>{b.isOpenNow ? 'Open now' : 'Closed'}</span>
                  ) : null}
                  {place ? <span className="booking-head-place">{place}</span> : null}
                </>
              )}
            </p>
          </>
        )}
      </header>

      {/* Step indicator: quiet numbered rail, current step emphasized. */}
      {step !== 'success' ? (
        <ol className="book-steps" aria-label={`Step ${stepIndex + 1} of ${stepNames.length}`}>
          {stepNames.map((name, i) => (
            <li
              key={name}
              className={`book-step${i === stepIndex ? ' book-step-now' : ''}${i < stepIndex ? ' book-step-done' : ''}`}
            >
              <span className="book-step-dot" aria-hidden>
                {i < stepIndex ? '✓' : i + 1}
              </span>
              <span className="book-step-name">{name}</span>
              {i < stepNames.length - 1 ? <span className="book-step-bar" aria-hidden /> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {/* Step 1 — service selection (multi-select, up to 10) */}
      {step === 'service' ? (
        <section className="book-section" aria-label="Choose services">
          <h2 className="book-section-title">Which services?</h2>
          <p className="book-section-hint">Select up to 10. Durations and prices combine.</p>
          <div className="svc-option-list">
            {(business.data?.services ?? []).map((s) => (
              <ServiceOption
                key={s.id}
                service={s}
                selected={serviceIds.includes(s.id)}
                onSelect={() => {
                  if (!isBookable(s)) return;
                  toggleService(s.id);
                }}
              />
            ))}
          </div>
          {selectedServices.length > 0 ? (
            <div className="book-selection-summary">
              <p>
                {selectedServices.length} selected · {combinedDuration} min total ·{' '}
                <Money minor={combinedPrice} currency={selectedServices[0].currency} />
              </p>
              <Button
                onClick={() => {
                  setSlot(null);
                  setStep('time');
                }}
              >
                Continue
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Step 2 — date + slots grouped by daypart (backend stays authoritative:
          only the presentation of its slots is grouped). */}
      {step === 'time' && selectedServices.length > 0 ? (
        <>
          <section className="book-section" aria-label="Choose a date">
            <h2 className="book-section-title">Pick a date</h2>
            <div className="date-strip" role="listbox" aria-label="Available dates">
              {dates.map((d) => {
                const label = compactDateLabel(d);
                const closed = b.hours?.find((h) => h.dayOfWeek === dayOfWeek(d))?.isClosed ?? false;
                return (
                  <button
                    key={d}
                    type="button"
                    role="option"
                    aria-selected={d === date}
                    className={`date-chip${d === date ? ' date-chip-active' : ''}${closed ? ' date-chip-closed' : ''}`}
                    onClick={() => {
                      setDate(d);
                      setSlot(null);
                    }}
                  >
                    <span className="date-chip-day">{label.day}</span>
                    <span className="date-chip-num">{label.num}</span>
                    <span className="date-chip-month">{label.month}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="book-section" aria-label="Available times">
            <h2 className="book-section-title">Available times</h2>
            {availability.loading ? (
              <Loading label="Checking availability…" />
            ) : availability.error ? (
              <ErrorState message={availability.error} onRetry={availability.reload} />
            ) : availability.data?.closed ? (
              <EmptyState
                icon={<StoreIcon size={26} />}
                title="Closed on this day"
                body="This business is closed on the selected date. Try another day."
              />
            ) : !availability.data ? null : (
              (() => {
                const open = availability.data.slots.filter((s) => s.available);
                if (open.length === 0)
                  return (
                    <EmptyState
                      icon={<StoreIcon size={26} />}
                      title={availability.data.slots.length ? 'Fully booked' : 'No slots'}
                      body={
                        availability.data.slots.length
                          ? 'Every slot on this date is taken. Try another day.'
                          : 'This business has no bookable times for the selected date.'
                      }
                    />
                  );
                return (
                  <div className="slot-groups">
                    {groupSlotsByDaypart(availability.data.slots).map((group) => (
                      <section key={group.daypart} className="slot-group" aria-label={`${group.daypart} slots`}>
                        <h3 className="slot-group-title">{group.daypart}</h3>
                        <div className="slot-grid">
                          {group.slots.map((s) => (
                            <button
                              key={s.start}
                              type="button"
                              className={`slot${s.available ? '' : ' slot-taken'}`}
                              disabled={!s.available}
                              onClick={() => chooseSlot({ start: s.start, end: s.end })}
                            >
                              {formatSlotTime(s.start)}
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                );
              })()
            )}
            {slotTaken ? (
              <div className="auth-error" role="alert">
                <AlertIcon size={18} />
                <span>That time was just booked. Choose another time below.</span>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {/* Step 3 — booking ticket: identity stub, perforation, line items,
          total. endAt comes from the slot the server returned. */}
      {step === 'summary' && selectedServices.length > 0 && slot && b ? (
        <section className="book-section" aria-label="Booking summary">
          <h2 className="book-section-title">Review your booking</h2>
          <div className="ticket" role="group" aria-label="Booking ticket">
            <div className="ticket-stub">
              <p className="ticket-biz">{b.name}</p>
              {selectedServices.length === 1 ? (
                <p className="ticket-service">{selectedServices[0].name}</p>
              ) : (
                <ul className="ticket-service-list">
                  {selectedServices.map((s) => (
                    <li key={s.id}>
                      {s.name} · {s.durationMinutes} min
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="ticket-perforation" aria-hidden />
            <dl className="ticket-rows">
              <div>
                <dt>Date</dt>
                <dd>{longDateLabel(date)}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>
                  {formatSlotTime(slot.start)} – {formatSlotTime(slot.end)}
                </dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{combinedDuration} minutes total</dd>
              </div>
              {place ? (
                <div>
                  <dt>Location</dt>
                  <dd>{place}</dd>
                </div>
              ) : null}
            </dl>
            <div className="ticket-perforation" aria-hidden />
            <div className="ticket-total">
              <span>Total</span>
              <Money minor={combinedPrice} currency={selectedServices[0].currency} />
            </div>
          </div>

          <label className="field">
            <span className="label">Note for the business (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Anything the business should know?"
            />
          </label>

          {submitError ? (
            <div className="auth-error" role="alert">
              <AlertIcon size={18} />
              <span>{submitError}</span>
            </div>
          ) : null}

          <div className="booking-ticket-actions">
            <Button full disabled={submitting} onClick={() => void confirm()}>
              {submitting ? 'Confirming…' : 'Confirm booking'}
            </Button>
            <Button full variant="ghost" onClick={backToSlots} disabled={submitting}>
              Change date or time
            </Button>
          </div>
        </section>
      ) : null}

      {/* Step 4 — success */}
      {step === 'success' && created ? (
        <section className="book-section booking-success" aria-label="Booking confirmation">
          <span className="success-mark" aria-hidden>
            <CheckIcon size={30} />
          </span>
          <h2>Booking {created.status === 'CONFIRMED' ? 'confirmed' : 'requested'}</h2>
          <p className="booking-success-sub">
            {created.status === 'CONFIRMED'
              ? 'Your booking is confirmed.'
              : 'Your booking request was sent to the business. You will see its status in My Bookings.'}
          </p>
          <dl className="summary-list">
            <div>
              <dt>Business</dt>
              <dd>{created.businessName}</dd>
            </div>
            {created.serviceName ? (
              <div>
                <dt>Service</dt>
                <dd>{created.serviceName}</dd>
              </div>
            ) : null}
            <div>
              <dt>Date</dt>
              <dd>{longDateLabel(created.bookingDate)}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>
                {formatSlotTime(created.startTime)}
                {created.endTime ? ` – ${formatSlotTime(created.endTime)}` : ''}
              </dd>
            </div>
            {created.priceMinor !== null ? (
              <div>
                <dt>Price</dt>
                <dd>
                  <Money minor={created.priceMinor} currency={created.currency} />
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`booking-status booking-status-${created.status.toLowerCase()}`}>
                  {created.status === 'PENDING' ? 'Pending' : created.status === 'CONFIRMED' ? 'Confirmed' : created.status}
                </span>
              </dd>
            </div>
          </dl>
          <Button full onClick={() => props.onDone(created)}>
            View my bookings
          </Button>
        </section>
      ) : null}
    </div>
  );
}
