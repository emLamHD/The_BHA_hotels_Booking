#!/usr/bin/env bash
# BHA-BACKEND-CD-001-CP03: host-side release wrapper. Downloaded by the SSM bootstrap at the immutable SHA and verified against
# the hash the runner sent; it reuses the CP02 engine (backend-deploy.sh) and does not reimplement its state machine.
#
#   backend-remote-release.sh <deploy|rollback|recover> --packet F --stage DIR --host-config F --correlation HEX32 --region R
#
# It adds, around the engine: an outer per-target release lock (a different lock from the engine's), ECR pull login with the
# instance profile (never with the runner's OIDC credentials), a watchdog, and ownership of EXPECTED_CURRENT_IMAGE: that
# field of the private host config is advanced only after the actual container (ID, image ID, RepoDigest, revision label, engine
# record) was reconciled, by an atomic replacement of that one line, and never guessed after a crash (release-state PENDING).
#
# stdout: exactly one JSON line (written to fd 3); everything else goes to a private log in the journal directory; stderr carries
# short codes only. Exit 0 only for a release outcome the caller accepts.
#
# Test-only switches, honoured only because they can only RELAX toward loopback / a non-root test user:
#   BHA_RELEASE_LOCK_DIR (default /run/lock), BHA_RELEASE_LOCK_WAIT (seconds, at most 30), BHA_RELEASE_ALLOW_LOOPBACK_REGISTRY=1 (accept 127.0.0.1:PORT as the registry).
# shellcheck disable=SC2015  # `A && B || fail` is the gate idiom used throughout
set -euo pipefail
umask 077
export LC_ALL=C
exec 3>&1 4>&2

ACTION="${1:-}"; shift || true
PACKET="" STAGE="" HOST_CONFIG="" CORR="" REGION=""
SOURCE_SHA="" IMAGE="" REPO_SLUG="" TARGET="" ALLOWED_REPO="" EXPECTED_REF="" JOURNAL="" PORT="" SOURCE_URL=""
RELEASE="" DETAIL="" ENGINE_STATUS="" ENGINE_EXIT=0 RUN_ID="" DOWNTIME=0 STATE_SYNC=NOT_NEEDED REVERIFIED=false CLEANUP=NOT_RUN
declare -A ST=()
LOG=""

# ----------------------------------------------------------------------------------------------- embedded JSON/file tool
read -r -d '' TOOL <<'PY' || true
import hashlib, json, os, re, sys

def die(code):
    sys.stderr.write(code + "\n"); sys.exit(1)

def kv_lines(path, allowed=None, allow_missing=False):
    if not os.path.exists(path):
        if allow_missing: return {}
        die("FILE_MISSING")
    out = {}
    for line in open(path, encoding="utf-8").read().split("\n"):
        if not line or line.startswith("#"): continue
        m = re.match(r"^([A-Z_0-9]+)=(.*)$", line)
        if not m or (allowed is not None and m.group(1) not in allowed) or m.group(1) in out: die("FILE_MALFORMED")
        out[m.group(1)] = m.group(2)
    return out

def atomic_write(path, text, expect_sha=None):
    d = os.path.dirname(path)
    tmp = os.path.join(d, ".%s.%d.tmp" % (os.path.basename(path), os.getpid()))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as h:
            h.write(text); h.flush(); os.fsync(h.fileno())
        if expect_sha is not None and os.path.exists(path) and hashlib.sha256(open(path, "rb").read()).hexdigest() != expect_sha:
            die("CONCURRENT_MODIFICATION")
        os.replace(tmp, path)
    except BaseException:
        try: os.unlink(tmp)
        except OSError: pass
        raise
    dfd = os.open(d, os.O_RDONLY)
    try: os.fsync(dfd)
    finally: os.close(dfd)

cmd = sys.argv[1]
if cmd == "packet":
    doc = json.load(open(sys.argv[2]))
    ok = (doc.get("format") == 1 and re.match(r"^[0-9a-f]{40}$", doc.get("source_sha", "")) and re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", doc.get("repository", ""))
          and re.match(r"^([A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64})?$", doc.get("image", "")) and isinstance(doc.get("manifest"), dict))
    if not ok: die("PACKET_INVALID")
    with open(sys.argv[3], "w") as h: json.dump(doc["manifest"], h)
    print("SOURCE_SHA=" + doc["source_sha"]); print("IMAGE=" + doc["image"]); print("REPO_SLUG=" + doc["repository"])
