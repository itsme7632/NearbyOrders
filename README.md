# NearbyOrders

Mobile-first local discovery, booking, and ordering platform for Pakistan. V1 is a pnpm monorepo: React/Vite mobile app (wrapped with Capacitor for Android), Fastify/TypeScript REST API, PostgreSQL/Prisma schema, and a deliberately small admin foundation.

## What works today

- Category browsing, business discovery (search, category filter, nearby radius), and rich business profiles with hours, services, and products
- Real booking backend (Phase 3A): server-derived end times from service duration, business-hours validation, per-date availability slots, double-booking protection, and a customer/owner booking lifecycle (see [docs/bookings.md](docs/bookings.md))
- Business-owner management screens: profile, services, products, and opening hours (create/edit/activate/deactivate, ownership enforced server-side)
- Admin category management and business approval endpoints
- Auth (register/login), customer orders foundation from Phase 1

## Start locally

Prerequisites: Node 24+, Corepack/pnpm. No Docker needed: a development PostgreSQL is booted from the `embedded-postgres` dev dependency.

```sh
pnpm install                                              # install all workspace dependencies
sh ./scripts/dev-preview.sh                               # one command: db + migrate + seed + API on :3001 + web on :5173
SEED_DEMO_DATA=1 sh ./scripts/dev-preview.sh              # same, plus clearly-marked [Demo] businesses for browsing
```

Demo logins (only when `SEED_DEMO_DATA=1`, never in production): owner `demo-owner@nearbyorders.test` / `DemoPassw0rd!2026`, customer `demo-customer@nearbyorders.test` / `DemoPassw0rd!2026`.

### `AUTO_APPROVE_BUSINESSES`

Development/preview convenience, read server-side only. When exactly `true`, **newly created** businesses are `APPROVED` immediately instead of `PENDING`, so the full onboarding → discovery → booking flow can be exercised without the (still unbuilt) Admin UI. Every auto-approval is recorded in the audit log (`BUSINESS_AUTO_APPROVED`).

- Default (unset/anything else): businesses stay `PENDING` and require admin approval — production behavior is untouched.
- The flag is never client-controllable: no API field (`autoApprove` etc.) can trigger it, and it is not exposed in responses.
- `scripts/dev-preview.sh` sets it for the local/preview stack; production deployments must not.

Prefer manual steps? Each piece runs on its own:

```sh
sh ./scripts/dev-db.sh start                              # boot the dev PostgreSQL (127.0.0.1:54329)
export DATABASE_URL="postgresql://daytona@127.0.0.1:54329/nearbyorders?schema=public"
pnpm --filter @nearbyorders/api prisma:migrate            # apply schema migrations
pnpm --filter @nearbyorders/api prisma:seed               # seed core categories (SEED_DEMO_DATA=1 adds demo data)
pnpm dev:api                                              # API on http://localhost:3000 (health: /health)
pnpm --filter @nearbyorders/mobile dev                    # web app on http://localhost:5173 (proxies /api to :3001)
```

`sh ./scripts/dev-db.sh stop|status|clean` manages the dev database. CI uses a GitHub Actions `postgres` service instead; production uses real PostgreSQL via `prisma migrate deploy`.

## Checks

```sh
pnpm typecheck    # all workspaces
pnpm lint
pnpm test         # mobile unit tests + DB-backed API integration tests (auto-boots the embedded DB locally)
pnpm build        # shared -> mobile (vite) -> api (tsc)
```

Environment variables are documented in `.env.example`; never commit `.env`.

## Android (Capacitor)

Capacitor 8 is configured in `apps/mobile/capacitor.config.ts` (`pk.nearbyorders.app`, webDir `dist`). The generated `android/` project is gitignored and regenerable:

```sh
pnpm --filter @nearbyorders/mobile cap:add:android   # first time: web build + cap add android
pnpm --filter @nearbyorders/mobile cap:sync          # after web changes: rebuild + copy web assets
```

Then open `apps/mobile/android/` in Android Studio (SDK 35, JDK 21) and build a debug APK, or run `./gradlew assembleDebug` inside it. Point the packaged app at an API host by setting `server.url` in `capacitor.config.ts` or configuring a release API origin.

## API

Versioned at `/api/v1`; `/health` is unprotected. Implemented: auth (register/login/me), categories (public list, admin CRUD), approved-business discovery (search `q`, `category`, `city`, nearby `nearLat`/`nearLng`/`radiusKm` with distance sorting), business detail by id or slug (hours + services + products), owner business profile update, owner services/products CRUD with activate/deactivate, owner opening-hours replacement, service availability and booking lifecycle (create/cancel, owner status changes), customer orders, in-app notifications, reviews and ratings, the subscription foundation (plans, trials, server-side access evaluation), manual subscription payments (Phase 7B): admin-configured pay-in methods (Easypaisa / JazzCash / bank transfer), real receipt upload to opaque server-side storage, owner payment history, and admin approval/rejection that atomically activates the subscription, and customer-to-business payments (Phase 7C): business-configured payment channels (cash, Easypaisa, JazzCash, bank transfer), optional service advances with booking-time price snapshots, customer payment proofs (reference + real receipt upload) verified or rejected by the business, cash on delivery/pickup, and a server-computed delivery fee — with payment status always kept separate from booking/order status. Backend authorization and ownership checks are the security boundary. See [architecture](docs/architecture.md) and [bookings](docs/bookings.md).

Planned next: admin UI, image hosting for business/product photos. This foundation intentionally does not include customer payment gateways, marketplace split payments, business payouts, or fake production data — businesses pay their subscription manually and a human admin verifies every payment, and customer money is paid directly to businesses: NearbyOrders records payment state only and never holds customer funds.

## Deployment

Use `infrastructure/docker/api.Dockerfile` behind a TLS reverse proxy on Contabo. Do not expose PostgreSQL publicly. Deploy with environment secrets injected by the host, run `prisma migrate deploy`, verify `/health`, and maintain encrypted off-host PostgreSQL backups.
