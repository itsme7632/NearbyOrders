import { useMemo, useState } from 'react';
import {
  createBooking,
  getAvailability,
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

type Step = 'service' | 'time' | 'summary' | 'success';

const DATE_WINDOW_DAYS = 14;

/** Bookable = active service with a duration (the backend refuses others). */
const isBookable = (s: Service): boolean => s.isActive && s.durationMinutes !== null && s.durationMinutes > 0;

function ServiceOption(props: { service: Service; selected: boolean; onSelect: () => void }) {
  const s = props.service;
  const bookable = isBookable(s);
  return (
    <button
      type="button"
      className={`service-option${props.selected ? ' service-option-active' : ''}`}
      onClick={props.onSelect}
      disabled={!bookable}
      aria-pressed={props.selected}
    >
      <span className="service-option-main">
        <span className="service-option-name">{s.name}</span>
        {s.description ? <span className="service-option-desc">{s.description}</span> : null}
      </span>
      <span className="service-option-side">
        <Money minor={s.priceMinor} currency={s.currency} />
        <span className="service-option-duration">{s.durationMinutes ? `${s.durationMinutes} min` : 'No duration'}</span>
        {!bookable ? <span className="service-option-off">Unavailable</span> : null}
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
  const [serviceId, setServiceId] = useState<string | undefined>(props.preselectedServiceId);
  const [date, setDate] = useState<string>(todayPkt());
  const [slot, setSlot] = useState<{ start: string; end: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);
  const [created, setCreated] = useState<Booking | null>(null);

  const services = (business.data?.services ?? []).filter(isBookable);
  const service = services.find((s) => s.id === serviceId) ?? null;

  // The date strip always starts today (business-local) — no past dates.
  const dates = useMemo(() => Array.from({ length: DATE_WINDOW_DAYS }, (_, i) => addDays(todayPkt(), i)), []);

  const availability = useAsyncData<Availability | null>(
    () => (service ? getAvailability(props.businessId, service.id, date) : Promise.resolve(null)),
    [service?.id, date],
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
    if (!service || !slot || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSlotTaken(false);
    try {
      const booking = await createBooking({
        businessId: props.businessId,
        serviceId: service.id,
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

  return (
    <div className="screen">
      <button className="back-link" onClick={step === 'summary' ? backToSlots : props.onBack}>
        ‹ {step === 'summary' ? 'Back to times' : 'Back'}
      </button>

      <header className="booking-head">
        <h1>{step === 'summary' ? 'Confirm your booking' : 'Book a service'}</h1>
        <p className="booking-head-biz">
          {b.name}
          {place ? <span className="booking-head-place"> · {place}</span> : null}
        </p>
      </header>

      {/* Step 1 — service selection */}
      {step === 'service' ? (
        <section className="card" aria-label="Choose a service">
          <h2>Which service?</h2>
          <div className="service-options">
            {(business.data?.services ?? []).map((s) => (
              <ServiceOption
                key={s.id}
                service={s}
                selected={s.id === serviceId}
                onSelect={() => {
                  if (!isBookable(s)) return;
                  setServiceId(s.id);
                  setSlot(null);
                  setStep('time');
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Step 2 — date + slots (backend is authoritative) */}
      {step === 'time' && service ? (
        <>
          <section className="card" aria-label="Choose a date">
            <h2>Pick a date</h2>
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

          <section className="card" aria-label="Available times">
            <h2>Available times</h2>
            <p className="booking-slot-meta">
              {service.name} · {service.durationMinutes} min
            </p>
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
                  <div className="slot-grid">
                    {availability.data.slots.map((s) => (
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

      {/* Step 3 — summary */}
      {step === 'summary' && service && slot && b ? (
        <section className="card booking-summary" aria-label="Booking summary">
          <dl className="summary-list">
            <div>
              <dt>Business</dt>
              <dd>{b.name}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{service.name}</dd>
            </div>
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
              <dd>{service.durationMinutes} minutes</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>
                <Money minor={service.priceMinor} currency={service.currency} />
              </dd>
            </div>
            {place ? (
              <div>
                <dt>Location</dt>
                <dd>{place}</dd>
              </div>
            ) : null}
          </dl>

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

          <Button full disabled={submitting} onClick={() => void confirm()}>
            {submitting ? 'Confirming…' : 'Confirm booking'}
          </Button>
          <Button full variant="ghost" onClick={backToSlots} disabled={submitting}>
            Change date or time
          </Button>
        </section>
      ) : null}

      {/* Step 4 — success */}
      {step === 'success' && created ? (
        <section className="card booking-success" aria-label="Booking confirmation">
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
