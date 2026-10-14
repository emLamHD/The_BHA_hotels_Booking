#!/usr/bin/env python3
"""
BHA-BACKEND-CD-001-CP03 tests: backend-release-packet.py (exact release packet from git objects).

Fixtures: a throw-away git repository with the four allowlisted files, fake EF migrations and the real manifest generator.
Nothing here touches the network, Docker, AWS or the product repository history.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(os.environ.get("SCRIPTS_UNDER_TEST") or Path(__file__).resolve().parents[1])
PACKET = SCRIPTS / "backend-release-packet.py"
MANIFEST = SCRIPTS / "backend-migration-manifest.py"
ALLOW = ["deploy/showcase/scripts/backend-remote-release.sh", "deploy/showcase/scripts/backend-deploy.sh",
         "deploy/showcase/scripts/backend-migration-preflight.sh", "deploy/showcase/scripts/backend-migration-manifest.py"]
DIGEST = "sha256:" + "d" * 64
REPO = "emLamHD/The_BHA_hotels_Booking"


class PacketFixture(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="bha-cp03-pk-"))
        self.addCleanup(shutil.rmtree, self.d, True)
        self.repo = self.d / "repo"
        mig = self.repo / "Back_End/src/TheBha.Infrastructure/Persistence/Migrations"; mig.mkdir(parents=True)
        (self.repo / "deploy/showcase/migrations").mkdir(parents=True)
        (self.repo / "deploy/showcase/scripts").mkdir(parents=True)
        self.ids = ["20260101000000_First", "20260202000000_Second"]
        sql = ""
        for i in self.ids:
            (mig / (i + ".Designer.cs")).write_text('[Migration("%s")]\n' % i)
            sql += 'INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")\n    VALUES (\'%s\', \'8\');\n' % i
        (self.repo / "deploy/showcase/migrations/idempotent.sql").write_text(sql)
        for path in ALLOW:
            target = self.repo / path
            target.write_bytes(MANIFEST.read_bytes() if path.endswith("manifest.py") else ("#!/usr/bin/env bash\necho fixture %s\n" % path).encode())
        self.git("init", "-q", "-b", "main"); self.git("add", "-A")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "fixture")
        self.sha = self.git("rev-parse", "HEAD").strip()
        self.uri = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/the-bha-api:" + self.sha

    def git(self, *a):
        return subprocess.run(["git", "-C", str(self.repo)] + list(a), capture_output=True, text=True, check=True).stdout

    def gen(self, **over):
        a = dict(repo=self.repo, source_sha=self.sha, github_repository=REPO, run_id="42", run_attempt="1", out=self.d / "out",
                 image_uri=self.uri, image_digest=DIGEST)
        a.update(over)
        argv = [sys.executable, "-I", str(PACKET), "generate"]
        for k, v in a.items():
            if v is True: argv.append("--" + k.replace("_", "-"))
            elif v is not None and v is not False: argv += ["--" + k.replace("_", "-"), str(v)]
        return subprocess.run(argv, capture_output=True, text=True)

    def check(self, path, sha=None):
        argv = [sys.executable, "-I", str(PACKET), "check", "--packet", str(path)] + (["--sha256", sha] if sha else [])
        return subprocess.run(argv, capture_output=True, text=True)


class Generate(PacketFixture):
    def test_packet_binds_sha_image_run_manifest_and_every_script_byte(self):
        p = self.gen()
        self.assertEqual(p.returncode, 0, p.stderr)
        raw = (self.d / "out/packet.json").read_bytes()
        doc = json.loads(raw)
        self.assertEqual((doc["source_sha"], doc["repository"], doc["run_id"], doc["run_attempt"]), (self.sha, REPO, 42, 1))
        self.assertEqual(doc["image"], "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/the-bha-api@" + DIGEST)      # tag replaced by the digest
        self.assertEqual(doc["raw_base"], "https://raw.githubusercontent.com/%s/%s" % (REPO, self.sha))
        self.assertEqual([f["path"] for f in doc["files"]], ALLOW)
        for f in doc["files"]:
            data = subprocess.run(["git", "-C", str(self.repo), "show", "%s:%s" % (self.sha, f["path"])], capture_output=True, check=True).stdout
            self.assertEqual((f["sha256"], f["size"]), (hashlib.sha256(data).hexdigest(), len(data)))
        self.assertEqual((doc["manifest"]["source_sha"], doc["manifest"]["migrations"]), (self.sha, sorted(self.ids)))
        self.assertEqual((self.d / "out/packet.sha256").read_text().strip(), hashlib.sha256(raw).hexdigest())
        self.assertEqual(self.check(self.d / "out/packet.json", hashlib.sha256(raw).hexdigest()).returncode, 0)
        self.assertNotRegex(raw.decode(), r"(?i)password|secret|token|BEGIN ")

    def test_the_bytes_come_from_the_commit_not_the_working_tree(self):
        (self.repo / ALLOW[1]).write_text("tampered after the commit\n")
        self.assertIn("TRACKED_FILES_MODIFIED", self.gen().stderr)                     # refused ...
        self.git("checkout", "--", ".")
        (self.repo / "untracked-note.txt").write_text("x")                              # ... while untracked files cannot matter
        self.assertEqual(self.gen().returncode, 0)

    def test_head_must_be_the_requested_sha_and_inputs_must_be_well_formed(self):
        self.assertIn("HEAD_IS_NOT_SOURCE_SHA", self.gen(source_sha="f" * 40).stderr)
        for over, code in (({"source_sha": "main"}, "SOURCE_SHA_MALFORMED"), ({"github_repository": "no-slash"}, "GITHUB_REPOSITORY_MALFORMED"),
                           ({"github_repository": "a/b c"}, "GITHUB_REPOSITORY_MALFORMED"), ({"run_id": "x"}, "RUN_ID_MALFORMED"), ({"run_attempt": "-1"}, "RUN_ATTEMPT_MALFORMED"),
                           ({"image_digest": "latest"}, "IMAGE_DIGEST_MALFORMED"), ({"image_digest": "sha256:xyz"}, "IMAGE_DIGEST_MALFORMED"),
                           ({"image_uri": self.uri.replace(self.sha, "f" * 40)}, "IMAGE_URI_WITHOUT_FULL_SHA_TAG"), ({"image_uri": "x y:" + self.sha}, "IMAGE_REFERENCE_MALFORMED")):
            p = self.gen(**over)
            self.assertNotEqual(p.returncode, 0, over)
            self.assertIn(code, p.stderr, over)
        self.assertIn("IMAGE_REQUIRED", self.gen(image_uri=None, image_digest=None).stderr)

    def test_rollback_and_recover_packets_carry_no_image(self):
        self.assertEqual(self.gen(image_uri=None, image_digest=None, no_image=True).returncode, 0)
        self.assertEqual(json.loads((self.d / "out/packet.json").read_text())["image"], "")

    def test_oversize_or_missing_script_bytes_and_a_disagreeing_manifest_are_refused(self):
        (self.repo / ALLOW[1]).write_bytes(b"x" * 262145)
        self.git("add", "-A"); self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "big")
        big = self.git("rev-parse", "HEAD").strip()
        self.assertIn("FILE_SIZE_OUT_OF_RANGE", self.gen(source_sha=big, image_uri=self.uri.replace(self.sha, big)).stderr)
        self.git("rm", "-q", ALLOW[0]); self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "gone")
        gone = self.git("rev-parse", "HEAD").strip()
        self.assertIn("GIT_FAILED", self.gen(source_sha=gone, image_uri=self.uri.replace(self.sha, gone)).stderr)

    def test_manifest_disagreement_between_sources_stops_the_packet(self):
        p = self.repo / "deploy/showcase/migrations/idempotent.sql"
        p.write_text(p.read_text() + 'INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")\n    VALUES (\'20260303000000_Phantom\', \'8\');\n')
        self.git("add", "-A"); self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "x")
        sha = self.git("rev-parse", "HEAD").strip()
        self.assertIn("MANIFEST_GENERATION_REFUSED", self.gen(source_sha=sha, image_uri=self.uri.replace(self.sha, sha)).stderr)


class Check(PacketFixture):
    def packet(self):
        self.assertEqual(self.gen().returncode, 0)
        return json.loads((self.d / "out/packet.json").read_text())

    def write(self, doc, canonical=True):
        p = self.d / "mutated.json"
        p.write_text(json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n" if canonical else json.dumps(doc, indent=2))
        return p

    def test_every_mutation_of_the_packet_is_refused(self):
        base = self.packet()
        mutations = {
            "extra key": lambda d: d.update(extra=1), "format": lambda d: d.update(format=2), "format bool": lambda d: d.update(format=True),
            "repository": lambda d: d.update(repository="a/b c"), "sha": lambda d: d.update(source_sha="abc"), "image tag": lambda d: d.update(image="repo:latest"),
            "run id bool": lambda d: d.update(run_id=True), "run id str": lambda d: d.update(run_id="1"),
            "raw base moving branch": lambda d: d.update(raw_base="https://raw.githubusercontent.com/%s/main" % REPO),
            "raw base other host": lambda d: d.update(raw_base="https://evil.example/%s/%s" % (REPO, d["source_sha"])),
            "extra file": lambda d: d["files"].append({"path": "x.sh", "sha256": "0" * 64, "size": 1}),
            "missing file": lambda d: d["files"].pop(), "reordered files": lambda d: d["files"].reverse(),
            "path traversal": lambda d: d["files"][0].update(path="../../etc/passwd"), "bad hash": lambda d: d["files"][0].update(sha256="xyz"),
            "size zero": lambda d: d["files"][0].update(size=0), "size huge": lambda d: d["files"][0].update(size=10**9),
            "manifest sha": lambda d: d["manifest"].update(source_sha="f" * 40), "manifest unsorted": lambda d: d["manifest"].update(migrations=list(reversed(d["manifest"]["migrations"]))),
            "manifest count": lambda d: d["manifest"].update(count=99), "manifest id": lambda d: d["manifest"].update(migrations=["bad id"], count=1),
        }
        for name, fn in mutations.items():
            doc = json.loads(json.dumps(base)); fn(doc)
            self.assertNotEqual(self.check(self.write(doc)).returncode, 0, name)
        self.assertEqual(self.check(self.write(base)).returncode, 0)
        self.assertNotEqual(self.check(self.write(base, canonical=False)).returncode, 0)          # not byte-canonical -> hash anchor would differ

    def test_the_sha256_anchor_detects_any_change_to_the_bytes(self):
        self.packet()
        raw = (self.d / "out/packet.json").read_bytes()
        self.assertEqual(self.check(self.d / "out/packet.json", hashlib.sha256(raw).hexdigest()).returncode, 0)
        p = self.check(self.d / "out/packet.json", "0" * 64)
        self.assertEqual(p.returncode, 1)
        self.assertIn("PACKET_SHA256_MISMATCH", p.stderr)
        (self.d / "big.json").write_bytes(b" " * 60000)
        self.assertIn("PACKET_TOO_LARGE", self.check(self.d / "big.json").stderr)
        (self.d / "bad.json").write_text("{not json")
        self.assertIn("PACKET_NOT_JSON", self.check(self.d / "bad.json").stderr)


if __name__ == "__main__":
    unittest.main()