elif cmd == "config-get":
    cfg = kv_lines(sys.argv[2])
    for k in sys.argv[3:]:
        if k not in cfg: die("CONFIG_KEY_MISSING")
        if not re.match(r"^[A-Za-z0-9._:/@+-]*$", cfg[k]): die("CONFIG_VALUE_CHARSET")
        print("%s=%s" % (k, cfg[k]))
elif cmd == "config-set-expected":
    path, old, new = sys.argv[2:5]
    raw = open(path, "rb").read()
    sha = hashlib.sha256(raw).hexdigest()
    lines = raw.decode("utf-8").split("\n")
    idx = [i for i, l in enumerate(lines) if l.startswith("EXPECTED_CURRENT_IMAGE=")]
    if len(idx) != 1: die("EXPECTED_CURRENT_IMAGE_LINE")
    if lines[idx[0]] != "EXPECTED_CURRENT_IMAGE=" + old: die("EXPECTED_CURRENT_CHANGED")
    if not re.match(r"^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$", new): die("NEW_REF_GRAMMAR")
    lines[idx[0]] = "EXPECTED_CURRENT_IMAGE=" + new
    atomic_write(path, "\n".join(lines), expect_sha=sha)
elif cmd == "state-read":
    for k, v in kv_lines(sys.argv[2], {"CURRENT_IMAGE", "PREVIOUS_IMAGE", "PENDING", "LAST_CORRELATION"}, allow_missing=True).items(): print("%s=%s" % (k, v))
elif cmd == "state-write":
    path = sys.argv[2]
    cur = kv_lines(path, {"CURRENT_IMAGE", "PREVIOUS_IMAGE", "PENDING", "LAST_CORRELATION"}, allow_missing=True)
    for a in sys.argv[3:]:
        k, _, v = a.partition("=")
        if k not in ("CURRENT_IMAGE", "PREVIOUS_IMAGE", "PENDING", "LAST_CORRELATION") or not re.match(r"^[A-Za-z0-9._:/@+|-]*$", v): die("STATE_FIELD")
        cur[k] = v
    atomic_write(path, "".join("%s=%s\n" % kv for kv in sorted(cur.items())))
elif cmd == "container":
    d = json.load(sys.stdin)
    if not isinstance(d, list) or len(d) != 1: die("INSPECT_SHAPE")
    c = d[0]
    labels = (c.get("Config") or {}).get("Labels") or {}
    print("CID=%s" % c["Id"]); print("CIMAGE=%s" % c["Image"]); print("RUNNING=%s" % ("true" if (c.get("State") or {}).get("Running") is True else "false"))
elif cmd == "image":
    d = json.load(sys.stdin)
    i = d[0]
    labels = (i.get("Config") or {}).get("Labels") or {}
    print("IID=%s" % i["Id"]); print("REVISION=%s" % labels.get("org.opencontainers.image.revision", ""))
    print("DIGESTS=%s" % ",".join(i.get("RepoDigests") or []))
elif cmd == "record":
    r = kv_lines(sys.argv[2])
    for k in ("RECORD_STATE", "CAND_ID", "CAND_IMAGE_ID", "OLD_ID", "OLD_IMAGE_ID", "SOURCE_SHA", "RECORD_RUN_ID"):
        print("%s=%s" % (k, r.get(k, "")))
elif cmd == "engine-result":
    try:
        d = json.loads(sys.argv[2])
    except ValueError:
        die("ENGINE_NOT_JSON")
    need = ("status", "detail", "exit", "run_id", "downtime_seconds", "candidate_id", "previous_id")
    if not isinstance(d, dict) or any(k not in d for k in need) or not isinstance(d["exit"], int) or isinstance(d["exit"], bool) \
            or not isinstance(d["downtime_seconds"], int) or isinstance(d["downtime_seconds"], bool): die("ENGINE_SCHEMA")
    for k in ("status", "detail", "run_id", "candidate_id", "previous_id"):
        if not isinstance(d[k], str) or not re.match(r"^[A-Za-z0-9_.:,-]{0,200}$", d[k]): die("ENGINE_CHARSET")
    for k in need: print("ENG_%s=%s" % (k.upper(), d[k]))
elif cmd == "result":
    (corr, action, sha, image, target, release, detail, estatus, eexit, run_id, down, sync, rever, cleanup) = sys.argv[2:16]
    san = lambda s: re.sub(r"[^A-Za-z0-9_.:,-]", "_", s)[:200]
    sys.stdout.write(json.dumps({"v": 1, "correlation": corr, "command": action, "source_sha": sha, "image": image, "target": san(target), "release": release,
        "detail": san(detail), "engine_status": san(estatus), "engine_exit": int(eexit), "run_id": san(run_id), "downtime_seconds": int(down),
        "state_sync": sync, "reverified": rever == "true", "cleanup": cleanup}, ensure_ascii=True, separators=(",", ":")) + "\n")
