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

    def test_repo_level_values_are_handed_to_the_publish_job(self):
        self.plan("push", "refs/heads/main", MAIN_PUBLISH_ENABLED="true", REPO_LEVEL_REGION="ap-southeast-2",
                  REPO_LEVEL_REPOSITORY="the-bha-api", REPO_LEVEL_ROLE_ARN="")
        o = self.e.outputs()
        self.assertEqual((o["repo_level_region"], o["repo_level_repository"], o["repo_level_role_arn_set"]),
                         ("ap-southeast-2", "the-bha-api", "false"))


class RequireConfig(unittest.TestCase):
    GOOD = dict(ROLE_ARN="arn:aws:iam::123456789012:role/bha-release", REGION="ap-southeast-2", REPOSITORY="the-bha/api")

    def setUp(self):
        self.e = Env()
        self.addCleanup(self.e.cleanup)

    def check(self, lane="main", **over):
        env = dict(self.GOOD)
        env.update(over)
        return self.e.run(POLICY, ["require-config", lane], **env)

    def test_good_config_passes_and_never_touches_aws(self):
        r = self.check()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(self.e.log(), "")

    def test_each_missing_value_fails_naming_the_variable_only(self):
        for field, name in (("ROLE_ARN", "AWS_ROLE_ARN"), ("REGION", "AWS_REGION"), ("REPOSITORY", "ECR_REPOSITORY")):
            r = self.check(**{field: ""})
            self.assertNotEqual(r.returncode, 0)
            self.assertIn(name, r.stdout)
            self.assertNotIn(self.GOOD[field], r.stdout)
        self.assertIn("AWS_ECR_ROLE_ARN", self.check("develop", ROLE_ARN="").stdout)

    def test_malformed_values_fail(self):
        for over in ({"ROLE_ARN": "not-an-arn"}, {"ROLE_ARN": "arn:aws:iam::123:role/x"}, {"REGION": "Sydney"},
                     {"REGION": "ap-southeast-2; id"}, {"REPOSITORY": "Upper/Case"}, {"REPOSITORY": "a b"}, {"REPOSITORY": "x$(id)"}):
            self.assertNotEqual(self.check(**over).returncode, 0, over)

    def test_a_repository_level_role_arn_is_refused_for_main_only(self):
        self.assertNotEqual(self.check(REPO_LEVEL_ROLE_ARN_SET="true").returncode, 0)
        self.assertEqual(self.check("develop", REPO_LEVEL_ROLE_ARN_SET="true").returncode, 0)

    def test_value_equal_to_the_repo_level_one_is_flagged_not_failed(self):
        r = self.check(REPO_LEVEL_REPOSITORY="the-bha/api", REPO_LEVEL_REGION="ap-southeast-2")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.count("::warning::"), 2)


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
            if name.startswith("publish-"):
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
        self.assertEqual(main_creds["with"]["role-to-assume"], "${{ vars.AWS_ROLE_ARN }}")

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


def extract_line(needle):
    for line in RUNBOOK.read_text().splitlines():
        if needle in line:
            return line
    raise AssertionError(f"runbook no longer contains: {needle}")


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
