# Production deployment (Contabo VPS)

Deterministic, production-safe deployment of NearbyOrders on a single VPS.
Do not improvise around this runbook: the compose stack is ordered so that
each step gates the next, and the API fail-fasts on unsafe configuration.

## Topology

```
internet ──▶ host nginx:80/443 (owns public ports; also serves BrokerMAIL,
│                                untouched by this stack)
│   ├── nearbyorders.com / www.nearbyorders.com ──▶ 127.0.0.1:3100 ──▶ public website (static, apps/website)
│   ├── admin.nearbyorders.com ──▶ 127.0.0.1:3100 ──┬── /* ────────▶ admin SPA (static, SPA fallback)
│   │                                               └── /api/v1/* ──▶ api:3000 (Fastify, NODE_ENV=production)
│   └── api.nearbyorders.com ──▶ 127.0.0.1:3100 ──▶ api:3000 (Fastify)
api ──▶ db:5432 (PostgreSQL 16)
```

The Contabo VPS may already host other applications. NearbyOrders therefore
never binds Docker nginx directly to host ports 80/443; `docker-compose.prod.yml`
binds it to `127.0.0.1:3100`. The existing host nginx remains the public TLS
entry point and proxies `nearbyorders.com`, `www.nearbyorders.com`,
`admin.nearbyorders.com`, and `api.nearbyorders.com` to that port; the
container routes by Host header (see `infrastructure/nginx.conf`). See
`infrastructure/host-nginx/nearbyorders.conf.example`.

There is ONE admin panel, served from `admin.nearbyorders.com`. It governs
the whole app + website ecosystem; no separate website CMS exists.

Receipt/verification files are stored in the `receipts_data` volume mounted
at `/var/nearbyorders/receipts` and served only through the API's authorized
endpoints. Business/product images (P1) are stored in the `uploads_data`
volume mounted at `/var/nearbyorders/uploads` and served through the API's
key-validated `GET /api/v1/images/*` capability endpoint — the image key is
an unguessable server-generated UUID and the endpoint strictly validates the
key shape before touching disk, so it can never escape the image directory.
There is intentionally no generic public `/uploads` filesystem route at the
proxy layer — do not add one.

## Prerequisites (VPS)

- Docker Engine + the Compose v2 plugin.
- A host directory is not needed for receipts or images: the named volumes
  `receipts_data` and `uploads_data` persist them. **Back these volumes up
  with the database.**
- TLS terminates on the host's Nginx (certbot, a host step, see section 2).
  Do not add 443 blocks to `infrastructure/nginx.conf`; the container only
  ever sees plain HTTP from the host proxy. Never touch BrokerMAIL's
  certificates.
- DNS (host step, not done through this repository):
  `@`, `www`, `admin`, `api` → `158.220.115.242`.

## 1. Configure the environment

All secrets come from the host environment — none live in the repository.
Copy `.env.example` and fill in real values:

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Postgres superuser password for the `db` service |
| `DATABASE_URL` | yes | Must match the `db` credentials, host `db`, e.g. `postgresql://nearbyorders:<pw>@db:5432/nearbyorders?schema=public` |
| `JWT_ACCESS_SECRET` | yes | ≥ 32 random chars; dev defaults/placeholders rejected |
| `JWT_REFRESH_SECRET` | yes | ≥ 32 random chars, different from access |
| `CORS_ORIGIN` | yes | Comma-separated API caller origins: the public admin origin **plus** the Capacitor Android WebView origin, e.g. `https://admin.nearbyorders.com,http://localhost` (`*` rejected) |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | no | defaults `100` / `10` |
| `FCM_PROJECT_ID` / `FCM_SERVICE_ACCOUNT_B64` | no | push silently disabled when unset |
| `VITE_API_BASE_URL` | no | default `/api/v1` (same-origin through nginx) |

Generate secrets with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Export them (or use a systemd `EnvironmentFile`) before running compose.

## 2. Configure the shared host nginx

On a VPS that already hosts other sites, copy the example config to `/etc/nginx/sites-available/nearbyorders.conf`, enable it, and validate before reload:

```sh
sudo cp /opt/nearbyorders/infrastructure/host-nginx/nearbyorders.conf.example /etc/nginx/sites-available/nearbyorders.conf
sudo ln -s /etc/nginx/sites-available/nearbyorders.conf /etc/nginx/sites-enabled/nearbyorders.conf
sudo nginx -t
sudo systemctl reload nginx
```

