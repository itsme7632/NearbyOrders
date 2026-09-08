# NearbyOrders

Mobile-first local discovery, booking, and ordering platform for Pakistan. V1 is a pnpm monorepo: React/Vite mobile foundation (ready to wrap with Capacitor), Fastify/TypeScript REST API, PostgreSQL/Prisma schema, and a deliberately small admin foundation.

## Start locally

Prerequisites: Node 24+, Corepack/pnpm, Docker. Copy `.env.example` to `.env`, choose non-default secrets, then run:

```sh
pnpm install
docker compose up -d db
pnpm --filter @nearbyorders/api prisma:generate
pnpm --filter @nearbyorders/api prisma:migrate -- --name initial
pnpm dev:api
pnpm --filter @nearbyorders/mobile dev
```

Run checks with `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Environment variables are documented in `.env.example`; never commit `.env`.

## API

The API is versioned at `/api/v1`; `/health` is unprotected. Implemented foundations: register/login/current user, categories, approved-business discovery, owner business/service/product creation, customer bookings/orders, status transitions, and admin dashboard/business approval. Backend authorization is the security boundary. See [architecture](docs/architecture.md).

`POST /auth/logout`, refresh-token rotation, category management UI/API, business hours mutations, comprehensive admin routes, nearby-radius filtering, and Capacitor native projects are planned next increments. This foundation intentionally does not include payments, reviews, delivery, promotions, subscriptions, or fake production data.

## Deployment

Use `infrastructure/docker/api.Dockerfile` behind a TLS reverse proxy on Contabo. Do not expose PostgreSQL publicly. Deploy with environment secrets injected by the host, run `prisma migrate deploy`, verify `/health`, and maintain encrypted off-host PostgreSQL backups.
