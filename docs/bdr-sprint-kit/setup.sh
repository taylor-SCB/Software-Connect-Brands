#!/bin/bash
# One-time setup on a fresh cloud machine for the BDR sprint.
# Usage: bash docs/bdr-sprint-kit/setup.sh <database_name>
# Starts Postgres on port 5433, makes the database, writes .env if missing,
# then generates the Prisma client and applies every migration.
set -e
DBN=${1:?usage: setup.sh <database_name>}
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
[ -d node_modules/next ] || npm ci --no-audit --no-fund
PG=/usr/lib/postgresql/16/bin
if ! pg_isready -h localhost -p 5433 >/dev/null 2>&1; then
  if [ ! -d /tmp/scbpg/data ]; then
    mkdir -p /tmp/scbpg && chown postgres /tmp/scbpg
    su postgres -c "$PG/initdb -D /tmp/scbpg/data -A trust -U postgres" >/dev/null
  fi
  su postgres -c "$PG/pg_ctl -D /tmp/scbpg/data -o '-p 5433 -k /tmp/scbpg' -l /tmp/scbpg/log start" >/dev/null
  for i in $(seq 1 30); do pg_isready -h localhost -p 5433 >/dev/null 2>&1 && break; sleep 1; done
fi
URL=postgresql://postgres:postgres@localhost:5433/$DBN
psql postgresql://postgres:postgres@localhost:5433/postgres -qc "DROP DATABASE IF EXISTS $DBN" -c "CREATE DATABASE $DBN"
if [ ! -f .env ]; then
  printf 'DATABASE_URL="%s"\nAUTH_SECRET="%s"\n' "$URL" "$(openssl rand -hex 32)" > .env
else
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=\"$URL\"#" .env
fi
npx prisma generate >/dev/null
DATABASE_URL=$URL npx prisma migrate deploy | tail -1
echo "ready: database $DBN at $URL"
echo "next: npx next build, then: DB=$URL bash docs/bdr-sprint-kit/run-suites.sh plain:<suite,suite>"
