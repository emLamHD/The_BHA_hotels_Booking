#!/usr/bin/env python3
"""
BHA-BACKEND-CD-001-CP01 regression tests: release policy, ECR publish helper, workflow shape, env-name parser.

Nothing here reaches a cloud or a Docker daemon. `aws` and `docker` are stubs first on PATH that keep a tiny
model in a temp directory and log every command; AWS config/credentials/profile/IMDS are neutralised so a stub
miss could not reach a real account. Assertions are about what was (not) called and what the scripts decided.

    python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py" -v
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:  # the workflow-shape tests need PyYAML; the rest of the module does not
    yaml = None

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = ROOT / "deploy" / "showcase" / "scripts"
POLICY = SCRIPTS / "backend-release-policy.sh"
PUBLISH = SCRIPTS / "backend-ecr-publish.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "backend-image.yml"
CI = ROOT / ".github" / "workflows" / "ci.yml"
RUNBOOK = ROOT / "docs" / "runbooks" / "CUST-WEB-SHOWCASE-001-deploy.md"

SHA = "0123456789abcdef0123456789abcdef01234567"
OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98"
URL = "https://github.com/emLamHD/The_BHA_hotels_Booking"
IMAGE_ID = "sha256:" + "a" * 64
DIGEST = "sha256:" + "b" * 64
REGISTRY = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com"

AWS_STUB = r'''#!/usr/bin/env bash
d="$STUB_DIR"; echo "aws $*" >> "$d/log"
[[ "$1 $2" == "ecr describe-repositories" ]] && {
  [[ -n "$REPO_ERR" ]] && { echo "An error occurred ($REPO_ERR) when calling the DescribeRepositories operation: nope" >&2; exit 254; }
  printf '%s\t%s\n' "${REPO_MUT:-IMMUTABLE}" "${REPO_URI:-$REGISTRY/$REPOSITORY}"; exit 0; }
[[ "$1 $2" == "ecr describe-images" ]] && {
  n=$(cat "$d/lookups" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$d/lookups"
  if [[ "$n" == 1 ]]; then mode="${LOOKUP:-absent}"; else mode="${READBACK:-ok}"; fi
  case "$mode" in
    absent) echo "An error occurred (ImageNotFoundException) when calling the DescribeImages operation: The image with imageId {imageTag:'x'} does not exist" >&2; exit 254;;
    exists|ok) echo "${DIGEST:-sha256:$(printf 'b%.0s' $(seq 64))}"; exit 0;;
    denied) echo "An error occurred (AccessDeniedException) when calling the DescribeImages operation: not allowed" >&2; exit 254;;
    repo_missing) echo "An error occurred (RepositoryNotFoundException) when calling the DescribeImages operation: gone" >&2; exit 254;;
    network) echo "Could not connect to the endpoint URL" >&2; exit 255;;
    notfound_wrong_exit) echo "An error occurred (ImageNotFoundException) when calling the DescribeImages operation: x" >&2; exit 1;;
    empty) exit 0;;
    none) echo None; exit 0;;
    invalid) echo "sha256:xyz"; exit 0;;
    other) echo "sha256:$(printf 'c%.0s' $(seq 64))"; exit 0;;
  esac; }
echo "unexpected aws call" >&2; exit 99
'''

DOCKER_STUB = r'''#!/usr/bin/env bash
d="$STUB_DIR"; echo "docker $*" >> "$d/log"
mkdir -p "$d/images"
key() { echo "$1" | tr '/:' '__'; }
case "$1" in
  image) # docker image inspect --format FMT REF
    ref="$5"; f="$d/images/$(key "$ref")"; [[ -e "$f" ]] || { echo "Error: No such image" >&2; exit 1; }
    IFS='|' read -r id rev src < "$f"
    case "$4" in
      *.Id*) echo "$id";; *revision*) echo "$rev";; *source*) echo "$src";; esac;;
  save) ref="$4"; f="$d/images/$(key "$ref")"; [[ -e "$f" ]] || exit 1; { echo "BEGIN"; cat "$f"; } > "$3";;
  load) f="$3"; [[ -n "$LOAD_ID" ]] && { echo "$LOAD_ID|${LOAD_REV:-$SOURCE_SHA}|${LOAD_SRC:-$EXPECT_SOURCE_URL}" > "$d/images/$(key thebha-api:$SOURCE_SHA)"; exit 0; }
        sed -n '2p' "$f" > "$d/images/$(key thebha-api:$SOURCE_SHA)";;
  rmi) rm -f "$d/images/$(key "$2")";;
  tag) cp "$d/images/$(key "$2")" "$d/images/$(key "$3")";;
  push)
    case "${PUSH:-ok}" in
      ok) echo "The push refers to repository [x]"; echo "tag: digest: ${PUSH_DIGEST:-sha256:$(printf 'b%.0s' $(seq 64))} size: 1234";;
      immutable) echo "tag invalid: The image tag already exists in the repository and cannot be overwritten because the repository is immutable" >&2; exit 1;;
      nodigest) echo "pushed";;
    esac;;
  *) echo "unexpected docker call" >&2; exit 99;;
esac
'''


class Env:
    """A scratch directory with stubs, a GITHUB_OUTPUT file and an isolated environment."""

    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix="bha-cd001-"))
        self.bin = self.dir / "bin"
        self.bin.mkdir()
        for name, body in (("aws", AWS_STUB), ("docker", DOCKER_STUB)):
            (self.bin / name).write_text(body)
            (self.bin / name).chmod(0o755)
        self.out = self.dir / "output"
        self.summary = self.dir / "summary"
        self.out.write_text("")
        self.summary.write_text("")

    def base(self, **extra):
        env = {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "STUB_DIR": str(self.dir),
            "GITHUB_OUTPUT": str(self.out),
            "GITHUB_STEP_SUMMARY": str(self.summary),
            "AWS_CONFIG_FILE": "/nonexistent/aws-config",
            "AWS_SHARED_CREDENTIALS_FILE": "/nonexistent/aws-credentials",
            "AWS_EC2_METADATA_DISABLED": "true",
            "HOME": str(self.dir),
        }
        env.update({k: str(v) for k, v in extra.items()})
        return env

    def run(self, script, args=(), **extra):
        return subprocess.run(["bash", str(script), *args], env=self.base(**extra), capture_output=True, text=True, timeout=60)

    def outputs(self):
        return dict(line.split("=", 1) for line in self.out.read_text().splitlines() if "=" in line)

    def log(self):
        p = self.dir / "log"
        return p.read_text() if p.exists() else ""

    def cleanup(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class PlanMatrix(unittest.TestCase):
    def setUp(self):
        self.e = Env()
        self.addCleanup(self.e.cleanup)

    def plan(self, event, ref, **flags):
        self.e.out.write_text("")
        env = dict(EVENT=event, REF=ref, SOURCE_SHA=SHA, GITHUB_SHA=SHA)
        env.update(flags)
        r = self.e.run(POLICY, ["plan"], **env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        o = self.e.outputs()
        return o["lane"], o["publish"], o["source_sha"]

    def test_pull_request_never_publishes_even_with_every_flag_true(self):
        for base in ("refs/pull/7/merge",):
            r = self.e.run(POLICY, ["plan"], EVENT="pull_request", REF=base, SOURCE_SHA=SHA, GITHUB_SHA=OTHER_SHA,
                           MAIN_PUBLISH_ENABLED="true", DEVELOP_PUBLISH_ENABLED="true")
            self.assertEqual(r.returncode, 0)
            o = self.e.outputs()
            self.assertEqual((o["lane"], o["publish"], o["source_sha"]), ("none", "false", SHA))  # PR head, not merge SHA

    def test_main_disabled_unless_exactly_true(self):
        for value in (None, "", "false", "TRUE", "True", "1", "yes", " true", "true "):
            flags = {} if value is None else {"MAIN_PUBLISH_ENABLED": value}
            self.assertEqual(self.plan("push", "refs/heads/main", **flags)[:2], ("main", "false"), repr(value))
        self.assertEqual(self.plan("push", "refs/heads/main", MAIN_PUBLISH_ENABLED="true")[:2], ("main", "true"))

    def test_develop_flag_does_not_enable_main_and_main_flag_does_not_enable_develop(self):
        self.assertEqual(self.plan("push", "refs/heads/main", DEVELOP_PUBLISH_ENABLED="true")[:2], ("main", "false"))
        self.assertEqual(self.plan("push", "refs/heads/develop", MAIN_PUBLISH_ENABLED="true")[:2], ("develop", "false"))
        self.assertEqual(self.plan("push", "refs/heads/develop", DEVELOP_PUBLISH_ENABLED="true")[:2], ("develop", "true"))

    def test_other_refs_and_events_never_publish(self):
        flags = dict(MAIN_PUBLISH_ENABLED="true", DEVELOP_PUBLISH_ENABLED="true")
        for event, ref in (("push", "refs/heads/feature/x"), ("push", "refs/tags/v1"), ("workflow_dispatch", "refs/heads/main"),
                           ("schedule", "refs/heads/main")):
            self.assertEqual(self.plan(event, ref, **flags)[:2], ("none", "false"), (event, ref))

    def test_push_must_build_the_pushed_commit_and_sha_must_be_full(self):
        r = self.e.run(POLICY, ["plan"], EVENT="push", REF="refs/heads/main", SOURCE_SHA=OTHER_SHA, GITHUB_SHA=SHA)
        self.assertNotEqual(r.returncode, 0)
        for bad in ("main", SHA[:7], SHA.upper(), SHA + "0", ""):
            r = self.e.run(POLICY, ["plan"], EVENT="push", REF="refs/heads/main", SOURCE_SHA=bad or "x", GITHUB_SHA=bad or "x")
            self.assertNotEqual(r.returncode, 0, bad)

    def test_inherited_scope_is_reported_as_booleans_never_as_values(self):
        self.plan("push", "refs/heads/main", MAIN_PUBLISH_ENABLED="true", INHERITED_REGION="ap-southeast-2",
                  INHERITED_REPOSITORY="secret-looking-name", INHERITED_ROLE_ARN="")
        o = self.e.outputs()
        self.assertEqual((o["inherited_role_arn_set"], o["inherited_region_set"], o["inherited_repository_set"]),
                         ("false", "true", "true"))
        self.assertNotIn("secret-looking-name", self.e.out.read_text())

    def test_plan_never_fails_because_of_production_scope(self):
        # PR, develop and main-disabled must not depend on production configuration at all
        every = dict(INHERITED_ROLE_ARN="x", INHERITED_REGION="x", INHERITED_REPOSITORY="x")
        self.assertEqual(self.plan("push", "refs/heads/main", **every)[:2], ("main", "false"))
        self.assertEqual(self.plan("push", "refs/heads/develop", DEVELOP_PUBLISH_ENABLED="true", **every)[:2], ("develop", "true"))


MAIN_NAMES = ("BACKEND_RELEASE_AWS_ROLE_ARN", "BACKEND_RELEASE_AWS_REGION", "BACKEND_RELEASE_ECR_REPOSITORY")
LEGACY_NAMES = ("AWS_ROLE_ARN", "AWS_ECR_ROLE_ARN", "AWS_REGION", "ECR_REPOSITORY")


class RequireConfig(unittest.TestCase):
    GOOD = dict(ROLE_ARN="arn:aws:iam::123456789012:role/bha-release", REGION="ap-southeast-2", REPOSITORY="the-bha/api")
    CLEAN = dict(INHERITED_ROLE_ARN_SET="false", INHERITED_REGION_SET="false", INHERITED_REPOSITORY_SET="false")

    def setUp(self):
        self.e = Env()
        self.addCleanup(self.e.cleanup)

    def check(self, lane="main", **over):
        env = dict(self.GOOD, **self.CLEAN)
        env.update(over)
        return self.e.run(POLICY, ["require-config", lane], **env)

    def test_good_config_passes_never_touches_aws_and_exports_the_validated_values(self):
        r = self.check()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(self.e.log(), "")
        o = self.e.outputs()
        self.assertEqual((o["role_arn"], o["region"], o["repository"]), tuple(self.GOOD[k] for k in ("ROLE_ARN", "REGION", "REPOSITORY")))

    def test_each_missing_main_value_fails_naming_the_release_variable_only(self):
        for field, name in zip(("ROLE_ARN", "REGION", "REPOSITORY"), MAIN_NAMES):
            r = self.check(**{field: ""})
            self.assertNotEqual(r.returncode, 0, field)
            self.assertIn(name, r.stdout)
            self.assertNotIn(self.GOOD[field], r.stdout)
            self.assertEqual(self.e.outputs(), {}, field)  # nothing validated is handed on
            for legacy in LEGACY_NAMES:
                self.assertNotRegex(r.stdout, rf"(?<![A-Z_]){legacy}\b", (field, legacy))  # no fallback to the develop names
        self.assertIn("AWS_ECR_ROLE_ARN", self.check("develop", ROLE_ARN="").stdout)

    def test_each_inherited_main_name_is_refused_even_when_the_effective_values_are_valid(self):
        for flag, name in zip(("INHERITED_ROLE_ARN_SET", "INHERITED_REGION_SET", "INHERITED_REPOSITORY_SET"), MAIN_NAMES):
            r = self.check(**{flag: "true"})
            self.assertNotEqual(r.returncode, 0, flag)
            self.assertIn(name, r.stdout)
            self.assertEqual(self.e.outputs(), {}, flag)
            for value in self.GOOD.values():
                self.assertNotIn(value, r.stdout)

    def test_unknown_scope_information_fails_closed(self):
        for flag in self.CLEAN:
            for bad in ("", "TRUE", "maybe", "1"):
                self.assertNotEqual(self.check(**{flag: bad}).returncode, 0, (flag, bad))
        env = dict(self.GOOD)  # scope booleans not passed at all
        self.assertNotEqual(self.e.run(POLICY, ["require-config", "main"], **env).returncode, 0)

    def test_develop_lane_keeps_its_contract_and_ignores_the_main_scope_guard(self):
        r = self.check("develop", INHERITED_ROLE_ARN_SET="true", INHERITED_REGION_SET="true", INHERITED_REPOSITORY_SET="true")
        self.assertEqual(r.returncode, 0, r.stdout)
        env = dict(self.GOOD)  # develop needs no scope information
        self.assertEqual(self.e.run(POLICY, ["require-config", "develop"], **env).returncode, 0)

    def test_malformed_values_fail(self):
        for over in ({"ROLE_ARN": "not-an-arn"}, {"ROLE_ARN": "arn:aws:iam::123:role/x"}, {"REGION": "Sydney"},
                     {"REGION": "ap-southeast-2; id"}, {"REPOSITORY": "Upper/Case"}, {"REPOSITORY": "a b"}, {"REPOSITORY": "x$(id)"}):
            self.assertNotEqual(self.check(**over).returncode, 0, over)
            self.assertNotEqual(self.check("develop", **over).returncode, 0, over)


class ImageTransfer(unittest.TestCase):
    def setUp(self):
        self.e = Env()
        self.addCleanup(self.e.cleanup)
        self.image = f"thebha-api:{SHA}"
        key = self.image.replace("/", "_").replace(":", "_")
        (self.e.dir / "images").mkdir()
        self.state = self.e.dir / "images" / key
        self.state.write_text(f"{IMAGE_ID}|{SHA}|{URL}\n")
        self.pack_dir = self.e.dir / "image"
        self.common = dict(EXPECT_SOURCE_SHA=SHA, EXPECT_SOURCE_URL=URL, SOURCE_SHA=SHA, GITHUB_RUN_ID="42",
                           GITHUB_RUN_ATTEMPT="1", GITHUB_REPOSITORY="emLamHD/The_BHA_hotels_Booking")

    def pack(self):
        r = self.e.run(POLICY, ["pack", self.image, str(self.pack_dir)], **self.common)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return self.e.outputs()

    def unpack(self, outs, **over):
        env = dict(self.common, EXPECT_TAR_SHA256=outs["tar_sha256"], EXPECT_IMAGE_ID=outs["image_id"])
        env.update(over)
        return self.e.run(POLICY, ["unpack", str(self.pack_dir), self.image], **env)

    def test_roundtrip_keeps_identity_and_reports_it(self):
        outs = self.pack()
        meta = json.loads((self.pack_dir / "metadata.json").read_text())
        self.assertEqual((meta["source_sha"], meta["run_id"], meta["run_attempt"], meta["image_id"]), (SHA, "42", "1", IMAGE_ID))
        self.state.unlink()
        r = self.unpack(outs)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_tampered_tar_is_refused_before_load(self):
        outs = self.pack()
        with open(self.pack_dir / "image.tar", "a") as f:
            f.write("x")
        r = self.unpack(outs)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("docker load", self.e.log())

    def test_tar_and_metadata_rewritten_together_still_fail_against_the_build_job_output(self):
        import hashlib
        outs = self.pack()  # the trust anchor is the build job's output, not the artifact's own metadata
        with open(self.pack_dir / "image.tar", "a") as f:
            f.write("x")
        meta = json.loads((self.pack_dir / "metadata.json").read_text())
        meta["tar_sha256"] = hashlib.sha256((self.pack_dir / "image.tar").read_bytes()).hexdigest()
        (self.pack_dir / "metadata.json").write_text(json.dumps(meta))
        r = self.unpack(outs)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("checksum", r.stdout)
        self.assertNotIn("docker load", self.e.log())

    def test_metadata_from_another_run_or_commit_is_refused(self):
        outs = self.pack()
        self.assertNotEqual(self.unpack(outs, GITHUB_RUN_ID="43").returncode, 0)
        self.assertNotEqual(self.unpack(outs, EXPECT_SOURCE_SHA=OTHER_SHA).returncode, 0)
        self.assertNotEqual(self.unpack(outs, EXPECT_IMAGE_ID="sha256:" + "d" * 64).returncode, 0)

    def test_labels_or_id_that_change_after_load_are_refused(self):
        outs = self.pack()
        self.assertNotEqual(self.unpack(outs, LOAD_ID=IMAGE_ID, LOAD_REV=OTHER_SHA).returncode, 0)
        self.assertNotEqual(self.unpack(outs, LOAD_ID=IMAGE_ID, LOAD_SRC="https://example.invalid/x").returncode, 0)
        self.assertNotEqual(self.unpack(outs, LOAD_ID="sha256:" + "e" * 64).returncode, 0)

    def test_check_image_requires_matching_revision_and_source_labels(self):
        ok = self.e.run(POLICY, ["check-image", self.image], **self.common)
        self.assertEqual(ok.returncode, 0, ok.stdout)
        bad = self.e.run(POLICY, ["check-image", self.image], **dict(self.common, EXPECT_SOURCE_SHA=OTHER_SHA))
        self.assertNotEqual(bad.returncode, 0)


class EcrPublish(unittest.TestCase):
    def setUp(self):
        self.e = Env()
        self.addCleanup(self.e.cleanup)
        self.image = f"thebha-api:{SHA}"
        (self.e.dir / "images").mkdir()
        (self.e.dir / "images" / self.image.replace(":", "_")).write_text(f"{IMAGE_ID}|{SHA}|{URL}\n")

    def publish(self, **over):
        env = dict(SOURCE_SHA=SHA, REPOSITORY="the-bha-api", REGISTRY=REGISTRY, IMAGE=self.image, IMAGE_ID=IMAGE_ID,
                   GITHUB_RUN_ID="42", GITHUB_RUN_ATTEMPT="2")
        env.update(over)
        return self.e.run(PUBLISH, (), **env)

    def pushed(self):
        return "docker push" in self.e.log()

    def test_success_exports_every_output_and_the_summary(self):
        r = self.publish()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        o = self.e.outputs()
        self.assertEqual(o["source_sha"], SHA)
        self.assertEqual(o["ecr_repository"], "the-bha-api")
        self.assertEqual(o["image_uri"], f"{REGISTRY}/the-bha-api:{SHA}")
        self.assertRegex(o["image_digest"], r"^sha256:[0-9a-f]{64}$")
        s = self.e.summary.read_text()
        self.assertIn(f"{REGISTRY}/the-bha-api@{o['image_digest']}", s)
        self.assertIn("`42` attempt `2`", s)
        self.assertEqual(self.e.log().count("docker build"), 0)  # published image is never rebuilt here

    def test_access_denied_on_lookup_is_a_failure_and_nothing_is_pushed(self):
        for mode in ("denied", "repo_missing", "network", "notfound_wrong_exit"):
            self.setUp()
            r = self.publish(LOOKUP=mode)
            self.assertNotEqual(r.returncode, 0, mode)
            self.assertFalse(self.pushed(), mode)

    def test_only_explicit_image_not_found_means_absent(self):
        self.assertEqual(self.publish(LOOKUP="absent").returncode, 0)

    def test_existing_tag_fails_closed_without_overwrite_or_retag(self):
        r = self.publish(LOOKUP="exists")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("already exists", r.stdout)
        self.assertNotIn("docker tag", self.e.log())
        self.assertFalse(self.pushed())

    def test_repository_must_exist_and_be_exactly_immutable(self):
        for over in ({"REPO_MUT": "MUTABLE"}, {"REPO_MUT": "IMMUTABLE_WITH_EXCLUSIONS"}, {"REPO_MUT": "MUTABLE_WITH_EXCLUSIONS"},
                     {"REPO_ERR": "RepositoryNotFoundException"}, {"REPO_ERR": "AccessDeniedException"},
                     {"REPO_URI": "999999999999.dkr.ecr.ap-southeast-2.amazonaws.com/the-bha-api"}):
            self.setUp()
            r = self.publish(**over)
            self.assertNotEqual(r.returncode, 0, over)
            self.assertFalse(self.pushed(), over)
            self.assertNotIn("describe-images", self.e.log(), over)

    def test_duplicate_or_immutability_rejection_at_push_time_is_a_failure(self):
        r = self.publish(PUSH="immutable")  # lost a check-then-push race
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.e.outputs(), {})
        self.assertEqual(self.e.log().count("describe-images"), 1)  # no "it exists now, so success" re-read

    def test_invalid_empty_or_mismatching_digests_fail(self):
        for mode in ("empty", "none", "invalid", "denied", "other"):
            self.setUp()
            r = self.publish(READBACK=mode)
            self.assertNotEqual(r.returncode, 0, mode)
            self.assertEqual(self.e.outputs(), {}, mode)
        self.setUp()
        self.assertNotEqual(self.publish(PUSH="nodigest").returncode, 0)

    def test_bad_inputs_fail_before_any_aws_call(self):
        for over in ({"SOURCE_SHA": "latest"}, {"SOURCE_SHA": SHA[:12]}, {"REGISTRY": "evil.example"}, {"REPOSITORY": "A;b"}):
            self.setUp()
            self.assertNotEqual(self.publish(**over).returncode, 0, over)
            self.assertEqual(self.e.log(), "", over)


def load(path):
    doc = yaml.safe_load(path.read_text())
    doc["on"] = doc.pop(True, doc.get("on"))  # YAML 1.1 reads the key `on` as boolean True
    return doc


def run_blocks(job):
    return [s["run"] for s in job["steps"] if "run" in s]


@unittest.skipIf(yaml is None, "PyYAML is not installed")
class WorkflowShape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.wf = load(WORKFLOW)
        cls.jobs = cls.wf["jobs"]
        cls.text = WORKFLOW.read_text()

    def test_triggers_are_pr_and_push_only_with_filters_covering_build_inputs(self):
        self.assertEqual(set(self.wf["on"]), {"pull_request", "push"})  # no dispatch, no pull_request_target
        for trigger in ("pull_request", "push"):
            self.assertEqual(self.wf["on"][trigger]["branches"], ["develop", "main"])
            for path in ("Back_End/**", "deploy/showcase/**", ".github/workflows/backend-image.yml", ".github/workflows/ci.yml"):
                self.assertIn(path, self.wf["on"][trigger]["paths"])

    def test_default_permissions_read_only_and_oidc_only_in_publish_jobs(self):
        self.assertEqual(self.wf["permissions"], {"contents": "read"})
        for name, job in self.jobs.items():
            perms = job.get("permissions", {})
            if name.startswith(("publish-", "deploy-")):
                self.assertEqual(perms.get("id-token"), "write", name)
            else:
                self.assertNotIn("id-token", perms, name)
                self.assertNotIn("environment", job, name)
                self.assertFalse([s for s in job["steps"] if "aws-actions" in s.get("uses", "")], name)
                self.assertNotIn("aws ", "\n".join(run_blocks(job)), name)

    def test_publish_depends_on_verify_and_build_without_bypassing_failures(self):
        for name, lane in (("publish-main", "main"), ("publish-develop", "develop")):
            job = self.jobs[name]
            self.assertEqual(set(job["needs"]), {"plan", "verify", "build"})
            self.assertIn(f"needs.plan.outputs.lane == '{lane}'", job["if"])
            self.assertIn("needs.plan.outputs.publish == 'true'", job["if"])
        self.assertNotRegex(self.text, r"always\(\)|failure\(\)|cancelled\(\)|continue-on-error")

    def test_main_lane_uses_its_own_environment_flag_and_serialisation(self):
        main = self.jobs["publish-main"]
        self.assertEqual(main["environment"], "backend-production")
        self.assertIs(main["concurrency"]["cancel-in-progress"], False)
        env = self.jobs["plan"]["steps"][1]["env"]
        self.assertEqual(env["MAIN_PUBLISH_ENABLED"], "${{ vars.BACKEND_RELEASE_PUBLISH_ENABLED }}")
        self.assertEqual(env["DEVELOP_PUBLISH_ENABLED"], "${{ vars.ECR_PUBLISH_ENABLED }}")
        self.assertEqual(self.jobs["publish-develop"]["environment"], "showcase-publish")
        # workflow-level concurrency may only cancel pull_request runs, never a push (main) run
        self.assertEqual(self.wf["concurrency"]["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}")

    def test_config_is_validated_before_credentials_and_masking_is_off(self):
        for name in ("publish-main", "publish-develop"):
            steps = self.jobs[name]["steps"]
            names = [s.get("name", "") for s in steps]
            cfg = next(i for i, n in enumerate(names) if "configuration" in n)
            cred = next(i for i, s in enumerate(steps) if "configure-aws-credentials" in s.get("uses", ""))
            unpack = next(i for i, s in enumerate(steps) if "unpack" in s.get("run", ""))
            self.assertLess(cfg, cred, name)
            self.assertLess(unpack, cred, name)
            self.assertIs(steps[cred]["with"]["mask-aws-account-id"], False, name)
        main_creds = next(s for s in self.jobs["publish-main"]["steps"] if "configure-aws-credentials" in s.get("uses", ""))
        self.assertEqual(main_creds["with"]["role-to-assume"], "${{ steps.config.outputs.role_arn }}")
        self.assertEqual(main_creds["with"]["aws-region"], "${{ steps.config.outputs.region }}")

    def test_main_validator_oidc_and_ecr_helper_share_one_validated_set_of_release_names(self):
        steps = self.jobs["publish-main"]["steps"]
        cfg = next(s for s in steps if s.get("id") == "config")
        self.assertEqual(cfg["env"]["ROLE_ARN"], "${{ vars.BACKEND_RELEASE_AWS_ROLE_ARN }}")
        self.assertEqual(cfg["env"]["REGION"], "${{ vars.BACKEND_RELEASE_AWS_REGION }}")
        self.assertEqual(cfg["env"]["REPOSITORY"], "${{ vars.BACKEND_RELEASE_ECR_REPOSITORY }}")
        publish = next(s for s in steps if s.get("id") == "publish")
        self.assertEqual(publish["env"]["REPOSITORY"], "${{ steps.config.outputs.repository }}")
        # after the validator, the main job reads no variable at all, and never a develop/generic name
        later = yaml.safe_dump(steps[steps.index(cfg) + 1:])
        self.assertNotIn("vars.", later)
        main_text = yaml.safe_dump(self.jobs["publish-main"])
        for legacy in LEGACY_NAMES:
            self.assertNotRegex(main_text, rf"vars\.{legacy}\b", legacy)

    def test_scope_inputs_come_from_the_plan_job_that_runs_outside_any_environment(self):
        plan = self.jobs["plan"]
        self.assertNotIn("environment", plan)
        env = plan["steps"][1]["env"]
        self.assertEqual(env["INHERITED_ROLE_ARN"], "${{ vars.BACKEND_RELEASE_AWS_ROLE_ARN }}")
        self.assertEqual(env["INHERITED_REGION"], "${{ vars.BACKEND_RELEASE_AWS_REGION }}")
        self.assertEqual(env["INHERITED_REPOSITORY"], "${{ vars.BACKEND_RELEASE_ECR_REPOSITORY }}")
        cfg = next(s for s in self.jobs["publish-main"]["steps"] if s.get("id") == "config")
        for k in ("ROLE_ARN", "REGION", "REPOSITORY"):
            self.assertEqual(cfg["env"][f"INHERITED_{k}_SET"], f"${{{{ needs.plan.outputs.inherited_{k.lower()}_set }}}}")

    def test_publish_job_outputs_are_the_contract(self):
        for name in ("publish-main", "publish-develop"):
            self.assertEqual(set(self.jobs[name]["outputs"]), {"source_sha", "ecr_repository", "image_uri", "image_digest"})

    def test_image_is_built_exactly_once_and_never_in_a_publish_job(self):
        builds = [(n, b) for n, j in self.jobs.items() for b in run_blocks(j) if "docker build" in b]
        self.assertEqual([n for n, _ in builds], ["build"])
        self.assertIn("org.opencontainers.image.revision=$SOURCE_SHA", builds[0][1])
        self.assertIn("org.opencontainers.image.source=", builds[0][1])
        for name in ("publish-main", "publish-develop"):
            self.assertNotIn("docker build", "\n".join(run_blocks(self.jobs[name])))

    def test_artifact_comes_from_this_run_only_and_is_named_by_sha_run_attempt(self):
        for name in ("publish-main", "publish-develop"):
            dl = next(s for s in self.jobs[name]["steps"] if "download-artifact" in s.get("uses", ""))
            self.assertEqual(set(dl["with"]), {"name", "path"})  # no run-id / github-token => current run only
            self.assertEqual(dl["with"]["name"], "${{ needs.build.outputs.artifact_name }}")
        self.assertIn("backend-image-$SOURCE_SHA-${{ github.run_id }}-${{ github.run_attempt }}", self.text)

    def test_checkouts_use_the_exact_sha_and_assert_head(self):
        for name, job in self.jobs.items():
            co = next(s for s in job["steps"] if "actions/checkout" in s.get("uses", ""))
            self.assertIn("source_sha", co["with"]["ref"] if name != "plan" else co["with"]["ref"] + "source_sha")
            self.assertIs(co["with"]["persist-credentials"], False, name)
        for name in ("verify", "build", "publish-main", "publish-develop"):
            self.assertIn('test "$(git rev-parse HEAD)" = "$SOURCE_SHA"', run_blocks(self.jobs[name]))

    def test_no_untrusted_event_text_reaches_a_shell(self):
        for name, job in self.jobs.items():
            for block in run_blocks(job):
                self.assertNotRegex(block, r"github\.event\.|github\.head_ref|github\.ref_name|inputs\.", name)

    def test_backend_services_use_postgres_18_3_with_a_version_assertion(self):
        for path, jobname in ((WORKFLOW, "verify"), (CI, "backend")):
            job = load(path)["jobs"][jobname]
            self.assertEqual(job["services"]["postgres"]["image"], "postgres:18.3", path.name)
            joined = "\n".join(run_blocks(job))
            self.assertIn("show server_version", joined)
            self.assertIn("18.3", joined)


BASE_VARS = dict(ECR_PUBLISH_ENABLED="false", AWS_ECR_ROLE_ARN="arn:aws:iam::123456789012:role/bha-develop",
                 AWS_REGION="ap-southeast-2", ECR_REPOSITORY="the-bha-api-dev")  # a complete develop setup, repository scope
PROD = dict(BACKEND_RELEASE_AWS_ROLE_ARN="arn:aws:iam::123456789012:role/bha-release",
            BACKEND_RELEASE_AWS_REGION="ap-southeast-2", BACKEND_RELEASE_ECR_REPOSITORY="the-bha-api")


@unittest.skipIf(yaml is None, "PyYAML is not installed")
class ProductionScopeSimulation(unittest.TestCase):
    """Replays the real workflow's `vars` wiring the way GitHub resolves it, then runs the real policy script.

    GitHub semantics modelled: a job without an environment sees organization + repository variables (repository wins);
    a job with an environment additionally sees that environment's variables, which win over the other scopes.
    """

    def setUp(self):
        self.e = Env()
        self.addCleanup(self.e.cleanup)
        self.jobs = load(WORKFLOW)["jobs"]

    @staticmethod
    def resolve(env_block, variables, outputs=None):
        def sub(m):
            expr = m.group(1).strip()
            if expr.startswith("vars."):
                return variables.get(expr[5:], "")
            if expr.startswith("needs.plan.outputs."):
                return (outputs or {}).get(expr.rsplit(".", 1)[1], "")
            if expr.startswith("github."):
                return ""  # event/ref/SHA are supplied by run_pipeline, not by variables
            raise AssertionError(f"unmodelled expression: {expr}")
        return {k: re.sub(r"\$\{\{(.*?)\}\}", sub, str(v)) for k, v in env_block.items()}

    def run_pipeline(self, event="push", ref="refs/heads/main", org=None, repo=None, environment=None, enabled=True):
        outside = {**(org or {}), **(repo or {})}
        if enabled:
            outside["BACKEND_RELEASE_PUBLISH_ENABLED"] = "true"
        plan_env = self.resolve(self.jobs["plan"]["steps"][1]["env"], outside)
        plan_env.update(EVENT=event, REF=ref, SOURCE_SHA=SHA, GITHUB_SHA=SHA if event == "push" else OTHER_SHA)
        self.e.out.write_text("")
        r = self.e.run(POLICY, ["plan"], **plan_env)
        self.assertEqual(r.returncode, 0, r.stdout)
        plan_out = self.e.outputs()
        job = self.jobs["publish-main"]
        runs = plan_out["lane"] == "main" and plan_out["publish"] == "true"  # the job-level `if`, evaluated by the plan outputs
        if not runs:
            return plan_out, None, None
        effective = {**outside, **(environment or {})}
        cfg = next(s for s in job["steps"] if s.get("id") == "config")
        cfg_env = self.resolve(cfg["env"], effective, plan_out)
        self.e.out.write_text("")
        return plan_out, self.e.run(POLICY, ["require-config", "main"], **cfg_env), self.e.outputs()

    def test_pr_with_every_variable_inherited_never_reaches_publish(self):
        for event, ref in (("pull_request", "refs/pull/3/merge"),):
            plan, r, _ = self.run_pipeline(event, ref, repo={**BASE_VARS, **PROD})
            self.assertEqual((plan["lane"], plan["publish"], r), ("none", "false", None))
        self.assertEqual(self.e.log(), "")

    def test_main_disabled_and_develop_do_not_depend_on_production_setup(self):
        plan, r, _ = self.run_pipeline(repo=BASE_VARS, enabled=False)
        self.assertEqual((plan["lane"], plan["publish"], r), ("main", "false", None))
        plan, r, _ = self.run_pipeline(ref="refs/heads/develop", repo={**BASE_VARS, "ECR_PUBLISH_ENABLED": "true"}, enabled=False)
        self.assertEqual((plan["lane"], plan["publish"], r), ("develop", "true", None))

    def test_each_missing_environment_field_fails_while_develop_config_is_complete(self):
        for missing in PROD:
            env = {k: v for k, v in PROD.items() if k != missing}
            plan, r, outs = self.run_pipeline(repo=BASE_VARS, environment=env)
            self.assertNotEqual(r.returncode, 0, missing)
            self.assertIn(missing, r.stdout)
            self.assertEqual(outs, {}, missing)

    def test_each_inherited_release_field_is_refused_with_or_without_an_environment_override(self):
        for name in PROD:
            for scope in ("repo", "org"):
                for override in (False, True):
                    kw = {scope: {**BASE_VARS, name: PROD[name]}}
                    env = dict(PROD) if override else {k: v for k, v in PROD.items() if k != name}
                    plan, r, outs = self.run_pipeline(environment=env, **kw)
                    self.assertNotEqual(r.returncode, 0, (name, scope, override))
                    self.assertIn(name, r.stdout)
                    self.assertEqual(outs, {}, (name, scope, override))

    def test_environment_only_configuration_passes_and_hands_the_new_values_on(self):
        plan, r, outs = self.run_pipeline(repo=BASE_VARS, environment=PROD)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(outs, {"role_arn": PROD["BACKEND_RELEASE_AWS_ROLE_ARN"], "region": PROD["BACKEND_RELEASE_AWS_REGION"],
                                "repository": PROD["BACKEND_RELEASE_ECR_REPOSITORY"]})
        self.assertNotEqual(outs["repository"], BASE_VARS["ECR_REPOSITORY"])  # never the develop repository
        self.assertEqual(self.e.log(), "")

    def test_old_generic_names_in_the_environment_are_not_a_substitute(self):
        legacy_env = dict(AWS_ROLE_ARN=PROD["BACKEND_RELEASE_AWS_ROLE_ARN"], AWS_REGION="ap-southeast-2", ECR_REPOSITORY="the-bha-api")
        plan, r, outs = self.run_pipeline(repo=BASE_VARS, environment=legacy_env)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(outs, {})


def extract_line(needle):
    for line in RUNBOOK.read_text().splitlines():
        if needle in line:
            return line
    raise AssertionError(f"runbook no longer contains: {needle}")


DEPLOY_NAMES = ("BACKEND_RELEASE_DEPLOY_AWS_ROLE_ARN", "BACKEND_RELEASE_EC2_INSTANCE_ID", "BACKEND_RELEASE_HOST_CONFIG_PATH")
D_ROLE = "arn:aws:iam::123456789012:role/bha-release-deploy"
D_URI = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/the-bha-api:" + SHA
D_DIGEST = "sha256:" + "d" * 64


class DeployGating(unittest.TestCase):
    """CP03: the deploy switch, its configuration gate and the stale-run guard, through the real policy script."""

    def setUp(self):
        self.e = Env()
        self.addCleanup(self.e.cleanup)

    def plan(self, event="push", ref="refs/heads/main", **flags):
        self.e.out.write_text("")
        env = dict(EVENT=event, REF=ref, SOURCE_SHA=SHA, GITHUB_SHA=SHA if event == "push" else OTHER_SHA)
        env.update(flags)
        r = self.e.run(POLICY, ["plan"], **env)
        return r, self.e.outputs()

    def test_deploy_requires_the_exact_flag_a_main_push_and_a_publishing_run(self):
        both = dict(MAIN_PUBLISH_ENABLED="true", MAIN_DEPLOY_ENABLED="true")
        r, o = self.plan(**both)
        self.assertEqual((r.returncode, o["lane"], o["publish"], o["deploy"]), (0, "main", "true", "true"))
        for value in (None, "", "false", "TRUE", "1", "yes", " true"):
            flags = dict(MAIN_PUBLISH_ENABLED="true")
            if value is not None: flags["MAIN_DEPLOY_ENABLED"] = value
            r, o = self.plan(**flags)
            self.assertEqual((r.returncode, o["publish"], o["deploy"]), (0, "true", "false"), repr(value))

    def test_deploy_enabled_without_publish_fails_clearly_before_any_aws_step(self):
        for pub in (None, "false", "1"):
            flags = dict(MAIN_DEPLOY_ENABLED="true")
            if pub is not None: flags["MAIN_PUBLISH_ENABLED"] = pub
            r, _ = self.plan(**flags)
            self.assertNotEqual(r.returncode, 0, repr(pub))
            self.assertIn("BACKEND_RELEASE_DEPLOY_ENABLED", r.stdout)
        self.assertEqual(self.e.log(), "")

    def test_pr_develop_and_other_refs_ignore_the_deploy_switch(self):
        flags = dict(MAIN_PUBLISH_ENABLED="true", MAIN_DEPLOY_ENABLED="true", DEVELOP_PUBLISH_ENABLED="true")
        for event, ref in (("pull_request", "refs/pull/3/merge"), ("push", "refs/heads/develop"), ("push", "refs/heads/feature/x"), ("schedule", "refs/heads/main")):
            r, o = self.plan(event, ref, **flags)
            self.assertEqual((r.returncode, o["deploy"]), (0, "false"), (event, ref))

    def test_inherited_deploy_values_are_reported_as_booleans_only(self):
        r, o = self.plan(MAIN_PUBLISH_ENABLED="true", INHERITED_INSTANCE_ID="i-0123456789abcdef0", INHERITED_DEPLOY_ROLE_ARN="", INHERITED_HOST_CONFIG="/x")
        self.assertEqual((o["inherited_deploy_role_arn_set"], o["inherited_instance_id_set"], o["inherited_host_config_set"]), ("false", "true", "true"))
        self.assertNotIn("i-0123456789abcdef0", self.e.out.read_text())

    def check(self, **over):
        env = dict(DEPLOY_ROLE_ARN=D_ROLE, INSTANCE_ID="i-0123456789abcdef0", HOST_CONFIG_PATH="/etc/the-bha/host.conf", REGION="ap-southeast-2",
                   PUBLISH_ROLE_ARN="arn:aws:iam::123456789012:role/bha-release", SOURCE_SHA=SHA, PUBLISHED_SHA=SHA, IMAGE_URI=D_URI, IMAGE_DIGEST=D_DIGEST,
                   INHERITED_DEPLOY_ROLE_ARN_SET="false", INHERITED_INSTANCE_ID_SET="false", INHERITED_HOST_CONFIG_SET="false")
        env.update(over)
        self.e.out.write_text("")
        return self.e.run(POLICY, ["require-deploy-config"], **env)

    def test_valid_configuration_passes_and_exports_the_single_validated_set(self):
        r = self.check()
        self.assertEqual(r.returncode, 0, r.stdout)
        o = self.e.outputs()
        self.assertEqual((o["deploy_role_arn"], o["instance_id"], o["host_config_path"], o["deploy_region"]), (D_ROLE, "i-0123456789abcdef0", "/etc/the-bha/host.conf", "ap-southeast-2"))
        self.assertEqual(self.e.log(), "")

    def test_each_missing_value_and_each_inherited_value_is_refused_naming_the_variable_only(self):
        for field, name in zip(("DEPLOY_ROLE_ARN", "INSTANCE_ID", "HOST_CONFIG_PATH"), DEPLOY_NAMES):
            r = self.check(**{field: ""})
            self.assertNotEqual(r.returncode, 0, field); self.assertIn(name, r.stdout)
        for flag, name in zip(("INHERITED_DEPLOY_ROLE_ARN_SET", "INHERITED_INSTANCE_ID_SET", "INHERITED_HOST_CONFIG_SET"), DEPLOY_NAMES):
            for bad in ("true", "", "maybe", "TRUE"):
                r = self.check(**{flag: bad})                          # even with a valid environment override the effective values are fine
                self.assertNotEqual(r.returncode, 0, (flag, bad)); self.assertIn(name, r.stdout)
                self.assertNotIn("i-0123456789abcdef0", r.stdout)
        self.assertNotEqual(self.check(REGION="").returncode, 0)

    def test_malformed_values_and_account_or_region_mismatches_are_refused(self):
        for over in ({"DEPLOY_ROLE_ARN": "nope"}, {"INSTANCE_ID": "i-123"}, {"INSTANCE_ID": "i-0123456789ABCDEF0"}, {"INSTANCE_ID": "mi-0123456789abcdef0"},
                     {"HOST_CONFIG_PATH": "relative.conf"}, {"HOST_CONFIG_PATH": "/etc/../x"}, {"HOST_CONFIG_PATH": "/etc/the bha"}, {"REGION": "Sydney"},
                     {"PUBLISH_ROLE_ARN": "arn:aws:iam::999999999999:role/x"},
                     {"IMAGE_URI": "999999999999.dkr.ecr.ap-southeast-2.amazonaws.com/the-bha-api:" + SHA},
                     {"IMAGE_URI": "123456789012.dkr.ecr.us-east-1.amazonaws.com/the-bha-api:" + SHA},
                     {"IMAGE_URI": D_URI.replace(SHA, OTHER_SHA)}, {"PUBLISHED_SHA": OTHER_SHA}, {"IMAGE_DIGEST": "latest"}, {"IMAGE_DIGEST": "sha256:xyz"}):
            self.assertNotEqual(self.check(**over).returncode, 0, over)

    def test_a_run_that_is_not_the_tip_of_main_never_deploys(self):
        remote = self.e.dir / "remote.git"; work = self.e.dir / "work"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
        subprocess.run(["git", "init", "-q", "-b", "main", str(work)], check=True)
        g = lambda *a: subprocess.run(["git", "-C", str(work), "-c", "user.name=t", "-c", "user.email=t@example.invalid"] + list(a), check=True, capture_output=True, text=True).stdout.strip()
        (work / "a").write_text("1"); g("add", "-A"); g("commit", "-q", "-m", "one"); first = g("rev-parse", "HEAD")
        g("remote", "add", "origin", str(remote)); g("push", "-q", "origin", "main")
        ok = self.e.run(POLICY, ["check-main-head"], MAIN_REMOTE_URL=str(remote), SOURCE_SHA=first)
        self.assertEqual(ok.returncode, 0, ok.stdout)
        (work / "a").write_text("2"); g("commit", "-q", "-am", "two"); g("push", "-q", "origin", "main")
        stale = self.e.run(POLICY, ["check-main-head"], MAIN_REMOTE_URL=str(remote), SOURCE_SHA=first)
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn("STALE_RUN", stale.stdout)
        unreadable = self.e.run(POLICY, ["check-main-head"], MAIN_REMOTE_URL=str(self.e.dir / "missing.git"), SOURCE_SHA=first)
        self.assertNotEqual(unreadable.returncode, 0)                  # an unreadable remote is never "fresh enough"

    def test_deploy_job_wiring_in_the_real_workflow(self):
        wf = load(WORKFLOW); jobs = wf["jobs"]; job = jobs["deploy-main"]
        self.assertEqual(wf["on"].keys(), {"pull_request", "push"})                   # still no workflow_dispatch
        self.assertEqual(job["environment"], "backend-production")
        self.assertEqual(set(job["needs"]), {"plan", "publish-main"})
        for part in ("needs.plan.outputs.lane == 'main'", "needs.plan.outputs.publish == 'true'", "needs.plan.outputs.deploy == 'true'"):
            self.assertIn(part, job["if"])
        self.assertEqual(job["permissions"], {"contents": "read", "id-token": "write"})
        self.assertIs(job["concurrency"]["cancel-in-progress"], False)
        self.assertEqual(job["timeout-minutes"], 40)
        env = job["env"]
        self.assertEqual(env["IMAGE_URI"], "${{ needs.publish-main.outputs.image_uri }}")        # this run's own publish outputs only
        self.assertEqual(env["IMAGE_DIGEST"], "${{ needs.publish-main.outputs.image_digest }}")
        steps = job["steps"]
        cfg = next(s for s in steps if s.get("id") == "deployconfig")
        for k, n, flag, out in (("DEPLOY_ROLE_ARN", DEPLOY_NAMES[0], "INHERITED_DEPLOY_ROLE_ARN_SET", "inherited_deploy_role_arn_set"),
                                ("INSTANCE_ID", DEPLOY_NAMES[1], "INHERITED_INSTANCE_ID_SET", "inherited_instance_id_set"),
                                ("HOST_CONFIG_PATH", DEPLOY_NAMES[2], "INHERITED_HOST_CONFIG_SET", "inherited_host_config_set")):
            self.assertEqual(cfg["env"][k], "${{ vars.%s }}" % n)
            self.assertEqual(cfg["env"][flag], "${{ needs.plan.outputs.%s }}" % out)
        plan_env = jobs["plan"]["steps"][1]["env"]
        self.assertEqual(plan_env["MAIN_DEPLOY_ENABLED"], "${{ vars.BACKEND_RELEASE_DEPLOY_ENABLED }}")
        for k, n in (("INHERITED_DEPLOY_ROLE_ARN", DEPLOY_NAMES[0]), ("INHERITED_INSTANCE_ID", DEPLOY_NAMES[1]), ("INHERITED_HOST_CONFIG", DEPLOY_NAMES[2])):
            self.assertEqual(plan_env[k], "${{ vars.%s }}" % n)
        names = [s.get("name", "") for s in steps]
        i_cfg = names.index(cfg["name"]); i_cred = next(i for i, s in enumerate(steps) if "configure-aws-credentials" in s.get("uses", ""))
        i_head = next(i for i, s in enumerate(steps) if "check-main-head" in s.get("run", ""))
        i_send = next(i for i, s in enumerate(steps) if "backend-ssm-release.py" in s.get("run", ""))
        i_pkt = next(i for i, s in enumerate(steps) if "backend-release-packet.py" in s.get("run", ""))
        self.assertLess(i_cfg, i_head); self.assertLess(i_head, i_cred); self.assertLess(i_pkt, i_cred); self.assertLess(i_cred, i_send)
        creds = steps[i_cred]["with"]
        self.assertEqual(creds["role-to-assume"], "${{ steps.deployconfig.outputs.deploy_role_arn }}")
        self.assertIs(creds["mask-aws-account-id"], False)
        after = yaml.safe_dump(steps[i_cfg + 1:])
        self.assertNotIn("vars.", after)                                          # downstream reads only the validated outputs
        for forbidden in ("docker build", "docker push", "aws ecr", ":latest", "download-artifact", "workflow_dispatch"):
            self.assertNotIn(forbidden, yaml.safe_dump(job))
        self.assertNotRegex(yaml.safe_dump(job), r"github\.event\.|inputs\.")

    def test_pr_develop_and_publish_jobs_are_unaffected_by_the_deploy_names(self):
        jobs = load(WORKFLOW)["jobs"]
        text = yaml.safe_dump({k: v for k, v in jobs.items() if k != "deploy-main" and k != "plan"})
        for name in DEPLOY_NAMES + ("BACKEND_RELEASE_DEPLOY_ENABLED",):
            self.assertNotIn(name, text)


IAM_DIR = ROOT / "deploy" / "showcase" / "iam"


class IamTemplates(unittest.TestCase):
    """CP03 cloud templates: validated locally only (JSON, placeholders, scope). Nothing is applied and no IAM simulator is called."""

    def load(self, name):
        text = (IAM_DIR / name).read_text()
        self.assertNotRegex(text, r"[0-9]{12}", name)                                       # no hardcoded account ID
        return json.loads(text), text

    @staticmethod
    def statements(doc):
        st = doc["Statement"]
        return st if isinstance(st, list) else [st]

    def test_every_template_is_valid_json_with_explicit_placeholders_only(self):
        for f in sorted(IAM_DIR.glob("*.json")):
            doc, text = self.load(f.name)
            self.assertEqual(doc["Version"], "2012-10-17")
            for token in re.findall(r"<[^>]*>", text):
                self.assertRegex(token, r"^<[A-Z][A-Z_]*>$", f.name)
        self.assertEqual({f.name for f in IAM_DIR.glob("*.json")},
                         {"backend-release-deploy-trust.json", "backend-release-deploy-policy.json", "backend-release-instance-ecr-policy.json"})

    def test_trust_uses_only_the_condition_keys_aws_supports_and_no_wildcard_subject(self):
        doc, _ = self.load("backend-release-deploy-trust.json")
        (st,) = self.statements(doc)
        self.assertEqual((st["Effect"], st["Action"]), ("Allow", "sts:AssumeRoleWithWebIdentity"))
        self.assertTrue(st["Principal"]["Federated"].endswith(":oidc-provider/token.actions.githubusercontent.com"))
        self.assertEqual(set(st["Condition"]), {"StringEquals"})                           # exact match: no StringLike
        cond = st["Condition"]["StringEquals"]
        self.assertEqual(set(cond), {"token.actions.githubusercontent.com:aud", "token.actions.githubusercontent.com:sub"})
        self.assertEqual(cond["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com")
        self.assertEqual(cond["token.actions.githubusercontent.com:sub"], "<VERIFIED_SUB_CLAIM>")    # the Owner verifies the real format first
        self.assertNotIn("*", json.dumps(st))

    def test_deploy_policy_sends_to_one_instance_and_one_document_and_reads_results_only(self):
        doc, _ = self.load("backend-release-deploy-policy.json")
        send, read = self.statements(doc)
        self.assertEqual(send["Action"], "ssm:SendCommand")
        self.assertEqual(send["Resource"], ["arn:aws:ssm:<REGION>::document/AWS-RunShellScript", "arn:aws:ec2:<REGION>:<ACCOUNT_ID>:instance/<INSTANCE_ID>"])
        self.assertNotIn("Condition", send)
        self.assertEqual(sorted(read["Action"]), ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:ListCommands"])
        self.assertEqual(read["Resource"], "*")                                              # AWS documents these list/read actions with Resource "*"
        everything = json.dumps(doc)
        for forbidden in ("CancelCommand", "ecr:", "iam:", "sts:", "s3:", "rds", "ssm:*", "ssm:StartSession", "ssm:PutParameter"):
            self.assertNotIn(forbidden, everything)
        self.assertEqual(everything.count("ec2:"), everything.count("arn:aws:ec2:"))                 # "ec2:" only inside the instance ARN, never as an action

    def test_instance_profile_policy_can_pull_one_repository_and_nothing_else(self):
        doc, _ = self.load("backend-release-instance-ecr-policy.json")
        token, pull = self.statements(doc)
        self.assertEqual((token["Action"], token["Resource"]), ("ecr:GetAuthorizationToken", "*"))
        self.assertEqual(sorted(pull["Action"]), ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"])
        self.assertEqual(pull["Resource"], "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/<ECR_REPOSITORY>")
        for forbidden in ("PutImage", "InitiateLayerUpload", "UploadLayerPart", "CompleteLayerUpload", "CreateRepository", "DeleteRepository", "BatchDeleteImage",
                          "SetRepositoryPolicy", "PutLifecyclePolicy", "ecr:*", "rds", "secretsmanager"):
            self.assertNotIn(forbidden, json.dumps(doc))


class EnvNameParser(unittest.TestCase):
    """The EC2 packet (C2/C3 of the Admin proxy block) is run from the real runbook text with fake data."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="bha-cd001-env-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.envf = self.dir / "api.env"
        self.envf.write_text("\n".join([
            "ASPNETCORE_ENVIRONMENT=Production",
            "Logging.LogLevel.Default=a=b=c",
            "ConnectionStrings__TheBhaDatabase=fake;with=equals",
            "1INVALID=value",
            "bad-name=value",
            "Cors__AdminOrigins__0=https://admin.example.invalid/?x=a=b=c",
            "# comment=ignored",
            "",
        ]))

    def names(self, mutate=None):
        line = extract_line("> /tmp/bha-names-file").strip()
        out = self.dir / "names"
        line = line.replace("/tmp/bha-names-file", str(out))
        if mutate:
            line = mutate(line)
        script = f'sudo() {{ "$@"; }}\nENVF={self.envf}\nexport LC_ALL=C\n{line}\n'
        r = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return out.read_text().split()

    def test_dotted_ordinary_and_invalid_names(self):
        names = self.names()
        self.assertIn("Logging.LogLevel.Default", names)  # dotted key kept as a key
        self.assertIn("ASPNETCORE_ENVIRONMENT", names)
        self.assertIn("ConnectionStrings__TheBhaDatabase", names)
        self.assertNotIn("1INVALID", names)
        self.assertNotIn("bad-name", names)
        self.assertFalse([n for n in names if "=" in n or "#" in n])  # only names, never values

    def test_the_old_class_would_have_dropped_the_dotted_key(self):
        old = self.names(mutate=lambda l: l.replace("[A-Za-z0-9_.]*", "[A-Za-z0-9_]*"))
        self.assertNotIn("Logging.LogLevel.Default", old)  # RED on the previous packet, GREEN now

    def test_value_is_split_at_the_first_equals_and_kept_whole(self):
        line = extract_line("cut -d= -f2- | grep -qxF")
        cond = re.search(r"if (sudo grep.*?); then", line).group(1)
        script = (f'sudo() {{ "$@"; }}\nENVF={self.envf}\nADMIN=\'https://admin.example.invalid/?x=a=b=c\'\n'
                  f'if {cond}; then echo present; else echo absent; fi\n')
        r = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.stdout.strip(), "present")  # everything after the first '=' compared, later '=' kept
        script = script.replace("x=a=b=c'\nif", "x=a'\nif")
        r = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.stdout.strip(), "absent")


if __name__ == "__main__":
    unittest.main()
