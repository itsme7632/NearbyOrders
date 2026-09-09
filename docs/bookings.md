# Booking system (Phase 3A)

The backend foundation for real service bookings: data model, availability calculation, creation rules, and lifecycle management. Phase 3B will add the mobile UI on top of these endpoints.

## Time-storage strategy

Pakistan (Asia/Karachi) has **no daylight saving time**, so local wall-clock time is a fixed UTC+05:00 offset. The system exploits this to store both exact instants and business-local days without a timezone library:

| Field | Type | Meaning |
| --- | --- | --- |
| `Booking.startAt` / `Booking.endAt` | `TIMESTAMP(3)` (UTC instants) | Absolute appointment instants; used for overlap checks. |
| `Booking.bookingDate` | `DATE` | Business-local (PKT) calendar date; used for per-day listing and availability queries. |

All conversions are pure UTC arithmetic against the fixed offset (`BUSINESS_TZ_OFFSET_MINUTES = 300` in `apps/api/src/lib.ts`): `pktToUtc`, `pktDateOf`, `pktMinutesOf`, `pktDayOfWeek`, and `pktDayWindowUtc`. They never depend on the server's own timezone, so the results are identical in local development, CI, and production.

The end time is **always server-derived**: `endAt = startAt + service.durationMinutes`. Clients send only `date` (`YYYY-MM-DD`, business-local) and `startTime` (`HH:MM`, business-local). A client-supplied end time is never trusted.

## Availability

`GET /api/v1/businesses/:businessId/services/:serviceId/availability?date=YYYY-MM-DD` answers: "for this business, service, and date, what time slots are available?"

- Slots step by `service.durationMinutes` from `opensAt` and must fit entirely inside `[opensAt, closesAt)` of that weekday's `BusinessHour` row (a 60-minute service at a 09:00–21:00 business yields starts at 09:00…20:00).
- Closed days return `closed: true` with an empty slot list.
- Slots overlapping any existing booking with status `PENDING` or `CONFIRMED` are unavailable. `REJECTED`, `CANCELLED`, and `COMPLETED` bookings never block.
- Slots already in the past (PKT) are unavailable.

## Creation rules

`POST /api/v1/bookings` (customers only) validates, in order: approved, non-archived business; active service with a `durationMinutes`; requested day is open; slot fits inside opening hours; slot is in the future. The derived window is then re-checked for overlaps and inserted inside one database transaction.

## Concurrency: no double-booking

Two customers hitting the same slot concurrently must not both succeed. The creation handler takes a **transaction-scoped PostgreSQL advisory lock keyed on the business id** (`pg_advisory_xact_lock(hashtext(businessId))`), re-checks overlap inside the transaction, and only then inserts. A second overlapping request waits for the first to commit, then fails with `409 SLOT_TAKEN`. The lock is released automatically when the transaction ends.

## Status lifecycle

`PENDING → CONFIRMED | REJECTED | CANCELLED`; `CONFIRMED → COMPLETED | CANCELLED`; `REJECTED`, `CANCELLED`, and `COMPLETED` are terminal. Transitions are enforced by `allowedTransitions.booking` and shared with orders.

- Customers may cancel their own `PENDING` booking (`POST /api/v1/bookings/:id/cancel`).
- Business owners (and admins) confirm, reject, complete, or cancel via `PATCH /api/v1/bookings/:id/status`.

## Visibility

A booking is visible to its customer, the owner of its business, and admins; everyone else receives `404` (not `403`) so ids are not enumerable. List endpoints (`/api/v1/bookings`, `/api/v1/businesses/:id/bookings`) scope rows by role automatically and support `status` / `from` / `to` (business-local dates) filters.

## Tests

`apps/api/test/bookings.test.ts` covers availability alignment and blocking statuses, hours/past/closed-day rejection, overlap rejection, adjacent-slot booking, customer/owner listing scopes, status transitions, and PKT↔UTC storage consistency.
