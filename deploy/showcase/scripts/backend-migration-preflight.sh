#!/usr/bin/env bash
# BHA-BACKEND-CD-001-CP02: READ-ONLY migration-history gate. It never migrates, never runs DDL, never seeds or repairs.
#
#   backend-migration-preflight.sh --service-file F --pass-file F --service NAME --expect-host H --expect-db D \
#       --expect-user U --ca-file F --ids FILE [--timeout SECONDS] [--evidence-dir DIR]
#
# --ids is the ordered expected migration list for the release (one ID per line, from backend-migration-manifest.py).
# The connection comes from a libpq service file + passfile (private, owned by the caller), always sslmode=verify-full
# against --ca-file, as the application identity. The session runs `BEGIN READ ONLY` and the script asserts, inside the
# session, the database, the session user, TLS and transaction_read_only before comparing the FULL ordered list of
# applied migration IDs with the expected list. Exact match is the only pass.
#
# This proves migration-history compatibility only; it cannot prove the absence of manual schema drift. A release that
# needs a schema change is refused here (PENDING_MIGRATIONS) until a separate Owner migration procedure has run.
#
# stdout: one JSON line {"gate":"migration-history","status":"PASS|FAIL","code":...,"expected":N,"applied":N}
# exit: 0 PASS; 10 usage/config; 11 psql missing; 20 history differs; 21 connection/TLS/permission/query failure;
#       22 identity (database/user/TLS/read-only) differs from the contract
# stderr (psql) is kept only in --evidence-dir (private) and is never printed.
set -euo pipefail

SERVICE_FILE="" PASS_FILE="" SERVICE="" EXPECT_HOST="" EXPECT_DB="" EXPECT_USER="" CA_FILE="" IDS="" TIMEOUT=30 EVIDENCE=""
while (( $# )); do
  case "$1" in
    --service-file) SERVICE_FILE="${2:-}"; shift 2 ;;
    --pass-file) PASS_FILE="${2:-}"; shift 2 ;;
    --service) SERVICE="${2:-}"; shift 2 ;;
    --expect-host) EXPECT_HOST="${2:-}"; shift 2 ;;
    --expect-db) EXPECT_DB="${2:-}"; shift 2 ;;
    --expect-user) EXPECT_USER="${2:-}"; shift 2 ;;
    --ca-file) CA_FILE="${2:-}"; shift 2 ;;
    --ids) IDS="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --evidence-dir) EVIDENCE="${2:-}"; shift 2 ;;
    *) echo "unknown argument" >&2; exit 10 ;;
  esac
done

EXPECTED_N=0
APPLIED_N=0
result() {  # result <PASS|FAIL> <code> <exit>
  printf '{"gate":"migration-history","status":"%s","code":"%s","expected":%s,"applied":%s}\n' "$1" "$2" "$EXPECTED_N" "$APPLIED_N"
  exit "$3"
}

for v in SERVICE_FILE PASS_FILE SERVICE EXPECT_HOST EXPECT_DB EXPECT_USER CA_FILE IDS; do
  [[ -n "${!v}" ]] || result FAIL "ARGUMENT_MISSING_$v" 10
done
[[ "$TIMEOUT" =~ ^[0-9]{1,3}$ && "$TIMEOUT" -ge 5 && "$TIMEOUT" -le 120 ]] || result FAIL TIMEOUT_OUT_OF_RANGE 10
[[ "$SERVICE" =~ ^[A-Za-z0-9_.-]{1,64}$ && "$EXPECT_DB" =~ ^[A-Za-z0-9_]{1,63}$ && "$EXPECT_USER" =~ ^[A-Za-z0-9_]{1,63}$ ]] || result FAIL ARGUMENT_SHAPE 10
[[ "$EXPECT_HOST" =~ ^[A-Za-z0-9.:-]{1,253}$ ]] || result FAIL ARGUMENT_SHAPE 10
PSQL="${PSQL_BIN:-$(command -v psql || true)}"
[[ -n "$PSQL" && -x "$PSQL" ]] || result FAIL PSQL_MISSING 11
command -v timeout >/dev/null || result FAIL TIMEOUT_TOOL_MISSING 11

