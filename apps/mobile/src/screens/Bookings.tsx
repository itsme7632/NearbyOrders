import { useEffect, useMemo, useState } from 'react';
import {
  cancelMyBooking,
  getBooking,
  listBookingPayments,
  listBusinessPayInMethods,
  listMyBookings,
  listMyReviews,
  submitBookingPayment,
  uploadPaymentReceipt,
  ApiError,
  type Booking,
  type BookingStatus,
  type BusinessPayInMethod,
  type CustomerPayment,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Loading, Money } from '../components/ui.js';
import { AlertIcon, BookingsIcon } from '../components/icons.js';
import { daysBetween, formatSlotTime, longDateLabel, todayPkt } from '../time.js';
import { ReviewForm } from '../components/ReviewForm.js';

const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Declined',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

/** Restrained status treatment: compact label, colored by meaning, never a heavy pill. */
export function BookingStatusBadge(props: { status: BookingStatus }) {
  return <span className={`booking-status booking-status-${props.status.toLowerCase()}`}>{STATUS_LABEL[props.status]}</span>;
}

/**
 * Booking row in the v7 marketplace-card language (shared with Orders):
 * calendar block on the left so "when is my next booking" scans instantly,
 * service as the primary line, business + time as the supporting meta, and
 * price + restrained status on the right. Hairline card, near-flat.
 */
function BookingCard(props: { booking: Booking; onOpen: () => void }) {
  const b = props.booking;
  const d = new Date(`${b.bookingDate}T00:00:00`);
  const dayNum = d.getDate();
  const month = d.toLocaleDateString('en-PK', { month: 'short' });
  return (
    <button type="button" className="order-card-v3 bk-card" onClick={props.onOpen}>
      <span className="oc-top">
        <span className="bk-date" aria-hidden>
          <span className="bk-date-num">{dayNum}</span>
          <span className="bk-date-month">{month}</span>
        </span>
        <span className="oc-main">
          <span className="oc-name">{b.serviceName ?? 'Booking'}</span>
          <span className="oc-sub">{b.businessName}</span>
          <span className="oc-sub bk-when">
            {formatSlotTime(b.startTime)}
            {b.endTime ? ` – ${formatSlotTime(b.endTime)}` : ''}
          </span>
        </span>
        <span className="oc-side">
          {b.priceMinor !== null ? (
            <span className="oc-amount">
              <Money minor={b.priceMinor} currency={b.currency} />
            </span>
          ) : null}
          <BookingStatusBadge status={b.status} />
        </span>
      </span>
    </button>
  );
}

/**
 * Signed-in customer view of all their bookings. Upcoming (the active,
 * actionable set) sits first; Past reads as an archive grouped into
 * Completed and Cancelled & declined, mirroring the redesigned Orders screen.
 */
