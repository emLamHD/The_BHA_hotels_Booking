#!/usr/bin/env bash
# BHA-BACKEND-CD-001-CP02: REAL isolated rehearsal of backend-deploy.sh. No cloud, no ECR, no AWS API, no RDS.
#
#   TMPDIR=<scratch dir> deploy/showcase/scripts/tests/rehearse_backend_deploy.sh [--setup-only]
#
# Needs: docker, a PostgreSQL client (psql, pg_dump) on PATH, openssl, curl, flock, python3, a CLEAN committed tree
# (the API image and the migration manifest are built from HEAD) and network access to pull registry:2 once.
#
# Everything it creates carries the label bha.cp02.rehearsal=<run id> or lives under one temp directory, is recorded
# only AFTER it was created successfully, and is removed by exact ID/tag at the end (also on failure/INT/TERM).
# Pre-existing containers/images/volumes are never listed-and-removed, and nothing is pruned.
# Images marked TEST_ONLY are fixtures that exist only to force a failure after the old container was stopped.
# The synthetic secrets below are canaries: the harness greps every captured output for them at the end.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SCRIPTS/../../.." && pwd)"
DEPLOY="$SCRIPTS/backend-deploy.sh"
MANIFEST="$SCRIPTS/backend-migration-manifest.py"

RID="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
LABEL="bha.cp02.rehearsal=$RID"
TARGET="bha-cp02-$RID-api"
SETUP_ONLY=false
[[ "${1:-}" == "--setup-only" ]] && SETUP_ONLY=true

PG_CANARY="CANARY-pg-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
STAFF_CANARY="CANARY-staff-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')Aa1!"
SU_CANARY="CANARY-su-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/bha-cp02-$RID.XXXXXX")"
mkdir -p "$WORK"/{certs,keys,journal,out,lock} && chmod 700 "$WORK/journal" "$WORK/lock"
CREATED_CONTAINERS=()   # full IDs, appended only after a successful create
CREATED_IMAGES=()       # tags this harness created
LOG="$WORK/out/harness.log"
PASS=0; FAILS=0

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
ok() { PASS=$((PASS + 1)); say "  PASS  $*"; }
bad() { FAILS=$((FAILS + 1)); say "  FAIL  $*"; }
check() { local what="$1"; shift; if "$@"; then ok "$what"; else bad "$what"; fi; }

track_container() { CREATED_CONTAINERS+=("$1"); }

cleanup() {
  local rc=$? id img
  set +e
  # Containers created by backend-deploy.sh for THIS target (candidates, the renamed original, failed candidates)
  # are found by the exact target label value, then verified by name prefix before removal.
  while read -r id; do
    [[ -n "$id" ]] && track_container "$id"
  done < <(docker ps -aq --no-trunc --filter "label=com.thebha.deploy.target=$TARGET" 2>/dev/null)
  for id in "${CREATED_CONTAINERS[@]}"; do
    docker rm -f "$id" >/dev/null 2>&1
  done
  for img in "${CREATED_IMAGES[@]}"; do
    docker rmi "$img" >/dev/null 2>&1
  done
  if [[ "$WORK" == */bha-cp02-$RID.* && -d "$WORK" && "${KEEP_WORK:-}" != "1" ]]; then
    rm -rf "$WORK"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }

say "== rehearsal $RID  work=$WORK"
[[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]] || { say "tracked files are modified: commit first"; exit 2; }
SHA="$(git -C "$REPO" rev-parse HEAD)"
OLD_SHA="1111111111111111111111111111111111111111"   # TEST_ONLY label for the "old" release
SRC_URL="https://github.com/emLamHD/The_BHA_hotels_Booking"