else:
    die("UNKNOWN_TOOL_COMMAND")
PY
tool() { python3 -I -c "$TOOL" "$@"; }

# ----------------------------------------------------------------------------------------------- result and exit
finish() {  # finish <RELEASE> <DETAIL>; prints the single JSON line to fd 3 and exits
  RELEASE="$1" DETAIL="$2"
  local code=1
  case "$RELEASE" in SUCCESS|ALREADY_CURRENT|ROLLED_BACK|ALREADY_ROLLED_BACK|RECOVERED) code=0 ;; esac
  [[ "$CLEANUP" == FAILED || "$STATE_SYNC" == FAILED ]] && code=1
  cleanup_stage || CLEANUP=FAILED
  [[ "$CLEANUP" == FAILED && "$code" == 0 ]] && code=1
  [[ "$code" == 0 && "$REVERIFIED" != true ]] && code=1
  tool result "${CORR:-}" "${ACTION:-}" "${SOURCE_SHA:-}" "${IMAGE:-}" "${TARGET:-}" "$RELEASE" "$DETAIL" "${ENGINE_STATUS:-}" "${ENGINE_EXIT:-0}" "${RUN_ID:-}" "${DOWNTIME:-0}" \
    "$STATE_SYNC" "$REVERIFIED" "$CLEANUP" >&3 2>/dev/null || printf '{"v":1,"correlation":"%s","release":"BOOTSTRAP_FAILED","detail":"RESULT_SERIALIZER"}\n' "${CORR:-}" >&3
  exit "$code"
}
cleanup_stage() {  # exact names inside the staging directory of this correlation; no wildcard
  local f ok=0
  [[ -n "$STAGE" && -d "$STAGE" && ! -L "$STAGE" && -O "$STAGE" && "$STAGE" == */"$CORR" ]] || return 0
  rm -rf -- "$STAGE/docker" || ok=1
  for f in packet.json manifest.json files.list bin/backend-remote-release.sh bin/backend-deploy.sh bin/backend-migration-preflight.sh bin/backend-migration-manifest.py engine.out; do
    rm -f -- "$STAGE/$f" || ok=1
  done
  rmdir -- "$STAGE/bin" "$STAGE" 2>/dev/null || ok=1
  return "$ok"
}
on_error() { local rc=$?; trap - EXIT; [[ -z "$RELEASE" ]] && { exec 1>&3 2>&4; RELEASE=UNEXPECTED; STATE_SYNC="${STATE_SYNC:-NOT_NEEDED}"; finish ENGINE_RESULT_INVALID "WRAPPER_ERROR_$rc"; }; exit "$rc"; }
trap on_error EXIT

fail_early() { finish "$1" "$2"; }

# ----------------------------------------------------------------------------------------------- arguments, packet, config
case "$ACTION" in deploy|rollback|recover) ;; *) fail_early PACKET_INVALID USAGE ;; esac
while (( $# )); do
  (( $# >= 2 )) || fail_early PACKET_INVALID ARGUMENT_VALUE_MISSING
  case "$1" in
    --packet) PACKET="$2" ;; --stage) STAGE="$2" ;; --host-config) HOST_CONFIG="$2" ;; --correlation) CORR="$2" ;; --region) REGION="$2" ;;
    *) fail_early PACKET_INVALID UNKNOWN_ARGUMENT ;;
  esac
  shift 2
done
[[ "$CORR" =~ ^[0-9a-f]{32}$ && "$REGION" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || fail_early PACKET_INVALID ARGUMENT_GRAMMAR
[[ "$HOST_CONFIG" =~ ^/[A-Za-z0-9_./+-]+$ && "$HOST_CONFIG" != *..* && "$PACKET" =~ ^/[A-Za-z0-9_./+-]+$ && "$STAGE" =~ ^/[A-Za-z0-9_./+-]+/[0-9a-f]{32}$ ]] || fail_early PACKET_INVALID PATH_GRAMMAR
while IFS='=' read -r k v; do
  case "$k" in SOURCE_SHA) SOURCE_SHA="$v" ;; IMAGE) IMAGE="$v" ;; REPO_SLUG) REPO_SLUG="$v" ;; esac
done < <(tool packet "$PACKET" "$STAGE/manifest.json" 2>/dev/null || echo "BAD=1")
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail_early PACKET_INVALID PACKET_FIELDS
[[ "$ACTION" != deploy || -n "$IMAGE" ]] || fail_early PACKET_INVALID DEPLOY_WITHOUT_IMAGE

