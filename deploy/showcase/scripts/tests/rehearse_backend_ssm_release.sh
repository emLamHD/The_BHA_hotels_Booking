#!/usr/bin/env bash
# BHA-BACKEND-CD-001-CP03: REAL isolated end-to-end rehearsal of the SSM release path.
#
#   TMPDIR=<scratch dir> deploy/showcase/scripts/tests/rehearse_backend_ssm_release.sh
#
# runner packet (git objects of the committed HEAD) -> real client -> MOCKED SSM boundary -> real bootstrap -> real remote wrapper
# -> real CP02 engine on real Docker, scratch PostgreSQL 18.3 (verify-full TLS), a loopback registry and a TLS proxy.
#
# What is NOT real: AWS itself. The `aws` shim below implements only `ssm send-command`, `ssm get-command-invocation` and
# `ecr get-login-password` (a synthetic token that is piped to `docker login` of the LOOPBACK registry). It runs the SSM script as
# the current user, and `curl` serves the allowlisted files of raw.githubusercontent.com from `git show` of the same commit.
# No AWS API, ECR, SSM, EC2 or RDS is contacted; the fixture, cleanup and canaries are those of rehearse_backend_deploy.sh.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  export REHEARSE_SETUP_HOOK="${BASH_SOURCE[0]}"
  exec "$(dirname "${BASH_SOURCE[0]}")/rehearse_backend_deploy.sh" "$@"
fi

# ----------------------------------------------------------------------------------------------- sourced by the CP02 harness
GH_REPO="emLamHD/The_BHA_hotels_Booking"
FAKE="$WORK/fakebin"; SSM_DIR="$WORK/ssm"; STAGE_ROOT="$WORK/stage-root"; RELLOCK="$WORK/lock"
mkdir -p "$FAKE" "$SSM_DIR" "$STAGE_ROOT"; chmod 700 "$STAGE_ROOT"
ECR_TOKEN="CANARY-ecr-token-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
REAL_CURL="$(command -v curl)"; REAL_PY="$(command -v python3)"
INSTANCE="i-0123456789abcdef0"; REGION_X="ap-southeast-2"
CLIENT="$SCRIPTS/backend-ssm-release.py"; PACKETGEN="$SCRIPTS/backend-release-packet.py"

