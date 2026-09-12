# Architecture

```mermaid
flowchart LR
  Mobile[React + Vite + Capacitor] --> API[Fastify modular monolith]
  Admin[Admin UI] --> API
  API --> DB[(PostgreSQL via Prisma)]
```

The API enforces JWT authentication, role checks, and business ownership checks. Public discovery only exposes approved businesses. Prices use integer minor units (`priceMinor` / `subtotalMinor`) with explicit ISO currency, never floating point.

Location is provider-neutral: businesses retain address/city/locality/latitude/longitude; a mapping provider may be added behind this representation later. PostgreSQL coordinate indexes support a simple future nearby-query implementation.

## Manual subscription payments (Phase 7B)

Businesses pay their NearbyOrders Business subscription manually (Easypaisa / JazzCash / bank transfer). The flow is deliberately human-verified — there is no self-attestation and no customer payment gateway:

1. Pay-in methods live in the `PaymentMethod` table (account title, number/IBAN, instructions, display order). Admins edit them via `/api/v1/admin/payment-methods`; changing a number never requires a mobile release. Seeded dev/test methods are clearly labelled placeholders, never real accounts.
2. The owner uploads a real receipt image to `POST /api/v1/subscription/payment-receipts` (multipart, 5 MB cap, JPG/PNG/WebP). The server stores bytes under an opaque key (`receipts/<uuid>.<ext>`) in `src/receiptStorage.ts` — the single seam a bucket provider replaces later. Receipts are readable only through `GET .../payment-receipts/:storageKey` by the owning business or an admin; there is no public URL.
3. The owner submits the reference + storage key via `POST /api/v1/businesses/:id/subscription/payment-requests`. The amount is always the server-computed plan price (299900 minor PKR); the client never sends money values. One `PENDING` request per business (advisory-lock guarded), and the owner can cancel their own pending request.
4. An ADMIN reviews the queue (`GET /api/v1/admin/subscription/payment-requests`), views the receipt, then approves or rejects. Approval runs atomically under the same `pg_advisory_xact_lock` pattern as trials and bookings: the request flips to `APPROVED` and the subscription activates in one transaction — a live paid subscription extends from its current expiry, a live trial activates in place, anything else creates a fresh row. A transaction reference can only be approved once across all requests. Rejection requires a reason, leaves the subscription untouched, and notifies the owner; owners are notified on both outcomes and audit-log entries record every review.

Production: reverse proxy terminates HTTPS, API and database run in separate Docker networks, database has no public port. Run migrations during deployment and back up PostgreSQL daily with encrypted off-host retention (receipt files belong in that backup plan too).

## Customer-to-business payments (Phase 7C)

Customers pay **businesses**, never NearbyOrders. The platform records payment state and workflow only — it does not receive, hold, split, or transfer customer money, and there is no wallet, escrow, commission, or payout.

**Payment state is separate from booking/order state.** A booking is PENDING/CONFIRMED/COMPLETED; its payment is independently UNPAID / PENDING_VERIFICATION / PAID / FAILED. Order status (PENDING → ACCEPTED → …) never implies payment status.

1. **Business payment methods** — `BusinessPaymentMethod` rows belong to each business (CASH, EASYPAISA, JAZZCASH, BANK_TRANSFER, OTHER) with account title, number, IBAN, instructions, active flag and display order. Distinct from the Phase 7B admin-managed subscription channels. Owners manage their own via `/api/v1/owner/businesses/:id/payment-methods` (create, update, deactivate — never hard-delete, so history keeps showing which account was paid); customers read only the active ones of an approved business. Deactivation and edits are audit-logged.
2. **Service advances** — services can require an advance (`NONE` / `FIXED` / `PERCENTAGE`). The server validates fixed ≤ price and 1–100%, and computes the required advance with integer math (percentage uses floor of `priceMinor × percent / 100`). The client never sends a final advance amount.
3. **Booking snapshot** — at booking creation the server freezes `servicePriceMinor`, `advanceRequiredMinor`, `amountPaidMinor`, `amountDueMinor` (`total − max(paid, advance)` while the advance is outstanding) onto the booking. Later service edits never change an existing booking's agreed amounts.
4. **Payment proofs** — `BookingPayment` / `OrderPayment` rows record amount, method, transaction reference, and a receipt uploaded through the same Phase 7B storage abstraction (multipart → opaque server-side key; there are no receipt URL fields anywhere). Digital submissions require reference + receipt and are capped to the amount due; cash payments need neither.
5. **Verification** — the owning business (and only it) verifies or rejects proofs via `POST /api/v1/owner/payments/:id/verify|reject` (bookings) and `.../owner/order-payments/:id/...` (orders). Verification is transactional under the project's `pg_advisory_xact_lock` pattern with a PENDING re-check, so concurrent duplicate verifies cannot both succeed; totals update atomically; both outcomes notify the counterparty and write audit-log entries. A rejected proof shows its reason to the customer, who can submit a fresh proof. Customers can never verify; cross-business/cross-customer access 404s.
6. **COD & delivery fee** — businesses enable delivery (own rider), COD, and a delivery fee in owner settings (`PUT /api/v1/owner/businesses/:id/delivery-settings`). Order creation re-prices everything server-side from current product prices plus the business fee (0 for pickup/collection); client-sent subtotal/fee/total fields are ignored. A COD order is UNPAID until the owner confirms cash via `collect-cash`; choosing COD never marks it PAID. No rider accounts, tracking, or payouts.
7. **Gateway-ready shape** — payment method, payment record, and payment status are modelled separately, so a future gateway provider slots in behind the same records without rewriting booking/order models. Nothing in this phase charges commission or moves money.
