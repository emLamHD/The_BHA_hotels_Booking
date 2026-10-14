#!/usr/bin/env python3
"""
BHA-BACKEND-CD-001-CP03 tests: backend-ssm-release.py (runner side of the SSM release).

`aws` is a stub first on PATH with scripted SendCommand / GetCommandInvocation behavior; AWS config, credentials and IMDS are
neutralised so a stub miss cannot reach an account. The real client runs unchanged. Nothing here touches the network or AWS.
"""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import test_backend_release_packet as pk

SCRIPTS = pk.SCRIPTS
CLIENT = SCRIPTS / "backend-ssm-release.py"
INSTANCE = "i-0123456789abcdef0"
REGION = "ap-southeast-2"
CORR = "c0ffee00c0ffee00c0ffee00c0ffee00"
CMD_ID = "11111111-2222-3333-4444-555555555555"

AWS_STUB = r'''#!/usr/bin/env python3
import json, os, sys, time
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = sys.argv[1:]
open(os.path.join(D, "calls.log"), "a").write(" ".join(a) + "\n")
def arg(name):
    return a[a.index(name) + 1] if name in a else None
def load(n, default):
    p = os.path.join(D, n)
    return json.load(open(p)) if os.path.exists(p) else default
if a[:2] == ["ssm", "send-command"]:
    open(os.path.join(D, "sent.json"), "w").write(open(arg("--parameters")[len("file://"):]).read())
    open(os.path.join(D, "sent-argv.json"), "w").write(json.dumps(a))
    cfg = load("send.json", {"mode": "ok"})
    if cfg["mode"] == "error":
        sys.stderr.write("An error occurred (%s) when calling the SendCommand operation: nope\n" % cfg["code"]); sys.exit(254)
    if cfg["mode"] == "noresponse":
        sys.stderr.write("Connection was closed before we received a valid response from endpoint URL\n"); sys.exit(255)
    if cfg["mode"] == "unreadable":
        sys.stdout.write("<html>not json"); sys.exit(0)
    ids = [arg("--instance-ids")] if cfg["mode"] != "wrong-instance" else ["i-0aaaaaaaaaaaaaaaa"]
    print(json.dumps({"Command": {"CommandId": "11111111-2222-3333-4444-555555555555", "InstanceIds": ids, "DocumentName": "AWS-RunShellScript", "Status": "Pending"}}))
    sys.exit(0)
if a[:2] == ["ssm", "get-command-invocation"]:
    steps = load("invocations.json", [])
    n = int(open(os.path.join(D, "polls")).read()) if os.path.exists(os.path.join(D, "polls")) else 0
    open(os.path.join(D, "polls"), "w").write(str(n + 1))
    step = steps[min(n, len(steps) - 1)]
    if "error" in step:
        sys.stderr.write(step.get("stderr", "An error occurred (%s) when calling the GetCommandInvocation operation: x\n" % step["error"])); sys.exit(254 if step["error"] else 255)
    inv = dict(step["inv"])
    for k, v in (("CommandId", arg("--command-id")), ("InstanceId", arg("--instance-id"))):
        if inv.get(k) == "*": inv[k] = v
    print(json.dumps(inv)); sys.exit(0)
sys.stderr.write("unexpected aws call\n"); sys.exit(99)
'''


def result(action="deploy", sha=None, image=None, **over):
    doc = {"v": 1, "correlation": CORR, "command": action, "source_sha": sha, "image": image, "target": "the-bha-api", "release": "SUCCESS", "detail": "NEW_RELEASE",
           "engine_status": "SUCCESS", "engine_exit": 0, "run_id": "20261009T000000Z-deadbeef", "downtime_seconds": 3, "state_sync": "OK", "reverified": True, "cleanup": "OK"}
    doc.update(over)
    return doc


def inv(doc=None, raw=None, status="Success", details="Success", rc=0, **over):
    out = raw if raw is not None else json.dumps(doc) + "\n"
    d = {"CommandId": "*", "InstanceId": "*", "DocumentName": "AWS-RunShellScript", "PluginName": "aws:runShellScript", "Status": status,
         "StatusDetails": details, "ResponseCode": rc, "StandardOutputContent": out, "StandardErrorContent": ""}
    d.update(over)
    return {"inv": d}