cat > "$FAKE/curl" <<EOF
#!/usr/bin/env bash
# serves https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path> from the git objects of the rehearsed commit; everything else is real curl
for a in "\$@"; do url="\$a"; done
if [[ "\$url" == https://raw.githubusercontent.com/$GH_REPO/*/* ]]; then
  rest="\${url#https://raw.githubusercontent.com/$GH_REPO/}"; sha="\${rest%%/*}"; path="\${rest#*/}"
  out=""; prev=""; for a in "\$@"; do [[ "\$prev" == "-o" ]] && out="\$a"; prev="\$a"; done
  git -C "$REPO" show "\$sha:\$path" > "\$out" 2>/dev/null || exit 22
  exit 0
fi
exec "$REAL_CURL" "\$@"
EOF
cat > "$FAKE/aws" <<EOF
#!$REAL_PY
import json, os, subprocess, sys, uuid
D = "$SSM_DIR"
a = sys.argv[1:]
def arg(name): return a[a.index(name) + 1] if name in a else None
if a[:2] == ["ecr", "get-login-password"]:
    print("$ECR_TOKEN"); sys.exit(0)
if a[:2] == ["ssm", "send-command"]:
    cid = str(uuid.uuid4())
    params = json.load(open(arg("--parameters")[len("file://"):]))
    script = os.path.join(D, cid + ".sh"); open(script, "w").write("\n".join(params["commands"]) + "\n")
    env = dict(os.environ, PATH="$FAKE:" + os.environ["PATH"], BHA_RELEASE_STAGE_ROOT="$STAGE_ROOT", BHA_RELEASE_LOCK_DIR="$RELLOCK",
               BHA_DEPLOY_LOCK_DIR="$RELLOCK", BHA_RELEASE_ALLOW_LOOPBACK_REGISTRY="1")
    subprocess.Popen(["bash", "-c", 'bash "\$0" > "\$1.out" 2> "\$1.err"; echo \$? > "\$1.rc"', script, os.path.join(D, cid)], env=env, start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(json.dumps({"Command": {"CommandId": cid, "InstanceIds": [arg("--instance-ids")], "DocumentName": "AWS-RunShellScript", "Status": "Pending"}})); sys.exit(0)
if a[:2] == ["ssm", "get-command-invocation"]:
    cid = arg("--command-id"); base = os.path.join(D, cid)
    inv = {"CommandId": cid, "InstanceId": arg("--instance-id"), "DocumentName": "AWS-RunShellScript", "PluginName": "aws:runShellScript"}
    if not os.path.exists(base + ".rc"):
        inv.update(Status="InProgress", StatusDetails="InProgress", ResponseCode=-1, StandardOutputContent="", StandardErrorContent="")
    else:
        rc = int(open(base + ".rc").read())
        inv.update(Status="Success" if rc == 0 else "Failed", StatusDetails="Success" if rc == 0 else "Failed", ResponseCode=rc,
                   StandardOutputContent=open(base + ".out").read()[:24000], StandardErrorContent=open(base + ".err").read()[:8000])
    print(json.dumps(inv)); sys.exit(0)
sys.stderr.write("unexpected aws call\\n"); sys.exit(99)
EOF
chmod 755 "$FAKE/curl" "$FAKE/aws"

# the client and the shim run with the shim first on PATH; the harness' own aws-free commands are unaffected
ssm_release() {  # ssm_release <action> <packet> <out-dir> [client args...] -> RC, RES (result.json)
  local action="$1" packet="$2" out="$3"; shift 3
  RC=0
  PATH="$FAKE:$PATH" AWS_CONFIG_FILE=/nonexistent AWS_SHARED_CREDENTIALS_FILE=/nonexistent AWS_EC2_METADATA_DISABLED=true \
    python3 -I "$CLIENT" "$action" --packet "$packet" --instance-id "$INSTANCE" --region "$REGION_X" --host-config "$CONF" --out "$out" \
      --poll-interval 1 --poll-deadline 600 "$@" > "$out.stdout" 2>>"$WORK/out/ssm-client.stderr" || RC=$?
  RES="$out/result.json"
}
rj() { python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2],""); print(v)' "$RES" "$1"; }
cfg_expected() { sed -n 's/^EXPECTED_CURRENT_IMAGE=//p' "$CONF"; }
rstate() { sed -n "s/^$1=//p" "$JOURNAL_DIR_X/release-state"; }
JOURNAL_DIR_X="$WORK/journal"
CFG_BYTES0="$(grep -v '^EXPECTED_CURRENT_IMAGE=' "$CONF" | sha256sum | cut -d' ' -f1)"
cfg_rest_unchanged() { test "$(grep -v '^EXPECTED_CURRENT_IMAGE=' "$CONF" | sha256sum | cut -d' ' -f1)" = "$CFG_BYTES0"; }

say "== P0 packets from the git objects of the committed HEAD ($SHA)"
python3 -I "$PACKETGEN" generate --repo "$REPO" --source-sha "$SHA" --github-repository "$GH_REPO" --image-uri "$REPO_PATH:$SHA" --image-digest "$D_CAND" \
  --run-id 101 --run-attempt 1 --out "$WORK/packet-deploy"
python3 -I "$PACKETGEN" generate --repo "$REPO" --source-sha "$SHA" --github-repository "$GH_REPO" --no-image --run-id 101 --run-attempt 1 --out "$WORK/packet-noimage"
python3 -I "$PACKETGEN" generate --repo "$REPO" --source-sha "$SHA" --github-repository "$GH_REPO" --image-uri "$REPO_PATH:$SHA" --image-digest "$D_FAULT" \
  --run-id 102 --run-attempt 1 --out "$WORK/packet-fault"
say "packet sha256 (deploy): $(cat "$WORK/packet-deploy/packet.sha256")  image=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["image"])' "$WORK/packet-deploy/packet.json" | sed 's/.*@//')"
check "packet image equals the digest reference of the rehearsed candidate" test "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["image"])' "$WORK/packet-deploy/packet.json")" = "$REF_CAND"
DB0="$(db_hash)"

say "== P1 integrity failures stop before any code runs and before the serving container is touched"
python3 - "$WORK/packet-deploy/packet.json" "$WORK/packet-badhash" <<'PY'
import hashlib, json, os, sys
doc = json.load(open(sys.argv[1])); doc["files"][2]["sha256"] = "0" * 64
os.makedirs(sys.argv[2], exist_ok=True)
open(sys.argv[2] + "/packet.json", "wb").write((json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n").encode())
doc = json.load(open(sys.argv[1])); doc["manifest"]["migrations"].append("20990101000000_PendingFixture"); doc["manifest"]["count"] += 1
os.makedirs(sys.argv[2] + "-pending", exist_ok=True)
open(sys.argv[2] + "-pending/packet.json", "wb").write((json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n").encode())
PY
ssm_release deploy "$WORK/packet-badhash/packet.json" "$WORK/rel-badhash"
check "a script byte that does not match the runner's hash -> RELEASE_FAILED BOOTSTRAP_FAILED HASH_MISMATCH, old container untouched" \
  bash -c "[[ $RC == 10 && '$(rj release)' == BOOTSTRAP_FAILED && '$(rj detail)' == HASH_MISMATCH:* ]]"
check "old container untouched after the hash mismatch" old_untouched
check "no engine run directory was created by the failed bootstrap" bash -c "[[ -z \"\$(ls '$WORK/journal/runs' 2>/dev/null)\" ]]"
ssm_release deploy "$WORK/packet-badhash-pending/packet.json" "$WORK/rel-pending"
check "a manifest with a pending migration is rejected by the engine's history gate -> RELEASE_FAILED REJECTED, old untouched" \
  bash -c "[[ $RC == 10 && '$(rj release)' == REJECTED && '$(rj detail)' == *PENDING_MIGRATIONS* ]]"
check "old container untouched after the history gate" old_untouched
check "config and release state not advanced by the rejections" bash -c "[[ '$(cfg_expected)' == '$REF_OLD' ]]"

say "== P2 real deploy through the mocked SSM boundary"
ssm_release deploy "$WORK/packet-deploy/packet.json" "$WORK/rel-deploy" --correlation 00000000000000000000000000000001
check "deploy -> client exit 0 PASS, release SUCCESS (outcome $(rj outcome) release $(rj release))" bash -c "[[ $RC == 0 && '$(rj outcome)' == PASS && '$(rj release)' == SUCCESS ]]"
NEW_CID="$(cfmt "$TARGET" '{{.Id}}')"
check "the target name serves the candidate image by digest (new container)" bash -c "[[ '$NEW_CID' != '$OLD_CID' && \"$(cfmt "$NEW_CID" '{{.Config.Image}}')\" == '$REF_CAND' ]]"
check "EXPECTED_CURRENT_IMAGE advanced to the verified digest; every other byte of the host config unchanged; mode private" \
  bash -c "[[ '$(cfg_expected)' == '$REF_CAND' && \$(stat -c %a '$CONF') == 600 ]]" ; check "rest of the host config byte-identical" cfg_rest_unchanged
check "release state: CURRENT=new PREVIOUS=old, no pending intent" bash -c "[[ '$(rstate CURRENT_IMAGE)' == '$REF_CAND' && '$(rstate PREVIOUS_IMAGE)' == '$REF_OLD' && -z '$(rstate PENDING)' ]]"
check "Staff session issued before any swap still reads /me = 200" test "$(me_code)" = 200
check "every env-file line (dotted key, values with '=') is in the new container's env" env_matches "$NEW_CID"
check "key files byte-identical" bash -c "[[ -z \"\$(comm -23 <(printf '%s\n' '$KEYS0') <(docker exec $NEW_CID find /var/keys -maxdepth 1 -type f -exec sha256sum {} + | sort))\" ]]"
check "database dump unchanged by the release" test "$(db_hash)" = "$DB0"
check "staging directory (packet, scripts, docker credentials) is gone from the host" bash -c "[[ -z \"\$(ls -A '$STAGE_ROOT')\" ]]"
evidence_clean "after the SSM deploy"
check "wrapper log is private and holds the raw subprocess output" bash -c "f='$WORK/journal/release-logs/00000000000000000000000000000001.log'; [[ -f \$f && \$(stat -c %a \$f) == 600 ]]"
check "ECR token canary absent from client output, results, journal, logs and stage" bash -c "! grep -rqF -e '$ECR_TOKEN' '$WORK/out' '$WORK/journal' '$WORK/rel-deploy' '$WORK/rel-deploy.stdout' '$STAGE_ROOT' '$WORK/ssm'/*.out '$WORK/ssm'/*.err 2>/dev/null"
check "the client saved the CommandId before it polled (reconciliation anchor)" test -s "$WORK/rel-deploy/command.json"

say "== P3 the same release again"
ssm_release deploy "$WORK/packet-deploy/packet.json" "$WORK/rel-again"
check "same digest -> PASS ALREADY_CURRENT, container and config unchanged" bash -c "[[ $RC == 0 && '$(rj release)' == ALREADY_CURRENT && \"$(cfmt "$TARGET" '{{.Id}}')\" == '$NEW_CID' && '$(cfg_expected)' == '$REF_CAND' ]]"

say "== P4 explicit latest-record rollback through the same wrapper"
ssm_release rollback "$WORK/packet-noimage/packet.json" "$WORK/rel-rollback"
check "rollback -> PASS ROLLED_BACK, the ORIGINAL container serves again" bash -c "[[ $RC == 0 && '$(rj release)' == ROLLED_BACK && \"$(cfmt "$TARGET" '{{.Id}}')\" == '$OLD_CID' ]]"
check "config and release state follow the verified rollback" bash -c "[[ '$(cfg_expected)' == '$REF_OLD' && '$(rstate CURRENT_IMAGE)' == '$REF_OLD' && -z '$(rstate PENDING)' ]]"
check "Staff session continuity through the rollback; database unchanged" bash -c "[[ '$(me_code)' == 200 && '$(db_hash)' == '$DB0' ]]"
evidence_clean "after the SSM rollback"

say "== P5 a release that fails after the stop is a FAILED release even though the old service is restored"
ssm_release deploy "$WORK/packet-fault/packet.json" "$WORK/rel-fault"
check "fault candidate -> client exit 10 RELEASE_FAILED, remote release FAILED_ROLLED_BACK (never a pass)" bash -c "[[ $RC == 10 && '$(rj outcome)' == RELEASE_FAILED && '$(rj release)' == FAILED_ROLLED_BACK ]]"
check "the original container serves again; config still names the old digest; no pending intent left" bash -c "[[ \"$(cfmt "$TARGET" '{{.Id}}')\" == '$OLD_CID' && '$(cfg_expected)' == '$REF_OLD' && -z '$(rstate PENDING)' ]]"
check "Staff session valid after the failed release" test "$(me_code)" = 200
evidence_clean "after the failed SSM release"

say "== P6 recover with nothing unfinished"
ssm_release recover "$WORK/packet-noimage/packet.json" "$WORK/rel-recover"
check "recover -> PASS RECOVERED (nothing to recover), state in sync" bash -c "[[ $RC == 0 && '$(rj release)' == RECOVERED ]]"

say "== P7 a successful release after the failure, then final scans"
ssm_release deploy "$WORK/packet-deploy/packet.json" "$WORK/rel-deploy2"
check "deploy again -> PASS SUCCESS and the config follows" bash -c "[[ $RC == 0 && '$(rj release)' == SUCCESS && '$(cfg_expected)' == '$REF_CAND' ]]"
check "Staff session valid after the second release" test "$(me_code)" = 200
check "no canary (ECR token, database, Staff, image) anywhere in the captured output or journal" bash -c "! grep -rqF -e '$ECR_TOKEN' -e '$PG_CANARY' -e '$STAFF_CANARY' -e '$IMG_CANARY' '$WORK/out' '$WORK/journal' '$WORK'/rel-*  2>/dev/null"
CREATED_IMAGES+=("$REF_CAND" "$REF_OLD" "$REF_FAULT")