export function BookingsScreen(props: { onOpenBooking: (id: string) => void; onExplore: () => void }) {
  const bookings = useAsyncData<Booking[]>(() => listMyBookings(), []);
  const today = todayPkt();

  const groups = useMemo(() => {
    const all = bookings.data ?? [];
    // Upcoming = today or later and not yet resolved. Everything else (past
    // dates or terminal statuses) is history.
    const upcoming = all
      .filter((b) => b.status !== 'CANCELLED' && b.status !== 'REJECTED' && b.status !== 'COMPLETED' && daysBetween(today, b.bookingDate) >= 0)
      .sort((a, b) => (a.bookingDate + a.startTime).localeCompare(b.bookingDate + b.startTime));
    const past = all
      .filter((b) => !upcoming.includes(b))
      .sort((a, b) => (b.bookingDate + b.startTime).localeCompare(a.bookingDate + a.startTime));
    // The archive is a hierarchy, not one undifferentiated list: resolved
    // past bookings split into Completed and Cancelled & declined; anything
    // still open but past-dated sits under Earlier.
    const pastGroups = [
      { key: 'earlier', title: 'Earlier', items: past.filter((b) => b.status === 'PENDING' || b.status === 'CONFIRMED') },
      { key: 'completed', title: 'Completed', items: past.filter((b) => b.status === 'COMPLETED') },
      { key: 'cancelled', title: 'Cancelled & declined', items: past.filter((b) => b.status === 'CANCELLED' || b.status === 'REJECTED') },
    ].filter((g) => g.items.length > 0);
    return { upcoming, past, pastGroups };
  }, [bookings.data, today]);

  if (bookings.loading) return <ListSkeleton count={4} />;
  if (bookings.error) return <ErrorState message={bookings.error} onRetry={bookings.reload} />;

  if (!bookings.data?.length) {
    return (
      <div className="screen">
        <EmptyState
          icon={<BookingsIcon size={30} />}
          title="No bookings yet"
          body="Discover something nearby and book your first service."
          action={
            <Button onClick={props.onExplore} sm>
              Explore businesses
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>My bookings</h1>
      </header>

      {groups.upcoming.length ? (
        <section aria-label="Upcoming bookings" className="order-group">
          <div className="section-head section-head-sm">
            <h2>Upcoming</h2>
            <span className="biz-distance">
              {groups.upcoming.length} {groups.upcoming.length === 1 ? 'booking' : 'bookings'}
            </span>
          </div>
          <ul className="order-list">
            {groups.upcoming.map((b) => (
              <li key={b.id}>
                <BookingCard booking={b} onOpen={() => props.onOpenBooking(b.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.past.length ? (
        <section aria-label="Past bookings" className="order-group">
          <div className="section-head section-head-sm">
            <h2>Past</h2>
          </div>
          {groups.pastGroups.map((g) => (
            <div key={g.key} className="bk-subgroup">
              {groups.pastGroups.length > 1 ? <h3 className="bk-subgroup-title">{g.title}</h3> : null}
              <ul className="order-list">
                {g.items.map((b) => (
                  <li key={b.id}>
                    <BookingCard booking={b} onOpen={() => props.onOpenBooking(b.id)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/** Single booking detail: flat editorial sections (status hero, when, details). */
export function BookingDetailScreen(props: { bookingId: string; onBack: () => void }) {
  const booking = useAsyncData<Booking>(() => getBooking(props.bookingId), [props.bookingId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelled, setCancelled] = useState<Booking | null>(null);

  const data = cancelled ?? booking.data;

  const doCancel = async () => {
    if (!data || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCancelled(await cancelMyBooking(data.id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError('This booking can no longer be cancelled.');
      else if (e instanceof ApiError && e.status === 0) setError(e.message);
      else setError('Could not cancel the booking. Please try again.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (booking.loading) return <Loading label="Loading booking…" />;
  if (booking.error) return <ErrorState message={booking.error} onRetry={booking.reload} />;
  if (!data)
    return (
      <div className="screen">
        <button className="back-link" onClick={props.onBack}>
          ‹ Back
        </button>
        <EmptyState icon={<BookingsIcon size={30} />} title="Booking not found" body="It may have been removed." />
      </div>
    );

  const canCancel = data.status === 'PENDING' || data.status === 'CONFIRMED';
  const whenDate = new Date(`${data.bookingDate}T00:00:00`);

  return (
    <div className="screen booking-detail">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>

      {/* When: calendar block anchors the date, the long date + service read beside it. */}
      <section className="detail-section booking-detail-when" aria-label="Date and time">
        <span className="bk-date" aria-hidden>
          <span className="bk-date-num">{whenDate.getDate()}</span>
          <span className="bk-date-month">{whenDate.toLocaleDateString('en-PK', { month: 'short' })}</span>
        </span>
        <span className="booking-detail-when-main">
          <span className="booking-detail-when-time">{longDateLabel(data.bookingDate)}</span>
          <span className="booking-detail-when-day">{data.serviceName ?? 'Booking'}</span>
        </span>
      </section>

      {/* Identity + status: the business first, the state as a restrained badge. */}
      <header className="booking-detail-head">
        <h1>{data.businessName}</h1>
        <BookingStatusBadge status={data.status} />
      </header>

      <section className="detail-section" aria-label="Booking details">
        <dl className="summary-list">
          <div>
            <dt>Business</dt>
            <dd>{data.businessName}</dd>
          </div>
          {data.serviceItems && data.serviceItems.length > 0 ? (
            <div>
              <dt>Services</dt>
              <dd>
                <ul className="booking-service-items">
                  {data.serviceItems.map((item) => (
                    <li key={item.id}>
                      {item.name} · {item.durationMinutes} min
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : data.serviceName ? (
            <div>
              <dt>Service</dt>
              <dd>{data.serviceName}</dd>
            </div>
          ) : null}
          {data.totalDurationMinutes ? (
            <div>
              <dt>Total duration</dt>
              <dd>{data.totalDurationMinutes} minutes</dd>
            </div>
          ) : null}
          <div>
            <dt>Date</dt>
            <dd>{longDateLabel(data.bookingDate)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>
              {formatSlotTime(data.startTime)}
              {data.endTime ? ` – ${formatSlotTime(data.endTime)}` : ''}
            </dd>
          </div>
          {data.priceMinor !== null ? (
            <div>
              <dt>Price</dt>
              <dd>
                <Money minor={data.priceMinor} currency={data.currency} />
              </dd>
            </div>
          ) : null}
          {data.notes ? (
            <div>
              <dt>Your note</dt>
              <dd>{data.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {data.status === 'PENDING' ? (
        <p className="booking-status-note">Waiting for the business to confirm.</p>
      ) : null}

      {/* Phase 7C — advance payment for this booking. */}
      <BookingPaymentSection booking={data} />

      {error ? (
        <div className="auth-error" role="alert">
          <AlertIcon size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {data.status === 'CANCELLED' ? (
        <p className="booking-cancelled-note" role="status">
          <AlertIcon size={16} /> This booking was cancelled.
        </p>
      ) : canCancel ? (
        confirming ? (
          <div className="confirm-cancel">
            <p>Cancel this booking? This cannot be undone.</p>
            <div className="btn-row">
              <Button variant="danger" sm onClick={() => void doCancel()} disabled={busy}>
                {busy ? 'Cancelling…' : 'Yes, cancel it'}
              </Button>
              <Button variant="ghost" sm onClick={() => setConfirming(false)} disabled={busy}>
                Keep booking
              </Button>
            </div>
          </div>
        ) : (
          <Button full variant="danger" onClick={() => setConfirming(true)}>
            Cancel booking
          </Button>
        )
      ) : null}

      {data.status === 'COMPLETED' ? <BookingReviewPanel booking={data} /> : null}
    </div>
  );
}

/** Leave-a-review panel for completed bookings; server rejects duplicates. */
function BookingReviewPanel(props: { booking: Booking }) {
  const [showForm, setShowForm] = useState(false);
  const [reviewed, setReviewed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    listMyReviews()
      .then((mine) => {
        if (active) setReviewed(mine.some((rv) => rv.bookingId === props.booking.id));
      })
      .catch(() => {
        if (active) setReviewed(false); // Fail open to the CTA; the API still blocks duplicates.
      });
    return () => {
      active = false;
    };
  }, [props.booking.id]);

  if (reviewed === null) return null;
  if (reviewed)
    return (
      <p className="review-done" role="status">
        ★ Reviewed: thank you for your feedback.
      </p>
    );
  if (!showForm)
    return (
      <Button full variant="secondary" onClick={() => setShowForm(true)}>
        Leave a review
      </Button>
    );
  return (
    <ReviewForm
      businessId={props.booking.businessId}
      source={{ bookingId: props.booking.id }}
      heading="Rate this business"
      onSubmitted={() => {
        setReviewed(true);
        setShowForm(false);
      }}
      onCancel={() => setShowForm(false)}
    />
  );
}

const PAYMENT_STATUS_LABEL: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'Waiting for verification',
  PAID: 'Paid',
  FAILED: 'Rejected',
  UNPAID: 'Unpaid',
};

const advanceOf = (booking: Booking) => {
  const advance = booking.advanceRequiredMinor ?? 0;
  const price = booking.servicePriceMinor ?? booking.priceMinor ?? 0;
  return advance > 0 && advance < price ? advance : 0;
};

/**
 * Phase 7C advance-payment section for one booking. Shows the frozen
 * snapshot (total / advance / remaining), existing payment proofs with
 * honest statuses, and (while an advance is outstanding) the business's
 * configured pay-in channels so the customer can submit proof. Cash
 * settlement happens in person; there is no gateway and no self-attestation.
 */
export function BookingPaymentSection(props: { booking: Booking }) {
  const { booking } = props;
  const advance = advanceOf(booking);
  const paid = booking.amountPaidMinor ?? 0;
  const due = booking.amountDueMinor ?? (booking.servicePriceMinor ?? 0) - Math.max(paid, advance);
  const closed = booking.status === 'CANCELLED' || booking.status === 'REJECTED';

  const [payments, setPayments] = useState<CustomerPayment[] | null>(null);
  const [methods, setMethods] = useState<BusinessPayInMethod[] | null>(null);
  const [open, setOpen] = useState(false);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadPayments = () => {
    listBookingPayments(booking.id)
      .then(setPayments)
      .catch(() => setPayments([]));
  };

  useEffect(() => {
    let alive = true;
    if (advance <= 0 || closed) return;
    listBookingPayments(booking.id)
      .then((rows) => {
        if (alive) setPayments(rows);
      })
      .catch(() => {
        if (alive) setPayments([]);
      });
    listBusinessPayInMethods(booking.businessId)
      .then((rows) => {
        if (alive) setMethods(rows);
      })
      .catch(() => {
        if (alive) setMethods([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id, advance, closed]);

  if (advance <= 0 || closed) return null;

  const advancePaid = paid >= advance;
  const digital = (methods ?? []).filter((m) => m.type !== 'CASH');
  const cash = (methods ?? []).find((m) => m.type === 'CASH');
  const selected = digital.find((m) => m.id === methodId) ?? null;

  const submit = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const receiptStorageKey = receiptFile ? await uploadPaymentReceipt(receiptFile) : undefined;
      await submitBookingPayment(booking.id, {
        amountMinor: advance - Math.min(paid, advance),
        paymentMethodId: selected.id,
        transactionReference: reference.trim() || undefined,
        receiptStorageKey,
      });
      setOpen(false);
      setMethodId(null);
      setReference('');
      setReceiptFile(null);
      reloadPayments();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit the payment. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pay-section" aria-label="Advance payment">
      <h3>Advance payment</h3>
      <div className="pay-details">
        <div className="pay-detail-row">
          <span className="pay-detail-label">Total</span>
          <span className="pay-detail-value">
            <Money minor={booking.servicePriceMinor ?? booking.priceMinor ?? 0} currency={booking.currency} />
          </span>
        </div>
        <div className="pay-detail-row">
          <span className="pay-detail-label">Advance required</span>
          <span className="pay-detail-value">
            <Money minor={advance} currency={booking.currency} />
          </span>
        </div>
        <div className="pay-detail-row">
          <span className="pay-detail-label">Paid</span>
          <span className="pay-detail-value">
            <Money minor={paid} currency={booking.currency} />
          </span>
        </div>
        <div className="pay-detail-row">
          <span className="pay-detail-label">Remaining after advance</span>
          <span className="pay-detail-value">
            <Money minor={due} currency={booking.currency} />
          </span>
        </div>
      </div>

      {payments && payments.length > 0 ? (
        <ul className="manage-list">
          {payments.map((p) => (
            <li key={p.id} className="manage-item">
              <span className={`pay-status pay-status-${p.status === 'PAID' ? 'paid' : p.status === 'FAILED' ? 'failed' : 'pending'}`}>
                {PAYMENT_STATUS_LABEL[p.status]}
              </span>
              <span className="pay-detail-value">
                <Money minor={p.amountMinor} currency={p.currency} /> · {p.paymentMethod?.displayName ?? 'Payment'}
              </span>
              {p.status === 'FAILED' && p.rejectionReason ? <p className="hint">Reason: {p.rejectionReason}</p> : null}
            </li>
          ))
          }
        </ul>
      ) : null}

      {advancePaid ? (
        <p className="pay-pending" role="status">
          Advance paid: pay the remaining <Money minor={due} currency={booking.currency} /> directly to the business.
        </p>
      ) : open ? (
        <>
          {digital.length > 0 ? (
            <div className="pay-methods" role="radiogroup" aria-label="Payment method">
              {digital.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={methodId === m.id}
                  className={`pay-chip${methodId === m.id ? ' pay-chip-active' : ''}`}
                  onClick={() => setMethodId(m.id)}
                >
                  {m.displayName}
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">This business has no digital pay-in channels yet: ask them how to pay the advance.</p>
          )}
          {selected ? (
            <div className="pay-details">
              <p className="pay-instructions">
                {selected.instructions ?? 'Pay the business directly, then submit your proof below.'}
              </p>
              {selected.accountTitle || selected.accountNumber || selected.iban ? (
                <dl className="pay-account">
                  {selected.accountTitle ? (
                    <div>
                      <dt>Account title</dt>
                      <dd>{selected.accountTitle}</dd>
                    </div>
                  ) : null}
                  {selected.accountNumber ? (
                    <div>
                      <dt>Account number</dt>
                      <dd>{selected.accountNumber}</dd>
                    </div>
                  ) : null}
                  {selected.iban ? (
                    <div>
                      <dt>IBAN</dt>
                      <dd className="pay-iban">{selected.iban}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <label className="field">
                <span className="label">Transaction reference (required)</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TX-123456" maxLength={80} />
              </label>
              <label className="field">
                <span className="label">Receipt image</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          ) : null}
          {cash ? <p className="hint">Or pay the advance in cash when the business confirms.</p> : null}
          {error ? <ErrorState message={error} /> : null}
          <div className="btn-row">
            <Button sm disabled={!selected || busy || !reference.trim() || !receiptFile} onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Submit payment proof'}
            </Button>
            <Button sm variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="pay-pending">Advance payment required before your booking is confirmed.</p>
          <Button full variant="secondary" onClick={() => setOpen(true)}>
            Pay business
          </Button>
        </>
      )}
    </div>
  );
}
