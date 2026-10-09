#!/usr/bin/env python3
"""BHA-BACKEND-CD-001-CP02: release migration manifest (stdlib only, Python 3.8+).

  generate --repo DIR --source-sha SHA [--output FILE]
      Reads the ordered EF Core migration IDs from the git OBJECTS of commit SHA (not the working tree) and
      cross-checks two independent sources at that commit: the [Migration("...")] attributes of the *.Designer.cs
      files and the history INSERTs of deploy/showcase/migrations/idempotent.sql. Refuses a repo whose HEAD is not SHA
      or whose tracked files are modified. Prints/writes JSON:
      {"format":1,"source_sha":...,"count":N,"migrations":[ordinal-sorted IDs]}
  ids --manifest FILE --source-sha SHA
      Validates a manifest (format, source_sha equals the requested release SHA, IDs well-formed, unique, ordinal
      order) and prints the IDs, one per line.

Exit: 0 ok; 1 refused/invalid (a code on stderr, never file contents).
"""
import argparse
import json
import re
import subprocess
import sys

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ID_RE = re.compile(r"^[0-9]{14}_[A-Za-z0-9_]+$")
MIGRATIONS_DIR = "Back_End/src/TheBha.Infrastructure/Persistence/Migrations"
SQL_FILE = "deploy/showcase/migrations/idempotent.sql"


class Refused(Exception):
    pass


def git(repo, *args):
    p = subprocess.run(["git", "-C", repo] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise Refused("GIT_FAILED:" + args[0])
    return p.stdout.decode("utf-8")


def generate(repo, sha, migrations_dir, sql_file):
    if not SHA_RE.match(sha):
        raise Refused("SOURCE_SHA_MALFORMED")
    if git(repo, "rev-parse", "HEAD").strip() != sha:
        raise Refused("HEAD_IS_NOT_SOURCE_SHA")
    if git(repo, "status", "--porcelain", "--untracked-files=no").strip():
        raise Refused("TRACKED_FILES_MODIFIED")
    names = git(repo, "ls-tree", "-r", "--name-only", sha, "--", migrations_dir).splitlines()
    from_attr = []
    for path in sorted(n for n in names if n.endswith(".Designer.cs")):
        stem = path.rsplit("/", 1)[-1][: -len(".Designer.cs")]
        ids = re.findall(r'\[Migration\("([^"]+)"\)\]', git(repo, "show", sha + ":" + path))
        if ids != [stem]:
            raise Refused("DESIGNER_ID_DISAGREES_WITH_FILENAME")
        from_attr.append(stem)
    from_sql = re.findall(
        r"""INSERT INTO "__EFMigrationsHistory" \("MigrationId", "ProductVersion"\)\s+VALUES \('([^']+)'""",
        git(repo, "show", sha + ":" + sql_file),
    )
    if not from_attr:
        raise Refused("NO_MIGRATIONS_FOUND")
    if sorted(from_attr) != sorted(from_sql) or len(set(from_attr)) != len(from_attr):
        raise Refused("MIGRATION_SOURCES_DISAGREE")
    migrations = sorted(from_attr)  # ordinal (bytewise) order, the same order EF applies and the preflight queries
    if not all(ID_RE.match(m) for m in migrations):
        raise Refused("MIGRATION_ID_MALFORMED")
    return {"format": 1, "source_sha": sha, "count": len(migrations), "migrations": migrations}


def load_ids(path, sha):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            doc = json.load(handle)
    except (OSError, ValueError):
        raise Refused("MANIFEST_UNREADABLE")
    if not isinstance(doc, dict) or doc.get("format") != 1:
        raise Refused("MANIFEST_FORMAT")
    if not SHA_RE.match(sha) or doc.get("source_sha") != sha:
        raise Refused("MANIFEST_SOURCE_SHA_MISMATCH")
    ids = doc.get("migrations")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) and ID_RE.match(i) for i in ids):
        raise Refused("MANIFEST_IDS_MALFORMED")
    if ids != sorted(set(ids)) or doc.get("count") != len(ids):
        raise Refused("MANIFEST_IDS_NOT_UNIQUE_SORTED_OR_COUNT")
    return ids


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    gen = sub.add_parser("generate")
    gen.add_argument("--repo", required=True)
    gen.add_argument("--source-sha", required=True)
    gen.add_argument("--output")
    gen.add_argument("--migrations-dir", default=MIGRATIONS_DIR)
    gen.add_argument("--sql-file", default=SQL_FILE)
    ids = sub.add_parser("ids")
    ids.add_argument("--manifest", required=True)
    ids.add_argument("--source-sha", required=True)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "generate":
            text = json.dumps(generate(args.repo, args.source_sha, args.migrations_dir, args.sql_file), indent=2) + "\n"
            if args.output:
                with open(args.output, "w", encoding="utf-8") as handle:
                    handle.write(text)
            else:
                sys.stdout.write(text)
        else:
            sys.stdout.write("\n".join(load_ids(args.manifest, args.source_sha)) + "\n")
    except Refused as error:
        sys.stderr.write("MANIFEST_REFUSED " + str(error) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
