#!/bin/sh
# Development-only helper: boots a local throwaway PostgreSQL instance using the
# embedded-postgres binaries already installed with the API's devDependencies.
# Never used in CI (GitHub Actions provides a postgres service) or production.
#
# Usage: scripts/dev-db.sh [start|stop|status|clean]   (default: start)
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STATE="$ROOT/.local-dev"
PGDATA="$STATE/pgdata"
LOG="$STATE/postgres.log"
PORT="${PGPORT:-54329}"
DB="${PGDATABASE:-nearbyorders}"

NATIVE=$(ls -d "$ROOT"/node_modules/.pnpm/@embedded-postgres+linux-x64@*/node_modules/@embedded-postgres/linux-x64/native 2>/dev/null | head -n 1 || true)
[ -n "$NATIVE" ] || { echo "embedded-postgres binaries not found. Run: pnpm install" >&2; exit 1; }

# PostgreSQL refuses to run as root; pick the OS account it should run as.
if [ "$(id -u)" = "0" ]; then
  RUN_AS="${PG_OS_USER:-${SUDO_USER:-}}"
  [ -n "$RUN_AS" ] || RUN_AS=$(id -un daytona 2>/dev/null || true)
  [ -n "$RUN_AS" ] || RUN_AS=$(id -un postgres 2>/dev/null || true)
  [ -n "$RUN_AS" ] || { echo "Running as root: set PG_OS_USER to a non-root account." >&2; exit 1; }
  run_pg() { runuser -u "$RUN_AS" -- "$@"; }
  PGUSER="$RUN_AS"
else
  run_pg() { "$@"; }
  PGUSER="$(id -un)"
fi

chown_state() {
  if [ "$(id -u)" = "0" ]; then
    mkdir -p "$STATE"
    chown -R "$RUN_AS" "$STATE"
  fi
}

pid_alive() {
  [ -f "$PGDATA/postmaster.pid" ] && kill -0 "$(head -n 1 "$PGDATA/postmaster.pid" | tr -d ' ')" 2>/dev/null
}

cmd="${1:-start}"
case "$cmd" in
  start)
    if pid_alive; then
      echo "PostgreSQL already running (port $PORT)"
    else
      chown_state
      if [ ! -s "$PGDATA/PG_VERSION" ]; then
        run_pg "$NATIVE/bin/initdb" -D "$PGDATA" -U "$PGUSER" -A trust -E utf8 >/dev/null
      fi
      run_pg "$NATIVE/bin/pg_ctl" -D "$PGDATA" \
        -o "-p $PORT -k $STATE -c listen_addresses=127.0.0.1" -l "$LOG" start >/dev/null
    fi
    run_pg "$NATIVE/bin/createdb" -h 127.0.0.1 -p "$PORT" -U "$PGUSER" "$DB" 2>/dev/null || true
    echo "PostgreSQL ready: 127.0.0.1:$PORT user=$PGUSER db=$DB"
    echo "  DATABASE_URL=postgresql://$PGUSER@127.0.0.1:$PORT/$DB?schema=public"
    ;;
  stop)
    if [ -d "$PGDATA" ]; then run_pg "$NATIVE/bin/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true; fi
    echo "PostgreSQL stopped"
    ;;
  status)
    if pid_alive; then echo "running (port $PORT)"; else echo "stopped"; fi
    ;;
  clean)
    if [ -d "$PGDATA" ]; then run_pg "$NATIVE/bin/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true; fi
    rm -rf "$STATE"
    echo "Removed $STATE"
    ;;
  *)
    echo "Usage: scripts/dev-db.sh [start|stop|status|clean]" >&2
    exit 2
    ;;
esac
