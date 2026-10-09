#!/usr/bin/env python3
"""
Regression tests for deploy/showcase/scripts/verify-key-persistence.sh
(CUST-WEB-SHOWCASE-001-CP02-C4, Codex finding P2: fixed scratch names could delete unrelated data).

The real script runs unchanged, but `docker`, `curl`, `python3` and (for collisions) `od` are stubs on
PATH that keep a tiny in-memory model of databases / volumes / containers in a temp directory and
write every command to a log. Assertions are about what resources were created and removed, not about
the script's text. Nothing here touches a real Docker daemon or PostgreSQL.

    python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py" -v
    SCRIPT_UNDER_TEST=/path/to/old/script.sh python3 -m unittest ...   # RED run against another copy

Stub faults (env FAULT): create_db, migrate, vol_b_fail, run2 (second `docker run -d` fails),
client (the python client fails), hang (curl sleeps so a signal can arrive mid-run).
"""
import os
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

REAL_SCRIPT = Path(__file__).resolve().parents[1] / "verify-key-persistence.sh"
SCRIPT = Path(os.environ.get("SCRIPT_UNDER_TEST", REAL_SCRIPT))

DOCKER_STUB = r'''#!/usr/bin/env bash
d="$STUB_DIR"; echo "docker $*" >> "$d/log"
args=("$@")
arg_after() { local k; for ((k=0;k<${#args[@]};k++)); do [[ "${args[k]}" == "$1" ]] && { echo "${args[k+1]}"; return; }; done; }
quoted() { local s="${1#*\"}"; echo "${s%\"*}"; }
case "$1" in
  compose)
    sql="$(arg_after -c)"
    if [[ -z "$sql" ]]; then cat >/dev/null; [[ "$FAULT" == migrate ]] && exit 1; exit 0; fi
    n="$(quoted "$sql")"
    if [[ "$sql" == CREATE\ DATABASE* ]]; then
      [[ -e "$d/dbs/$n" ]] && { echo "ERROR: database already exists" >&2; exit 1; }
      [[ "$FAULT" == create_db ]] && { echo "ERROR: injected" >&2; exit 1; }
      touch "$d/dbs/$n"
    elif [[ "$sql" == DROP\ DATABASE* ]]; then
      echo "DROP $n" >> "$d/drops"; rm -f "$d/dbs/$n"
    fi
    exit 0;;
  network) exit 0;;
  volume)
    case "$2" in
      inspect)
        if [[ "$3" == "-f" ]]; then v="$5"; else v="$3"; fi
        [[ -e "$d/vols/$v" ]] || exit 1
        [[ "$3" == "-f" ]] && cat "$d/vols/$v" || echo "[{}]"; exit 0;;
      create)
        label="$(arg_after --label)"; v="${args[${#args[@]}-1]}"
        [[ "$FAULT" == vol_b_fail && "$v" == *keys-b ]] && exit 1
        [[ -e "$d/vols/$v" ]] || printf '%s' "${label#*=}" > "$d/vols/$v"   # like docker: an existing volume keeps its label
        echo "$v"; exit 0;;
      rm) shift 2; for v in "$@"; do echo "VOLRM $v" >> "$d/removed"; rm -f "$d/vols/$v"; done; exit 0;;
    esac;;
  run)
    name="$(arg_after --name)"; label="$(arg_after --label)"
    if [[ " $* " == *" --rm "* ]]; then
      echo "Unhandled exception: DataProtection:KeysPath must point to durable shared storage"; exit 139
    fi
    n=$(( $(cat "$d/runs" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/runs"
    [[ "$FAULT" == run2 && "$n" == 2 ]] && exit 1
    [[ -e "$d/ctrs/$name" ]] && { echo "name in use" >&2; exit 1; }
    printf '%s' "${label#*=}" > "$d/ctrs/$name"; echo "cid_$name"; exit 0;;
  port) echo "127.0.0.1:18999"; echo "[::]:18999"; exit 0;;
  inspect)
    target="${args[${#args[@]}-1]}"; target="${target#cid_}"
    [[ -e "$d/ctrs/$target" ]] && { cat "$d/ctrs/$target"; exit 0; }; exit 1;;
  rm)
    for t in "${args[@]:1}"; do [[ "$t" == -f ]] && continue; t="${t#cid_}"; echo "RM $t" >> "$d/removed"; rm -f "$d/ctrs/$t"; done; exit 0;;
  logs) exit 0;;
esac
exit 0
'''
CURL_STUB = '''#!/usr/bin/env bash
[[ "$FAULT" == hang ]] && sleep 3
echo 200
'''
PYTHON_STUB = '''#!/usr/bin/env bash
cat >/dev/null
echo "python3 $*" >> "$STUB_DIR/log"
[[ "$FAULT" == client ]] && exit 1
exit 0
'''
OD_STUB = '''#!/usr/bin/env bash
echo " aa bb cc dd ee ff"
'''
OLD_DB, OLD_VOLS, OLD_CTR = "bhashow_keytest", ("the-bha-showcase-keytest-keys-a", "the-bha-showcase-keytest-keys-b"), "the-bha-showcase-keytest"


