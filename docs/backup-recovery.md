# Backup & Recovery Runbook (Production)

**Scope:** Contabo VPS running the `docker-compose.prod.yml` stack.
**Do not run destructive commands against production without verifying the target.**

All commands assume SSH access to the VPS with the production environment
loaded (same shell that runs `docker compose -f docker-compose.prod.yml`).

---

## 1. PostgreSQL Backup

### What to back up
The `postgres_data` Docker volume (entire database: users, businesses, orders,
bookings, subscriptions, plans, notifications, everything).

### Backup command
Run from the directory containing `docker-compose.prod.yml`:

```sh
# Timestamped SQL dump (recommended: nightly via cron)
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U nearbyorders nearbyorders \
  | gzip > "/backups/nearbyorders-db-$(date +%Y%m%d-%H%M%S).sql.gz"
```

The `-T` flag disables TTY allocation (required for cron/non-interactive shells).

### Verify the backup
```sh
# Check the file is non-empty and a valid gzip
ls -lh /backups/nearbyorders-db-*.sql.gz | tail -3
gzip -t /backups/nearbyorders-db-<timestamp>.sql.gz && echo "gzip OK"

# Optional: verify the dump contains expected tables (without restoring)
zcat /backups/nearbyorders-db-<timestamp>.sql.gz | grep -c "CREATE TABLE"
```

### Restore procedure
**WARNING:** This overwrites the production database. Stop the API first.

```sh
# 1. Stop the API and migrate services (keep db running)
docker compose -f docker-compose.prod.yml stop api migrate nginx

# 2. Drop and recreate the database (clears all data)
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U nearbyorders -d postgres -c "DROP DATABASE nearbyorders;"
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U nearbyorders -d postgres -c "CREATE DATABASE nearbyorders;"

# 3. Restore from backup
zcat /backups/nearbyorders-db-<timestamp>.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db \
  psql -U nearbyorders -d nearbyorders

# 4. Verify migration state matches the deployed code
docker compose -f docker-compose.prod.yml run --rm migrate

# 5. Restart the stack
docker compose -f docker-compose.prod.yml up -d
```

### Restore verification
```sh
# API health check (should return 200)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:80/api/v1/health

# Spot-check row counts against pre-restore notes
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U nearbyorders -d nearbyorders -c \
  "SELECT (SELECT count(*) FROM \"User\") AS users, (SELECT count(*) FROM \"Business\") AS businesses;"
```

---

## 2. Uploads & Receipts Backup

### What to back up
- `uploads_data` volume → `/var/nearbyorders/uploads` (business/product images, P1)
- `receipts_data` volume → `/var/nearbyorders/receipts` (order receipts, verification documents)

Both are Docker named volumes. They must be backed up alongside the database —
the database stores opaque keys that reference these files.

### Backup command
```sh
# Back up both volumes to timestamped tarballs
docker run --rm \
  -v nearbyorders_uploads_data:/src/uploads:ro \
  -v nearbyorders_receipts_data:/src/receipts:ro \
  -v /backups:/dst \
  alpine tar czf "/dst/nearbyorders-files-$(date +%Y%m%d-%H%M%S).tar.gz" -C /src uploads receipts
```

**Note:** The actual volume names are prefixed by the compose project name.
Run `docker volume ls | grep nearbyorders` to confirm exact names if the
project directory is not `nearbyorders`.

### Verify the backup
```sh
ls -lh /backups/nearbyorders-files-*.tar.gz | tail -3
tar tzf /backups/nearbyorders-files-<timestamp>.tar.gz | head -5
```

### Restore procedure
```sh
# 1. Stop the API (prevents writes during restore)
docker compose -f docker-compose.prod.yml stop api

# 2. Restore files into the volumes
docker run --rm \
  -v nearbyorders_uploads_data:/dst/uploads \
  -v nearbyorders_receipts_data:/dst/receipts \
  -v /backups:/src:ro \
  alpine sh -c "tar xzf /src/nearbyorders-files-<timestamp>.tar.gz -C /dst"

# 3. Restart the API
docker compose -f docker-compose.prod.yml up -d api
```

---

## 3. Environment Secrets Backup

### What must be backed up securely
These are **never** stored in Git. Back them up separately in a secure location
(encrypted USB, password manager, or sealed envelope):

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `CORS_ORIGIN`
- `FCM_PROJECT_ID` / `FCM_SERVICE_ACCOUNT_B64` (if push is configured)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` (initial admin credentials)
- Android keystore file + keystore password + key alias + key password (see docs/android-release.md)

### How to back up
```sh
# On the VPS, the production .env file (NOT in the repo)
# Copy it to encrypted offline storage. Example:
gpg --symmetric --cipher-algo AES256 /root/nearbyorders-production.env
# Store the resulting .gpg file offline. Delete the plaintext copy from any
# non-secure location.
```

**Never** put secret values in Git, in chat logs, in screenshots, or in
unencrypted backups.

---

## 4. Backup Schedule (Recommended)

| What | Frequency | Retention | Method |
|---|---|---|---|
| PostgreSQL dump | Daily (cron, off-peak) | 30 days | `pg_dump` + gzip, §1 |
| Uploads/receipts tarball | Daily (after DB dump) | 30 days | volume tar, §2 |
| Secrets | On change only | Indefinite (secure) | encrypted offline, §3 |
| Full VPS snapshot | Weekly (Contabo panel) | 4 weeks | provider snapshot |

### Example cron (runs daily at 03:00 VPS time)
```cron
0 3 * * * /root/nearbyorders-backup.sh >> /var/log/nearbyorders-backup.log 2>&1
```

Where `/root/nearbyorders-backup.sh` runs the §1 and §2 commands above and
prunes backups older than 30 days:
```sh
find /backups -name "nearbyorders-*.sql.gz" -mtime +30 -delete
find /backups -name "nearbyorders-files-*.tar.gz" -mtime +30 -delete
```

---

## 5. Disaster Recovery (Full VPS Loss)

1. Provision a fresh Contabo VPS (same specs: 4 vCPU, ~8 GB RAM).
2. Install Docker Engine + Compose v2.
3. Copy `docker-compose.prod.yml`, `infrastructure/`, and `.env.example` from the
   Git repository (`itsme7632/NearbyOrders`).
4. Restore secrets from the secure offline backup (§3); create the production `.env`.
5. Start only the database: `docker compose -f docker-compose.prod.yml up -d db`
6. Restore the latest database backup (§1, steps 2–3).
7. Restore the latest files backup (§2, step 2).
8. Run migrations: `docker compose -f docker-compose.prod.yml run --rm migrate`
9. Start the full stack: `docker compose -f docker-compose.prod.yml up -d`
10. Verify: `curl http://localhost/api/v1/health` → 200; spot-check admin login.

---

## 6. What Was Validated in P5

- Backup commands were reviewed against the production compose topology
  (volume names, service names, paths).
- The commands were **not** executed against a production server in P5
  (no production deployment exists yet).
- Validate the exact commands in a staging environment before first production use.