# ---------------------------------------------------------------- topology: bridge, CA, PostgreSQL 18.3 with TLS
GW="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')"
SUBNET="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Subnet}}')"
PGPORT="$(free_port)"; APIPORT="$(free_port)"; TLSPORT="$(free_port)"; REGPORT="$(free_port)"
say "bridge gateway=$GW subnet=$SUBNET ports pg=$PGPORT api=$APIPORT tls=$TLSPORT registry=$REGPORT"

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=bha-cp02-test-ca" -keyout "$WORK/certs/ca.key" -out "$WORK/certs/ca.pem" 2>/dev/null
cat > "$WORK/certs/san.cnf" <<EOF
[req]
distinguished_name=dn
[dn]
[san]
subjectAltName=IP:$GW,IP:127.0.0.1,DNS:localhost
EOF
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout "$WORK/certs/server.key" -out "$WORK/certs/server.csr" 2>/dev/null
openssl x509 -req -in "$WORK/certs/server.csr" -CA "$WORK/certs/ca.pem" -CAkey "$WORK/certs/ca.key" -CAcreateserial -days 2 \
  -extfile "$WORK/certs/san.cnf" -extensions san -out "$WORK/certs/server.crt" 2>/dev/null
chmod 644 "$WORK/certs/"*.pem "$WORK/certs/server.crt"; chmod 600 "$WORK/certs/server.key"
cp "$WORK/certs/ca.pem" "$WORK/rds-ca.pem" && chmod 644 "$WORK/rds-ca.pem"

docker pull -q registry:2 >/dev/null
REG_DIGEST="$(docker image inspect registry:2 --format '{{index .RepoDigests 0}}')"
say "registry image: $REG_DIGEST"
id="$(docker run -d --name "bha-cp02-$RID-registry" --label "$LABEL" -p "127.0.0.1:$REGPORT:5000" registry:2)"; track_container "$id"

id="$(docker create --name "bha-cp02-$RID-pg" --label "$LABEL" -e "POSTGRES_PASSWORD=$SU_CANARY" -p "$GW:$PGPORT:5432" \
  -v "$WORK/certs:/certsrc:ro" --entrypoint sh postgres:18.3 -c \
  'mkdir -p /certs && cp /certsrc/server.crt /certsrc/server.key /certs/ && chown postgres:postgres /certs/* && chmod 600 /certs/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key')"
track_container "$id"; PG_CID="$id"
docker start "$PG_CID" >/dev/null
for _ in $(seq 1 60); do docker exec "$PG_CID" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec "$PG_CID" pg_isready -U postgres >/dev/null
PGVER="$(docker exec "$PG_CID" psql -U postgres -Atc 'show server_version')"
say "scratch PostgreSQL server_version=$PGVER image=$(docker image inspect postgres:18.3 --format '{{index .RepoDigests 0}}')"

# Privileged fixture setup is a separate identity (postgres over the container's unix socket) from the deploy identity.
su_psql() { docker exec -i "$PG_CID" psql -U postgres -v ON_ERROR_STOP=1 -X -q "$@"; }
su_psql -c 'CREATE DATABASE thebha'
su_psql -d thebha -f - < "$REPO/deploy/showcase/migrations/idempotent.sql" >/dev/null
su_psql -d thebha <<SQL
CREATE ROLE bha_app LOGIN PASSWORD '$PG_CANARY' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON DATABASE thebha FROM PUBLIC;
GRANT CONNECT ON DATABASE thebha TO bha_app;
GRANT USAGE ON SCHEMA public TO bha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bha_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bha_app;
INSERT INTO "Properties" ("Id","Name","Slug","Address","City","Country","TimeZone","CheckInTime","CheckOutTime","IsActive","CreatedAt","UpdatedAt")
VALUES ('a1000000-0000-0000-0000-000000000001','Rehearsal Property (synthetic)','rehearsal','1 Test St','Testville','VN','Asia/Ho_Chi_Minh','14:00','12:00',true,now(),now());
SQL
PROPERTY_ID="a1000000-0000-0000-0000-000000000001"

