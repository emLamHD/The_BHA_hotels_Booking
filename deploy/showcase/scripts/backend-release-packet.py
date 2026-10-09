#!/usr/bin/env python3
"""BHA-BACKEND-CD-001-CP03: exact release packet (stdlib only, Python 3.8+).

  generate --repo DIR --source-sha SHA --github-repository OWNER/REPO --run-id N --run-attempt N --out DIR
           (--image-uri URI --image-digest sha256:... | --no-image)
      Builds DIR/packet.json and DIR/packet.sha256 from the git OBJECTS of commit SHA: the bytes of the four allowlisted
      scripts, the migration manifest produced by backend-migration-manifest.py, the image reference (repository@digest,
      the digest published by the same run) and the run identity. Refuses a checkout whose HEAD is not SHA, tracked
      modifications, an image URI that does not carry the full SHA tag, malformed digests/identities. No secret enters it.
  check --packet FILE [--sha256 HEX]
      Validates the packet grammar and (optionally) the SHA-256 of the file. Prints nothing on success.

The runner is the only trust anchor: it computes every hash from git objects and sends the packet and its SHA-256 itself.
The host downloads the script bytes from the public repository at the immutable full SHA and refuses any byte that does not
match the hash the runner sent.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

ALLOWLIST = (
    "deploy/showcase/scripts/backend-remote-release.sh",
    "deploy/showcase/scripts/backend-deploy.sh",
    "deploy/showcase/scripts/backend-migration-preflight.sh",
    "deploy/showcase/scripts/backend-migration-manifest.py",
)
MAX_FILE_BYTES = 262144
MAX_PACKET_BYTES = 49152
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
IMAGE_RE = re.compile(r"^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$")
RAW_HOST = "https://raw.githubusercontent.com"


class Refused(Exception):
    pass


def git(repo, *args, binary=False):
    p = subprocess.run(["git", "-C", repo] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise Refused("GIT_FAILED:" + args[0])
    return p.stdout if binary else p.stdout.decode("utf-8")


def canonical(doc):
    return (json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")


def derive_image(image_uri, image_digest, sha):
    if not image_uri.endswith(":" + sha):
        raise Refused("IMAGE_URI_WITHOUT_FULL_SHA_TAG")
    if not DIGEST_RE.match(image_digest):
        raise Refused("IMAGE_DIGEST_MALFORMED")
    ref = image_uri[: -(len(sha) + 1)] + "@" + image_digest
    if not IMAGE_RE.match(ref):
        raise Refused("IMAGE_REFERENCE_MALFORMED")
    return ref


def generate(args):
    sha, repo = args.source_sha, args.repo
    if not SHA_RE.match(sha):
        raise Refused("SOURCE_SHA_MALFORMED")
    if not REPO_RE.match(args.github_repository):
        raise Refused("GITHUB_REPOSITORY_MALFORMED")
    for name, value in (("RUN_ID", args.run_id), ("RUN_ATTEMPT", args.run_attempt)):
        if not re.match(r"^[0-9]{1,20}$", value):
            raise Refused(name + "_MALFORMED")
    if git(repo, "rev-parse", "HEAD").strip() != sha:
        raise Refused("HEAD_IS_NOT_SOURCE_SHA")
    if git(repo, "status", "--porcelain", "--untracked-files=no").strip():
        raise Refused("TRACKED_FILES_MODIFIED")
    image = ""
    if not args.no_image:
        if not args.image_uri or not args.image_digest:
            raise Refused("IMAGE_REQUIRED")
        image = derive_image(args.image_uri, args.image_digest, sha)
    files = []
    for path in ALLOWLIST:
        data = git(repo, "show", sha + ":" + path, binary=True)
        if not data or len(data) > MAX_FILE_BYTES:
            raise Refused("FILE_SIZE_OUT_OF_RANGE")
        files.append({"path": path, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)})
    gen = os.path.join(repo, "deploy/showcase/scripts/backend-migration-manifest.py")
    p = subprocess.run([sys.executable, "-I", gen, "generate", "--repo", repo, "--source-sha", sha], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise Refused("MANIFEST_GENERATION_REFUSED")
    manifest = json.loads(p.stdout.decode("utf-8"))
    packet = {
        "format": 1, "repository": args.github_repository, "source_sha": sha, "image": image,
        "run_id": int(args.run_id), "run_attempt": int(args.run_attempt),
        "raw_base": "%s/%s/%s" % (RAW_HOST, args.github_repository, sha), "files": files, "manifest": manifest,
    }
    data = canonical(packet)
    if len(data) > MAX_PACKET_BYTES:
        raise Refused("PACKET_TOO_LARGE")
    check_doc(json.loads(data.decode("ascii")))
    os.makedirs(args.out, mode=0o700, exist_ok=True)
    with open(os.path.join(args.out, "packet.json"), "wb") as handle:
        handle.write(data)
    with open(os.path.join(args.out, "packet.sha256"), "w") as handle:
        handle.write(hashlib.sha256(data).hexdigest() + "\n")


def check_doc(doc):
    """Strict grammar of a packet. Raises Refused with a code, never with a value."""
    if not isinstance(doc, dict) or set(doc) != {"format", "repository", "source_sha", "image", "run_id", "run_attempt", "raw_base", "files", "manifest"}:
        raise Refused("PACKET_KEYS")
    if doc["format"] != 1 or isinstance(doc["format"], bool):
        raise Refused("PACKET_FORMAT")
    if not isinstance(doc["repository"], str) or not REPO_RE.match(doc["repository"]):
        raise Refused("PACKET_REPOSITORY")
    if not isinstance(doc["source_sha"], str) or not SHA_RE.match(doc["source_sha"]):
        raise Refused("PACKET_SOURCE_SHA")
    if not isinstance(doc["image"], str) or (doc["image"] and not IMAGE_RE.match(doc["image"])):
        raise Refused("PACKET_IMAGE")
    for key in ("run_id", "run_attempt"):
        if not isinstance(doc[key], int) or isinstance(doc[key], bool) or doc[key] < 0:
            raise Refused("PACKET_" + key.upper())
    if doc["raw_base"] != "%s/%s/%s" % (RAW_HOST, doc["repository"], doc["source_sha"]):
        raise Refused("PACKET_RAW_BASE")
    files = doc["files"]
    if not isinstance(files, list) or [f.get("path") if isinstance(f, dict) else None for f in files] != list(ALLOWLIST):
        raise Refused("PACKET_FILES_NOT_THE_ALLOWLIST")
    for f in files:
        if set(f) != {"path", "sha256", "size"} or not isinstance(f["sha256"], str) or not HEX64_RE.match(f["sha256"]) \
                or not isinstance(f["size"], int) or isinstance(f["size"], bool) or not 0 < f["size"] <= MAX_FILE_BYTES:
            raise Refused("PACKET_FILE_ENTRY")
    m = doc["manifest"]
    ids = m.get("migrations") if isinstance(m, dict) else None
    if not isinstance(m, dict) or m.get("format") != 1 or m.get("source_sha") != doc["source_sha"] or not isinstance(ids, list) or not ids \
            or any(not isinstance(i, str) or not re.match(r"^[0-9]{14}_[A-Za-z0-9_]+$", i) for i in ids) or ids != sorted(set(ids)) or m.get("count") != len(ids):
        raise Refused("PACKET_MANIFEST")


def load(path, expected_sha256=None):
    with open(path, "rb") as handle:
        data = handle.read(MAX_PACKET_BYTES + 1)
    if len(data) > MAX_PACKET_BYTES:
        raise Refused("PACKET_TOO_LARGE")
    if expected_sha256 is not None and hashlib.sha256(data).hexdigest() != expected_sha256:
        raise Refused("PACKET_SHA256_MISMATCH")
    try:
        doc = json.loads(data.decode("utf-8"))
    except ValueError:
        raise Refused("PACKET_NOT_JSON")
    check_doc(doc)
    if canonical(doc) != data:
        raise Refused("PACKET_NOT_CANONICAL")
    return doc, data


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate")
    for opt in ("--repo", "--source-sha", "--github-repository", "--run-id", "--run-attempt", "--out"):
        g.add_argument(opt, required=True)
    g.add_argument("--image-uri")
    g.add_argument("--image-digest")
    g.add_argument("--no-image", action="store_true")
    c = sub.add_parser("check")
    c.add_argument("--packet", required=True)
    c.add_argument("--sha256")
    args = parser.parse_args(argv)
    try:
        if args.cmd == "generate":
            generate(args)
        else:
            load(args.packet, args.sha256)
    except (Refused, OSError) as error:
        sys.stderr.write("PACKET_REFUSED %s\n" % (error if isinstance(error, Refused) else "IO_ERROR"))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
