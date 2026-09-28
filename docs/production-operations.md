# Production Operations Runbook (NearbyOrders)

Quick-reference for day-to-day production operations on the Contabo VPS.
See `production-deploy.md` for initial deployment and `backup-recovery.md`
for backup/restore.

---

## VPS Setup (one-time)

1. Provision Contabo VPS: 4 vCPU, ~8 GB RAM, ~100 GB disk (Ubuntu 24.04 LTS).
2. Install Docker Engine + Compose v2:
   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   ```
3. Clone the repo (or copy `docker-compose.prod.yml` + `infrastructure/`):
   ```sh
   git clone https://github.com/itsme7632/NearbyOrders.git /opt/nearbyorders
   cd /opt/nearbyorders
   ```
4. Create the production `.env` from `.env.example` (see `production-deploy.md` §1).
5. Open firewall: allow 80/tcp (and 443/tcp when TLS is added); restrict SSH.

## Environment Variables

All required production variables are documented in `.env.example` (sections
marked REQUIRED IN PRODUCTION). The API fail-fasts at startup if any are
missing or unsafe — a crash-looping `api` container almost always means a
missing/weak secret or bad `CORS_ORIGIN`.

## Database Migration

Migrations run automatically on every `docker compose up` via the `migrate`
service (`prisma migrate deploy`). Manual invocation:

```sh
docker compose -f docker-compose.prod.yml run --rm migrate
```

## Seed Procedure (first deployment only)

```sh
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml run --rm api node node_modules/.bin/tsx apps/api/prisma/seed-categories.ts
docker compose -f docker-compose.prod.yml run --rm api node node_modules/.bin/tsx apps/api/prisma/seed-plans.ts
docker compose -f docker-compose.prod.yml run --rm -e ADMIN_EMAIL=ops@example.com -e ADMIN_PASSWORD='...' api node node_modules/.bin/tsx apps/api/scripts/create-admin.ts
docker compose -f docker-compose.prod.yml up -d
```

**Never** run demo seeds (`SEED_DEMO_DATA`) in production.

## Process Management

The stack runs under Docker Compose with `restart: unless-stopped`.
No PM2/systemd unit is required — but if the VPS reboots, ensure Docker
starts on boot:

```sh
sudo systemctl enable docker
```

## Nginx

Nginx runs as a container (`infrastructure/docker/nginx.Dockerfile`,
config `infrastructure/nginx.conf`):
- `/api/v1/*` → `api:3000`
- `/healthz` → `api:3000/health`
- `/*` → admin SPA (static, SPA fallback)

TLS termination is done above nginx (host certbot or a 443 server block).

## API Health Check

```sh
# From the VPS
curl -s http://localhost/api/v1/health
# Expected: {"ok":true} (HTTP 200)

# Container-level
docker compose -f docker-compose.prod.yml ps
```

## Logs

```sh
# Follow all services
docker compose -f docker-compose.prod.yml logs -f

# API only, last 200 lines
docker compose -f docker-compose.prod.yml logs --tail=200 api

# Database
docker compose -f docker-compose.prod.yml logs --tail=100 db
```

The API logs to stdout (JSON-ish lines via Fastify). For persistent log
retention, add a log driver or ship to a collector — plain `docker logs`
is ephemeral across container recreation.

## Rollback

The `migrate` service only ever applies forward migrations
(`prisma migrate deploy`); there is no automatic down-migration.

To roll back a bad deploy:

```sh
# 1. Check out the previous known-good commit
git log --oneline -5
git checkout <previous-sha>

# 2. Rebuild and restart (migrations from the bad deploy are NOT reverted —
#    verify the previous code is compatible with the current schema first)
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

If the bad deploy included a **breaking** migration, restore from backup
instead (`docs/backup-recovery.md` §1).

## Production Smoke Test (after every deploy)

```sh
# 1. Health
curl -s http://localhost/api/v1/health | grep -q '"ok":true' && echo "health OK"

# 2. Admin SPA loads
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/

# 3. Authenticated probe (replace with a real admin token)
# curl -s http://localhost/api/v1/admin/overview -H "Authorization: Bearer <token>"
```

Then in a browser: admin login → dashboard loads → business list renders.
On the Android app (production build): login → explore → business detail.

## Useful One-Liners

```sh
# Restart just the API
docker compose -f docker-compose.prod.yml restart api

# Shell into the API container
docker compose -f docker-compose.prod.yml exec api sh

# PostgreSQL console
docker compose -f docker-compose.prod.yml exec db psql -U nearbyorders -d nearbyorders

# Disk usage of volumes
docker system df -v | grep nearbyorders
```
