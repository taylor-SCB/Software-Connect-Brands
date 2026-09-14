#!/bin/bash
# Build the app and serve it on :3000 for the browser suites.
#
#   bash scripts/dev-serve.sh          build, then (re)start
#   bash scripts/dev-serve.sh --serve  restart the current build only
#
# Kills whatever is already on the port first — a suite run against a
# stale server is the most confusing failure there is.
set -e
cd "$(dirname "$0")/.."

if [ "$1" != "--serve" ]; then
  npm run build:app
fi

pkill -f "next-server" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
sleep 1

nohup npx next start -p 3000 > /tmp/next-start.log 2>&1 &
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login)" = "200" ]; do sleep 1; done
echo "serving $(cat .next/BUILD_ID) on http://localhost:3000"
