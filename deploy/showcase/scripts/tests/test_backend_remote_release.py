#!/usr/bin/env python3
"""
BHA-BACKEND-CD-001-CP03 tests: backend-remote-release.sh (host wrapper around the CP02 engine).

The real wrapper runs unchanged. `docker`, `aws` (ECR login only) and `curl` are stubs over a small JSON model, and the CP02 engine
is a scripted stub staged as backend-deploy.sh (it only changes the modelled container and the engine record, like the real one).
The real engine is exercised end to end in rehearse_backend_ssm_release.sh. Nothing here touches Docker, AWS or the network.
"""
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(os.environ.get("SCRIPTS_UNDER_TEST") or Path(__file__).resolve().parents[1])
WRAPPER = SCRIPTS / "backend-remote-release.sh"
REGION = "ap-southeast-2"
REGISTRY = "123456789012.dkr.ecr.%s.amazonaws.com" % REGION
REPO = REGISTRY + "/the-bha-api"
SHA, OLD_SHA = "a" * 40, "b" * 40
CORR = "c0ffee00c0ffee00c0ffee00c0ffee00"
TOKEN = "CANARY-ecr-token-9d41"
OLD_REF, NEW_REF, THIRD_REF = (REPO + "@sha256:" + c * 64 for c in "123")
OLD_ID, NEW_ID, THIRD_ID = ("sha256:" + c * 64 for c in "abc")

DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
st = json.load(open(os.path.join(D, "docker.json")))
a = sys.argv[1:]
open(os.path.join(D, "docker.log"), "a").write(" ".join(a[:3]) + "\n")
if a[:2] == ["container", "inspect"]:
    c = st["container"]
    if not c or a[2] != "the-bha-api": sys.stderr.write("Error: No such container\n"); sys.exit(1)
    print(json.dumps([{"Id": c["id"], "Image": c["image_id"], "State": {"Running": c["running"]}, "Config": {"Image": c["ref"], "Labels": {}, "Env": ["SECRET=" + os.environ.get("CANARY", "")]}}])); sys.exit(0)
if a[:2] == ["image", "inspect"]:
    i = st["images"].get(a[2])
    if not i: sys.stderr.write("Error: No such image\n"); sys.exit(1)
    print(json.dumps([{"Id": i["id"], "RepoDigests": [a[2]], "Config": {"Labels": {"org.opencontainers.image.revision": i["revision"]}}}])); sys.exit(0)
if a[0] == "login":
    data = sys.stdin.read()
    open(os.path.join(D, "login.json"), "w").write(json.dumps({"args": a, "stdin_len": len(data), "docker_config": os.environ.get("DOCKER_CONFIG", "")}))
    if os.path.exists(os.path.join(D, "login-fails")): sys.exit(1)
    sys.exit(0)
sys.exit(99)
'''
AWS = r'''#!/usr/bin/env python3
import os, sys
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if sys.argv[1:3] == ["ecr", "get-login-password"]:
    if os.path.exists(os.path.join(D, "token-fails")): sys.stderr.write("An error occurred (AccessDeniedException)\n"); sys.exit(254)
    open(os.path.join(D, "aws.env"), "w").write("\n".join(k for k in os.environ if k.startswith("AWS_")))
    print(os.environ.get("TOKEN_VALUE", "")); sys.exit(0)
sys.exit(99)
'''
CURL = r'''#!/usr/bin/env python3
import json, os, sys
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
st = json.load(open(os.path.join(D, "docker.json")))
if st["container"] and st["container"]["running"] and not os.path.exists(os.path.join(D, "not-ready")): sys.stdout.write("Healthy200"); sys.exit(0)
sys.exit(7)
'''
ENGINE = r'''#!/usr/bin/env python3
import json, os, re, sys, time
D = os.environ["STUB_DIR"]
sc = json.load(open(os.path.join(D, "engine.json")))
open(os.path.join(D, "engine.args"), "a").write(json.dumps(sys.argv[1:]) + "\n")
dk = json.load(open(os.path.join(D, "docker.json")))
if "serve" in sc:
    ref = sc["serve"]; dk["container"] = dict(dk["container"], image_id=dk["images"][ref]["id"], ref=ref, running=True, id=sc.get("container_id", dk["container"]["id"]))
    json.dump(dk, open(os.path.join(D, "docker.json"), "w"))
