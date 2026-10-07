#!/usr/bin/env bash
# Proves the Data Protection key ring survives a container recreate when /var/keys is a durable
# volume, and that cookies/antiforgery tokens do NOT survive when it is not. Uses a scratch database
# in the showcase PostgreSQL and two scratch volumes. The demo database, its rows and the real key
# volume are never touched. Run from anywhere; needs the stack up.
#
# Ownership (CUST-WEB-SHOWCASE-001-CP02-C4): every run gets its own random run id, and the scratch
# database, container and both volumes are named after it. Nothing is dropped or removed to "prepare":
# CREATE DATABASE and the volume pre-check refuse when a name already exists, a resource is recorded as
# owned only after its creation succeeded (volumes and containers also carry a run-id label that is
# verified), and cleanup removes only what this run owns, by exact name/id — never by prefix, wildcard
# or process scan. Resources of earlier runs, of other runs, or the old fixed *-keytest names are left
# alone. Environment: KEYTEST_IMAGE (default thebha-api:showcase) selects the API image to test.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
set -a; . ./.env; set +a

image="${KEYTEST_IMAGE:-thebha-api:showcase}"
net="the-bha-showcase_showcase"
run_id="$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$run_id" =~ ^[0-9a-f]{12}$ ]] || { echo "FAIL  could not generate a run id" >&2; exit 1; }
label_key="bha.keytest.run"
scratch_db="bha_kt_${run_id}"            # 19 characters: far below PostgreSQL's 63-byte limit
name="bha-kt-${run_id}"
guard_name="bha-kt-${run_id}-guard"
vol_a="bha-kt-${run_id}-keys-a"
vol_b="bha-kt-${run_id}-keys-b"

state=""
db_owned=0; vol_a_owned=0; vol_b_owned=0; ctr_id=""; guard_owned=0
cleanup_failed=()
psql_in() { docker compose --env-file .env exec -T postgres psql -v ON_ERROR_STOP=1 -q -U "$SHOWCASE_DB_USER" "$@"; }

cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP
  set +e
  if [[ -n "$ctr_id" ]]; then
    if [[ "$(docker inspect -f "{{index .Config.Labels \"$label_key\"}}" "$ctr_id" 2>/dev/null)" == "$run_id" ]]; then
      docker rm -f "$ctr_id" >/dev/null 2>&1 || cleanup_failed+=("container $name")
    fi
  fi
  if [[ $guard_owned -eq 1 ]]; then
    if [[ "$(docker inspect -f "{{index .Config.Labels \"$label_key\"}}" "$guard_name" 2>/dev/null)" == "$run_id" ]]; then
      docker rm -f "$guard_name" >/dev/null 2>&1 || cleanup_failed+=("container $guard_name")
    fi
  fi
  local owned vol
  for owned in "$vol_a_owned:$vol_a" "$vol_b_owned:$vol_b"; do
    vol="${owned#*:}"
    if [[ "${owned%%:*}" -eq 1 ]]; then
      if [[ "$(docker volume inspect -f "{{index .Labels \"$label_key\"}}" "$vol" 2>/dev/null)" == "$run_id" ]]; then
        docker volume rm "$vol" >/dev/null 2>&1 || cleanup_failed+=("volume $vol")
      fi
    fi
  done
  if [[ $db_owned -eq 1 ]]; then
    psql_in -d postgres -c "DROP DATABASE \"$scratch_db\" WITH (FORCE)" >/dev/null 2>&1 || cleanup_failed+=("database $scratch_db")
  fi
  [[ -n "$state" ]] && rm -f "$state"
  if [[ ${#cleanup_failed[@]} -gt 0 ]]; then
    echo "WARN  scratch cleanup incomplete, left for manual removal: ${cleanup_failed[*]}" >&2
    [[ $rc -eq 0 ]] && rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

state="$(mktemp)"; chmod 600 "$state"

create_volume() { # name -> sets ownership only after a verified creation
  local vol="$1"
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    echo "FAIL  volume $vol already exists; refusing to reuse or remove it" >&2; exit 1
  fi
  docker volume create --label "$label_key=$run_id" "$vol" >/dev/null
  if [[ "$(docker volume inspect -f "{{index .Labels \"$label_key\"}}" "$vol")" != "$run_id" ]]; then
    echo "FAIL  volume $vol is not owned by this run; leaving it untouched" >&2; exit 1
  fi
}

host_port() { docker port "$ctr_id" 8080/tcp | head -n 1 | sed 's/.*://'; }

run_api() { # volume
  if [[ -n "$ctr_id" ]]; then
    docker rm -f "$ctr_id" >/dev/null
    ctr_id=""
  fi
  local id
  id="$(docker run -d --name "$name" --label "$label_key=$run_id" --network "$net" -p 127.0.0.1::8080 \
    -e ASPNETCORE_ENVIRONMENT=Production \
    -e "ConnectionStrings__TheBhaDatabase=Host=postgres;Database=$scratch_db;Username=$SHOWCASE_DB_USER;Password=$SHOWCASE_DB_PASSWORD" \
    -e "Cors__AllowedOrigins__0=$CUSTOMER_ORIGIN" -e "Cors__AdminOrigins__0=$ADMIN_ORIGIN" \
    -e DataProtection__KeysPath=/var/keys \
    -e Hosting__TrustedProxy__Enabled=true -e Hosting__TrustedProxy__KnownNetworks__0=172.28.0.0/24 \
    -v "$1:/var/keys" "$image")"
  ctr_id="$id"
  port="$(host_port)"
  [[ "$port" =~ ^[0-9]+$ ]] || { echo "FAIL  could not read the scratch API port" >&2; exit 1; }
  for _ in $(seq 1 40); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health/ready" || true)" == 200 ]] && return 0
    sleep 1
  done
  echo "FAIL  scratch API did not become ready" >&2; docker logs "$ctr_id" 2>&1 | tail -5 >&2; exit 1
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

docker network inspect "$net" >/dev/null 2>&1 || { echo "FAIL  network $net not found; is the showcase stack up?" >&2; exit 1; }
echo "run id $run_id: scratch database $scratch_db, container $name, volumes $vol_a / $vol_b"

# CREATE DATABASE fails when the name exists; it is never dropped or taken over to prepare.
psql_in -d postgres -c "CREATE DATABASE \"$scratch_db\""
db_owned=1
psql_in -d "$scratch_db" < migrations/idempotent.sql >/dev/null
create_volume "$vol_a"; vol_a_owned=1
create_volume "$vol_b"; vol_b_owned=1

echo "== durable volume: issue, recreate on the same volume, reuse"
run_api "$vol_a"; client issue
run_api "$vol_a"; client same-volume
echo "== control: recreate on a fresh volume invalidates what was issued"
run_api "$vol_a"; client issue
run_api "$vol_b"; client fresh-volume
echo "== guard: no key directory configured -> Production refuses to start"
if [[ -n "$ctr_id" ]]; then docker rm -f "$ctr_id" >/dev/null; ctr_id=""; fi
guard_owned=1
set +e
out="$(docker run --rm --name "$guard_name" --label "$label_key=$run_id" --network "$net" -e ASPNETCORE_ENVIRONMENT=Production \
  -e "ConnectionStrings__TheBhaDatabase=Host=postgres;Database=$scratch_db;Username=$SHOWCASE_DB_USER;Password=$SHOWCASE_DB_PASSWORD" \
  -e "Cors__AllowedOrigins__0=$CUSTOMER_ORIGIN" -e "Cors__AdminOrigins__0=$ADMIN_ORIGIN" "$image" 2>&1)"
code=$?
set -e
if [[ $code -ne 0 && "$out" == *"DataProtection:KeysPath must point to durable shared storage"* ]]; then
  echo "ok    image without DataProtection__KeysPath exits $code with the guard message"
else
  echo "FAIL  image started (or failed differently) without a key directory (exit $code)" >&2; exit 1
fi
echo "key persistence verified"