class Client(pk.PacketFixture):
    def setUp(self):
        super().setUp()
        self.bin = self.d / "bin"; self.bin.mkdir()
        (self.bin / "aws").write_text(AWS_STUB); os.chmod(self.bin / "aws", 0o755)
        self.assertEqual(self.gen().returncode, 0)
        self.packet = self.d / "out/packet.json"
        self.image = json.loads(self.packet.read_text())["image"]
        self.out = self.d / "release"

    def script(self, name, data):
        (self.d / name).write_text(json.dumps(data))

    def run_client(self, action="deploy", extra=(), timeout=60, packet=None):
        env = dict(os.environ, PATH="%s:%s" % (self.bin, os.environ["PATH"]), AWS_CONFIG_FILE="/nonexistent/c", AWS_SHARED_CREDENTIALS_FILE="/nonexistent/k",
                   AWS_EC2_METADATA_DISABLED="true")
        env.pop("AWS_PROFILE", None); env.pop("GITHUB_STEP_SUMMARY", None)
        argv = [sys.executable, "-I", str(CLIENT), action, "--packet", str(packet or self.packet), "--instance-id", INSTANCE, "--region", REGION,
                "--host-config", "/etc/the-bha/host.conf", "--out", str(self.out), "--correlation", CORR, "--poll-interval", "0.05", "--poll-deadline", "5",
                "--not-found-grace", "0.4", "--max-poll-errors", "2"] + list(extra)
        self.p = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=timeout)
        self.res = json.loads((self.out / "result.json").read_text()) if (self.out / "result.json").exists() else {}
        return self.p.returncode

    def calls(self, kind):
        p = self.d / "calls.log"
        return [l for l in p.read_text().splitlines() if l.startswith("ssm " + kind)] if p.exists() else []

    def good(self, **over):
        return result("deploy", self.sha, self.image, **over)


