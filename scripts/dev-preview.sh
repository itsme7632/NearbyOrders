#!/bin/sh
# Local/preview stack launcher: embedded PostgreSQL + Fastify API + Vite dev server.
# Used by the Freebuff preview runner and humans. Production is unaffected:
# deploys build the static mobile bundle only (`pnpm --filter @nearbyorders/mobile build`).
#
#   sh ./scripts/dev-preview.sh
#
# Environment:
#   PORT            port for the Vite dev server (default 5173; Freebuff injects it)
#   API_PORT        port for the API (default 3001)
#   SEED_DEMO_DATA  set to 1 to seed clearly-marked [Demo] businesses (recommended for preview)
#   AUTO_APPROVE_BUSINESSES  set to true so newly created businesses skip the
#     admin-approval wait in this dev/preview stack only. Server-side flag;
#     never client-controllable. Production/unset default stays PENDING.
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT="${PORT:-5173}"
API_PORT="${API_PORT:-3001}"
DATABASE_URL="${DATABASE_URL:-postgresql://daytona@127.0.0.1:54329/nearbyorders?schema=public}"
export DATABASE_URL
CORS_ORIGIN="http://localhost:$PORT,http://127.0.0.1:$PORT"
export CORS_ORIGIN
# Dev/preview convenience only: new businesses are approved immediately so the
# full product flow can be tested without the (still unbuilt) Admin UI.
# Production never sets this and keeps the PENDING → admin approval flow.
AUTO_APPROVE_BUSINESSES="${AUTO_APPROVE_BUSINESSES:-true}"
export AUTO_APPROVE_BUSINESSES

echo "[preview] 1/5 database"
sh "$ROOT/scripts/dev-db.sh" start

echo "[preview] 2/5 migrations"
(cd "$ROOT/apps/api" && ./node_modules/.bin/prisma migrate deploy >/dev/null)

echo "[preview] 3/5 seed"
if [ "${SEED_DEMO_DATA:-0}" = "1" ]; then
  (cd "$ROOT/apps/api" && SEED_DEMO_DATA=1 ./node_modules/.bin/tsx prisma/seed.ts)
else
  (cd "$ROOT/apps/api" && ./node_modules/.bin/tsx prisma/seed.ts)
fi

echo "[preview] 4/5 API on port $API_PORT"
(cd "$ROOT/apps/api" && API_PORT="$API_PORT" PORT="$API_PORT" ./node_modules/.bin/tsx src/server.ts) &
API_PID=$!

echo "[preview] 5/5 mobile web on port $PORT"
cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
cd "$ROOT/apps/mobile" && exec ./node_modules/.bin/vite --host 0.0.0.0 --port "$PORT" --strictPort
