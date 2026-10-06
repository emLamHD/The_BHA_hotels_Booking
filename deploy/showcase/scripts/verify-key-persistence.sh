#!/usr/bin/env bash
# Proves the Data Protection key ring survives a container recreate when /var/keys is a durable
# volume, and that cookies/antiforgery tokens do NOT survive when it is not. Uses a scratch database
# in the showcase PostgreSQL and two scratch volumes; both are removed at the end. The demo database,
# its rows and the real key volume are never touched. Run from anywhere; needs the stack up.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
set -a; . ./.env; set +a

scratch_db="${SHOWCASE_DB}_keytest"
net="the-bha-showcase_showcase"
name="the-bha-showcase-keytest"
vol_a="the-bha-showcase-keytest-keys-a"
vol_b="the-bha-showcase-keytest-keys-b"
port=18080
state="$(mktemp)"
psql_in() { docker compose --env-file .env exec -T postgres psql -v ON_ERROR_STOP=1 -q -U "$SHOWCASE_DB_USER" "$@"; }

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$vol_a" "$vol_b" >/dev/null 2>&1 || true
  psql_in -d postgres -c "DROP DATABASE IF EXISTS \"$scratch_db\" WITH (FORCE)" >/dev/null 2>&1 || true
  rm -f "$state"
}
trap cleanup EXIT

run_api() { # volume
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --network "$net" -p "127.0.0.1:$port:8080" \
    -e ASPNETCORE_ENVIRONMENT=Production \
    -e "ConnectionStrings__TheBhaDatabase=Host=postgres;Database=$scratch_db;Username=$SHOWCASE_DB_USER;Password=$SHOWCASE_DB_PASSWORD" \
    -e "Cors__AllowedOrigins__0=$CUSTOMER_ORIGIN" -e "Cors__AdminOrigins__0=$ADMIN_ORIGIN" \
    -e DataProtection__KeysPath=/var/keys \
    -e Hosting__TrustedProxy__Enabled=true -e Hosting__TrustedProxy__KnownNetworks__0=172.28.0.0/24 \
    -v "$1:/var/keys" thebha-api:showcase >/dev/null
  for _ in $(seq 1 40); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health/ready" || true)" == 200 ]] && return 0
    sleep 1
  done
  echo "FAIL  scratch API did not become ready" >&2; docker logs "$name" 2>&1 | tail -5 >&2; exit 1
}

client() { python3 - "$state" "$port" "$1" <<'PY'
import json, sys, urllib.request, urllib.error, uuid
state_path, port, phase = sys.argv[1], sys.argv[2], sys.argv[3]
base = f"http://127.0.0.1:{port}"

def call(method, path, body=None, cookies=None, headers=None):
    request = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode())
    if body is not None: request.add_header("Content-Type", "application/json")
    if cookies: request.add_header("Cookie", "; ".join(cookies))
    # Production antiforgery/cookies require HTTPS; the compose network is the trusted proxy range,
    # so this header stands in for the TLS terminator.
    request.add_header("X-Forwarded-Proto", "https")
    for key, value in (headers or {}).items(): request.add_header(key, value)
    try:
        response = urllib.request.urlopen(request)
    except urllib.error.HTTPError as error:
        response = error
    jar = [value.split(";")[0] for value in response.headers.get_all("Set-Cookie") or []]
    raw = response.read()
    return response.status, jar, (json.loads(raw) if raw else None)

def expect(label, got, want):
    ok = got == want
    print(("ok    " if ok else "FAIL  ") + f"{label} ({got})")
    if not ok: sys.exit(1)

if phase == "issue":
    email, password = f"keytest-{uuid.uuid4().hex[:8]}@example.com", "K!y1-" + uuid.uuid4().hex
    expect("register", call("POST", "/api/v1/auth/register", {"email": email, "password": password})[0], 201)
    status, session_cookies, _ = call("POST", "/api/v1/auth/login", {"email": email, "password": password})
    expect("login", status, 200)
    # The antiforgery token is bound to the signed-in user, so it is requested after login, as the SPA does.
    status, antiforgery_cookies, token = call("GET", "/api/v1/auth/csrf", cookies=session_cookies)
    expect("csrf issued for the signed-in user", status, 200)
    cookies = session_cookies + antiforgery_cookies
    expect("me with the issued cookies", call("GET", "/api/v1/auth/me", cookies=cookies)[0], 200)
    json.dump({"cookies": cookies, "header": token["headerName"], "token": token["token"]}, open(state_path, "w"))
else:
    saved = json.load(open(state_path))
    expected_me, expected_logout = (200, 204) if phase == "same-volume" else (401, None)
    expect(f"[{phase}] me with the old session cookie", call("GET", "/api/v1/auth/me", cookies=saved["cookies"])[0], expected_me)
    status = call("POST", "/api/v1/auth/logout", cookies=saved["cookies"], headers={saved["header"]: saved["token"]})[0]
    if expected_logout: expect(f"[{phase}] logout with the old antiforgery cookie+token", status, expected_logout)
    else: expect(f"[{phase}] logout with the old antiforgery cookie+token is refused", status in (400, 401), True)
PY
}

psql_in -d postgres -c "DROP DATABASE IF EXISTS \"$scratch_db\" WITH (FORCE)"
psql_in -d postgres -c "CREATE DATABASE \"$scratch_db\""
psql_in -d "$scratch_db" < migrations/idempotent.sql >/dev/null

echo "== durable volume: issue, recreate on the same volume, reuse"
run_api "$vol_a"; client issue
run_api "$vol_a"; client same-volume
echo "== control: recreate on a fresh volume invalidates what was issued"
run_api "$vol_a"; client issue
run_api "$vol_b"; client fresh-volume
echo "== guard: no key directory configured -> Production refuses to start"
docker rm -f "$name" >/dev/null 2>&1 || true
set +e
out="$(docker run --rm --network "$net" -e ASPNETCORE_ENVIRONMENT=Production \
  -e "ConnectionStrings__TheBhaDatabase=Host=postgres;Database=$scratch_db;Username=$SHOWCASE_DB_USER;Password=$SHOWCASE_DB_PASSWORD" \
  -e "Cors__AllowedOrigins__0=$CUSTOMER_ORIGIN" -e "Cors__AdminOrigins__0=$ADMIN_ORIGIN" thebha-api:showcase 2>&1)"
code=$?
set -e
if [[ $code -ne 0 && "$out" == *"DataProtection:KeysPath must point to durable shared storage"* ]]; then
  echo "ok    image without DataProtection__KeysPath exits $code with the guard message"
else
  echo "FAIL  image started (or failed differently) without a key directory (exit $code)" >&2; exit 1
fi
echo "key persistence verified"
