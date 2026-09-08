# NearbyOrders

Mobile-first local discovery, booking, and ordering platform for Pakistan. V1 is a pnpm monorepo: React/Vite mobile foundation (wrapped with Capacitor for Android), Fastify/TypeScript REST API, PostgreSQL/Prisma schema, and a deliberately small admin foundation.

## Start locally

Prerequisites: Node 24+, Corepack/pnpm, Docker (for PostgreSQL only). Copy `.env.example` to `.env`, choose non-default secrets, then run:

```sh
pnpm install                                         # install all workspace dependencies
docker compose up -d db                              # start PostgreSQL (no other services needed)
pnpm --filter @nearbyorders/api prisma:generate      # generate the Prisma client
pnpm --filter @nearbyorders/api prisma:migrate -- --name initial  # create/apply schema
pnpm dev:api                                         # API on http://localhost:3000 (health: /health)
pnpm --filter @nearbyorders/mobile dev               # mobile app on http://localhost:5173
```

Open the printed Vite URL in a browser; use device toolbar widths (360–412px) for the mobile layout. A production web build can be served locally with `pnpm --filter @nearbyorders/mobile preview`.

## Checks

Run the same checks CI runs: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. `prisma validate` needs a reachable `DATABASE_URL` only for migrate commands; schema validation runs without a live database. Environment variables are documented in `.env.example`; never commit `.env`.

## Android (Capacitor)

Capacitor 8 is configured in `apps/mobile/capacitor.config.ts` (`pk.nearbyorders.app`, webDir `dist`). The generated `android/` project is gitignored and regenerable:

```sh
pnpm --filter @nearbyorders/mobile cap:add:android   # first time: web build + cap add android
pnpm --filter @nearbyorders/mobile cap:sync          # after web changes: rebuild + copy web assets
```

Then open `apps/mobile/android/` in Android Studio (SDK 35, JDK 21) and build a debug APK, or run `./gradlew assembleDebug` inside it.

## API

The API is versioned at `/api/v1`; `/health` is unprotected. Implemented foundations: register/login/current user, categories, approved-business discovery, owner business/service/product creation, customer bookings/orders, status transitions, and admin dashboard/business approval. Backend authorization is the security boundary. See [architecture](docs/architecture.md).

`POST /auth/logout`, refresh-token rotation, category management UI/API, business hours mutations, and comprehensive admin routes are planned next increments. This foundation intentionally does not include payments, reviews, delivery, promotions, subscriptions, or fake production data.

## Deployment

Use `infrastructure/docker/api.Dockerfile` behind a TLS reverse proxy on Contabo. Do not expose PostgreSQL publicly. Deploy with environment secrets injected by the host, run `prisma migrate deploy`, verify `/health`, and maintain encrypted off-host PostgreSQL backups.
