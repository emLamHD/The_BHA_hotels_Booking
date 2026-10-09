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

REG_PRESENT=false; docker image inspect registry:2 >/dev/null 2>&1 && REG_PRESENT=true
docker pull -q registry:2 >/dev/null
REG_DIGEST="$(docker image inspect registry:2 --format '{{index .RepoDigests 0}}')"
$REG_PRESENT || CREATED_IMAGES+=("registry:2" "$REG_DIGEST")      # only removed if this run is what brought it in
say "registry image (pinned by digest): $REG_DIGEST  pre-existing=$REG_PRESENT"
id="$(docker run -d --name "bha-cp02-$RID-registry" --label "$LABEL" -p "127.0.0.1:$REGPORT:5000" "$REG_DIGEST")"; track_container "$id"

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
# The build context is an archive of the committed tree (no working-tree leftovers such as bin/ obj/), like runbook step 2.
mkdir -p "$WORK/src"
git -C "$REPO" archive "$SHA" Back_End | tar -x -C "$WORK/src"
build() {  # build <tag> <revision-label>
  docker build -q --tag "$1" --label "org.opencontainers.image.revision=$2" --label "org.opencontainers.image.source=$SRC_URL" "$WORK/src/Back_End" >/dev/null
  CREATED_IMAGES+=("$1")
}
IMG_BASE="bha-cp02-$RID-api"
build "$IMG_BASE:cand" "$SHA"
build "$IMG_BASE:old" "$OLD_SHA"
# TEST_ONLY fixture: same entrypoint/user/env defaults, so it passes every pre-stop gate, but it cannot start (invalid appsettings.json).
docker build -q --tag "$IMG_BASE:fault" -f - "$WORK/src/Back_End" >/dev/null <<EOF
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
CREATED_IMAGES+=("$REF_CAND" "$REF_OLD" "$REF_FAULT")   # pulled by digest later; removal is by exact reference
# Remove every local reference so that the deploy script's `docker pull` by digest is a real pull.
for t in "$IMG_BASE:cand" "$IMG_BASE:old" "$IMG_BASE:fault" "$REPO_PATH:cand" "$REPO_PATH:old" "$REPO_PATH:fault"; do docker rmi "$t" >/dev/null 2>&1 || true; done
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

# ================================================================ scenarios (real Docker, real PostgreSQL, real API)
MAN="$WORK/manifest.json"
python3 -I "$MANIFEST" generate --repo "$REPO" --source-sha "$SHA" --output "$MAN"
OUT="" RC=0
run_deploy() {  # run_deploy <command> [extra args] -> OUT (one JSON line), RC
  RC=0
  OUT="$(BHA_DEPLOY_LOCK_DIR="$WORK/lock" "$DEPLOY" "$1" --config "${CONF_USED:-$CONF}" "${@:2}" 2>>"$WORK/out/deploy.stderr")" || RC=$?
  printf '%s\n' "$OUT" >> "$WORK/out/deploy.stdout"
  # every invocation prints exactly one physical line holding one valid JSON object
  if [[ "$OUT" == *$'\n'* ]] || ! python3 -c 'import json,sys; assert isinstance(json.loads(sys.argv[1]), dict)' "$OUT" 2>/dev/null; then JSON_BAD=$((JSON_BAD + 1)); fi
}
JSON_BAD=0
jf() { python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get(sys.argv[2],""))' "$OUT" "$1"; }
cfmt() { docker container inspect "$1" --format "$2" 2>/dev/null; }
set_conf() { sed -i "s#^$1=.*#$1=$2#" "$CONF"; }
db_hash() {  # schema + data + history of the application database (pg_dump 18 adds a random \restrict token per dump: dropped)
  docker exec "$PG_CID" pg_dump -U postgres -d thebha 2>/dev/null | grep -v -E '^\\(un)?restrict ' | sha256sum | cut -d' ' -f1
}
keys_list() { docker exec "$1" find /var/keys -maxdepth 1 -type f -exec sha256sum {} + 2>/dev/null | sort; }
count_target_containers() { docker ps -aq --filter "label=com.thebha.deploy.target=$TARGET" | wc -l; }
deploy_args() { printf '%s\n' --image "$1" --source-sha "${2:-$SHA}" --manifest "${3:-$MAN}"; }
dargs() { mapfile -t DA < <(deploy_args "$@"); }
env_matches() {  # the container's effective env contains every env-file line byte for byte (nothing printed)
  docker container inspect "$1" | python3 -c '
import json, sys
env = set(json.load(sys.stdin)[0]["Config"]["Env"])
lines = [l for l in open(sys.argv[1], encoding="utf-8").read().split("\n") if l and not l.startswith("#")]
sys.exit(0 if all(l in env for l in lines) else 1)' "$ENVF"
}
old_untouched() {
  [[ "$(cfmt "$TARGET" '{{.Id}}')" == "$OLD_CID" && "$(cfmt "$TARGET" '{{.State.Running}}')" == true && "$(cfmt "$TARGET" '{{.State.StartedAt}}')" == "$OLD_STARTED" ]]
}
OLD_STARTED="$(cfmt "$TARGET" '{{.State.StartedAt}}')"
ENV_SHA0="$(sha256sum "$ENVF" | cut -d' ' -f1)"; CA_SHA0="$(sha256sum "$WORK/rds-ca.pem" | cut -d' ' -f1)"
KEYS0="$(keys_list "$OLD_CID")"
check "key ring exists before any deploy (login created it)" test -n "$KEYS0"