[[ -f "$HOST_CONFIG" && ! -L "$HOST_CONFIG" && -O "$HOST_CONFIG" ]] && (( (8#$(stat -c '%a' "$HOST_CONFIG") & 8#077) == 0 )) || fail_early STATE_RECONCILE_REQUIRED HOST_CONFIG_NOT_PRIVATE
while IFS='=' read -r k v; do
  case "$k" in TARGET_CONTAINER) TARGET="$v" ;; ALLOWED_IMAGE_REPOSITORY) ALLOWED_REPO="$v" ;; EXPECTED_CURRENT_IMAGE) EXPECTED_REF="$v" ;; JOURNAL_DIR) JOURNAL="$v" ;;
    LOOPBACK_PORT) PORT="$v" ;; EXPECTED_SOURCE_URL) SOURCE_URL="$v" ;; esac
done < <(tool config-get "$HOST_CONFIG" TARGET_CONTAINER ALLOWED_IMAGE_REPOSITORY EXPECTED_CURRENT_IMAGE JOURNAL_DIR LOOPBACK_PORT EXPECTED_SOURCE_URL 2>/dev/null || echo "BAD=1")
[[ "$TARGET" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$ && "$JOURNAL" =~ ^/[A-Za-z0-9_./+-]+$ && "$PORT" =~ ^[0-9]{4,5}$ && -d "$JOURNAL" ]] || fail_early CONFIG_INVALID HOST_CONFIG_FIELDS
[[ "$SOURCE_URL" == "https://github.com/$REPO_SLUG" ]] || fail_early CONFIG_INVALID REPOSITORY_URL_DIFFERS_FROM_PACKET
mkdir -p "$JOURNAL/release-logs"
LOG="$JOURNAL/release-logs/$CORR.log"
exec 1>>"$LOG" 2>>"$LOG"                # raw subprocess output stays in a private file on the host

# ----------------------------------------------------------------------------------------------- outer release lock
LOCK="${BHA_RELEASE_LOCK_DIR:-/run/lock}/bha-release-$TARGET.lock"        # not the engine's bha-deploy-<target>.lock
{ exec 8>>"$LOCK"; } 2>/dev/null || finish PREREQUISITE_MISSING RELEASE_LOCK_UNWRITABLE
LOCK_WAIT="${BHA_RELEASE_LOCK_WAIT:-30}"
[[ "$LOCK_WAIT" =~ ^[0-9]{1,2}$ && "$LOCK_WAIT" -le 30 ]] || LOCK_WAIT=30
flock -w "$LOCK_WAIT" 8 || finish LOCK_BUSY ANOTHER_RELEASE_WRAPPER_HOLDS_THE_RELEASE_LOCK
STATE_FILE="$JOURNAL/release-state"

# ----------------------------------------------------------------------------------------------- docker views (names only on stderr)
cinfo() {  # sets CID CIMAGE RUNNING of the target container; returns 1 if there is none
  local out; CID="" CIMAGE="" RUNNING=false
  out="$(timeout 30 docker container inspect "$TARGET" 2>/dev/null | tool container 2>/dev/null)" || return 1
  while IFS='=' read -r k v; do case "$k" in CID) CID="$v" ;; CIMAGE) CIMAGE="$v" ;; RUNNING) RUNNING="$v" ;; esac; done <<< "$out"
  [[ "$CID" =~ ^[0-9a-f]{64}$ ]]
}
iinfo() {  # iinfo <ref> sets IID REVISION DIGESTS; returns 1 if the image is not present locally
  local out; IID="" REVISION="" DIGESTS=""
  out="$(timeout 30 docker image inspect "$1" 2>/dev/null | tool image 2>/dev/null)" || return 1
  while IFS='=' read -r k v; do case "$k" in IID) IID="$v" ;; REVISION) REVISION="$v" ;; DIGESTS) DIGESTS="$v" ;; esac; done <<< "$out"
  [[ "$IID" =~ ^sha256:[0-9a-f]{64}$ ]]
}
read_state() { ST=(); local k v; while IFS='=' read -r k v; do [[ -n "$k" ]] && ST[$k]="$v"; done < <(tool state-read "$STATE_FILE" 2>/dev/null || echo "BAD=1"); [[ -z "${ST[BAD]:-}" ]]; }
write_state() { tool state-write "$STATE_FILE" "$@" "LAST_CORRELATION=$CORR" 2>/dev/null; }
set_expected() { tool config-set-expected "$HOST_CONFIG" "$1" "$2" 2>/dev/null; }          # old, new
read_record() {  # sets REC_* from the engine's latest record
  REC_RECORD_STATE="" REC_CAND_ID="" REC_OLD_IMAGE_ID="" REC_SOURCE_SHA=""
  local k v
  while IFS='=' read -r k v; do case "$k" in RECORD_STATE|CAND_ID|OLD_IMAGE_ID|SOURCE_SHA) printf -v "REC_$k" '%s' "$v" ;; esac; done < <(tool record "$JOURNAL/records/latest" 2>/dev/null || echo "BAD=1")
}
ready_ok() {  # the service answers /health/ready with 200 and Healthy a few times in a row, bounded
  local body
  for _ in 1 2 3 4 5 6; do
    body="$(curl -sS --noproxy '*' --max-time 5 -w '%{http_code}' -o /dev/stdout "http://127.0.0.1:$PORT/health/ready" 2>/dev/null || true)"
    [[ "$body" == "Healthy200" ]] && return 0
    sleep 1
  done
  return 1
}

