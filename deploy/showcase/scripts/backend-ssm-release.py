#!/usr/bin/env python3
"""BHA-BACKEND-CD-001-CP03: runner/Owner side of the SSM release (stdlib only, Python 3.8+; calls the `aws` CLI).

  deploy|rollback|recover --packet FILE --instance-id i-... --region R --host-config /abs/path --out DIR
  status --command-id UUID --instance-id i-... --region R          (read-only: one GetCommandInvocation)

Sends ONE AWS-RunShellScript command to exactly one instance, polls that CommandId + InstanceId and confirms the single
JSON line the remote wrapper prints. Accepted/aggregated Success/exit 0 alone is never a PASS: the result must also carry the
requested correlation, command, SHA, digest and target, a valid schema, an engine outcome of SUCCESS/ALREADY_CURRENT (deploy),
a committed host state, a re-verified service and a finished evidence cleanup.

Never resends: a SendCommand with an ambiguous outcome (timeout, no response, unknown error) is REMOTE_RESULT_UNKNOWN, and so
is any accepted command whose result cannot be read. Only read polling is retried, with bounds.

Exit codes: 0 PASS | 10 RELEASE_FAILED (the remote reported a failure, e.g. rolled back) | 11 RELEASE_INCOMPLETE (cleanup or
state sync incomplete) | 12 RESULT_INVALID (terminal invocation, result not confirmable) | 20 REMOTE_RESULT_UNKNOWN |
30 NOT_SENT (validation or a definite SendCommand refusal) | 2 usage. DIR/result.json holds the sanitised outcome; the raw
invocation output is never written anywhere.

Timeout budget (seconds), worst case, one place:
  remote overhead 240 (downloads 4x30, ECR login 30, lock wait 30, state sync 30, re-verify 30)
  + engine watchdog 900 + TERM-to-KILL grace 300 (the engine restores the previous container on TERM)  = 1440
  < SSM executionTimeout 1500 ; delivery timeout 120 ; total command timeout 120 + 1500 = 1620
  poll deadline = 120 + 1500 + 120 margin = 1740 ; the Actions job allows 40 minutes (2400).
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))

OVERHEAD, WATCHDOG, GRACE = 240, 900, 300
EXEC_TIMEOUT, DELIVERY_TIMEOUT, POLL_MARGIN = 1500, 120, 120
POLL_DEADLINE = DELIVERY_TIMEOUT + EXEC_TIMEOUT + POLL_MARGIN
INSTANCE_RE = re.compile(r"^i-[0-9a-f]{17}$")
COMMAND_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
REGION_RE = re.compile(r"^[a-z]{2}(-[a-z]+)+-[0-9]+$")
PATH_RE = re.compile(r"^/[A-Za-z0-9_./+-]{1,200}$")
CORR_RE = re.compile(r"^[0-9a-f]{32}$")
DEFINITE_SEND_ERRORS = {"AccessDeniedException", "InvalidInstanceId", "ValidationException", "InvalidDocument", "InvalidParameters",
                        "UnsupportedPlatformType", "InvalidRole", "MaxDocumentSizeExceeded", "InvalidNotificationConfig", "InvalidOutputFolder"}
RELEASES = {
    "deploy": {"SUCCESS", "ALREADY_CURRENT"},
    "rollback": {"ROLLED_BACK", "ALREADY_ROLLED_BACK"},
    "recover": {"RECOVERED"},
}
ALL_RELEASES = {"SUCCESS", "ALREADY_CURRENT", "ROLLED_BACK", "ALREADY_ROLLED_BACK", "RECOVERED", "FAILED_ROLLED_BACK", "ROLLBACK_FAILED",
                "REJECTED", "LOCK_BUSY", "INTERRUPTED_STATE", "CONFIG_INVALID", "PREREQUISITE_MISSING", "STATE_RECONCILE_REQUIRED",
                "STATE_SYNC_FAILED", "ENGINE_RESULT_INVALID", "ENGINE_TIMEOUT", "BOOTSTRAP_FAILED", "PACKET_INVALID", "REGISTRY_LOGIN_FAILED"}
RESULT_KEYS = {"v", "correlation", "command", "source_sha", "image", "target", "release", "detail", "engine_status", "engine_exit",
               "run_id", "downtime_seconds", "state_sync", "reverified", "cleanup"}


class Refused(Exception):
    pass


CANCEL = {"flag": False}


def _on_signal(signum, frame):
    # A cancelled Actions job (SIGINT, then SIGTERM) must not be read as "the remote stopped": the accepted command keeps
    # running on the host. The loop notices the flag, records the CommandId and reports REMOTE_RESULT_UNKNOWN.
    CANCEL["flag"] = True


def load_packet_module():
    spec = importlib.util.spec_from_file_location("backend_release_packet", os.path.join(HERE, "backend-release-packet.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_budget(watchdog=WATCHDOG, grace=GRACE, overhead=OVERHEAD, execution=EXEC_TIMEOUT, delivery=DELIVERY_TIMEOUT, margin=POLL_MARGIN):
    """The orderings that make the numbers above safe. Raises Refused when they do not hold."""
    if overhead + watchdog + grace >= execution:
        raise Refused("BUDGET_REMOTE_NOT_BELOW_EXECUTION_TIMEOUT")
    if delivery < 30:
        raise Refused("BUDGET_DELIVERY_BELOW_MINIMUM")
    if margin <= 0:
        raise Refused("BUDGET_POLL_MARGIN")
    return delivery + execution + margin


BOOTSTRAP = r'''set -euo pipefail
umask 077
export LC_ALL=C PATH="${BHA_RELEASE_PATH_PREFIX:+$BHA_RELEASE_PATH_PREFIX:}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"   # prefix: test shims only
CORR='@CORR@'; SHA='@SHA@'; REPO='@REPO@'; PACKET_SHA='@PACKET_SHA@'; HCFG='@HCFG@'; ACTION='@ACTION@'; REGION='@REGION@'
fail() { printf '{"v":1,"correlation":"%s","command":"%s","source_sha":"%s","release":"BOOTSTRAP_FAILED","detail":"%s"}\n' "$CORR" "$ACTION" "$SHA" "$1"; exit 1; }
ROOT="${BHA_RELEASE_STAGE_ROOT:-/var/lib/the-bha/release-staging}"
mkdir -p "$ROOT" 2>/dev/null || fail STAGE_ROOT_UNUSABLE
[[ -d "$ROOT" && ! -L "$ROOT" && -O "$ROOT" ]] || fail STAGE_ROOT_NOT_OWNED
chmod 700 "$ROOT"
STAGE="$ROOT/$CORR"
mkdir "$STAGE" 2>/dev/null || fail STAGE_EXISTS
mkdir "$STAGE/bin"
printf '%s' '@PACKET_B64@' | base64 -d > "$STAGE/packet.json" 2>/dev/null || fail PACKET_DECODE
[[ "$(sha256sum "$STAGE/packet.json" | cut -d' ' -f1)" == "$PACKET_SHA" ]] || fail PACKET_SHA256_MISMATCH
python3 -I - "$STAGE/packet.json" "$REPO" "$SHA" > "$STAGE/files.list" <<'PY' || fail PACKET_INVALID
import json, re, sys
ALLOW = @ALLOWLIST@
doc = json.load(open(sys.argv[1]))
ok = (isinstance(doc, dict) and doc.get("format") == 1 and doc.get("repository") == sys.argv[2] and doc.get("source_sha") == sys.argv[3]
      and doc.get("raw_base") == "https://raw.githubusercontent.com/%s/%s" % (sys.argv[2], sys.argv[3])
      and [f.get("path") for f in doc.get("files", [])] == ALLOW)
if not ok:
    sys.exit(1)
for f in doc["files"]:
    if not re.match(r"^[0-9a-f]{64}$", f["sha256"]) or not isinstance(f["size"], int) or not 0 < f["size"] <= 262144:
        sys.exit(1)
    print(f["path"], f["sha256"], f["size"])
PY
while read -r path want size; do
  name="${path##*/}"
  curl -fsS --proto '=https' --tlsv1.2 --max-time 30 --max-filesize "$size" -o "$STAGE/bin/$name" "https://raw.githubusercontent.com/$REPO/$SHA/$path" 2>/dev/null || fail "DOWNLOAD_FAILED:$name"
  [[ -f "$STAGE/bin/$name" && ! -L "$STAGE/bin/$name" ]] || fail "DOWNLOAD_NOT_A_FILE:$name"
  [[ "$(sha256sum "$STAGE/bin/$name" | cut -d' ' -f1)" == "$want" ]] || fail "HASH_MISMATCH:$name"
done < "$STAGE/files.list"
chmod 700 "$STAGE"/bin/*
exec "$STAGE/bin/backend-remote-release.sh" "$ACTION" --packet "$STAGE/packet.json" --stage "$STAGE" --host-config "$HCFG" --correlation "$CORR" --region "$REGION"
'''


def build_bootstrap(packet_bytes, packet, action, region, host_config, correlation):
    """Validated constants only: every value is matched against a strict grammar and then lives in single quotes."""
    packet_mod = load_packet_module()
    values = {"CORR": (correlation, CORR_RE), "SHA": (packet["source_sha"], packet_mod.SHA_RE), "REPO": (packet["repository"], packet_mod.REPO_RE),
              "PACKET_SHA": (hashlib.sha256(packet_bytes).hexdigest(), packet_mod.HEX64_RE), "HCFG": (host_config, PATH_RE),
              "ACTION": (action, re.compile(r"^(deploy|rollback|recover)$")), "REGION": (region, REGION_RE)}
    text = BOOTSTRAP
    for key, (value, rx) in values.items():
        if not isinstance(value, str) or not rx.match(value) or "'" in value:
            raise Refused("BOOTSTRAP_VALUE_" + key)
        text = text.replace("@%s@" % key, value)
    if ".." in host_config or "//" in host_config:
        raise Refused("BOOTSTRAP_VALUE_HCFG")
    b64 = base64.b64encode(packet_bytes).decode("ascii")
    text = text.replace("@PACKET_B64@", b64).replace("@ALLOWLIST@", json.dumps(list(packet_mod.ALLOWLIST)))
    if re.search(r"@[A-Z_0-9]+@", text):
        raise Refused("BOOTSTRAP_UNFILLED")
    return text


def aws(args, region, timeout):
    """Run the aws CLI. Returns (returncode, stdout, stderr); a timeout is returncode None."""
    try:
        p = subprocess.run(["aws"] + args + ["--region", region, "--output", "json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "", ""
    except OSError:
        return None, "", ""
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def aws_error_code(stderr):
    m = re.search(r"An error occurred \(([A-Za-z]+)\)", stderr)
    return m.group(1) if m else ""


def validate_result(raw, expect):
    """raw: the text of StandardOutputContent. Returns the validated dict or raises Refused(code)."""
    if len(raw) >= 24000:
        raise Refused("OUTPUT_TRUNCATED")
    lines = [l for l in raw.split("\n") if l.strip()]
    if len(lines) != 1:
        raise Refused("OUTPUT_NOT_ONE_LINE")
    try:
        doc = json.loads(lines[0], parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
    except ValueError:
        raise Refused("OUTPUT_NOT_JSON")
    if not isinstance(doc, dict):
        raise Refused("OUTPUT_NOT_AN_OBJECT")
    if doc.get("release") == "BOOTSTRAP_FAILED":     # produced before the wrapper exists: a short, fixed schema
        if not isinstance(doc.get("detail"), str) or not re.match(r"^[A-Za-z0-9_.:,-]{1,100}$", doc["detail"]) or doc.get("v") != 1 \
                or doc.get("correlation") != expect["correlation"] or doc.get("command") != expect["command"] or doc.get("source_sha") != expect["source_sha"]:
            raise Refused("BOOTSTRAP_RESULT_MISMATCH")
        return {"release": "BOOTSTRAP_FAILED", "detail": doc["detail"], "bootstrap": True}
    if set(doc) != RESULT_KEYS:
        raise Refused("RESULT_KEYS")
    ints = ("v", "engine_exit", "downtime_seconds")
    for k in ints:
        if not isinstance(doc[k], int) or isinstance(doc[k], bool):
            raise Refused("RESULT_TYPE_" + k)
    for k in ("correlation", "command", "source_sha", "image", "target", "release", "detail", "engine_status", "run_id", "state_sync", "cleanup"):
        if not isinstance(doc[k], str):
            raise Refused("RESULT_TYPE_" + k)
    if not isinstance(doc["reverified"], bool):
        raise Refused("RESULT_TYPE_reverified")
    if doc["v"] != 1 or doc["release"] not in ALL_RELEASES or doc["state_sync"] not in ("OK", "FAILED", "NOT_NEEDED") or doc["cleanup"] not in ("OK", "FAILED", "NOT_RUN"):
        raise Refused("RESULT_VALUE")
    for k in ("detail", "engine_status", "run_id", "target"):
        if not re.match(r"^[A-Za-z0-9_.:,-]{0,200}$", doc[k]):
            raise Refused("RESULT_CHARSET_" + k)
    for k in ("correlation", "command", "source_sha", "image"):
        if doc[k] != expect[k]:
            raise Refused("RESULT_MISMATCH_" + k)
    return doc


def classify(inv, expect, instance_id, command_id):
    """Decide the outcome from one TERMINAL invocation. Returns (outcome, release, detail, exit_code)."""
    status, details, rc = inv.get("Status"), inv.get("StatusDetails", ""), inv.get("ResponseCode")
    if inv.get("CommandId") != command_id or inv.get("InstanceId") != instance_id or inv.get("DocumentName") != "AWS-RunShellScript":
        return "RESULT_INVALID", "", "INVOCATION_IDENTITY_MISMATCH", 12
    if inv.get("PluginName") not in ("aws:runShellScript", "runShellScript"):
        return "RESULT_INVALID", "", "PLUGIN_MISMATCH", 12
    if not isinstance(rc, int) or isinstance(rc, bool):
        return "RESULT_INVALID", "", "RESPONSE_CODE_NOT_AN_INTEGER", 12
    if status == "TimedOut" and details == "DeliveryTimedOut":
        return "RELEASE_FAILED", "", "DELIVERY_TIMED_OUT_NOTHING_RAN", 10
    if status in ("TimedOut", "Cancelled", "Cancelling"):
        return "REMOTE_RESULT_UNKNOWN", "", "REMOTE_" + re.sub(r"[^A-Za-z]", "", details or status).upper(), 20
    if (status, details) not in (("Success", "Success"), ("Failed", "Failed")) or (status == "Success") != (rc == 0):
        return "RESULT_INVALID", "", "STATUS_RESPONSE_CODE_INCONSISTENT", 12
    try:
        doc = validate_result(inv.get("StandardOutputContent", ""), expect)
    except Refused as error:
        return "RESULT_INVALID", "", str(error), 12
    if doc.get("bootstrap"):
        return "RELEASE_FAILED", "BOOTSTRAP_FAILED", doc["detail"], 10
    allowed = RELEASES[expect["command"]]
    if doc["release"] in set().union(*RELEASES.values()) and doc["release"] not in allowed:
        return "RESULT_INVALID", doc["release"], "RELEASE_NOT_VALID_FOR_THE_COMMAND", 12
    if status == "Success" and rc == 0 and doc["release"] in allowed and doc["engine_exit"] == 0 and doc["state_sync"] == "OK" \
            and doc["reverified"] is True and doc["cleanup"] == "OK" and doc["engine_status"] == doc["release"] \
            and not doc["detail"].endswith("__EVIDENCE_CLEANUP_FAILED"):
        return "PASS", doc["release"], doc["detail"], 0
    if doc["release"] in allowed and (doc["cleanup"] == "FAILED" or doc["detail"].endswith("__EVIDENCE_CLEANUP_FAILED") or doc["state_sync"] != "OK" or doc["reverified"] is not True):
        return "RELEASE_INCOMPLETE", doc["release"], doc["detail"], 11
    if doc["release"] in allowed:
        return "RESULT_INVALID", doc["release"], "SUCCESS_CLAIM_NOT_CONSISTENT", 12
    return "RELEASE_FAILED", doc["release"], doc["detail"], 10


NEXT_STEPS = (
    "Read-only reconciliation, in this order: (1) aws ssm get-command-invocation --command-id {cid} --instance-id {iid} --region {region}; "
    "(2) on the host: backend-deploy.sh status --config <host config> (an unfinished run shows exit 60); (3) docker ps / docker inspect of the "
    "target to see which image digest serves; (4) compare with release-state and records/latest in the journal directory. Do NOT re-run the "
    "workflow or resend the command before the state is known; if a run is unfinished use the recover command of the same wrapper.")


def write_outcome(out_dir, outcome, release, detail, code, extra):
    doc = dict({"outcome": outcome, "release": release, "detail": detail, "exit": code}, **extra)
    if outcome in ("REMOTE_RESULT_UNKNOWN", "RESULT_INVALID", "RELEASE_INCOMPLETE") and extra.get("command_id"):
        doc["next_steps"] = NEXT_STEPS.format(cid=extra["command_id"], iid=extra.get("instance_id", ""), region=extra.get("region", ""))
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    text = json.dumps(doc, sort_keys=True, ensure_ascii=True, indent=2) + "\n"
    with open(os.path.join(out_dir, "result.json"), "w") as handle:
        handle.write(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as handle:
            handle.write("### Backend release over SSM: %s (%s)\n" % (outcome, release or "-"))
            for k in ("command_id", "instance_id", "correlation", "source_sha", "image", "detail"):
                handle.write("- %s: `%s`\n" % (k, doc.get(k, "")))
            if "next_steps" in doc:
                handle.write("\n%s\n" % doc["next_steps"])
    sys.stdout.write(json.dumps({"outcome": outcome, "release": release, "exit": code}) + "\n")
    return code


def run(args, sleep=time.sleep, now=time.monotonic):
    action = args.action
    if not INSTANCE_RE.match(args.instance_id) or not REGION_RE.match(args.region) or not PATH_RE.match(args.host_config):
        raise Refused("ARGUMENT_GRAMMAR")
    check_budget()
    packet_mod = load_packet_module()
    try:
        packet, packet_bytes = packet_mod.load(args.packet)
    except packet_mod.Refused as error:
        raise Refused("PACKET_" + str(error))
    if action == "deploy" and not packet["image"]:
        raise Refused("DEPLOY_NEEDS_AN_IMAGE")
    correlation = args.correlation or uuid.uuid4().hex
    if not CORR_RE.match(correlation):
        raise Refused("CORRELATION_GRAMMAR")
    bootstrap = build_bootstrap(packet_bytes, packet, action, args.region, args.host_config, correlation)
    params = {"commands": bootstrap.split("\n"), "executionTimeout": [str(EXEC_TIMEOUT)], "workingDirectory": ["/"]}
    os.makedirs(args.out, mode=0o700, exist_ok=True)
    params_path = os.path.join(args.out, "send-parameters.json")
    fd = os.open(params_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(params, handle)
    expect = {"correlation": correlation, "command": action, "source_sha": packet["source_sha"], "image": packet["image"]}
    base = {"correlation": correlation, "instance_id": args.instance_id, "region": args.region, "source_sha": packet["source_sha"], "image": packet["image"], "command": action}
    comment = "bha-release %s %s" % (action, correlation[:12])
    if CANCEL["flag"]:
        return write_outcome(args.out, "NOT_SENT", "", "CANCELLED_BEFORE_SEND", 30, base)
    rc, out, err = aws(["ssm", "send-command", "--instance-ids", args.instance_id, "--document-name", "AWS-RunShellScript",
                        "--parameters", "file://" + params_path, "--timeout-seconds", str(DELIVERY_TIMEOUT), "--max-concurrency", "1",
                        "--max-errors", "0", "--comment", comment], args.region, 60)
    try:
        os.remove(params_path)
    except OSError:
        pass
    if rc != 0:
        code = aws_error_code(err) if rc is not None else ""
        if code in DEFINITE_SEND_ERRORS:
            return write_outcome(args.out, "NOT_SENT", "", "SEND_REFUSED_" + code, 30, base)
        return write_outcome(args.out, "REMOTE_RESULT_UNKNOWN", "", "SEND_OUTCOME_AMBIGUOUS_NOT_RESENT", 20, dict(base, command_id=""))
    try:
        sent = json.loads(out)["Command"]
        command_id = sent["CommandId"]
        ok = COMMAND_ID_RE.match(command_id) and sent.get("InstanceIds") == [args.instance_id] and sent.get("DocumentName") == "AWS-RunShellScript"
    except (ValueError, KeyError, TypeError):
        ok, command_id = False, ""
    if not ok:
        return write_outcome(args.out, "REMOTE_RESULT_UNKNOWN", "", "SEND_RESPONSE_UNREADABLE_NOT_RESENT", 20, dict(base, command_id=command_id if isinstance(command_id, str) and COMMAND_ID_RE.match(command_id) else ""))
    base["command_id"] = command_id
    with open(os.path.join(args.out, "command.json"), "w") as handle:      # saved BEFORE polling: the reconciliation anchor
        json.dump({"command_id": command_id, "instance_id": args.instance_id, "correlation": correlation, "region": args.region}, handle)
    start, not_found_until, errors = now(), now() + args.not_found_grace, 0
    while True:
        if CANCEL["flag"]:
            return write_outcome(args.out, "REMOTE_RESULT_UNKNOWN", "", "CANCELLED_BY_RUNNER_REMOTE_STATE_UNKNOWN", 20, base)
        elapsed = now() - start
        if elapsed >= args.poll_deadline:
            return write_outcome(args.out, "REMOTE_RESULT_UNKNOWN", "", "POLL_DEADLINE_REACHED", 20, base)
        rc, out, err = aws(["ssm", "get-command-invocation", "--command-id", command_id, "--instance-id", args.instance_id], args.region, 30)
        if rc != 0:
            code = aws_error_code(err) if rc is not None else ""
            if code == "InvocationDoesNotExist" and now() < not_found_until:
                sleep(args.poll_interval)
                continue
            if code == "InvocationDoesNotExist":
                return write_outcome(args.out, "REMOTE_RESULT_UNKNOWN", "", "INVOCATION_NOT_FOUND_AFTER_GRACE", 20, base)
            if code in ("", "InternalServerError", "ThrottlingException") and errors < args.max_poll_errors:      # transient transport trouble
                errors += 1
                sleep(args.poll_interval)
                continue
            return write_outcome(args.out, "REMOTE_RESULT_UNKNOWN", "", "POLL_FAILED_" + (code or "TRANSPORT"), 20, base)
        errors = 0
        try:
            inv = json.loads(out)
        except ValueError:
            return write_outcome(args.out, "REMOTE_RESULT_UNKNOWN", "", "POLL_RESPONSE_UNREADABLE", 20, base)
        if inv.get("Status") in ("Pending", "InProgress", "Delayed"):
            sleep(args.poll_interval)
            continue
        outcome, release, detail, code = classify(inv, expect, args.instance_id, command_id)
        return write_outcome(args.out, outcome, release, detail, code, dict(base, ssm_status=str(inv.get("Status")), ssm_status_details=str(inv.get("StatusDetails", "")), response_code=inv.get("ResponseCode")))


def status(args):
    if not COMMAND_ID_RE.match(args.command_id) or not INSTANCE_RE.match(args.instance_id) or not REGION_RE.match(args.region):
        raise Refused("ARGUMENT_GRAMMAR")
    rc, out, err = aws(["ssm", "get-command-invocation", "--command-id", args.command_id, "--instance-id", args.instance_id], args.region, 30)
    if rc != 0:
        sys.stdout.write(json.dumps({"status": "UNREADABLE", "error": aws_error_code(err) or "TRANSPORT"}) + "\n")
        return 20
    inv = json.loads(out)
    sys.stdout.write(json.dumps({"status": inv.get("Status"), "status_details": inv.get("StatusDetails"), "response_code": inv.get("ResponseCode"),
                                 "plugin": inv.get("PluginName")}) + "\n")
    return 0


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    for name in ("deploy", "rollback", "recover"):
        p = sub.add_parser(name)
        p.add_argument("--packet", required=True)
        p.add_argument("--instance-id", required=True)
        p.add_argument("--region", required=True)
        p.add_argument("--host-config", required=True)
        p.add_argument("--out", required=True)
        p.add_argument("--correlation")
        p.add_argument("--poll-interval", type=float, default=10)
        p.add_argument("--poll-deadline", type=float, default=POLL_DEADLINE)
        p.add_argument("--not-found-grace", type=float, default=60)
        p.add_argument("--max-poll-errors", type=int, default=5)
    s = sub.add_parser("status")
    s.add_argument("--command-id", required=True)
    s.add_argument("--instance-id", required=True)
    s.add_argument("--region", required=True)
    args = parser.parse_args(argv)
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)
    try:
        return status(args) if args.action == "status" else run(args)
    except Refused as error:
        out = getattr(args, "out", None)
        if out:
            return write_outcome(out, "NOT_SENT", "", str(error), 30, {})
        sys.stdout.write(json.dumps({"outcome": "NOT_SENT", "detail": str(error), "exit": 30}) + "\n")
        return 30


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