say "== S1 preflight: every pre-stop gate, read-only"
DB0="$(db_hash)"
dargs "$REF_CAND"; run_deploy preflight "${DA[@]}"
check "preflight passes (exit $RC status $(jf status))" test "$RC" = 0 -a "$(jf status)" = PREFLIGHT_PASS
check "preflight created/stopped nothing: old untouched, no labelled containers" bash -c "[[ $(count_target_containers) -eq 0 ]]"
check "old container untouched by preflight" old_untouched
check "database dump (schema+data+history) identical after preflight" test "$(db_hash)" = "$DB0"
check "image is now present locally by digest (pull happened)" docker image inspect "$REF_CAND" >/dev/null

say "== S2 gates that must fail BEFORE the old container is stopped"
expect_reject() {  # expect_reject <why> <detail substring> <command...>
  local why="$1" want="$2"; shift 2
  RC=0; "$@" || true
  if [[ "$RC" == 20 && "$(jf status)" == REJECTED_BEFORE_STOP && "$(jf detail)" == *"$want"* ]] && old_untouched && [[ "$(count_target_containers)" -eq 0 ]]; then
    ok "$why -> exit 20 $(jf detail); old untouched"
  else bad "$why (rc=$RC status=$(jf status) detail=$(jf detail))"; fi
}
python3 - "$MAN" "$WORK" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
pending = dict(m, migrations=m["migrations"] + ["20270101000000_PendingFixture"], count=m["count"] + 1)
missing = dict(m, migrations=m["migrations"][:-1], count=m["count"] - 1)
other = dict(m, source_sha="2" * 40)
for name, doc in (("pending", pending), ("missing", missing), ("othersha", other)):
    json.dump(doc, open("%s/manifest-%s.json" % (sys.argv[2], name), "w"))