# ----------------------------------------------------------------------------------------------- reconciliation of EXPECTED_CURRENT_IMAGE
CUR_REF=""
reconcile() {
  local from to kind pend id_from id_to
  read_state || finish STATE_RECONCILE_REQUIRED RELEASE_STATE_UNREADABLE
  cinfo || { [[ "$ACTION" == recover ]] || finish STATE_RECONCILE_REQUIRED TARGET_CONTAINER_MISSING; }
  if [[ -z "${ST[CURRENT_IMAGE]:-}" && -z "${ST[PENDING]:-}" ]]; then                   # first run: the Owner-verified bootstrap digest
    iinfo "$EXPECTED_REF" || finish STATE_RECONCILE_REQUIRED EXPECTED_IMAGE_NOT_PRESENT
    [[ "$ACTION" == recover || ( "$RUNNING" == true && "$CIMAGE" == "$IID" ) ]] || finish STATE_RECONCILE_REQUIRED RUNNING_IMAGE_IS_NOT_THE_BOOTSTRAP_DIGEST
    write_state "CURRENT_IMAGE=$EXPECTED_REF" "PREVIOUS_IMAGE=" "PENDING=" || finish STATE_RECONCILE_REQUIRED STATE_WRITE_FAILED
    CUR_REF="$EXPECTED_REF"; return 0
  fi
  pend="${ST[PENDING]:-}"
  if [[ -n "$pend" ]]; then                                                             # a previous wrapper stopped between engine, record and metadata
    IFS='|' read -r kind _ from to <<< "$pend"
    iinfo "$from" && id_from="$IID" || id_from=""
    iinfo "$to" && id_to="$IID" || id_to=""
    if [[ -n "$id_to" && "$RUNNING" == true && "$CIMAGE" == "$id_to" && "$kind" == deploy ]]; then
      read_record
      [[ "$REC_RECORD_STATE" == SUCCEEDED && "$REC_CAND_ID" == "$CID" ]] || finish STATE_RECONCILE_REQUIRED PENDING_DEPLOY_WITHOUT_MATCHING_RECORD
      if [[ "$EXPECTED_REF" != "$to" ]]; then set_expected "$EXPECTED_REF" "$to" || finish STATE_SYNC_FAILED CONFIG_SYNC_FAILED_SERVICE_RUNS_THE_PENDING_RELEASE; EXPECTED_REF="$to"; fi
      write_state "CURRENT_IMAGE=$to" "PREVIOUS_IMAGE=$from" "PENDING=" || finish STATE_RECONCILE_REQUIRED STATE_WRITE_FAILED
      CUR_REF="$to"
    elif [[ -n "$id_from" && "$RUNNING" == true && "$CIMAGE" == "$id_from" && "$EXPECTED_REF" == "$from" ]]; then
      write_state "CURRENT_IMAGE=$from" "PENDING=" || finish STATE_RECONCILE_REQUIRED STATE_WRITE_FAILED
      CUR_REF="$from"
    elif [[ "$ACTION" == recover ]]; then
      CUR_REF=""
    else
      finish STATE_RECONCILE_REQUIRED PENDING_STATE_DISAGREES_WITH_THE_RUNNING_CONTAINER
    fi
    return 0
  fi
  [[ "$EXPECTED_REF" == "${ST[CURRENT_IMAGE]:-}" ]] || finish STATE_RECONCILE_REQUIRED HOST_CONFIG_DISAGREES_WITH_RELEASE_STATE
  iinfo "$EXPECTED_REF" || finish STATE_RECONCILE_REQUIRED EXPECTED_IMAGE_NOT_PRESENT
  [[ "$ACTION" == recover || ( "$RUNNING" == true && "$CIMAGE" == "$IID" ) ]] || finish STATE_RECONCILE_REQUIRED RUNNING_CONTAINER_IS_NOT_THE_EXPECTED_IMAGE
  CUR_REF="$EXPECTED_REF"
}
pending_set() { write_state "PENDING=$1|$CORR|$2|$3" || finish STATE_RECONCILE_REQUIRED STATE_WRITE_FAILED; }   
pending_clear() { write_state "PENDING=" || return 1; }