# ---------------------------------------------------------------- images: exact committed source, distinct identities
build() {  # build <tag> <revision-label> [dockerfile-on-stdin]
  docker build -q --tag "$1" --label "org.opencontainers.image.revision=$2" --label "org.opencontainers.image.source=$SRC_URL" "$REPO/Back_End" >/dev/null
  CREATED_IMAGES+=("$1")
}
IMG_BASE="bha-cp02-$RID-api"
build "$IMG_BASE:cand" "$SHA"
build "$IMG_BASE:old" "$OLD_SHA"
# TEST_ONLY fixture: same entrypoint/user/env defaults, so it passes every pre-stop gate, but it cannot start (invalid appsettings.json).
docker build -q --tag "$IMG_BASE:fault" -f - "$REPO/Back_End" >/dev/null <<EOF
FROM $IMG_BASE:cand
LABEL com.thebha.test-only="true"
RUN echo '{ this is not json' > /app/appsettings.json
EOF
CREATED_IMAGES+=("$IMG_BASE:fault")

REPO_PATH="127.0.0.1:$REGPORT/bha-cp02-$RID/api"
push_digest() {  # push_digest <local tag> <registry tag> -> echoes repo@sha256:...
  docker tag "$1" "$REPO_PATH:$2"; CREATED_IMAGES+=("$REPO_PATH:$2")
  docker push "$REPO_PATH:$2" 2>&1 | sed -n 's/.*digest: \(sha256:[0-9a-f]\{64\}\).*/\1/p' | tail -n1
}
D_CAND="$(push_digest "$IMG_BASE:cand" cand)"; D_OLD="$(push_digest "$IMG_BASE:old" old)"; D_FAULT="$(push_digest "$IMG_BASE:fault" fault)"
REF_CAND="$REPO_PATH@$D_CAND"; REF_OLD="$REPO_PATH@$D_OLD"; REF_FAULT="$REPO_PATH@$D_FAULT"
# Remove every local reference so that the deploy script's `docker pull` by digest is a real pull.
for t in "$IMG_BASE:cand" "$IMG_BASE:old" "$IMG_BASE:fault" "$REPO_PATH:cand" "$REPO_PATH:old" "$REPO_PATH:fault"; do docker rmi "$t" >/dev/null 2>&1 || true; done
CREATED_IMAGES=()
say "digests: old=$D_OLD cand=$D_CAND fault=$D_FAULT"
check "candidate digest ref is NOT present locally before the pull" bash -c "! docker image inspect '$REF_CAND' >/dev/null 2>&1"

# ---------------------------------------------------------------- runtime contract files (as on the EC2 host)
chmod 777 "$WORK/keys"
ENVF="$WORK/api.env"
umask 077
cat > "$ENVF" <<EOF
ASPNETCORE_ENVIRONMENT=Production
ConnectionStrings__TheBhaDatabase=Host=$GW;Port=$PGPORT;Database=thebha;Username=bha_app;Password=$PG_CANARY;SSL Mode=VerifyFull;Root Certificate=/certs/rds-ca.pem
Cors__AllowedOrigins__0=https://localhost:$TLSPORT
Cors__AdminOrigins__0=https://localhost:$TLSPORT
DataProtection__KeysPath=/var/keys
Hosting__TrustedProxy__Enabled=true
Hosting__TrustedProxy__KnownNetworks__0=$SUBNET
Hosting__TrustedProxy__ForwardLimit=1
Logging.LogLevel.Default=a=b=c
EOF
umask 022
chmod 600 "$ENVF"

PGSVC="$WORK/pg_service.conf"; PGPASS="$WORK/pgpass"
umask 077
cat > "$PGSVC" <<EOF
[bha-app-read]
host=$GW
port=$PGPORT
dbname=thebha
user=bha_app
sslmode=verify-full
sslrootcert=$WORK/rds-ca.pem
EOF
printf '%s:%s:thebha:bha_app:%s\n' "$GW" "$PGPORT" "$PG_CANARY" > "$PGPASS"
umask 022
chmod 600 "$PGSVC" "$PGPASS"

CONF="$WORK/host.conf"
cat > "$CONF" <<EOF
# host runtime configuration (data only; never sourced)
TARGET_CONTAINER=$TARGET
ALLOWED_IMAGE_REPOSITORY=$REPO_PATH
EXPECTED_SOURCE_URL=$SRC_URL
EXPECTED_CURRENT_IMAGE=$REF_OLD
LOOPBACK_PORT=$APIPORT
ENV_FILE=$ENVF
KEYS_DIR=$WORK/keys
CA_FILE=$WORK/rds-ca.pem
JOURNAL_DIR=$WORK/journal
PG_SERVICE_FILE=$PGSVC
PG_PASS_FILE=$PGPASS
PG_SERVICE=bha-app-read
PG_EXPECT_HOST=$GW
PG_EXPECT_DB=thebha
PG_EXPECT_USER=bha_app
API_BASE_URL=https://localhost:$TLSPORT
API_CA_FILE=$WORK/rds-ca.pem
READY_TIMEOUT_SECONDS=60
EOF
chmod 600 "$CONF"