PY
dargs "$REF_CAND" "$SHA" "$WORK/manifest-pending.json"; expect_reject "pending migration in manifest" PENDING_MIGRATIONS run_deploy deploy "${DA[@]}"
dargs "$REF_CAND" "$SHA" "$WORK/manifest-missing.json"; expect_reject "manifest lacks an applied migration (unknown applied)" UNKNOWN_APPLIED_MIGRATIONS run_deploy deploy "${DA[@]}"
dargs "$REF_CAND" "$SHA" "$WORK/manifest-othersha.json"; expect_reject "manifest for another release SHA" MANIFEST_INVALID run_deploy deploy "${DA[@]}"
dargs "$REF_CAND" "$(printf '3%.0s' $(seq 40))"; expect_reject "OCI revision label differs from the requested SHA (manifest/sha consistent)" MANIFEST_INVALID run_deploy deploy "${DA[@]}"
python3 - "$MAN" "$WORK" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); m["source_sha"] = "3" * 40
json.dump(m, open("%s/manifest-sha3.json" % sys.argv[2], "w"))
PY
dargs "$REF_CAND" "$(printf '3%.0s' $(seq 40))" "$WORK/manifest-sha3.json"; expect_reject "OCI revision label differs from the requested SHA" IMAGE_REVISION_LABEL_DIFFERS run_deploy deploy "${DA[@]}"
dargs "$REPO_PATH:cand"; expect_reject "mutable tag instead of a digest" IMAGE_NOT_A_DIGEST_REFERENCE run_deploy deploy "${DA[@]}"
dargs "127.0.0.1:$REGPORT/other/api@$D_CAND"; expect_reject "image from another repository" IMAGE_REPOSITORY_NOT_ALLOWED run_deploy deploy "${DA[@]}"
dargs "$REPO_PATH@sha256:$(printf '0%.0s' $(seq 64))"; expect_reject "digest that does not exist in the registry (pull fails)" IMAGE_PULL_FAILED run_deploy deploy "${DA[@]}"
# env value mismatch: an entry in the env file that the running container does not have
cp "$ENVF" "$WORK/env.keep"; printf 'Cors__AllowedOrigins__1=https://not-in-container.invalid\n' >> "$ENVF"
dargs "$REF_CAND"; expect_reject "env file has a value the running container lacks" ENV_VALUE_MISMATCH:Cors__AllowedOrigins__1 run_deploy deploy "${DA[@]}"
cp "$WORK/env.keep" "$ENVF"; chmod 600 "$ENVF"
check "env file restored byte for byte" test "$(sha256sum "$ENVF" | cut -d' ' -f1)" = "$ENV_SHA0"
# database history: an applied migration unknown to the release (privileged fixture write, then removed)
su_psql -d thebha -c "INSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\",\"ProductVersion\") VALUES ('20270202000000_UnknownFixture','0')" >/dev/null
dargs "$REF_CAND"; expect_reject "extra applied migration in the database" UNKNOWN_APPLIED_MIGRATIONS run_deploy deploy "${DA[@]}"
su_psql -d thebha -c "DELETE FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\"='20270202000000_UnknownFixture'" >/dev/null
# history table missing
su_psql -d thebha -c 'ALTER TABLE "__EFMigrationsHistory" RENAME TO "__EFMigrationsHistory_hidden"' >/dev/null
dargs "$REF_CAND"; expect_reject "history table missing" HISTORY_TABLE_MISSING run_deploy deploy "${DA[@]}"
su_psql -d thebha -c 'ALTER TABLE "__EFMigrationsHistory_hidden" RENAME TO "__EFMigrationsHistory"' >/dev/null
# TLS failure: a CA that did not sign the server certificate
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=bha-cp02-wrong-ca" -keyout "$WORK/wrong.key" -out "$WORK/wrong-ca.pem" 2>/dev/null
sed "s#sslrootcert=.*#sslrootcert=$WORK/wrong-ca.pem#" "$PGSVC" > "$WORK/svc-wrong"; chmod 600 "$WORK/svc-wrong"
sed -e "s#^CA_FILE=.*#CA_FILE=$WORK/wrong-ca.pem#" -e "s#^PG_SERVICE_FILE=.*#PG_SERVICE_FILE=$WORK/svc-wrong#" "$CONF" > "$WORK/conf-wrongca"; chmod 600 "$WORK/conf-wrongca"
CONF_USED="$WORK/conf-wrongca"; dargs "$REF_CAND"; expect_reject "TLS verify-full against the wrong CA" TLS_FAILURE run_deploy deploy "${DA[@]}"; unset CONF_USED
sed "s#^port=.*#port=$(free_port)#" "$PGSVC" > "$WORK/svc-port"; chmod 600 "$WORK/svc-port"
sed "s#^PG_SERVICE_FILE=.*#PG_SERVICE_FILE=$WORK/svc-port#" "$CONF" > "$WORK/conf-port"; chmod 600 "$WORK/conf-port"
CONF_USED="$WORK/conf-port"; dargs "$REF_CAND"; expect_reject "database unreachable" CONNECTION_FAILED run_deploy deploy "${DA[@]}"; unset CONF_USED
# lock contention: another writer holds the per-target host lock
( exec 8>>"$WORK/lock/bha-deploy-$TARGET.lock"; flock 8; sleep 8 ) & LOCK_HOLDER=$!
sleep 1
sed "s#^READY_TIMEOUT_SECONDS=.*#READY_TIMEOUT_SECONDS=60\nLOCK_WAIT_SECONDS=2#" "$CONF" > "$WORK/conf-lock"; chmod 600 "$WORK/conf-lock"
CONF_USED="$WORK/conf-lock"; dargs "$REF_CAND"; run_deploy deploy "${DA[@]}"; unset CONF_USED
check "deploy while the lock is held -> exit 50 LOCK_BUSY, nothing changed" bash -c "[[ $RC == 50 && '$(jf status)' == LOCK_BUSY ]]"
check "old untouched after lock contention" old_untouched
CONF_USED="$WORK/conf-lock"; run_deploy rollback; unset CONF_USED
check "rollback while the lock is held -> exit 50 as well" test "$RC" = 50
wait "$LOCK_HOLDER" || true
check "lock file still exists (never deleted)" test -f "$WORK/lock/bha-deploy-$TARGET.lock"
check "no run left unfinished by rejected attempts" bash -c "! grep -L -E '^STATE=(REJECTED|SUCCEEDED|ROLLED_BACK|ROLLBACK_DONE|ALREADY_CURRENT_DONE)\$' '$WORK'/journal/runs/*/state | grep -q ."