class Harness:
    def __init__(self, fixed_run_id=False):
        self.root = Path(tempfile.mkdtemp(prefix="keytest-harness-"))
        self.stub = self.root / "stub"
        for sub in ("dbs", "vols", "ctrs"):
            (self.stub / sub).mkdir(parents=True)
        (self.stub / "log").touch()
        self.bin = self.root / "bin"; self.bin.mkdir()
        stubs = {"docker": DOCKER_STUB, "curl": CURL_STUB, "python3": PYTHON_STUB}
        if fixed_run_id:
            stubs["od"] = OD_STUB
        for name, body in stubs.items():
            p = self.bin / name; p.write_text(body); p.chmod(p.stat().st_mode | stat.S_IEXEC)
        self.deploy = self.root / "showcase"
        (self.deploy / "scripts").mkdir(parents=True); (self.deploy / "migrations").mkdir()
        shutil.copy(SCRIPT, self.deploy / "scripts" / "verify-key-persistence.sh")
        (self.deploy / "migrations" / "idempotent.sql").write_text("-- dummy\n")
        (self.deploy / ".env").write_text(
            "SHOWCASE_DB=bhashow\nSHOWCASE_DB_USER=u\nSHOWCASE_DB_PASSWORD=not-a-secret\n"
            "CUSTOMER_ORIGIN=https://c.test\nADMIN_ORIGIN=https://a.test\n")
        self.tmp = self.root / "tmp"; self.tmp.mkdir()

    def add_canaries(self):
        (self.stub / "dbs" / OLD_DB).touch()
        for v in OLD_VOLS:
            (self.stub / "vols" / v).write_text("canary")
        (self.stub / "ctrs" / OLD_CTR).write_text("canary")

    def env(self, **extra):
        e = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", STUB_DIR=str(self.stub), TMPDIR=str(self.tmp), FAULT="")
        e.update(extra)
        return e

    def run(self, **extra):
        return subprocess.run(["bash", str(self.deploy / "scripts" / "verify-key-persistence.sh")],
                              env=self.env(**extra), capture_output=True, text=True, timeout=60)

    def read(self, name):
        p = self.stub / name
        return p.read_text() if p.exists() else ""

    def dbs(self): return sorted(p.name for p in (self.stub / "dbs").iterdir())
    def vols(self): return sorted(p.name for p in (self.stub / "vols").iterdir())
    def ctrs(self): return sorted(p.name for p in (self.stub / "ctrs").iterdir())
    def log(self): return self.read("log")
    def created_dbs(self): return re.findall(r'CREATE DATABASE "([^"]+)"', self.log())
    def cleanup(self): shutil.rmtree(self.root, ignore_errors=True)