if "record" in sc:
    j = [a for a in sys.argv if a.startswith("/")]
    cfg = sys.argv[sys.argv.index("--config") + 1]
    journal = [l.split("=", 1)[1] for l in open(cfg).read().split("\n") if l.startswith("JOURNAL_DIR=")][0]
    os.makedirs(journal + "/records", exist_ok=True)
    open(journal + "/records/latest", "w").write("".join("%s=%s\n" % kv for kv in sc["record"].items()))
if "edit_config" in sc:
    cfg = sys.argv[sys.argv.index("--config") + 1]
    t = open(cfg).read().split("\n"); t = [sc["edit_config"] if l.startswith("EXPECTED_CURRENT_IMAGE=") else l for l in t]; open(cfg, "w").write("\n".join(t))
if "sleep" in sc: time.sleep(sc["sleep"])
body = sc.get("raw")
if body is None:
    body = json.dumps({"status": sc["status"], "detail": sc.get("detail", "X"), "exit": sc.get("exit", 0), "command": sys.argv[1], "run_id": "20261009T000000Z-deadbeef",
                       "target": "the-bha-api", "image": "", "source_sha": "", "candidate_id": "", "previous_id": "", "downtime_seconds": 3})
sys.stdout.write(body + "\n")
sys.exit(sc.get("exit", 0))
'''


class Host(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="bha-cp03-rw-"))
        self.addCleanup(shutil.rmtree, self.d, True)
        self.bin = self.d / "bin"; self.bin.mkdir()
        for n, body in (("docker", DOCKER), ("aws", AWS), ("curl", CURL)):
            (self.bin / n).write_text(body); os.chmod(self.bin / n, 0o755)
        self.lock = self.d / "lock"; self.lock.mkdir()
        self.journal = self.d / "journal"; self.journal.mkdir(mode=0o700)
        self.stage_root = self.d / "stage"; self.stage_root.mkdir(mode=0o700)
        self.stage = self.stage_root / CORR
        (self.stage / "bin").mkdir(parents=True)
        self.engine = self.stage / "bin" / "backend-deploy.sh"
        self.engine.write_text(ENGINE); os.chmod(self.engine, 0o700)
        self.write_packet()
        self.cfg_lines = ["# host config fixture", "TARGET_CONTAINER=the-bha-api", "ALLOWED_IMAGE_REPOSITORY=" + REPO, "EXPECTED_SOURCE_URL=https://github.com/o/r",
                          "EXPECTED_CURRENT_IMAGE=" + OLD_REF, "LOOPBACK_PORT=8080", "JOURNAL_DIR=" + str(self.journal), "ENV_FILE=/etc/the-bha/api.env",
                          "PG_SERVICE=bha-app-read", "API_BASE_URL=https://api.example.invalid", ""]
        (self.d / "cfg").mkdir(); self.cfg = self.d / "cfg" / "host.conf"; self.write_cfg()
        self.packet_text = (self.stage / "packet.json").read_text()
        self.model(running_ref=OLD_REF)
        self.scenario({"status": "SUCCESS"})

    def write_packet(self, image=NEW_REF, sha=SHA, repository="o/r"):
        doc = {"format": 1, "repository": repository, "source_sha": sha, "image": image, "run_id": 1, "run_attempt": 1,
               "raw_base": "https://raw.githubusercontent.com/%s/%s" % (repository, sha), "files": [],
               "manifest": {"format": 1, "source_sha": sha, "count": 1, "migrations": ["20260101000000_First"]}}
        (self.stage / "packet.json").write_text(json.dumps(doc))

    def write_cfg(self):
        self.cfg.write_text("\n".join(self.cfg_lines)); os.chmod(self.cfg, 0o600)

    def model(self, running_ref=OLD_REF, running=True, container_id="9" * 64):
        imgs = {OLD_REF: {"id": OLD_ID, "revision": OLD_SHA}, NEW_REF: {"id": NEW_ID, "revision": SHA}, THIRD_REF: {"id": THIRD_ID, "revision": "c" * 40}}
        self.dk = {"images": imgs, "container": {"id": container_id, "image_id": imgs[running_ref]["id"], "ref": running_ref, "running": running}}
        (self.d / "docker.json").write_text(json.dumps(self.dk))

    def scenario(self, sc):
        (self.d / "engine.json").write_text(json.dumps(sc))

    def record(self, **kv):
        return {"RECORD_STATE": "SUCCEEDED", "CAND_ID": "8" * 64, "CAND_IMAGE_ID": NEW_ID, "OLD_ID": "9" * 64, "OLD_IMAGE_ID": OLD_ID, "SOURCE_SHA": SHA, "RECORD_RUN_ID": "r1", **kv}

    def success_scenario(self, **over):
        sc = {"status": "SUCCESS", "detail": "NEW_RELEASE", "exit": 0, "serve": NEW_REF, "container_id": "8" * 64, "record": self.record()}
        sc.update(over)
        self.scenario(sc)

    def go(self, action="deploy", extra_env=None, stage=None, corr=CORR, args=None):
        env = dict(os.environ, PATH="%s:/usr/bin:/bin" % self.bin, STUB_DIR=str(self.d), BHA_RELEASE_LOCK_DIR=str(self.lock), TOKEN_VALUE=TOKEN, CANARY=TOKEN)
        env.update(extra_env or {})
        argv = ["bash", str(WRAPPER), action] + (args if args is not None else
               ["--packet", str((stage or self.stage) / "packet.json"), "--stage", str(stage or self.stage), "--host-config", str(self.cfg), "--correlation", corr, "--region", REGION])
        self.p = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=60)
        self.res = self.parse(self.p.stdout)
        return self.p.returncode

    @staticmethod
    def parse(out):
        assert out.endswith("\n") and out.count("\n") == 1, "stdout is not exactly one line: %r" % out[:200]
        return json.loads(out)

    def mk_stage(self, corr):
        s = self.stage_root / corr; (s / "bin").mkdir(parents=True)
        (s / "bin" / "backend-deploy.sh").write_text(ENGINE); os.chmod(s / "bin" / "backend-deploy.sh", 0o700); (s / "packet.json").write_text(self.packet_text)
        return s

    def cfg_with(self, ref):
        return "\n".join(("EXPECTED_CURRENT_IMAGE=" + ref) if l.startswith("EXPECTED_CURRENT_IMAGE=") else l for l in self.cfg_lines)

    def state(self):
        p = self.journal / "release-state"
        return dict(l.split("=", 1) for l in p.read_text().splitlines()) if p.exists() else {}

    def engine_calls(self):
        p = self.d / "engine.args"
        return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []

    def container_ref(self):
        return json.loads((self.d / "docker.json").read_text())["container"]["ref"]


class Deploy(Host):
    def test_success_advances_only_the_expected_image_line_atomically(self):
        self.success_scenario()
        before_mode = None
        self.assertEqual(self.go(), 0, self.p.stdout + self.p.stderr)
        r = self.res
        self.assertEqual((r["v"], r["release"], r["engine_status"], r["engine_exit"], r["state_sync"], r["reverified"], r["cleanup"]), (1, "SUCCESS", "SUCCESS", 0, "OK", True, "OK"))
        self.assertEqual((r["correlation"], r["command"], r["source_sha"], r["image"], r["target"]), (CORR, "deploy", SHA, NEW_REF, "the-bha-api"))
        self.assertEqual(self.cfg.read_text(), self.cfg_with(NEW_REF))                          # every other byte of the private config is unchanged
        self.assertEqual(stat.S_IMODE(self.cfg.stat().st_mode), 0o600)
        self.assertEqual(self.state()["CURRENT_IMAGE"], NEW_REF); self.assertEqual(self.state()["PREVIOUS_IMAGE"], OLD_REF); self.assertEqual(self.state()["PENDING"], "")
        call = self.engine_calls()[0]
        self.assertEqual(call[0], "deploy")
        for flag, val in (("--image", NEW_REF), ("--source-sha", SHA)):
            self.assertEqual(call[call.index(flag) + 1], val)
        self.assertEqual(json.loads((self.stage / "manifest.json").read_text()) if (self.stage / "manifest.json").exists() else {"gone": 1}, {"gone": 1})   # staging removed
        self.assertFalse(self.stage.exists())
        self.assertEqual(sorted(p.name for p in self.journal.iterdir() if p.name.startswith(".")), [])   # no temp file left behind

    def test_a_dead_end_pending_never_survives_a_clean_success(self):
        self.success_scenario()
        self.go()
        self.assertEqual(self.state().get("PENDING"), "")

    def test_already_current_changes_nothing_and_keeps_the_known_previous_release(self):
        self.journal.joinpath("release-state").write_text("CURRENT_IMAGE=%s\nPENDING=\nPREVIOUS_IMAGE=%s\n" % (NEW_REF, OLD_REF))
        self.cfg_lines[[i for i, l in enumerate(self.cfg_lines) if l.startswith("EXPECTED_CURRENT_IMAGE=")][0]] = "EXPECTED_CURRENT_IMAGE=" + NEW_REF; self.write_cfg()
        self.model(running_ref=NEW_REF)
        self.scenario({"status": "ALREADY_CURRENT", "detail": "SAME", "exit": 0})
        before = self.cfg.read_text()
        self.assertEqual(self.go(), 0, self.p.stdout)
        self.assertEqual((self.res["release"], self.cfg.read_text()), ("ALREADY_CURRENT", before))
        self.assertEqual((self.state()["CURRENT_IMAGE"], self.state()["PREVIOUS_IMAGE"]), (NEW_REF, OLD_REF))

    def test_engine_failures_are_release_failures_and_config_is_not_advanced(self):
        for status, release, code in (("DEPLOY_FAILED_ROLLED_BACK", "FAILED_ROLLED_BACK", 30), ("REJECTED_BEFORE_STOP", "REJECTED", 20), ("LOCK_BUSY", "LOCK_BUSY", 50),
                                      ("CONFIG_INVALID", "CONFIG_INVALID", 2), ("PREREQUISITE_MISSING", "PREREQUISITE_MISSING", 3)):
            with self.subTest(status):
                self.setUp()
                self.scenario({"status": status, "detail": "X", "exit": code})
                self.assertNotEqual(self.go(), 0)
                self.assertEqual((self.res["release"], self.res["engine_status"], self.res["engine_exit"]), (release, status, code))
                self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF)); self.assertEqual(self.state()["PENDING"], "")      # the old release still serves
                self.assertEqual(self.res["reverified"], True)

    def test_rollback_failed_and_interrupted_keep_the_intent_and_block_the_next_run_until_reconciled(self):
        for status, release, code in (("ROLLBACK_FAILED", "ROLLBACK_FAILED", 40), ("INTERRUPTED_STATE", "INTERRUPTED_STATE", 60)):
            with self.subTest(status):
                self.setUp()
                self.scenario({"status": status, "detail": "X", "exit": code})
                self.assertNotEqual(self.go(), 0)
                self.assertEqual(self.res["release"], release)
                self.assertTrue(self.state()["PENDING"].startswith("deploy|" + CORR))
                self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF))
                # something else serves now: the next run must NOT guess and must NOT reach the engine
                self.model(running_ref=THIRD_REF); n = len(self.engine_calls())
                s2 = self.mk_stage("d" * 32)
                self.assertNotEqual(self.go(corr="d" * 32, stage=s2), 0)
                self.assertEqual((self.res["release"], len(self.engine_calls())), ("STATE_RECONCILE_REQUIRED", n))

    def test_cleanup_failure_is_reported_next_to_the_real_outcome_without_undoing_it(self):
        self.success_scenario(detail="NEW_RELEASE__EVIDENCE_CLEANUP_FAILED")
        self.assertNotEqual(self.go(), 0)
        self.assertEqual((self.res["release"], self.res["cleanup"], self.res["state_sync"]), ("SUCCESS", "FAILED", "OK"))
        self.assertEqual(self.cfg.read_text(), self.cfg_with(NEW_REF))                          # the release really is running: the metadata follows reality

    def test_engine_output_problems_are_never_read_as_success(self):
        for sc in ({"raw": "", "exit": 0}, {"raw": "not json", "exit": 0}, {"raw": '{"status":"SUCCESS"}', "exit": 0},
                   {"status": "SUCCESS", "exit": 0, "serve": NEW_REF, "raw": json.dumps({"status": "SUCCESS", "detail": "X", "exit": 5, "run_id": "r", "downtime_seconds": 1, "candidate_id": "", "previous_id": ""})},
                   {"raw": json.dumps({"status": "SUCCESS", "detail": "X", "exit": True, "run_id": "r", "downtime_seconds": 1, "candidate_id": "", "previous_id": ""}), "exit": 0},
                   {"status": "SURPRISE", "exit": 0}):
            self.setUp(); self.scenario(sc)
            self.assertNotEqual(self.go(), 0, sc)
            self.assertIn(self.res["release"], ("ENGINE_RESULT_INVALID", "STATE_RECONCILE_REQUIRED"), sc)
            self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF))

    def test_a_success_that_the_container_does_not_confirm_is_not_committed(self):
        self.success_scenario(serve=OLD_REF, container_id="9" * 64)                              # engine says SUCCESS, the old image still serves
        self.assertNotEqual(self.go(), 0)
        self.assertEqual((self.res["release"], self.res["state_sync"]), ("STATE_RECONCILE_REQUIRED", "FAILED"))
        self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF))
        self.setUp(); self.success_scenario(record=self.record(CAND_ID="7" * 64))               # record names another container
        self.assertNotEqual(self.go(), 0)
        self.assertEqual(self.res["release"], "STATE_RECONCILE_REQUIRED")
        self.setUp(); self.success_scenario(record=self.record(RECORD_STATE="ROLLED_BACK_EXPLICIT"))
        self.assertNotEqual(self.go(), 0)
        self.assertEqual(self.res["release"], "STATE_SYNC_FAILED")
        self.setUp(); self.success_scenario(record=self.record(SOURCE_SHA="f" * 40))
        self.assertNotEqual(self.go(), 0)
        self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF))

    def test_service_not_ready_after_the_commit_is_reported_not_reverified(self):
        self.success_scenario()
        (self.d / "not-ready").write_text("1")
        self.assertNotEqual(self.go(), 0)
        self.assertEqual((self.res["release"], self.res["reverified"]), ("SUCCESS", False))


class StateReconciliation(Host):
    def test_config_write_failure_leaves_a_pending_intent_and_the_retry_completes_it_from_evidence(self):
        self.success_scenario()
        os.chmod(self.cfg.parent, 0o500)                                                        # the config directory cannot take the temp file
        try:
            self.assertNotEqual(self.go(), 0)
        finally:
            os.chmod(self.cfg.parent, 0o700)
        self.assertEqual((self.res["release"], self.res["state_sync"]), ("STATE_SYNC_FAILED", "FAILED"))
        self.assertEqual(self.container_ref(), NEW_REF)                                          # the report says which release actually runs
        self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF))
        self.assertTrue(self.state()["PENDING"].startswith("deploy|"))
        # the retry (same request) reconciles from the record, then the engine reports ALREADY_CURRENT
        self.scenario({"status": "ALREADY_CURRENT", "detail": "SAME", "exit": 0})
        self.assertEqual(self.go(corr="e" * 32, stage=self.mk_stage("e" * 32)), 0, self.p.stdout)
        self.assertEqual(self.cfg.read_text(), self.cfg_with(NEW_REF)); self.assertEqual(self.state()["PENDING"], "")

    def test_pending_after_a_crash_between_swap_and_metadata_is_completed_only_with_matching_evidence(self):
        self.journal.joinpath("release-state").write_text("CURRENT_IMAGE=%s\nPENDING=deploy|%s|%s|%s\nPREVIOUS_IMAGE=\n" % (OLD_REF, "f" * 32, OLD_REF, NEW_REF))
        self.model(running_ref=NEW_REF, container_id="8" * 64)
        (self.journal / "records").mkdir(); (self.journal / "records/latest").write_text("".join("%s=%s\n" % kv for kv in self.record().items()))
        self.scenario({"status": "ALREADY_CURRENT", "detail": "SAME", "exit": 0})
        self.assertEqual(self.go(), 0, self.p.stdout)
        self.assertEqual(self.cfg.read_text(), self.cfg_with(NEW_REF))
        self.assertEqual((self.state()["CURRENT_IMAGE"], self.state()["PREVIOUS_IMAGE"]), (NEW_REF, OLD_REF))

    def test_disagreements_fail_closed_before_the_engine_runs(self):
        cases = {
            "pending but a third release serves": lambda: (self.journal.joinpath("release-state").write_text("CURRENT_IMAGE=%s\nPENDING=deploy|%s|%s|%s\n" % (OLD_REF, "f" * 32, OLD_REF, NEW_REF)), self.model(running_ref=THIRD_REF)),
            "pending deploy, new serves, no record": lambda: (self.journal.joinpath("release-state").write_text("CURRENT_IMAGE=%s\nPENDING=deploy|%s|%s|%s\n" % (OLD_REF, "f" * 32, OLD_REF, NEW_REF)), self.model(running_ref=NEW_REF)),
            "config differs from the release state": lambda: self.journal.joinpath("release-state").write_text("CURRENT_IMAGE=%s\nPENDING=\n" % NEW_REF),
            "bootstrap digest is not what runs": lambda: self.model(running_ref=THIRD_REF),
            "container missing": lambda: self.model(running=False),
        }
        for name, setup in cases.items():
            with self.subTest(name):
                self.setUp(); setup()
                self.assertNotEqual(self.go(), 0)
                self.assertEqual(self.res["release"], "STATE_RECONCILE_REQUIRED", name)
                self.assertEqual(self.engine_calls(), [], name)                                  # nothing was touched
                self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF), name)

    def test_a_concurrent_edit_of_the_expected_image_is_detected_not_overwritten(self):
        self.success_scenario(edit_config="EXPECTED_CURRENT_IMAGE=" + THIRD_REF)                 # somebody edits the field while the engine runs
        self.assertNotEqual(self.go(), 0)
        self.assertEqual(self.res["release"], "STATE_SYNC_FAILED")
        self.assertIn("EXPECTED_CURRENT_IMAGE=" + THIRD_REF, self.cfg.read_text())

    def test_first_run_bootstraps_from_the_owner_verified_digest_only_if_it_is_what_runs(self):
        self.success_scenario()
        self.assertFalse((self.journal / "release-state").exists())
        self.assertEqual(self.go(), 0)
        self.assertTrue((self.journal / "release-state").exists())

    def test_rollback_returns_to_the_recorded_previous_release_and_syncs_the_config(self):
        self.success_scenario(); self.go()
        self.setUp_stage_again()
        self.scenario({"status": "ROLLED_BACK", "detail": "PREVIOUS", "exit": 0, "serve": OLD_REF, "container_id": "9" * 64, "record": self.record(RECORD_STATE="ROLLED_BACK_EXPLICIT")})
        self.assertEqual(self.go("rollback", corr="e" * 32, stage=self.stage_root / ("e" * 32)), 0, self.p.stdout)
        self.assertEqual((self.res["release"], self.res["command"], self.res["state_sync"]), ("ROLLED_BACK", "rollback", "OK"))
        self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF)); self.assertEqual((self.state()["CURRENT_IMAGE"], self.state()["PREVIOUS_IMAGE"]), (OLD_REF, NEW_REF))
        self.assertEqual(self.engine_calls()[-1][0], "rollback")

    def setUp_stage_again(self):
        self.mk_stage("e" * 32)
        self.assertTrue((self.stage_root / ("e" * 32) / "bin" / "backend-deploy.sh").exists())

    def test_rollback_that_the_record_or_container_does_not_confirm_is_not_committed(self):
        self.success_scenario(); self.go(); self.setUp_stage_again()
        self.scenario({"status": "ROLLED_BACK", "detail": "X", "exit": 0, "serve": THIRD_REF, "record": self.record(RECORD_STATE="ROLLED_BACK_EXPLICIT")})
        self.assertNotEqual(self.go("rollback", corr="e" * 32, stage=self.stage_root / ("e" * 32)), 0)
        self.assertEqual(self.res["release"], "STATE_RECONCILE_REQUIRED")
        self.assertEqual(self.cfg.read_text(), self.cfg_with(NEW_REF))

    def test_rollback_without_a_known_previous_release_is_refused_before_the_engine(self):
        self.assertNotEqual(self.go("rollback"), 0)
        self.assertEqual(self.res["detail"], "NO_PREVIOUS_RELEASE_RECORDED"); self.assertEqual(self.engine_calls(), [])

    def test_recover_syncs_to_whatever_known_release_actually_serves(self):
        self.journal.joinpath("release-state").write_text("CURRENT_IMAGE=%s\nPENDING=deploy|%s|%s|%s\nPREVIOUS_IMAGE=\n" % (OLD_REF, "f" * 32, OLD_REF, NEW_REF))
        self.model(running_ref=OLD_REF)
        self.scenario({"status": "RECOVERED", "detail": "PREVIOUS_RELEASE_RESTORED_AND_VERIFIED", "exit": 0})
        self.assertEqual(self.go("recover"), 0, self.p.stdout)
        self.assertEqual((self.res["release"], self.res["state_sync"], self.state()["PENDING"]), ("RECOVERED", "OK", ""))
        self.assertEqual(self.cfg.read_text(), self.cfg_with(OLD_REF))
        # a serving image that is no known release is escalated, not adopted
        self.setUp()
        self.journal.joinpath("release-state").write_text("CURRENT_IMAGE=%s\nPENDING=deploy|%s|%s|%s\nPREVIOUS_IMAGE=\n" % (OLD_REF, "f" * 32, OLD_REF, NEW_REF))
        self.model(running_ref=THIRD_REF); self.scenario({"status": "RECOVERED", "detail": "X", "exit": 0})
        self.assertNotEqual(self.go("recover"), 0)
        self.assertEqual(self.res["release"], "STATE_RECONCILE_REQUIRED")


class RegistryAndGuards(Host):
    def test_ecr_login_uses_the_instance_profile_and_the_token_goes_through_stdin_only(self):
        self.success_scenario()
        self.assertEqual(self.go(), 0)
        login = json.loads((self.d / "login.json").read_text())
        self.assertEqual(login["args"], ["login", "--username", "AWS", "--password-stdin", REGISTRY])
        self.assertEqual(login["stdin_len"] > 0, True)
        self.assertTrue(login["docker_config"].startswith(str(self.stage_root / CORR)))        # credentials in a private directory of the stage ...
        self.assertFalse(Path(login["docker_config"]).exists())                                 # ... removed with it
        aws_env = (self.d / "aws.env").read_text()
        for runner_secret in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
            self.assertNotIn(runner_secret, aws_env)                                            # no OIDC credentials were handed to the host call
        blob = self.p.stdout + self.p.stderr + "".join(f.read_text(errors="replace") for f in self.journal.rglob("*") if f.is_file())
        self.assertNotIn(TOKEN, blob)

    def test_registry_and_repository_must_match_the_validated_release(self):
        for image, code in ((("127.0.0.1:5000/the-bha-api@sha256:" + "1" * 64), "REGISTRY_NOT_THE_ECR_REGISTRY_OF_THE_REGION"),
                            ("123456789012.dkr.ecr.us-east-1.amazonaws.com/the-bha-api@sha256:" + "1" * 64, "REGISTRY_NOT_THE_ECR_REGISTRY_OF_THE_REGION"),
                            (REGISTRY + "/other-repo@sha256:" + "1" * 64, "IMAGE_REPOSITORY_NOT_THE_CONFIGURED_ONE")):
            self.setUp(); self.write_packet(image=image)
            if code.startswith("REGISTRY"):                                                      # configured repository matches, the registry itself is wrong
                self.cfg_lines = [("ALLOWED_IMAGE_REPOSITORY=" + image.split("@")[0]) if l.startswith("ALLOWED_IMAGE_REPOSITORY=") else l for l in self.cfg_lines]; self.write_cfg()
            self.assertNotEqual(self.go(), 0)
            self.assertEqual((self.res["release"], self.res["detail"]), ("REGISTRY_LOGIN_FAILED", code))
            self.assertEqual(self.engine_calls(), []); self.assertFalse((self.d / "login.json").exists())

    def test_loopback_registry_is_accepted_only_with_the_explicit_test_switch(self):
        loop = "127.0.0.1:5000/the-bha-api"
        self.cfg_lines = [("ALLOWED_IMAGE_REPOSITORY=" + loop) if l.startswith("ALLOWED_IMAGE_REPOSITORY=") else l for l in self.cfg_lines]; self.write_cfg()
        self.write_packet(image=loop + "@sha256:" + "1" * 64)
        self.assertNotEqual(self.go(), 0)
        self.assertEqual(self.res["detail"], "REGISTRY_NOT_THE_ECR_REGISTRY_OF_THE_REGION")
        self.assertNotEqual(self.go(extra_env={"BHA_RELEASE_ALLOW_LOOPBACK_REGISTRY": "1"}), 0)    # passes the registry guard, then stops at reconcile (image not modelled)
        self.assertNotEqual(self.res["detail"], "REGISTRY_NOT_THE_ECR_REGISTRY_OF_THE_REGION")

    def test_login_failures_stop_before_any_container_change(self):
        for flag in ("login-fails", "token-fails"):
            self.setUp(); (self.d / flag).write_text("1")
            self.assertNotEqual(self.go(), 0)
            self.assertEqual((self.res["release"], self.res["detail"]), ("REGISTRY_LOGIN_FAILED", "ECR_LOGIN_FAILED"), flag)
            self.assertEqual(self.engine_calls(), [])

    def test_the_release_lock_is_per_target_and_distinct_from_the_engine_lock(self):
        import fcntl
        lockfile = self.lock / "bha-release-the-bha-api.lock"
        self.assertNotEqual(lockfile.name, "bha-deploy-the-bha-api.lock")                       # the engine's flock is a different file: no deadlock
        fd = os.open(lockfile, os.O_WRONLY | os.O_CREAT, 0o600); fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            self.success_scenario()
            self.assertNotEqual(self.go(extra_env={"BHA_RELEASE_LOCK_WAIT": "1"}), 0)
            self.assertEqual((self.res["release"], self.engine_calls()), ("LOCK_BUSY", []))
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)
        self.setUp(); self.success_scenario()
        self.assertEqual(self.go(), 0)
        self.assertTrue(lockfile.exists())                                                      # never deleted

    def test_bad_arguments_and_packets_are_refused_without_touching_anything(self):
        self.assertNotEqual(self.go(args=["--packet", "x"]), 0)
        self.assertEqual(self.res["release"], "PACKET_INVALID")
        self.assertNotEqual(self.go("explode"), 0)
        for bad in ({"corr": "short"}, {"stage": self.d / "elsewhere"}):
            self.setUp()
            if "stage" in bad: (self.d / "elsewhere").mkdir()
            self.assertNotEqual(self.go(**bad), 0)
            self.assertEqual(self.res["release"], "PACKET_INVALID")
        self.setUp(); self.write_packet(repository="other/repo")
        self.assertNotEqual(self.go(), 0)
        self.assertEqual((self.res["release"], self.res["detail"]), ("CONFIG_INVALID", "REPOSITORY_URL_DIFFERS_FROM_PACKET"))
        self.setUp(); self.write_packet(image="")
        self.assertNotEqual(self.go(), 0)
        self.assertEqual(self.res["detail"], "DEPLOY_WITHOUT_IMAGE")
        self.assertEqual(self.engine_calls(), [])

    def test_a_config_that_is_not_private_is_refused(self):
        os.chmod(self.cfg, 0o644)
        self.assertNotEqual(self.go(), 0)
        self.assertEqual(self.res["detail"], "HOST_CONFIG_NOT_PRIVATE")

    def test_stdout_is_one_json_line_stderr_has_no_values_and_raw_output_stays_in_a_private_log(self):
        self.success_scenario()
        self.go()
        self.assertEqual(self.p.stdout.count("\n"), 1)
        self.assertNotIn(TOKEN, self.p.stderr)
        log = self.journal / "release-logs" / (CORR + ".log")
        self.assertTrue(log.exists()); self.assertEqual(stat.S_IMODE(log.stat().st_mode) & 0o077, 0)


if __name__ == "__main__":
    unittest.main()