# caller-controlled arguments that try to forge JSON or journal lines (real script, real Docker state)
HOSTILE_SHA=$'abc"\nSTATE=SUCCEEDED\nDETAIL=forged'
HOSTILE_IMG=$'x"}\n{"status":"SUCCESS","exit":0}\\'
RC=0; OUT="$(BHA_DEPLOY_LOCK_DIR="$WORK/lock" "$DEPLOY" deploy --config "$CONF" --image "$REF_CAND" --source-sha "$HOSTILE_SHA" --manifest "$MAN" 2>>"$WORK/out/deploy.stderr")" || RC=$?
check "hostile --source-sha -> exit 20 SOURCE_SHA_MALFORMED, one valid JSON line, nothing reflected, old untouched" \
  bash -c "[[ $RC == 20 && '$(jf detail)' == SOURCE_SHA_MALFORMED && -z '$(jf source_sha)' ]]" ; old_untouched || bad "old untouched after hostile source sha"
RC=0; OUT="$(BHA_DEPLOY_LOCK_DIR="$WORK/lock" "$DEPLOY" deploy --config "$CONF" --image "$HOSTILE_IMG" --source-sha "$SHA" --manifest "$MAN" 2>>"$WORK/out/deploy.stderr")" || RC=$?
check "hostile --image -> exit 20 IMAGE_NOT_A_DIGEST_REFERENCE, one valid JSON line, nothing reflected" \
  bash -c "[[ $RC == 20 && '$(jf detail)' == IMAGE_NOT_A_DIGEST_REFERENCE && -z '$(jf image)' ]]"
check "journal after hostile arguments: strict key=value only, no injected or forged line" bash -c "! grep -rhv -E '^[A-Z_0-9]+=[A-Za-z0-9@:/._,+-]*\$' '$WORK'/journal/runs/*/state | grep -q . && ! grep -rq forged '$WORK/journal'"
run_deploy status
check "status after hostile arguments is exit 0 with nothing unfinished" test "$RC" = 0 -a -z "$(jf unfinished_run)"
check "old container untouched after the hostile arguments" old_untouched