# ----------------------------------------------------------------------------------------------- registry login (instance profile)
login_registry() {
  local registry="${IMAGE%%/*}"
  [[ "$IMAGE" == "$ALLOWED_REPO"@* ]] || finish REGISTRY_LOGIN_FAILED IMAGE_REPOSITORY_NOT_THE_CONFIGURED_ONE
  if [[ "$registry" =~ ^[0-9]{12}\.dkr\.ecr\.${REGION}\.amazonaws\.com$ ]]; then :
  elif [[ "${BHA_RELEASE_ALLOW_LOOPBACK_REGISTRY:-}" == 1 && "$registry" =~ ^127\.0\.0\.1:[0-9]{2,5}$ ]]; then :
  else finish REGISTRY_LOGIN_FAILED REGISTRY_NOT_THE_ECR_REGISTRY_OF_THE_REGION; fi
  mkdir -p "$STAGE/docker"; chmod 700 "$STAGE/docker"
  export DOCKER_CONFIG="$STAGE/docker"        # credentials live in this private directory and are deleted with the stage
  { aws ecr get-login-password --region "$REGION" | timeout 60 docker login --username AWS --password-stdin "$registry"; } >/dev/null 2>&1 \
    || finish REGISTRY_LOGIN_FAILED ECR_LOGIN_FAILED
}

# ----------------------------------------------------------------------------------------------- the engine
ENGINE="$STAGE/bin/backend-deploy.sh"
run_engine() {  # run_engine <deploy|rollback|recover>; fills ENGINE_* from the engine's one JSON line
  local out rc=0 args=("$1" --config "$HOST_CONFIG")
  [[ "$1" == deploy ]] && args+=(--image "$IMAGE" --source-sha "$SOURCE_SHA" --manifest "$STAGE/manifest.json")
  [[ -x "$ENGINE" ]] || finish PACKET_INVALID ENGINE_NOT_STAGED
  # --preserve-status: when the watchdog sends TERM the engine restores the previous container and exits with ITS code (and its
  # JSON line); only a KILL after the 300 s grace leaves no result
  out="$(timeout --preserve-status -s TERM -k 300 900 "$ENGINE" "${args[@]}" 2>>"$LOG")" || rc=$?
  printf '%s\n' "$out" > "$STAGE/engine.out"
  if (( rc == 137 || rc == 143 )) && [[ -z "$out" ]]; then ENGINE_STATUS=WATCHDOG; ENGINE_EXIT=$rc; finish ENGINE_TIMEOUT WATCHDOG_EXPIRED_ENGINE_STOPPED_BY_SIGNAL; fi
  local k v
  while IFS='=' read -r k v; do
    case "$k" in ENG_STATUS) ENGINE_STATUS="$v" ;; ENG_DETAIL) DETAIL="$v" ;; ENG_EXIT) ENGINE_EXIT="$v" ;; ENG_RUN_ID) RUN_ID="$v" ;; ENG_DOWNTIME_SECONDS) DOWNTIME="$v" ;; esac
  done < <(tool engine-result "$out" 2>/dev/null || echo "BAD=1")
  [[ -n "$ENGINE_STATUS" && "$ENGINE_EXIT" == "$rc" ]] || { ENGINE_STATUS=INVALID; ENGINE_EXIT=$rc; finish ENGINE_RESULT_INVALID ENGINE_OUTPUT_UNREADABLE_OR_EXIT_CODE_MISMATCH; }
  [[ "$DETAIL" == *__EVIDENCE_CLEANUP_FAILED ]] && CLEANUP=FAILED || CLEANUP=OK
}

verify_serving() {  # verify_serving <ref> <deploy|none>: the running target container is this image (deploy: also its RepoDigest and revision label)
  cinfo && [[ "$RUNNING" == true ]] || return 1
  iinfo "$1" || return 1
  [[ "$CIMAGE" == "$IID" ]] || return 1
  [[ "$2" != deploy ]] || [[ ",$DIGESTS," == *",$1,"* && "$REVISION" == "$SOURCE_SHA" ]] || return 1
  return 0
}