class KeyPersistenceScratchOwnership(unittest.TestCase):
    def harness(self, **kw):
        h = Harness(**kw); self.addCleanup(h.cleanup); return h

    def assert_canaries_untouched(self, h):
        self.assertIn(OLD_DB, h.dbs())
        for v in OLD_VOLS: self.assertIn(v, h.vols())
        self.assertIn(OLD_CTR, h.ctrs())
        for name in (OLD_DB, *OLD_VOLS, OLD_CTR):
            for line in h.log().splitlines():
                if re.search(r"(DROP|rm |volume rm)", line):
                    self.assertNotIn(name, line, f"destructive command targeted pre-existing {name}: {line}")
        self.assertNotIn(OLD_DB, h.read("drops"))
        removed = h.read("removed")
        for name in (*OLD_VOLS, OLD_CTR): self.assertNotIn(name, removed)

    def assert_nothing_left(self, h):
        extra_db = [d for d in h.dbs() if d != OLD_DB]
        self.assertEqual(extra_db, [], "scratch database left behind")
        self.assertEqual([v for v in h.vols() if v not in OLD_VOLS], [], "scratch volume left behind")
        self.assertEqual([c for c in h.ctrs() if c != OLD_CTR], [], "scratch container left behind")
        self.assertEqual(list(h.tmp.iterdir()), [], "state file left behind")

    # 1 + 5
    def test_canaries_with_the_old_fixed_names_survive_a_normal_run_and_scratch_is_cleaned(self):
        h = self.harness(); h.add_canaries()
        r = h.run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("key persistence verified", r.stdout)
        self.assert_canaries_untouched(h)
        self.assert_nothing_left(h)
        self.assertEqual(len(h.created_dbs()), 1)
        # all three runtime phases ran against the one scratch namespace
        self.assertIn("same-volume", h.log()); self.assertIn("fresh-volume", h.log())

    def test_every_scratch_resource_name_belongs_to_the_run_namespace(self):
        h = self.harness()
        self.assertEqual(h.run().returncode, 0)
        (db,) = h.created_dbs()
        rid = db.removeprefix("bha_kt_")
        self.assertRegex(rid, r"^[0-9a-f]{12}$")
        self.assertLessEqual(len(db), 63)
        self.assertNotIn("keytest", db)
        names = re.findall(r"--name (\S+)", h.log())
        self.assertTrue(names and all(n.startswith(f"bha-kt-{rid}") for n in names), names)
        created_vols = re.findall(r"volume create --label \S+ (\S+)", h.log())
        self.assertEqual(sorted(created_vols), [f"bha-kt-{rid}-keys-a", f"bha-kt-{rid}-keys-b"])

    # 3
    def test_two_runs_use_different_namespaces_and_each_cleans_only_its_own(self):
        h = self.harness(); h.add_canaries()
        self.assertEqual(h.run().returncode, 0)
        self.assertEqual(h.run().returncode, 0)
        first, second = h.created_dbs()
        self.assertNotEqual(first, second)
        drops = h.read("drops").split()
        self.assertEqual(drops, ["DROP", first, "DROP", second])  # each run dropped exactly its own database
        self.assert_canaries_untouched(h); self.assert_nothing_left(h)

    def test_a_second_run_never_touches_the_resources_of_a_run_still_in_progress(self):
        h = self.harness()
        other = "bha_kt_0123456789ab"
        (h.stub / "dbs" / other).touch()
        (h.stub / "vols" / "bha-kt-0123456789ab-keys-a").write_text("0123456789ab")
        (h.stub / "ctrs" / "bha-kt-0123456789ab").write_text("0123456789ab")
        self.assertEqual(h.run().returncode, 0)
        self.assertIn(other, h.dbs()); self.assertIn("bha-kt-0123456789ab-keys-a", h.vols()); self.assertIn("bha-kt-0123456789ab", h.ctrs())
        self.assertNotIn("0123456789ab", h.read("removed") + h.read("drops"))

    # 2
    def test_database_name_collision_is_refused_without_drop_or_takeover(self):
        h = self.harness(fixed_run_id=True)
        (h.stub / "dbs" / "bha_kt_aabbccddeeff").touch()
        r = h.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(h.dbs(), ["bha_kt_aabbccddeeff"])
        self.assertEqual(h.read("drops"), "")
        self.assertEqual(h.read("removed"), "")
        self.assertNotIn("volume create", h.log()); self.assertNotIn("docker run", h.log())

    def test_volume_collision_is_refused_the_pre_existing_volume_is_kept_and_only_owned_resources_are_removed(self):
        h = self.harness(fixed_run_id=True)
        (h.stub / "vols" / "bha-kt-aabbccddeeff-keys-b").write_text("someone-else")
        r = h.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("already exists", r.stderr)
        self.assertIn("bha-kt-aabbccddeeff-keys-b", h.vols())
        self.assertEqual((h.stub / "vols" / "bha-kt-aabbccddeeff-keys-b").read_text(), "someone-else")
        self.assertNotIn("VOLRM bha-kt-aabbccddeeff-keys-b", h.read("removed"))
        self.assertEqual(h.dbs(), [])                                  # the run's own database was cleaned
        self.assertNotIn("bha-kt-aabbccddeeff-keys-a", h.vols())      # and its own volume

    def test_a_volume_whose_label_is_not_this_runs_is_never_removed(self):
        # `docker volume create` succeeds for an existing name and keeps the old label; the pre-check must
        # catch it, and even if it were raced the label check in cleanup must stop the removal.
        h = self.harness(fixed_run_id=True)
        (h.stub / "vols" / "bha-kt-aabbccddeeff-keys-a").write_text("foreign")
        h.run()
        self.assertIn("bha-kt-aabbccddeeff-keys-a", h.vols())

    # 4
    def test_create_database_failure_drops_nothing_and_removes_nothing(self):
        h = self.harness(); h.add_canaries()
        r = h.run(FAULT="create_db")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(h.read("drops"), ""); self.assertEqual(h.read("removed"), "")
        self.assert_canaries_untouched(h); self.assert_nothing_left(h)

    def test_failure_before_any_resource_exists_leaves_everything_alone(self):
        h = self.harness(); h.add_canaries()
        (h.deploy / ".env").write_text("this is not valid shell (\n")
        r = h.run()
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(h.log().strip(), ""); self.assert_canaries_untouched(h)

    def test_migration_failure_drops_only_the_owned_database(self):
        h = self.harness(); h.add_canaries()
        self.assertNotEqual(h.run(FAULT="migrate").returncode, 0)
        self.assertEqual(len(h.read("drops").split()), 2)
        self.assertNotIn("volume create", h.log())
        self.assert_canaries_untouched(h); self.assert_nothing_left(h)

    def test_failure_between_volume_creations_removes_only_the_volume_that_was_created(self):
        h = self.harness(); h.add_canaries()
        self.assertNotEqual(h.run(FAULT="vol_b_fail").returncode, 0)
        removed = h.read("removed").split()
        (db,) = h.created_dbs(); rid = db.removeprefix("bha_kt_")
        self.assertEqual(removed, ["VOLRM", f"bha-kt-{rid}-keys-a"])
        self.assert_canaries_untouched(h); self.assert_nothing_left(h)

    def test_container_start_failure_after_one_container_cleans_by_id_what_exists(self):
        h = self.harness(); h.add_canaries()
        self.assertNotEqual(h.run(FAULT="run2").returncode, 0)
        (db,) = h.created_dbs(); rid = db.removeprefix("bha_kt_")
        self.assertEqual(h.ctrs(), [OLD_CTR])
        self.assertIn(f"RM bha-kt-{rid}", h.read("removed"))
        self.assertNotIn(OLD_CTR, h.read("removed"))
        self.assert_canaries_untouched(h); self.assert_nothing_left(h)

    def test_client_failure_still_cleans_container_volumes_database_and_state_file(self):
        h = self.harness(); h.add_canaries()
        r = h.run(FAULT="client")
        self.assertNotEqual(r.returncode, 0)
        self.assert_canaries_untouched(h); self.assert_nothing_left(h)

    def test_sigterm_during_the_run_cleans_owned_resources_and_exits_143(self):
        h = self.harness(); h.add_canaries()
        p = subprocess.Popen(["bash", str(h.deploy / "scripts" / "verify-key-persistence.sh")], env=h.env(FAULT="hang"),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.time() + 20
        while time.time() < deadline and not h.created_dbs(): time.sleep(0.05)
        time.sleep(0.5)
        p.send_signal(signal.SIGTERM)
        p.communicate(timeout=30)
        self.assertEqual(p.returncode, 143)
        self.assert_canaries_untouched(h); self.assert_nothing_left(h)

    def test_a_cleanup_failure_does_not_hide_the_main_failure_and_names_what_is_left(self):
        h = self.harness()
        # the client fails (main error) and then removing the volumes fails (cleanup error)
        bad_docker = h.bin / "docker"
        bad_docker.write_text(DOCKER_STUB.replace('rm) shift 2; for v in "$@"; do', 'rm) exit 1; shift 2; for v in "$@"; do'))
        r = h.run(FAULT="client")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("scratch cleanup incomplete", r.stderr)
        self.assertRegex(r.stderr, r"volume bha-kt-[0-9a-f]{12}-keys-a")
        self.assertNotIn("not-a-secret", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