say "== S3 real success: swap by digest"
DB1="$(db_hash)"
dargs "$REF_CAND"; run_deploy deploy "${DA[@]}"
NEW_CID="$(jf candidate_id)"
check "deploy -> exit 0 SUCCESS (status $(jf status) detail $(jf detail), downtime $(jf downtime_seconds)s)" test "$RC" = 0 -a "$(jf status)" = SUCCESS
DOWNTIME_S="$(jf downtime_seconds)"
check "the TARGET name now belongs to the new container, running, on the candidate image" bash -c "[[ \"$(cfmt "$TARGET" '{{.Id}}')\" == $NEW_CID && \"$(cfmt "$TARGET" '{{.State.Running}}')\" == true ]]"
check "new container runs exactly the digest-pulled image" test "$(cfmt "$NEW_CID" '{{.Config.Image}}')" = "$REF_CAND"
check "previous container retained: stopped, restart=no, renamed, same ID as before" bash -c "[[ \"$(cfmt "$OLD_CID" '{{.State.Running}}')\" == false && \"$(cfmt "$OLD_CID" '{{.HostConfig.RestartPolicy.Name}}')\" == no && \"$(cfmt "$OLD_CID" '{{.Name}}')\" == /${TARGET}-prev-* ]]"
check "original restart policy applied to the new container" test "$(cfmt "$NEW_CID" '{{.HostConfig.RestartPolicy.Name}}')" = unless-stopped
check "log driver/options preserved" test "$(cfmt "$NEW_CID" '{{.HostConfig.LogConfig.Type}}:{{index .HostConfig.LogConfig.Config "max-size"}}')" = "json-file:10m"
check "mounts preserved (keys rw, CA ro) and loopback binding preserved" bash -c "[[ \"$(cfmt "$NEW_CID" '{{range .Mounts}}{{.Destination}}={{.RW}} {{end}}')\" == *'/var/keys=true'* && \"$(cfmt "$NEW_CID" '{{range .Mounts}}{{.Destination}}={{.RW}} {{end}}')\" == *'/certs/rds-ca.pem=false'* && \"$(cfmt "$NEW_CID" '{{json .HostConfig.PortBindings}}')\" == *'127.0.0.1'* ]]"
check "every env-file line (dotted key, values with '=') is in the new container's env" env_matches "$NEW_CID"
check "existing key files preserved byte for byte" bash -c "[[ -z \"\$(comm -23 <(printf '%s\n' '$KEYS0') <(docker exec $NEW_CID find /var/keys -maxdepth 1 -type f -exec sha256sum {} + | sort))\" ]]"
check "env file and CA unchanged" test "$(sha256sum "$ENVF" | cut -d' ' -f1)" = "$ENV_SHA0" -a "$(sha256sum "$WORK/rds-ca.pem" | cut -d' ' -f1)" = "$CA_SHA0"
check "Staff session issued BEFORE the swap still reads /me = 200" test "$(me_code)" = 200
check "without the cookie /me = 401" test "$(curl_api -o /dev/null -w '%{http_code}' "https://localhost:$TLSPORT/api/admin/v1/me")" = 401
check "database identical after the deploy (no migration, no repair)" test "$(db_hash)" = "$DB1"
check "journal: run SUCCEEDED and latest record written" bash -c "grep -q '^STATE=SUCCEEDED' '$WORK/journal/runs/$(jf run_id)/state' && grep -q '^RECORD_STATE=SUCCEEDED' '$WORK/journal/records/latest'"
set_conf EXPECTED_CURRENT_IMAGE "$REF_CAND"     # the next release packet carries the new expected-current identity (CP03)

say "== S4 same release again: no bypass of the gates"
dargs "$REF_CAND"; run_deploy deploy "${DA[@]}"
check "same digest -> ALREADY_CURRENT after verification, container untouched" test "$RC" = 0 -a "$(jf status)" = ALREADY_CURRENT -a "$(cfmt "$TARGET" '{{.Id}}')" = "$NEW_CID"