commit_deploy() {  # after a SUCCESS/ALREADY_CURRENT engine outcome
  read_record
  if [[ "$ENGINE_STATUS" == SUCCESS ]]; then
    [[ "$REC_RECORD_STATE" == SUCCEEDED && "$REC_SOURCE_SHA" == "$SOURCE_SHA" ]] || { STATE_SYNC=FAILED; finish STATE_SYNC_FAILED RECORD_DOES_NOT_MATCH_THE_RELEASE; }
  fi
  verify_serving "$IMAGE" deploy || { STATE_SYNC=FAILED; finish STATE_RECONCILE_REQUIRED RUNNING_CONTAINER_IS_NOT_THE_RELEASED_IMAGE; }
  [[ "$ENGINE_STATUS" != SUCCESS || "$REC_CAND_ID" == "$CID" ]] || { STATE_SYNC=FAILED; finish STATE_RECONCILE_REQUIRED RECORD_CONTAINER_IS_NOT_THE_RUNNING_ONE; }
  if [[ "$EXPECTED_REF" != "$IMAGE" ]]; then
    set_expected "$EXPECTED_REF" "$IMAGE" || { STATE_SYNC=FAILED; finish STATE_SYNC_FAILED HOST_CONFIG_NOT_UPDATED_SERVICE_RUNS_NEW_RELEASE; }
  fi
  local prev="$CUR_REF"
  [[ "$ENGINE_STATUS" != ALREADY_CURRENT ]] || prev="${ST[PREVIOUS_IMAGE]:-}"
  write_state "CURRENT_IMAGE=$IMAGE" "PREVIOUS_IMAGE=$prev" "PENDING=" || { STATE_SYNC=FAILED; finish STATE_SYNC_FAILED RELEASE_STATE_NOT_UPDATED_SERVICE_RUNS_NEW_RELEASE; }
  STATE_SYNC=OK
}