class SendAndPoll(Client):
    def test_pass_requires_all_layers_and_sends_exactly_one_scoped_command(self):
        self.script("invocations.json", [inv(None, raw="", status="InProgress", details="InProgress", rc=-1), inv(self.good())])
        self.assertEqual(self.run_client(), 0, self.p.stdout + self.p.stderr)
        self.assertEqual((self.res["outcome"], self.res["release"], self.res["exit"]), ("PASS", "SUCCESS", 0))
        self.assertEqual(len(self.calls("send-command")), 1)
        argv = json.loads((self.d / "sent-argv.json").read_text())
        self.assertEqual(argv[argv.index("--instance-ids") + 1], INSTANCE)                      # one validated instance, never tags or fleets
        self.assertEqual(argv.count("--instance-ids"), 1); self.assertNotIn("--targets", argv)
        self.assertEqual(argv[argv.index("--document-name") + 1], "AWS-RunShellScript")
        self.assertEqual((argv[argv.index("--timeout-seconds") + 1], argv[argv.index("--max-concurrency") + 1], argv[argv.index("--max-errors") + 1]), ("120", "1", "0"))
        for forbidden in ("--cloud-watch-output-config", "--output-s3-bucket-name", "--output-s3-key-prefix", "--targets"):
            self.assertNotIn(forbidden, argv)                                                  # no new cloud resource, no raw-output export
        sent = json.loads((self.d / "sent.json").read_text())
        self.assertEqual(sent["executionTimeout"], ["1500"])
        self.assertEqual(json.loads((self.out / "command.json").read_text())["command_id"], CMD_ID)   # saved before polling
        for call in self.calls("get-command-invocation"):
            self.assertIn("--command-id " + CMD_ID, call); self.assertIn("--instance-id " + INSTANCE, call)

    def test_the_bootstrap_carries_only_validated_constants_and_the_runner_computed_hash(self):
        self.script("invocations.json", [inv(self.good())])
        self.run_client()
        text = "\n".join(json.loads((self.d / "sent.json").read_text())["commands"])
        raw = self.packet.read_bytes()
        self.assertIn("PACKET_SHA='%s'" % hashlib.sha256(raw).hexdigest(), text)
        self.assertIn("SHA='%s'" % self.sha, text); self.assertIn("CORR='%s'" % CORR, text)
        self.assertIn("https://raw.githubusercontent.com/$REPO/$SHA/$path", text)             # fixed host, immutable full SHA
        self.assertIn("--proto '=https'", text)
        for bad in ("eval ", "source ", "| bash", "| sh", "curl -k", "--insecure", "latest", "/main/"):
            self.assertNotIn(bad, text)
        self.assertNotIn("@", "".join(c for c in text if False))                                 # placeholder markers are all filled
        self.assertEqual(text.count("@CORR@") + text.count("@SHA@") + text.count("@PACKET_B64@"), 0)
        self.assertLess(len(text), 100000)

    def test_ambiguous_send_is_never_resent(self):
        for cfg in ({"mode": "noresponse"}, {"mode": "unreadable"}, {"mode": "error", "code": "InternalServerError"}, {"mode": "error", "code": "ThrottlingException"}, {"mode": "wrong-instance"}):
            with self.subTest(cfg):
                shutil.rmtree(self.out, ignore_errors=True); (self.d / "calls.log").unlink(missing_ok=True)
                self.script("send.json", cfg)
                self.assertEqual(self.run_client(), 20)
                self.assertEqual(self.res["outcome"], "REMOTE_RESULT_UNKNOWN")
                self.assertEqual(len(self.calls("send-command")), 1)                           # exactly one attempt
                self.assertEqual(self.calls("get-command-invocation"), [])

    def test_definite_refusals_are_not_sent(self):
        for code in ("AccessDeniedException", "InvalidInstanceId", "ValidationException", "InvalidDocument"):
            shutil.rmtree(self.out, ignore_errors=True)
            self.script("send.json", {"mode": "error", "code": code})
            self.assertEqual(self.run_client(), 30, code)
            self.assertEqual((self.res["outcome"], self.res["detail"]), ("NOT_SENT", "SEND_REFUSED_" + code))

    def test_invocation_does_not_exist_is_retried_only_within_the_grace_and_other_errors_are_not_not_found(self):
        nf = {"error": "InvocationDoesNotExist"}
        self.script("invocations.json", [nf, nf, inv(self.good())])
        self.assertEqual(self.run_client(), 0)
        shutil.rmtree(self.out); (self.d / "polls").unlink()
        self.script("invocations.json", [nf])
        self.assertEqual(self.run_client(), 20)
        self.assertEqual(self.res["detail"], "INVOCATION_NOT_FOUND_AFTER_GRACE")
        for err in ("AccessDeniedException", "InvalidInstanceId", "InvalidCommandId"):
            shutil.rmtree(self.out); (self.d / "polls").unlink()
            self.script("invocations.json", [{"error": err}, inv(self.good())])
            self.assertEqual(self.run_client(), 20, err)
            self.assertEqual(self.res["detail"], "POLL_FAILED_" + err)                         # never read as "not found", never as success

    def test_transport_trouble_while_polling_is_bounded(self):
        flaky = {"error": "", "stderr": "Could not connect to the endpoint URL\n"}
        self.script("invocations.json", [flaky, flaky, inv(self.good())])
        self.assertEqual(self.run_client(), 0)                                                 # 2 transient errors <= bound
        shutil.rmtree(self.out); (self.d / "polls").unlink()
        self.script("invocations.json", [flaky, flaky, flaky, inv(self.good())])
        self.assertEqual(self.run_client(), 20)
        self.assertTrue(self.res["detail"].startswith("POLL_FAILED_"))

    def test_deadline_with_the_command_still_running_is_unknown_with_reconciliation_steps(self):
        self.script("invocations.json", [inv(None, raw="", status="InProgress", details="InProgress", rc=-1)])
        self.assertEqual(self.run_client(extra=["--poll-deadline", "0.5"]), 20)
        self.assertEqual((self.res["outcome"], self.res["detail"]), ("REMOTE_RESULT_UNKNOWN", "POLL_DEADLINE_REACHED"))
        self.assertEqual(self.res["command_id"], CMD_ID)
        self.assertIn("Do NOT re-run", self.res["next_steps"]); self.assertIn("get-command-invocation", self.res["next_steps"])
        self.assertEqual(len(self.calls("send-command")), 1)

    def test_a_cancelled_runner_reports_unknown_and_never_claims_the_remote_stopped(self):
        self.script("invocations.json", [inv(None, raw="", status="InProgress", details="InProgress", rc=-1)])
        env = dict(os.environ, PATH="%s:%s" % (self.bin, os.environ["PATH"]), AWS_CONFIG_FILE="/nonexistent/c", AWS_SHARED_CREDENTIALS_FILE="/nonexistent/k")
        argv = [sys.executable, "-I", str(CLIENT), "deploy", "--packet", str(self.packet), "--instance-id", INSTANCE, "--region", REGION, "--host-config", "/etc/the-bha/host.conf",
                "--out", str(self.out), "--correlation", CORR, "--poll-interval", "0.1", "--poll-deadline", "30"]
        proc = subprocess.Popen(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for _ in range(100):
            if (self.d / "polls").exists(): break
            time.sleep(0.1)
        proc.send_signal(signal.SIGTERM)
        out, _ = proc.communicate(timeout=30)
        res = json.loads((self.out / "result.json").read_text())
        self.assertEqual((proc.returncode, res["outcome"], res["detail"]), (20, "REMOTE_RESULT_UNKNOWN", "CANCELLED_BY_RUNNER_REMOTE_STATE_UNKNOWN"))
        self.assertEqual(res["command_id"], CMD_ID)
        self.assertEqual(len(self.calls("send-command")), 1)


class Classification(Client):
    def run_with(self, step, **kw):
        self.script("invocations.json", [step])
        shutil.rmtree(self.out, ignore_errors=True); (self.d / "polls").unlink(missing_ok=True)
        return self.run_client(**kw)

    def test_success_with_a_bad_result_is_never_a_pass(self):
        g = self.good()
        cases = {
            "missing output": inv(None, raw=""), "two lines": inv(None, raw=json.dumps(g) + "\n" + json.dumps(g) + "\n"), "not json": inv(None, raw="Healthy\n"),
            "truncated": inv(None, raw=json.dumps(g) + " " * 24000), "nan": inv(None, raw=json.dumps(g).replace('"downtime_seconds": 3', '"downtime_seconds": NaN') + "\n"),
            "array": inv(None, raw="[1]\n"), "extra key": inv(dict(g, extra=1)), "missing key": inv({k: v for k, v in g.items() if k != "cleanup"}),
            "wrong sha": inv(dict(g, source_sha="f" * 40)), "wrong correlation": inv(dict(g, correlation="0" * 32)), "wrong image": inv(dict(g, image="other@sha256:" + "0" * 64)),
            "wrong command": inv(dict(g, command="rollback")), "version": inv(dict(g, v=2)), "bool as int": inv(dict(g, engine_exit=False)),
            "string exit": inv(dict(g, engine_exit="0")), "float downtime": inv(dict(g, downtime_seconds=1.5)), "reverified string": inv(dict(g, reverified="true")),
            "unknown release": inv(dict(g, release="WORKED")), "unknown cleanup": inv(dict(g, cleanup="MAYBE")), "bad charset": inv(dict(g, detail="a bé")),
            "engine status disagrees": inv(dict(g, engine_status="ALREADY_CURRENT")),
        }
        for name, step in cases.items():
            code = self.run_with(step)
            self.assertEqual((code, self.res["outcome"]), (12, "RESULT_INVALID"), name)

    def test_status_response_code_and_identity_must_agree(self):
        g = self.good()
        for name, step in {"success but rc 1": inv(g, rc=1), "failed but rc 0": inv(g, status="Failed", details="Failed", rc=0), "details differ": inv(g, details="Failed"),
                           "rc not int": inv(g, rc="0"), "rc bool": inv(g, rc=False), "other command id": inv(g, CommandId="99999999-2222-3333-4444-555555555555"),
                           "other instance": inv(g, InstanceId="i-0aaaaaaaaaaaaaaaa"), "other document": inv(g, DocumentName="AWS-RunPowerShellScript"),
                           "other plugin": inv(g, PluginName="aws:runPowerShellScript")}.items():
            self.assertEqual(self.run_with(step), 12, name)

    def test_release_failures_are_failures_even_when_the_service_was_restored(self):
        for release, estatus, exit_code in (("FAILED_ROLLED_BACK", "DEPLOY_FAILED_ROLLED_BACK", 30), ("ROLLBACK_FAILED", "ROLLBACK_FAILED", 40), ("LOCK_BUSY", "LOCK_BUSY", 50),
                                             ("INTERRUPTED_STATE", "INTERRUPTED_STATE", 60), ("REJECTED", "REJECTED_BEFORE_STOP", 20), ("STATE_RECONCILE_REQUIRED", "", 0),
                                             ("STATE_SYNC_FAILED", "SUCCESS", 0), ("ENGINE_TIMEOUT", "WATCHDOG", 137), ("REGISTRY_LOGIN_FAILED", "", 0)):
            g = self.good(release=release, engine_status=estatus, engine_exit=exit_code, state_sync="NOT_NEEDED", detail="X")
            code = self.run_with(inv(g, status="Failed", details="Failed", rc=1))
            self.assertEqual((code, self.res["outcome"], self.res["release"]), (10, "RELEASE_FAILED", release), release)
            self.assertNotEqual(self.res["outcome"], "PASS")
        # a release failure that arrives with an aggregated Success/0 is not a pass either
        g = self.good(release="FAILED_ROLLED_BACK", engine_status="DEPLOY_FAILED_ROLLED_BACK", engine_exit=30)
        self.assertEqual(self.run_with(inv(g)), 10)

    def test_success_claims_with_incomplete_follow_up_are_incomplete(self):
        for over in ({"cleanup": "FAILED"}, {"detail": "NEW_RELEASE__EVIDENCE_CLEANUP_FAILED"}, {"state_sync": "FAILED"}, {"state_sync": "NOT_NEEDED"}, {"reverified": False}):
            code = self.run_with(inv(self.good(**over), status="Failed", details="Failed", rc=1))
            self.assertEqual((code, self.res["outcome"]), (11, "RELEASE_INCOMPLETE"), over)
            self.assertIn("Do NOT re-run", self.res["next_steps"])
        self.assertEqual(self.run_with(inv(self.good(cleanup="FAILED"))), 11)                    # even with an aggregated Success/0

    def test_already_current_passes_and_a_failing_engine_exit_does_not(self):
        g = self.good(release="ALREADY_CURRENT", engine_status="ALREADY_CURRENT", detail="SAME")
        self.assertEqual(self.run_with(inv(g)), 0)
        self.assertEqual(self.run_with(inv(self.good(engine_exit=30))), 12)

    def test_timeouts_cancellation_and_bootstrap_failures(self):
        self.assertEqual(self.run_with(inv(None, raw="", status="TimedOut", details="DeliveryTimedOut", rc=-1)), 10)
        self.assertEqual(self.res["detail"], "DELIVERY_TIMED_OUT_NOTHING_RAN")
        self.assertEqual(self.run_with(inv(None, raw="", status="TimedOut", details="ExecutionTimedOut", rc=-1)), 20)          # may have been mid-run
        self.assertEqual(self.run_with(inv(None, raw="", status="Cancelled", details="Cancelled", rc=-1)), 20)
        boot = {"v": 1, "correlation": CORR, "command": "deploy", "source_sha": self.sha, "release": "BOOTSTRAP_FAILED", "detail": "HASH_MISMATCH:backend-deploy.sh"}
        self.assertEqual(self.run_with(inv(boot, status="Failed", details="Failed", rc=1)), 10)
        self.assertEqual((self.res["release"], self.res["detail"]), ("BOOTSTRAP_FAILED", "HASH_MISMATCH:backend-deploy.sh"))
        self.assertEqual(self.run_with(inv(dict(boot, correlation="0" * 32), status="Failed", details="Failed", rc=1)), 12)

    def test_rollback_and_recover_confirm_their_own_outcomes(self):
        shutil.rmtree(self.out, ignore_errors=True)
        self.assertEqual(self.gen(out=self.d / "out2", image_uri=None, image_digest=None, no_image=True).returncode, 0)
        p2 = self.d / "out2/packet.json"
        for action, release in (("rollback", "ROLLED_BACK"), ("rollback", "ALREADY_ROLLED_BACK"), ("recover", "RECOVERED")):
            g = result(action, self.sha, "", release=release, engine_status=release)
            self.script("invocations.json", [inv(g)])
            shutil.rmtree(self.out, ignore_errors=True); (self.d / "polls").unlink(missing_ok=True)
            self.assertEqual(self.run_client(action, packet=p2), 0, (action, release))
        g = result("rollback", self.sha, "", release="SUCCESS", engine_status="SUCCESS")         # a deploy outcome is not a rollback outcome
        self.script("invocations.json", [inv(g)]); shutil.rmtree(self.out, ignore_errors=True); (self.d / "polls").unlink(missing_ok=True)
        self.assertEqual(self.run_client("rollback", packet=p2), 12)
        self.assertEqual(self.run_client("deploy", packet=p2), 30)                              # deploy without an image is refused locally

    def test_invalid_arguments_and_packets_never_reach_aws(self):
        for bad in (["--instance-id", "i-123"], ["--instance-id", "mi-0123456789abcdef0"], ["--region", "Sydney"], ["--host-config", "relative"], ["--host-config", "/etc/../x"]):
            argv = [sys.executable, "-I", str(CLIENT), "deploy", "--packet", str(self.packet), "--instance-id", INSTANCE, "--region", REGION, "--host-config", "/etc/the-bha/host.conf", "--out", str(self.out)]
            argv[argv.index(bad[0]) + 1] = bad[1]
            p = subprocess.run(argv, env=dict(os.environ, PATH="%s:%s" % (self.bin, os.environ["PATH"])), capture_output=True, text=True)
            self.assertEqual(p.returncode, 30, bad)
        tampered = self.d / "tampered.json"; doc = json.loads(self.packet.read_text()); doc["files"][0]["sha256"] = "zz"; tampered.write_text(json.dumps(doc))
        self.assertEqual(self.run_client(packet=tampered), 30)
        self.assertEqual(self.calls("send-command"), [])


class TimeoutBudget(unittest.TestCase):
    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("ssm_client", CLIENT); self.m = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.m)

    def test_ordering_that_keeps_the_numbers_safe(self):
        m = self.m
        self.assertEqual((m.OVERHEAD, m.WATCHDOG, m.GRACE, m.EXEC_TIMEOUT, m.DELIVERY_TIMEOUT), (240, 900, 300, 1500, 120))
        self.assertLess(m.OVERHEAD + m.WATCHDOG + m.GRACE, m.EXEC_TIMEOUT)                    # remote worst case < SSM execution timeout
        self.assertEqual(m.POLL_DEADLINE, m.DELIVERY_TIMEOUT + m.EXEC_TIMEOUT + m.POLL_MARGIN)  # the poll outlives delivery + execution
        self.assertGreater(m.POLL_DEADLINE, m.DELIVERY_TIMEOUT + m.EXEC_TIMEOUT)
        self.assertGreaterEqual(m.DELIVERY_TIMEOUT, 30)                                       # AWS minimum for --timeout-seconds
        self.assertEqual(m.check_budget(), m.POLL_DEADLINE)
        with self.assertRaises(m.Refused): m.check_budget(watchdog=1300)
        with self.assertRaises(m.Refused): m.check_budget(delivery=10)
        with self.assertRaises(m.Refused): m.check_budget(margin=0)
        # the Actions job (40 minutes) outlives the poll by more than a packet build + credentials + report
        import re
        wf = (SCRIPTS.parents[2] / ".github/workflows/backend-image.yml").read_text()
        minutes = int(re.search(r"deploy-main:.*?timeout-minutes: (\d+)", wf, re.S).group(1))
        self.assertGreater(minutes * 60, m.POLL_DEADLINE + 300)
        # the wrapper's watchdog is the same number
        self.assertIn("-k 300 900", (SCRIPTS / "backend-remote-release.sh").read_text())


if __name__ == "__main__":
    unittest.main()