say "== S5 explicit rollback from the protected record"
run_deploy rollback
check "rollback -> exit 0 ROLLED_BACK" test "$RC" = 0 -a "$(jf status)" = ROLLED_BACK
check "the ORIGINAL container (same ID) serves again under the target name with its original policy" bash -c "[[ \"$(cfmt "$TARGET" '{{.Id}}')\" == $OLD_CID && \"$(cfmt "$TARGET" '{{.State.Running}}')\" == true && \"$(cfmt "$OLD_CID" '{{.HostConfig.RestartPolicy.Name}}')\" == unless-stopped ]]"
check "the rolled-back release is stopped with restart=no and kept" bash -c "[[ \"$(cfmt "$NEW_CID" '{{.State.Running}}')\" == false && \"$(cfmt "$NEW_CID" '{{.HostConfig.RestartPolicy.Name}}')\" == no ]]"
check "Staff session still valid after the rollback" test "$(me_code)" = 200
check "database identical after the rollback (container rollback never touches it)" test "$(db_hash)" = "$DB1"
run_deploy rollback
check "second rollback is idempotent -> ALREADY_ROLLED_BACK exit 0" test "$RC" = 0 -a "$(jf status)" = ALREADY_ROLLED_BACK
set_conf EXPECTED_CURRENT_IMAGE "$REF_OLD"
OLD_STARTED="$(cfmt "$TARGET" '{{.State.StartedAt}}')"

say "== S6 real failure AFTER the stop (TEST_ONLY candidate that cannot start)"
dargs "$REF_FAULT"; run_deploy deploy "${DA[@]}"
check "failed candidate -> exit 30 DEPLOY_FAILED_ROLLED_BACK (never success): status=$(jf status) detail=$(jf detail)" test "$RC" = 30 -a "$(jf status)" = DEPLOY_FAILED_ROLLED_BACK
check "the original container serves again, verified, under the target name" bash -c "[[ \"$(cfmt "$TARGET" '{{.Id}}')\" == $OLD_CID && \"$(cfmt "$TARGET" '{{.State.Running}}')\" == true ]]"
check "restart policy restored on the original" test "$(cfmt "$OLD_CID" '{{.HostConfig.RestartPolicy.Name}}')" = unless-stopped
check "failed candidate kept stopped as evidence with restart=no (not removed)" bash -c "[[ \"$(cfmt "$(jf candidate_id)" '{{.State.Running}}')\" == false && \"$(cfmt "$(jf candidate_id)" '{{.HostConfig.RestartPolicy.Name}}')\" == no ]]"
check "Staff session valid after the failed deploy and rollback" test "$(me_code)" = 200
check "journal: ROLLED_BACK and nothing unfinished" bash -c "grep -q '^STATE=ROLLED_BACK' '$WORK/journal/runs/$(jf run_id)/state' && [[ -z \"\$(grep -L -E '^STATE=(REJECTED|SUCCEEDED|ROLLED_BACK|ROLLBACK_DONE|ALREADY_CURRENT_DONE)\$' '$WORK'/journal/runs/*/state)\" ]]"
run_deploy status
check "status reports a healthy, finished state (exit 0)" test "$RC" = 0

say "== S7 deploy succeeds again after a rolled-back failure"
dargs "$REF_CAND"; run_deploy deploy "${DA[@]}"
check "second successful deploy -> SUCCESS" test "$RC" = 0 -a "$(jf status)" = SUCCESS
check "Staff session valid after the second deploy" test "$(me_code)" = 200

say "== S8 secret canaries and result JSON"
check "every deploy/rollback/status/preflight result of this rehearsal was exactly one valid JSON line" test "$JSON_BAD" = 0
LEAK=0
for canary in "$PG_CANARY" "$STAFF_CANARY" "$SU_CANARY"; do
  if grep -rqF -- "$canary" "$WORK/out" "$WORK/journal" 2>/dev/null; then LEAK=1; fi
done
check "no canary in deploy stdout/stderr, harness log, journal, records or evidence" test "$LEAK" = 0

say "== summary  PASS=$PASS FAIL=$FAILS  postgres=$PGVER  downtime_seconds(first success)=$DOWNTIME_S"
{ echo "downtime_seconds=$DOWNTIME_S"; echo "pass=$PASS"; echo "fail=$FAILS"; } > "${REHEARSAL_SUMMARY:-/dev/null}"
[[ "$FAILS" -eq 0 ]]
