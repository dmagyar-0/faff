#!/usr/bin/env bash
# Smoke-tests a built worker image (CI job `build-worker`). Usage: smoke-image.sh <image>
# Proves the image boots and answers /healthz, refuses to boot without its config, runs as a
# non-root user and exits 0 on SIGTERM. /readyz against a real database is the `db` job's test.
set -euo pipefail

image="${1:?usage: smoke-image.sh <image>}"
port=18080
name="faff-worker-smoke-$$"
fail() { echo "::error::$*"; docker logs "$name" 2>&1 || true; exit 1; }
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

echo "--- refuses to boot without DATABASE_URL"
if out=$(docker run --rm "$image" 2>&1); then fail "booted without DATABASE_URL"; fi
grep -q "DATABASE_URL: missing" <<<"$out" || fail "unclear config error: $out"

echo "--- boots and answers /healthz"
# Nothing listens on port 1, so the database is unreachable: /healthz must not care.
docker run -d --name "$name" -p "$port:8080" \
  -e DATABASE_URL=postgresql://worker:unused@127.0.0.1:1/postgres "$image" >/dev/null
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$port/healthz" | grep -q '"ok"' || fail "/healthz did not answer ok"

echo "--- /readyz reports the unreachable database"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/readyz")
[[ "$code" == 503 ]] || fail "/readyz returned $code, expected 503"

echo "--- runs as a non-root user"
uid=$(docker exec "$name" id -u)
[[ "$uid" != 0 ]] || fail "the worker runs as root"

echo "--- drains and exits 0 on SIGTERM"
docker stop --signal SIGTERM --time 15 "$name" >/dev/null
status=$(docker inspect -f '{{.State.ExitCode}}' "$name")
[[ "$status" == 0 ]] || fail "exit code $status after SIGTERM, expected 0"
docker logs "$name" 2>&1 | grep -q "closed database pool" || fail "shutdown didn't close the pool"

echo "Worker image smoke test passed."