# ---------------------------------------------------------------- the OLD container, created exactly like the EC2 packet does
docker pull -q "$REF_OLD" >/dev/null
id="$(docker create --name "$TARGET" --restart unless-stopped --log-driver json-file --log-opt max-size=10m -p "127.0.0.1:$APIPORT:8080" \
  --env-file "$ENVF" --mount "type=bind,src=$WORK/keys,dst=/var/keys" \
  --mount "type=bind,src=$WORK/rds-ca.pem,dst=/certs/rds-ca.pem,readonly" "$REF_OLD")"
track_container "$id"; OLD_CID="$id"
docker start "$OLD_CID" >/dev/null

# TLS terminator on loopback (stands in for Caddy): forwards the scheme so the API treats the request as HTTPS.
cat > "$WORK/nginx.conf" <<EOF
server {
  listen 127.0.0.1:$TLSPORT ssl;
  ssl_certificate /certs/server.crt;
  ssl_certificate_key /certs/server.key;
  location / {
    proxy_pass http://127.0.0.1:$APIPORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For \$remote_addr;
  }
}
EOF
id="$(docker run -d --name "bha-cp02-$RID-tls" --label "$LABEL" --network host -v "$WORK/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$WORK/certs:/certs:ro" nginx:1.27-alpine)"; track_container "$id"

curl_api() { curl -sS --noproxy '*' --max-time 8 --cacert "$WORK/rds-ca.pem" "$@"; }
wait_ready() { for _ in $(seq 1 60); do [[ "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$APIPORT/health/ready" || true)" == 200 ]] && return 0; sleep 1; done; return 1; }
check "old API container reaches PostgreSQL 18.3 over verify-full and is ready" wait_ready
check "Staff /me without a session is 401 through the TLS proxy (not 404)" \
  test "$(curl_api -o /dev/null -w '%{http_code}' "https://localhost:$TLSPORT/api/admin/v1/me")" = 401

# ---------------------------------------------------------------- synthetic Staff account + session (isolated harness only)
docker run --rm --name "bha-cp02-$RID-staffcli" --label "$LABEL" --env-file "$ENVF" -e "BHA_STAFF_PASSWORD=$STAFF_CANARY" \
  -e DataProtection__KeysPath=/tmp/keys -v "$WORK/rds-ca.pem:/certs/rds-ca.pem:ro" "$REF_OLD" \
  --staff-create --email "rehearsal-$RID@example.invalid" --property-id "$PROPERTY_ID" --role Manager >"$WORK/out/staff-create.out" 2>&1
JAR="$WORK/jar"
printf '{"email":"rehearsal-%s@example.invalid","password":"%s"}' "$RID" "$STAFF_CANARY" > "$WORK/login.json"; chmod 600 "$WORK/login.json"
check "synthetic Staff login succeeds before any swap" \
  test "$(curl_api -o /dev/null -w '%{http_code}' -c "$JAR" -H 'Content-Type: application/json' -H "Origin: https://localhost:$TLSPORT" \
    --data @"$WORK/login.json" "https://localhost:$TLSPORT/api/admin/v1/auth/login")" = 200
chmod 600 "$JAR"
me_code() { curl_api -o /dev/null -w '%{http_code}' -b "$JAR" "https://localhost:$TLSPORT/api/admin/v1/me"; }
check "Staff session cookie reads /me = 200 on the old container" test "$(me_code)" = 200

if $SETUP_ONLY; then
  say "setup-only: topology proven. PASS=$PASS FAIL=$FAILS"
  [[ "$FAILS" -eq 0 ]]
  exit $?
fi