# ----------------------------------------------------------------------------------------------- main
reconcile
read_state || finish STATE_RECONCILE_REQUIRED RELEASE_STATE_UNREADABLE      # reconcile may have rewritten it: work from what is on disk now
case "$ACTION" in
  deploy)
    login_registry
    pending_set deploy "$CUR_REF" "$IMAGE"
    run_engine deploy
    case "$ENGINE_STATUS" in
      SUCCESS|ALREADY_CURRENT)
        commit_deploy
        ready_ok && REVERIFIED=true || REVERIFIED=false
        finish "$ENGINE_STATUS" "$DETAIL" ;;
      DEPLOY_FAILED_ROLLED_BACK|REJECTED_BEFORE_STOP|LOCK_BUSY|CONFIG_INVALID|PREREQUISITE_MISSING)
        # the previous release must still be the one serving; only then is the intent cleared
        if verify_serving "$CUR_REF" none && pending_clear; then STATE_SYNC=NOT_NEEDED; ready_ok && REVERIFIED=true; else STATE_SYNC=FAILED; fi
        case "$ENGINE_STATUS" in DEPLOY_FAILED_ROLLED_BACK) finish FAILED_ROLLED_BACK "$DETAIL" ;; REJECTED_BEFORE_STOP) finish REJECTED "$DETAIL" ;;
          LOCK_BUSY) finish LOCK_BUSY "$DETAIL" ;; CONFIG_INVALID) finish CONFIG_INVALID "$DETAIL" ;; *) finish PREREQUISITE_MISSING "$DETAIL" ;; esac ;;
      ROLLBACK_FAILED) STATE_SYNC=NOT_NEEDED; finish ROLLBACK_FAILED "$DETAIL" ;;
      INTERRUPTED_STATE) STATE_SYNC=NOT_NEEDED; finish INTERRUPTED_STATE "$DETAIL" ;;
      *) finish ENGINE_RESULT_INVALID "ENGINE_STATUS_UNEXPECTED" ;;
    esac ;;
  rollback)
    [[ -n "${ST[PREVIOUS_IMAGE]:-}" ]] || finish STATE_RECONCILE_REQUIRED NO_PREVIOUS_RELEASE_RECORDED
    PREV_REF="${ST[PREVIOUS_IMAGE]}"
    pending_set rollback "$CUR_REF" "$PREV_REF"
    run_engine rollback
    case "$ENGINE_STATUS" in
      ROLLED_BACK|ALREADY_ROLLED_BACK)
        read_record
        iinfo "$PREV_REF" || { STATE_SYNC=FAILED; finish STATE_RECONCILE_REQUIRED PREVIOUS_IMAGE_NOT_PRESENT; }
        [[ "$REC_OLD_IMAGE_ID" == "$IID" ]] || { STATE_SYNC=FAILED; finish STATE_RECONCILE_REQUIRED RECORD_PREVIOUS_IMAGE_DIFFERS_FROM_RELEASE_STATE; }
        verify_serving "$PREV_REF" none || { STATE_SYNC=FAILED; finish STATE_RECONCILE_REQUIRED PREVIOUS_RELEASE_NOT_SERVING; }
        if [[ "$EXPECTED_REF" != "$PREV_REF" ]]; then set_expected "$EXPECTED_REF" "$PREV_REF" || { STATE_SYNC=FAILED; finish STATE_SYNC_FAILED HOST_CONFIG_NOT_UPDATED_SERVICE_RUNS_PREVIOUS_RELEASE; }; fi
        write_state "CURRENT_IMAGE=$PREV_REF" "PREVIOUS_IMAGE=$CUR_REF" "PENDING=" || { STATE_SYNC=FAILED; finish STATE_SYNC_FAILED RELEASE_STATE_NOT_UPDATED; }
        STATE_SYNC=OK; ready_ok && REVERIFIED=true || REVERIFIED=false
        finish "$ENGINE_STATUS" "$DETAIL" ;;
      REJECTED_BEFORE_STOP|LOCK_BUSY|CONFIG_INVALID|PREREQUISITE_MISSING)
        verify_serving "$CUR_REF" none && pending_clear && STATE_SYNC=NOT_NEEDED || STATE_SYNC=FAILED
        case "$ENGINE_STATUS" in REJECTED_BEFORE_STOP) finish REJECTED "$DETAIL" ;; LOCK_BUSY) finish LOCK_BUSY "$DETAIL" ;; CONFIG_INVALID) finish CONFIG_INVALID "$DETAIL" ;; *) finish PREREQUISITE_MISSING "$DETAIL" ;; esac ;;
      ROLLBACK_FAILED) finish ROLLBACK_FAILED "$DETAIL" ;;
      INTERRUPTED_STATE) finish INTERRUPTED_STATE "$DETAIL" ;;
      *) finish ENGINE_RESULT_INVALID ENGINE_STATUS_UNEXPECTED ;;
    esac ;;
  recover)
    pending_set recover "${CUR_REF:-$EXPECTED_REF}" "${ST[PREVIOUS_IMAGE]:-${CUR_REF:-$EXPECTED_REF}}"
    run_engine recover
    case "$ENGINE_STATUS" in
      RECOVERED)
        # whatever the engine restored is what is serving now: it must be one release this host knows, never a guess
        cinfo && [[ "$RUNNING" == true ]] || { STATE_SYNC=FAILED; finish STATE_RECONCILE_REQUIRED NOTHING_IS_SERVING_AFTER_RECOVER; }
        SERVING=""
        for candidate in "${CUR_REF:-}" "${ST[PREVIOUS_IMAGE]:-}" "$EXPECTED_REF"; do
          [[ -n "$candidate" ]] && iinfo "$candidate" && [[ "$CIMAGE" == "$IID" ]] && { SERVING="$candidate"; break; }
        done
        [[ -n "$SERVING" ]] || { STATE_SYNC=FAILED; finish STATE_RECONCILE_REQUIRED SERVING_IMAGE_IS_NOT_A_KNOWN_RELEASE; }
        if [[ "$EXPECTED_REF" != "$SERVING" ]]; then set_expected "$EXPECTED_REF" "$SERVING" || { STATE_SYNC=FAILED; finish STATE_SYNC_FAILED HOST_CONFIG_NOT_UPDATED; }; fi
        write_state "CURRENT_IMAGE=$SERVING" "PENDING=" || { STATE_SYNC=FAILED; finish STATE_SYNC_FAILED RELEASE_STATE_NOT_UPDATED; }
        STATE_SYNC=OK; ready_ok && REVERIFIED=true || REVERIFIED=false
        finish RECOVERED "$DETAIL" ;;
      ROLLBACK_FAILED) finish ROLLBACK_FAILED "$DETAIL" ;;
      LOCK_BUSY) finish LOCK_BUSY "$DETAIL" ;;
      INTERRUPTED_STATE) finish INTERRUPTED_STATE "$DETAIL" ;;
      *) finish ENGINE_RESULT_INVALID ENGINE_STATUS_UNEXPECTED ;;
    esac ;;
esac