private_file() {  # private_file <path>: regular, not a symlink, owned by the caller, no group/other access
  local mode
  [[ -f "$1" && ! -L "$1" && -O "$1" ]] || return 1
  mode="$(stat -c '%a' "$1")"
  (( (8#$mode & 8#077) == 0 ))
}
private_file "$SERVICE_FILE" || result FAIL SERVICE_FILE_NOT_PRIVATE 10
private_file "$PASS_FILE" || result FAIL PASS_FILE_NOT_PRIVATE 10
[[ -f "$CA_FILE" && ! -L "$CA_FILE" ]] || result FAIL CA_FILE_MISSING 10
[[ -f "$IDS" ]] || result FAIL IDS_MISSING 10
EXPECTED_N="$(grep -c . "$IDS" || true)"
[[ "$EXPECTED_N" -ge 1 ]] || result FAIL IDS_EMPTY 10
[[ "$(LC_ALL=C sort -u "$IDS" | diff -q - "$IDS" >/dev/null 2>&1; echo $?)" == 0 ]] || result FAIL IDS_NOT_SORTED_UNIQUE 10

# The named service must exist in THIS file and bind exactly the contract: libpq would otherwise fall back to other
# service files and to environment defaults.
in_section=false found=false
declare -A seen=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  if [[ "$line" =~ ^\[([^]]+)\]$ ]]; then
    if [[ "${BASH_REMATCH[1]}" == "$SERVICE" ]]; then
      $found && result FAIL SERVICE_DEFINED_TWICE 10
      in_section=true found=true
    else
      in_section=false
    fi
    continue
  fi
  $in_section || continue
  [[ "$line" =~ ^([a-z_]+)=(.*)$ ]] || result FAIL SERVICE_LINE_MALFORMED 10
  key="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
  [[ -z "${seen[$key]:-}" ]] || result FAIL SERVICE_KEY_REPEATED 10
  seen[$key]=1
  case "$key" in
    host) [[ "$value" == "$EXPECT_HOST" ]] || result FAIL SERVICE_HOST_DIFFERS 10 ;;
    dbname) [[ "$value" == "$EXPECT_DB" ]] || result FAIL SERVICE_DATABASE_DIFFERS 10 ;;
    user) [[ "$value" == "$EXPECT_USER" ]] || result FAIL SERVICE_USER_DIFFERS 10 ;;
    sslmode) [[ "$value" == "verify-full" ]] || result FAIL SERVICE_SSLMODE_NOT_VERIFY_FULL 10 ;;
    sslrootcert) [[ "$value" == "$CA_FILE" ]] || result FAIL SERVICE_CA_DIFFERS 10 ;;
    port) [[ "$value" =~ ^[0-9]{1,5}$ ]] || result FAIL SERVICE_PORT_MALFORMED 10 ;;
    *) result FAIL "SERVICE_KEY_NOT_ALLOWED" 10 ;;
  esac
done < "$SERVICE_FILE"
$found || result FAIL SERVICE_NOT_IN_FILE 10
for k in host dbname user sslmode sslrootcert; do [[ -n "${seen[$k]:-}" ]] || result FAIL "SERVICE_KEY_MISSING_$k" 10; done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"
mkdir "$TMP/sysconf"
cat > "$TMP/history.sql" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '5s';
SELECT 'identity|' || current_database() || '|' || session_user || '|'
    || coalesce((SELECT ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()), 'null') || '|'
    || current_setting('transaction_read_only');
SELECT to_regclass('public."__EFMigrationsHistory"') IS NOT NULL AS has_history \gset
SELECT 'history|' || :'has_history';
\if :has_history
SELECT 'id|' || "MigrationId" FROM public."__EFMigrationsHistory" ORDER BY "MigrationId" COLLATE "C";
\endif
COMMIT;
SQL

set +e
env -i PATH="$PATH" ${LD_LIBRARY_PATH:+LD_LIBRARY_PATH="$LD_LIBRARY_PATH"} HOME="$TMP" LC_ALL=C PGSYSCONFDIR="$TMP/sysconf" \
  PGSERVICEFILE="$SERVICE_FILE" PGSERVICE="$SERVICE" PGPASSFILE="$PASS_FILE" PGCONNECT_TIMEOUT=10 PGAPPNAME=bha-deploy-preflight \
  PGOPTIONS="-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=20000" \
  timeout "$TIMEOUT" "$PSQL" -X -w -q -At -v ON_ERROR_STOP=1 -f "$TMP/history.sql" > "$TMP/out" 2> "$TMP/err"
rc=$?
set -e
if [[ -n "$EVIDENCE" && -d "$EVIDENCE" ]]; then
  ( umask 077; cp "$TMP/err" "$EVIDENCE/psql-preflight.stderr" )   # private; never echoed
fi
if (( rc != 0 )); then
  code=QUERY_FAILED
  if (( rc == 124 )); then code=TIMEOUT
  elif grep -qiE 'permission denied' "$TMP/err"; then code=PERMISSION_DENIED
  elif grep -qiE 'certificate|SSL|TLS' "$TMP/err"; then code=TLS_FAILURE
  elif grep -qiE 'could not (connect|translate)|connection (refused|timed out)|password authentication|no pg_hba|Connection to server' "$TMP/err"; then code=CONNECTION_FAILED
  elif grep -qiE 'canceling statement|timeout' "$TMP/err"; then code=TIMEOUT
  fi
  result FAIL "$code" 21
fi

identity="$(grep -m1 '^identity|' "$TMP/out" || true)"
[[ "$identity" == "identity|$EXPECT_DB|$EXPECT_USER|true|on" ]] || result FAIL IDENTITY_DIFFERS_FROM_CONTRACT 22
grep -q '^history|t$' "$TMP/out" || result FAIL HISTORY_TABLE_MISSING 20
sed -n 's/^id|//p' "$TMP/out" > "$TMP/applied"
APPLIED_N="$(grep -c . "$TMP/applied" || true)"
if cmp -s "$TMP/applied" "$IDS"; then
  result PASS EXACT_MATCH 0
fi
LC_ALL=C sort "$TMP/applied" > "$TMP/applied.sorted"   # comm needs sorted input even if the server ever returned another order
pending="$(LC_ALL=C comm -23 "$IDS" "$TMP/applied.sorted" | grep -c . || true)"
extra="$(LC_ALL=C comm -13 "$IDS" "$TMP/applied.sorted" | grep -c . || true)"
if (( pending > 0 && extra > 0 )); then result FAIL PENDING_AND_UNKNOWN_MIGRATIONS 20
elif (( pending > 0 )); then result FAIL PENDING_MIGRATIONS 20
elif (( extra > 0 )); then result FAIL UNKNOWN_APPLIED_MIGRATIONS 20
fi
result FAIL ORDER_DIFFERS 20