Do not replace existing site configs (BrokerMAIL's included). After DNS points the four hostnames at the VPS, issue TLS certificates with the host's normal Certbot workflow:

```sh
certbot --nginx -d nearbyorders.com -d www.nearbyorders.com -d admin.nearbyorders.com -d api.nearbyorders.com
```

## 3. Build

```sh
docker compose -f docker-compose.prod.yml build
```

`VITE_API_BASE_URL` is a build arg for the nginx image: the default `/api/v1`
is correct because the admin SPA is served from `admin.nearbyorders.com`
through the same nginx, which proxies `/api/v1` to the API (same origin).
Pass an absolute API origin only when the admin is NOT served through this
same nginx.

## 4. Start the database, then initialize it (first deploy only)

```sh
docker compose -f docker-compose.prod.yml up -d db
```

Run migrations explicitly once (the `migrate` service also runs
`prisma migrate deploy` automatically on every `up`, which is idempotent and
safe — this step just makes the first deploy observable):

```sh
docker compose -f docker-compose.prod.yml run --rm migrate
```

Seed reference data — categories and plans — exactly once. **Never run the
demo seeds (`SEED_DEMO_DATA`) in production:**

```sh
docker compose -f docker-compose.prod.yml run --rm api ./apps/api/node_modules/.bin/tsx apps/api/prisma/seed-categories.ts
docker compose -f docker-compose.prod.yml run --rm api ./apps/api/node_modules/.bin/tsx apps/api/prisma/seed-plans.ts
```

Create the first admin (interactive hidden prompt preferred; env vars are the
non-interactive path — the script never logs the password):

```sh
docker compose -f docker-compose.prod.yml run --rm \
  -e ADMIN_EMAIL=ops@example.com -e ADMIN_PASSWORD='...' \
  api ./apps/api/node_modules/.bin/tsx apps/api/scripts/create-admin.ts
```

See `docs/admin-provisioning.md` for the full provisioning policy.

## 5. Start the stack

```sh
docker compose -f docker-compose.prod.yml up -d
```

Startup order is enforced by compose:

1. `db` becomes healthy (`pg_isready` healthcheck).
2. `migrate` runs `prisma migrate deploy` (never `migrate dev`) and must exit 0.
3. `api` starts only after migrations succeed, with `NODE_ENV=production`.
   Missing/unsafe `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, or `CORS_ORIGIN`
   crashes the container immediately with a descriptive error (secret values
   are never logged); fix the environment and restart.
4. `nginx` serves the public website (`nearbyorders.com`, `www`),
   the admin SPA (`admin.nearbyorders.com`, with `/api/v1` proxied to the
   API), and the API (`api.nearbyorders.com`), routing by Host header.

## 6. Verify

```sh
# via the container's loopback binding (Host header selects the virtual host)
curl -s -H 'Host: nearbyorders.com' http://127.0.0.1:3100/ | head -c 120
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: www.nearbyorders.com' http://127.0.0.1:3100/            # 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: admin.nearbyorders.com' http://127.0.0.1:3100/           # 200 (admin SPA)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: admin.nearbyorders.com' http://127.0.0.1:3100/api/v1/     # API through admin host
curl -s -H 'Host: admin.nearbyorders.com' http://127.0.0.1:3100/healthz                                     # {"status":"ok"} via nginx -> api
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: api.nearbyorders.com' http://127.0.0.1:3100/api/v1/       # 200/401 (API intact)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: api.nearbyorders.com' http://127.0.0.1:3100/healthz       # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' http://127.0.0.1:3100/                      # 444 (unknown host refused)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: nearbyorders.com' http://127.0.0.1:3100/og-cover.png     # 200 (OG image)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: nearbyorders.com' http://127.0.0.1:3100/api/v1/           # 404 (website never proxies to the API)
docker compose -f docker-compose.prod.yml logs migrate   # "All migrations have been successfully applied" (or "No pending migrations")
docker compose -f docker-compose.prod.yml exec api sh -c 'touch /var/nearbyorders/receipts/.writetest && rm /var/nearbyorders/receipts/.writetest && echo receipts-writable'
```

Load the website at `https://nearbyorders.com` and the admin at
`https://admin.nearbyorders.com`: same-origin `/api/v1` calls flow through
nginx, so no CORS configuration beyond `CORS_ORIGIN` is needed.

## Updating

```sh
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

`prisma migrate deploy` runs automatically on every `up` via the `migrate`
service before the API starts, so schema changes apply in order.

## Hardcoded deployment assumptions (audited 2026-09-28)

- No production IP or provider name is hardcoded anywhere in runtime code:
  the old DigitalOcean IP (`157.230.213.10`) appears only in a mobile
  **test fixture** (`apps/mobile/src/profileSave.test.ts`) and in the
  `android-debug` CI workflow, which bakes it into a **debug** APK for
  development — neither is a production deployment path. All origins/URLs
  are configuration (`CORS_ORIGIN`, `VITE_API_BASE_URL`).
- `localhost` defaults (`:3000`, `:5173`) exist only as development/test
  conveniences; production rejects them at startup for secrets/CORS.
- Other hardcoded URLs are external-service endpoints, not deployment
  assumptions: Google FCM token/messaging endpoints (`apps/api/src/push.ts`)
  and Google Maps direction/search links (`apps/mobile/src/location.ts`).
