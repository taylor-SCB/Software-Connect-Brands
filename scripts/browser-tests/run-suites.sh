#!/bin/bash
# Runs browser suites against a production build (run "npx next build" first).
# Usage: [PORT=3400] [LOG=/tmp/sprint-run.txt] DB=<url> run-suites.sh <group...>  groups: plain:<suites,comma> email:<suites> reports ai[:<suites>] template load
# "ai" alone runs ai-assist; "ai:ai-assist,sales-ai" runs those, each with its own stand-in Claude on :3995 (fake-claude.cjs).
DIR=${DIR:-$(git rev-parse --show-toplevel)}; PORT=${PORT:-3400}; : "${DB:?set DB to your database URL}"
cd "$DIR" || exit 1


export NODE_PATH=$(npm root -g):$(pwd)/node_modules
LOG=${LOG:-/tmp/sprint-run.txt}
: > $LOG
start() {
  stop
  env DATABASE_URL=$DB STORAGE_DRIVER=local "$@" npx next start -p $PORT > ${LOG%.txt}-server.log 2>&1 &
  for i in $(seq 1 90); do curl -s -o /dev/null http://localhost:$PORT/login && break; sleep 1; done
}
stop() {
  fuser -k $PORT/tcp >/dev/null 2>&1
  sleep 1
}
run() {
  local n=$1; shift
  local t0=$(date +%s)
  out=$(env DATABASE_URL=$DB BASE=http://localhost:$PORT APP_URL=http://localhost:$PORT "$@" node scripts/browser-tests/$n.cjs 2>&1)
  local code=$?
  local dt=$(( $(date +%s) - t0 ))
  echo "$out" > ${LOG%.txt}-$n.log
  if [ $code -eq 0 ] && echo "$out" | grep -qiE "steps passed|PASS"; then
    echo "PASS $n (${dt}s) $(echo "$out" | grep -iE "steps passed|PASS —" | tail -1)" >> $LOG
  else
    echo "FAIL $n (${dt}s)" >> $LOG
    echo "$out" | tail -30 | sed 's/^/    /' >> $LOG
  fi
}
for g in "$@"; do
  kind=${g%%:*}; list=${g#*:}; [ "$list" = "$g" ] && list=""
  case $kind in
    plain) echo "== plain" >> $LOG; start; for n in ${list//,/ }; do run $n; done ;;
    email) echo "== email" >> $LOG; start RESEND_API_KEY=re_test_fake EMAIL_FROM=test@example.com RESEND_ENDPOINT=http://localhost:3999/emails
           for n in ${list//,/ }; do if [ $n = crm-data ]; then run crm-data CATCHER_PORT=3999; else run $n; fi; done ;;
    reports) echo "== reports" >> $LOG; start RESEND_API_KEY=test-resend-key "EMAIL_FROM=Software Connect Brands <no-reply@example.com>" RESEND_ENDPOINT=http://localhost:3993/emails \
           CRON_SECRET=test-cron-secret REPORTS_TEST_CLOCK=1 APP_URL=http://localhost:$PORT
           run reports CRON_SECRET=test-cron-secret ;;
    ai) echo "== ai" >> $LOG; start ANTHROPIC_API_KEY=test-key ANTHROPIC_ENDPOINT=http://localhost:3995; l=${list//,/ }; for n in ${l:-ai-assist}; do run $n; done ;;
    template) echo "== template" >> $LOG; start ANTHROPIC_API_KEY=test-key ANTHROPIC_ENDPOINT=http://localhost:3998; run template-import ;;
    load) echo "== load" >> $LOG; start; run load-test ;;
  esac
done
stop
echo "== done" >> $LOG
