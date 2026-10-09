#!/usr/bin/env python3
"""
BHA-BACKEND-CD-001-CP02 tests: backend-deploy.sh, backend-migration-preflight.sh, backend-migration-manifest.py.

The scripts run unchanged. `docker`, `curl` and `psql` are stubs first on PATH over a small JSON model of containers,
images and a database, with fault injection; every command is logged. Nothing here touches a Docker daemon, PostgreSQL
or any cloud. These mocks complement, and never replace, the real isolated rehearsal in rehearse_backend_deploy.sh.

    python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py" -v
"""
import json
import os
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
DEPLOY = SCRIPTS / "backend-deploy.sh"
PREFLIGHT = SCRIPTS / "backend-migration-preflight.sh"
MANIFEST = SCRIPTS / "backend-migration-manifest.py"

SHA = "0123456789abcdef0123456789abcdef01234567"
OLD_SHA = "1" * 40
URL = "https://github.com/emLamHD/The_BHA_hotels_Booking"
REPO = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/the-bha-api"
D_OLD, D_CAND, D_BAD = ("sha256:" + c * 64 for c in "123")
ID_OLD, ID_CAND, ID_BAD = ("sha256:" + c * 64 for c in "abc")
REF_OLD, REF_CAND, REF_BAD = (REPO + "@" + d for d in (D_OLD, D_CAND, D_BAD))
TARGET = "the-bha-api"
CANARY = "CANARY-secret-7f3a91"
IDS = ["20260721175848_InitialPropertyRoomInventory", "20260722102552_AddRatePlanFoundation", "20261001141847_AddStaffIdentityFoundation"]

DOCKER_STUB = r'''#!/usr/bin/env python3
import hashlib, json, os, sys, time
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ST = os.path.join(D, "state.json")
def load():
    with open(ST) as f: return json.load(f)
def save(s):
    with open(ST, "w") as f: json.dump(s, f)
def log(argv):
    with open(os.path.join(D, "docker.log"), "a") as f: f.write(" ".join(argv) + "\n")
def faults():
    p = os.path.join(D, "faults")
    return [l.split() for l in open(p).read().splitlines() if l.strip()] if os.path.exists(p) else []
def die(msg, rc=1):
    sys.stderr.write(msg + "\n"); sys.exit(rc)
def img_alias(s, image_id):
    for alias, iid in s["aliases"].items():
        if iid == image_id: return alias
    return "?"
def fault(op, **ctx):
    for f in faults():
        if f[0] != op: continue
        ok = True
        for cond in f[1:]:
            k, _, v = cond.partition("=")
            if k == "image" and ctx.get("image") != v: ok = False
            if k == "name" and v not in (ctx.get("name") or ""): ok = False
            if k == "newname" and v not in (ctx.get("newname") or ""): ok = False
        if ok: return True
    return False
def find(s, x):
    x = x.lstrip("/")
    for cid, c in s["containers"].items():
        if cid == x or c["name"] == x: return cid
    return None
def inspect_c(s, cid):
    c = s["containers"][cid]; im = s["images_by_id"][c["image_id"]]
    hc = {"NetworkMode": c.get("network", "default"), "PortBindings": c["ports"], "RestartPolicy": {"Name": c["restart"][0], "MaximumRetryCount": c["restart"][1]},
          "LogConfig": {"Type": c["log"][0], "Config": c["log"][1]}, "CapAdd": None, "CapDrop": None, "SecurityOpt": None, "ReadonlyRootfs": False,
          "Memory": 0, "MemorySwap": 0, "NanoCpus": 0, "PidsLimit": None, "Privileged": False}
    hc.update(c.get("hc_extra", {}))
    labels = dict(im["Labels"]); labels.update(c["labels"])
    cfg = {"Image": c["config_image"], "Env": c["env"], "Labels": labels, "Entrypoint": im["Entrypoint"], "Cmd": None, "User": im["User"], "WorkingDir": "/app", "StopSignal": ""}
    cfg.update(c.get("cfg_extra", {}))
    return {"Id": cid, "Name": "/" + c["name"], "Image": c["image_id"], "State": {"Running": c["running"], "Status": "running" if c["running"] else c["status"]},
            "Config": cfg, "HostConfig": hc, "Mounts": c["mounts"]}
def inspect_i(s, x):
    im = s["images"].get(x) or s["images_by_id"].get(x)
    if not im: die("Error: No such image: " + x)
    return {"Id": im["Id"], "RepoDigests": im["RepoDigests"], "Config": {"Env": im["Env"], "Labels": im["Labels"], "User": im["User"], "Entrypoint": im["Entrypoint"], "Cmd": None, "WorkingDir": "/app", "StopSignal": "", "ExposedPorts": {"8080/tcp": {}}}}
def parse_envfile(path):
    out = []
    for line in open(path, "rb").read().decode("utf-8", "surrogateescape").split("\n"):
        if line and not line.startswith("#"): out.append(line)
    return out
def newid(s):
    s["next"] += 1
    return hashlib.sha256(("c%d" % s["next"]).encode()).hexdigest()

argv = sys.argv[1:]
log(argv)
s = load()
cmd = argv[0]
if cmd == "version": sys.exit(0)
if cmd == "pull":
    ref = argv[-1]
    if fault("pull") or ref not in s["registry"]: die("Error: pull access denied / not found")
    s["images"][ref] = s["images_by_id"][s["registry"][ref]]; save(s); sys.exit(0)
if cmd == "image" and argv[1] == "inspect":
    rest = argv[2:]
    if rest[0] == "--format": print(inspect_i(s, rest[2])["Id"]); sys.exit(0)
    print(json.dumps([inspect_i(s, rest[0])])); sys.exit(0)
if cmd == "container" and argv[1] == "inspect":
    rest = argv[2:]
    cid = find(s, rest[-1])
    if not cid: die("Error: No such container: " + rest[-1])
    if rest[0] == "--format":
        print(s["containers"][cid]["labels"].get("com.thebha.deploy.run", "")); sys.exit(0)
    print(json.dumps([inspect_c(s, cid)])); sys.exit(0)
if cmd == "ps":
    key = [a for a in argv if a.startswith("label=")][0][6:]
    k, _, v = key.partition("=")
    for cid, c in s["containers"].items():
        if c["labels"].get(k) == v: print(cid)
    sys.exit(0)
if cmd == "create":
    a = argv[1:]; name = None; labels = {}; restart = ("no", 0); logd = ("json-file", {}); ports = {}; envfile = None; mounts = []; network = "default"; i = 0
    while i < len(a):
        t = a[i]
        if t == "--name": name = a[i + 1]; i += 2
        elif t == "--label": k, _, v = a[i + 1].partition("="); labels[k] = v; i += 2
        elif t.startswith("--restart="): r = t.split("=", 1)[1]; restart = (r.split(":")[0], int(r.split(":")[1]) if ":" in r else 0); i += 1
        elif t == "--log-driver": logd = (a[i + 1], logd[1]); i += 2
        elif t == "--log-opt": k, _, v = a[i + 1].partition("="); logd[1][k] = v; i += 2
        elif t == "-p": h, hp, cp = a[i + 1].split(":"); ports = {cp + "/tcp": [{"HostIp": h, "HostPort": hp}]}; i += 2
        elif t == "--env-file": envfile = a[i + 1]; i += 2
        elif t == "--network": network = a[i + 1]; i += 2
        elif t == "--mount":
            kv = dict(x.partition("=")[::2] if "=" in x else (x, "") for x in a[i + 1].split(","))
            mounts.append({"Type": kv["type"], "Source": kv["src"], "Destination": kv["dst"], "RW": "readonly" not in kv, "Mode": ""}); i += 2
        elif t.startswith("-"): i += 2
        else: image_ref = t; i += 1
    if fault("create"): die("Error: create failed")
    if find(s, name): die("Conflict. The container name is already in use")
    im = s["images"].get(image_ref)
    if not im: die("Error: No such image")
    env = dict(e.split("=", 1) for e in im["Env"])
    for e in parse_envfile(envfile): k, _, v = e.partition("="); env[k] = v
    cid = newid(s)
    s["containers"][cid] = {"name": name, "image_id": im["Id"], "config_image": image_ref, "running": False, "status": "created", "restart": list(restart), "log": [logd[0], logd[1]],
        "ports": ports, "labels": labels, "env": ["%s=%s" % kv for kv in env.items()], "mounts": mounts, "network": network}
    save(s); print(cid); sys.exit(0)
if cmd in ("start", "stop", "rm", "logs"):
    cid = find(s, argv[-1])
    if not cid: die("Error: No such container")
    c = s["containers"][cid]
    ctx = {"image": img_alias(s, c["image_id"]), "name": c["name"]}
    if cmd == "start":
        if fault("start", **ctx): die("Error: cannot start container")
        for oid, o in s["containers"].items():
            if oid != cid and o["running"] and o["ports"] == c["ports"]: die("Error: port is already allocated")
        c["running"] = True; c["status"] = "running"
        if os.path.exists(os.path.join(D, "block-start")):
            save(s); open(os.path.join(D, "blocked"), "w").write(str(os.getpid()))
            time.sleep(60)
    elif cmd == "stop":
        if fault("stop", **ctx): die("Error: cannot stop")
        c["running"] = False; c["status"] = "exited"
    elif cmd == "rm":
        if c["running"]: die("Error: cannot remove a running container")
        del s["containers"][cid]
    elif cmd == "logs": print("candidate log line"); sys.exit(0)
    save(s); sys.exit(0)
if cmd == "rename":
    cid = find(s, argv[1])
    if not cid: die("Error: No such container")
    c = s["containers"][cid]
    if fault("rename", image=img_alias(s, c["image_id"]), name=c["name"], newname=argv[2]): die("Error: rename failed")
    if find(s, argv[2]): die("Error: name already in use")
    c["name"] = argv[2]; save(s); sys.exit(0)
if cmd == "update":
    pol = [a for a in argv if a.startswith("--restart=")][0].split("=", 1)[1]
    cid = find(s, argv[-1]); c = s["containers"][cid]
    if fault("update", image=img_alias(s, c["image_id"]), name=c["name"]): die("Error: update failed")
    c["restart"] = [pol.split(":")[0], int(pol.split(":")[1]) if ":" in pol else 0]; save(s); sys.exit(0)
if cmd == "exec":
    cid = find(s, argv[1]); c = s["containers"][cid]
    if not c["running"]: die("Error: container is not running")
    ctx = {"image": img_alias(s, c["image_id"]), "name": c["name"]}
    if argv[2] == "find":
        if fault("keys-empty", **ctx): sys.exit(0)
        for name, h in sorted(s["keys"].items()): print("%s  /var/keys/%s" % (h, name))
        sys.exit(0)
    if fault("mount-fail", **ctx): sys.exit(1)
    sys.exit(0)
die("unexpected docker call: " + " ".join(argv), 99)
'''

CURL_STUB = r'''#!/usr/bin/env python3
import json, os, sys
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = sys.argv[1:]
url = a[-1]; out = None; w = False
for i, t in enumerate(a):
    if t == "-o": out = a[i + 1]
    if t == "-w": w = True
st = json.load(open(os.path.join(D, "state.json")))
faults = [l.split() for l in open(os.path.join(D, "faults")).read().splitlines() if l.strip()] if os.path.exists(os.path.join(D, "faults")) else []
running = [c for c in st["containers"].values() if c["running"]]
if not running: sys.exit(7)
alias = next((k for k, iid in st["aliases"].items() if iid == running[0]["image_id"]), "?")
def bad(op): return any(f[0] == op and ("image=" + alias in f[1:] or len(f) == 1) for f in faults)
code, body = 200, ""
if url.endswith("/health/ready"):
    code, body = (503, "Unhealthy") if bad("ready") else (200, "Healthy")
elif url.endswith("/api/v1/properties"):
    code = 404 if bad("api404") else 200
    body = json.dumps([{"id": "a1000000-0000-0000-0000-000000000001", "name": "P", "slug": "p", "timeZone": "Asia/Ho_Chi_Minh"}])
elif url.endswith("/api/admin/v1/me"):
    code = 404 if bad("me404") else 401
if out: open(out, "w").write(body)
if w: sys.stdout.write(str(code))
'''

PSQL_STUB = r'''#!/usr/bin/env python3
import json, os, sys
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = sys.argv[1:]
sql = open(a[a.index("-f") + 1]).read()
open(os.path.join(D, "psql.sql"), "w").write(sql)
open(os.path.join(D, "psql.env"), "w").write("\n".join(sorted(k + "=" + v for k, v in os.environ.items() if k.startswith("PG"))) + "\nARGS=" + " ".join(a) + "\n")
db = json.load(open(os.path.join(D, "db.json")))
fail = db.get("fail")
if fail:
    msg = {"perm": "ERROR: permission denied for table __EFMigrationsHistory", "tls": "psql: error: SSL error: certificate verify failed",
           "conn": "psql: error: connection to server failed: Connection refused", "timeout": "ERROR: canceling statement due to statement timeout",
           "query": "ERROR: boom"}[fail]
    sys.stderr.write(msg + " " + os.environ.get("CANARY_IN_STDERR", "") + "\n"); sys.exit(124 if fail == "timeout-rc" else 2)
print(db.get("identity", "identity|thebha|bha_app|true|on"))
print("history|" + ("t" if db.get("has_history", True) else "f"))
if db.get("has_history", True):
    for i in db["ids"]: print("id|" + i)
'''


def write(path, text, mode=0o600):
    Path(path).write_text(text)
    os.chmod(path, mode)


class Host:
    """A scratch Docker host: stubs, a JSON model, config/env/pg files and a private journal."""

    def __init__(self):
        self.d = Path(tempfile.mkdtemp(prefix="bha-cp02-t-"))
        self.bin = self.d / "bin"; self.bin.mkdir()
        for name, body in (("docker", DOCKER_STUB), ("curl", CURL_STUB), ("psql", PSQL_STUB)):
            write(self.bin / name, body, 0o755)
        self.lock = self.d / "lock"; self.lock.mkdir()
        self.journal = self.d / "journal"; self.journal.mkdir(mode=0o700)
        self.keysdir = self.d / "keys"; self.keysdir.mkdir()
        self.ca = self.d / "ca.pem"; write(self.ca, "CA", 0o644)
        self.env = self.d / "api.env"
        self.env_lines = ["ASPNETCORE_ENVIRONMENT=Production",
                          "ConnectionStrings__TheBhaDatabase=Host=h;Port=5432;Password=%s;SSL Mode=VerifyFull" % CANARY,
                          "Logging.LogLevel.Default=a=b=c", "Cors__AdminOrigins__0=https://admin.example.invalid"]
        self.write_env()
        self.svc = self.d / "pg_service.conf"
        write(self.svc, "[app-read]\nhost=db.internal\nport=5432\ndbname=thebha\nuser=bha_app\nsslmode=verify-full\nsslrootcert=%s\n" % self.ca)
        self.pass_ = self.d / "pgpass"; write(self.pass_, "db.internal:5432:thebha:bha_app:%s\n" % CANARY)
        self.conf = self.d / "host.conf"
        self.write_conf()
        self.manifest = self.d / "manifest.json"
        self.write_manifest(IDS)
        write(self.d / "db.json", json.dumps({"ids": IDS}))
        self.state = self.fresh_state()
        self.save()

    def write_env(self):
        write(self.env, "\n".join(self.env_lines) + "\n")

    def write_conf(self, **over):
        cfg = dict(TARGET_CONTAINER=TARGET, ALLOWED_IMAGE_REPOSITORY=REPO, EXPECTED_SOURCE_URL=URL, EXPECTED_CURRENT_IMAGE=REF_OLD,
                   LOOPBACK_PORT="8080", ENV_FILE=self.env, KEYS_DIR=self.keysdir, CA_FILE=self.ca, JOURNAL_DIR=self.journal,
                   PG_SERVICE_FILE=self.svc, PG_PASS_FILE=self.pass_, PG_SERVICE="app-read", PG_EXPECT_HOST="db.internal",
                   PG_EXPECT_DB="thebha", PG_EXPECT_USER="bha_app", API_BASE_URL="https://api.example.invalid", PSQL_BIN=self.bin / "psql",
                   READY_TIMEOUT_SECONDS="10", LOCK_WAIT_SECONDS="1", STOP_TIMEOUT_SECONDS="5")
        cfg.update({k: str(v) for k, v in over.items()})
        write(self.conf, "# fixture host config\n" + "\n".join("%s=%s" % kv for kv in cfg.items()) + "\n")

    def write_manifest(self, ids, sha=SHA):
        write(self.manifest, json.dumps({"format": 1, "source_sha": sha, "count": len(ids), "migrations": ids}), 0o644)

    def fresh_state(self):
        def image(i, labels, env):
            return {"Id": i, "RepoDigests": [], "Env": env, "Labels": labels, "User": "app", "Entrypoint": ["dotnet", "TheBha.Api.dll"]}
        base = ["PATH=/usr/bin", "ASPNETCORE_ENVIRONMENT=Production", "DOTNET_gcServer=0"]
        old = image(ID_OLD, {"org.opencontainers.image.revision": OLD_SHA, "org.opencontainers.image.source": URL}, base + ["DOTNET_VERSION=8.0.1"])
        cand = image(ID_CAND, {"org.opencontainers.image.revision": SHA, "org.opencontainers.image.source": URL}, base + ["DOTNET_VERSION=8.0.2"])
        bad = image(ID_BAD, {"org.opencontainers.image.revision": SHA, "org.opencontainers.image.source": URL}, base + ["DOTNET_VERSION=8.0.2"])
        old["RepoDigests"], cand["RepoDigests"], bad["RepoDigests"] = [REF_OLD], [REF_CAND], [REF_BAD]
        env = dict(e.split("=", 1) for e in old["Env"])
        env.update(dict(l.split("=", 1) for l in self.env_lines))
        old_cid = "9" * 64
        return {"next": 0, "keys": {"key-1.xml": "h1" * 32}, "registry": {REF_CAND: ID_CAND, REF_BAD: ID_BAD},
                "images": {"OLD": old, REF_OLD: old}, "images_by_id": {ID_OLD: old, ID_CAND: cand, ID_BAD: bad},
                "aliases": {"OLD": ID_OLD, "CAND": ID_CAND, "BAD": ID_BAD},
                "containers": {old_cid: {"name": TARGET, "image_id": ID_OLD, "config_image": REF_OLD, "running": True, "status": "running",
                                         "restart": ["unless-stopped", 0], "log": ["json-file", {"max-size": "10m"}],
                                         "ports": {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8080"}]}, "labels": {},
                                         "env": ["%s=%s" % kv for kv in env.items()],
                                         "mounts": [{"Type": "bind", "Source": str(self.keysdir), "Destination": "/var/keys", "RW": True, "Mode": ""},
                                                    {"Type": "bind", "Source": str(self.ca), "Destination": "/certs/rds-ca.pem", "RW": False, "Mode": ""}]}}}

    def save(self):
        write(self.d / "state.json", json.dumps(self.state), 0o644)

    def load(self):
        self.state = json.loads((self.d / "state.json").read_text())
        return self.state

    def old_cid(self):
        return "9" * 64

    def fault(self, *lines):
        write(self.d / "faults", "\n".join(lines) + "\n", 0o644)

    def env_for(self):
        e = dict(os.environ)
        e.update(PATH="%s:/usr/bin:/bin" % self.bin, BHA_DEPLOY_LOCK_DIR=str(self.lock))
        return e

    def run(self, cmd="deploy", image=REF_CAND, sha=SHA, manifest=None, extra=(), timeout=120, conf=None):
        argv = [str(DEPLOY), cmd, "--config", str(conf or self.conf)]
        if cmd in ("deploy", "preflight"):
            argv += ["--image", image, "--source-sha", sha, "--manifest", str(manifest or self.manifest)]
        p = subprocess.run(argv + list(extra), env=self.env_for(), capture_output=True, text=True, timeout=timeout)
        out = p.stdout.strip().splitlines()
        self.last = json.loads(out[-1]) if out and out[-1].startswith("{") else {}
        self.proc = p
        return p.returncode

    def log(self):
        p = self.d / "docker.log"
        return p.read_text().splitlines() if p.exists() else []

    def mutating(self):
        return [l for l in self.log() if l.split()[0] in ("create", "stop", "rename", "update", "rm", "start")]

    def containers(self):
        return self.load()["containers"]

    def by_name(self, name):
        for cid, c in self.containers().items():
            if c["name"] == name:
                return cid, c
        return None, None

    def cleanup(self):
        shutil.rmtree(self.d, ignore_errors=True)


class Base(unittest.TestCase):
    def setUp(self):
        self.h = Host()
        self.addCleanup(self.h.cleanup)

    def assert_old_untouched(self, restart=("unless-stopped", 0)):
        cid, c = self.h.by_name(TARGET)
        self.assertEqual(cid, self.h.old_cid())
        self.assertTrue(c["running"])
        self.assertEqual(c["restart"], list(restart))
        self.assertEqual([l for l in self.h.log() if l.split()[0] in ("stop", "rename", "update", "start")], [])
        removed = [l for l in self.h.log() if l.split()[0] == "rm"]
        self.assertTrue(all(self.h.old_cid() not in l for l in removed))       # only a candidate proven to be ours can ever be removed

    def last_events(self):
        run = self.h.last["run_id"]
        return [l.split(" ", 1)[1] for l in (self.h.journal / "runs" / run / "events").read_text().splitlines()]

    def states(self):
        return [e.split("=", 1)[1] for e in self.last_events() if e.startswith("STATE=")]


class DeploySuccess(Base):
    def test_success_swaps_by_digest_create_before_stop_and_retains_old(self):
        rc = self.h.run()
        self.assertEqual(rc, 0, self.h.proc.stdout + self.h.proc.stderr)
        self.assertEqual(self.h.last["status"], "SUCCESS")
        log = self.h.mutating()
        ops = [l.split()[0] for l in log]
        self.assertEqual(ops[0], "create")                       # created while the old container still serves
        self.assertLess(ops.index("create"), ops.index("stop"))
        self.assertIn("pull -q " + REF_CAND, self.h.log()[1:] and self.h.log())
        cid, c = self.h.by_name(TARGET)
        self.assertNotEqual(cid, self.h.old_cid())
        self.assertEqual((c["image_id"], c["config_image"], c["running"], c["restart"]), (ID_CAND, REF_CAND, True, ["unless-stopped", 0]))
        prev = self.h.containers()[self.h.old_cid()]
        self.assertEqual((prev["running"], prev["restart"][0]), (False, "no"))
        self.assertTrue(prev["name"].startswith(TARGET + "-prev-"))
        self.assertEqual(self.states(), ["STARTED", "GATES_PASSED", "STOP_INTENT", "OLD_STOPPED", "NAMES_SWAPPED", "CANDIDATE_STARTED", "VERIFIED", "SUCCEEDED"])
        record = (self.h.journal / "records" / "latest").read_text()
        self.assertIn("RECORD_STATE=SUCCEEDED", record)
        self.assertIn("OLD_ID=" + self.h.old_cid(), record)
        self.assertNotIn(CANARY, self.h.proc.stdout + self.h.proc.stderr + record)

    def test_candidate_is_created_with_restart_no_and_policy_applied_only_after_the_checks(self):
        self.assertEqual(self.h.run(), 0)
        creates = [l for l in self.h.log() if l.startswith("create ")][0]
        self.assertIn("--restart=no", creates)
        updates = [l for l in self.h.log() if l.startswith("update ")]
        self.assertEqual([u.split()[1] for u in updates], ["--restart=no", "--restart=unless-stopped"])

    def test_dotted_key_and_value_with_equals_reach_the_candidate_unchanged(self):
        self.assertEqual(self.h.run(), 0)
        _, c = self.h.by_name(TARGET)
        self.assertIn("Logging.LogLevel.Default=a=b=c", c["env"])
        self.assertIn("ConnectionStrings__TheBhaDatabase=Host=h;Port=5432;Password=%s;SSL Mode=VerifyFull" % CANARY, c["env"])

    def test_tolerated_base_image_version_drift_passes_but_an_app_default_change_is_refused(self):
        s = self.h.load(); s["images_by_id"][ID_CAND]["Env"] = [e for e in s["images_by_id"][ID_CAND]["Env"] if not e.startswith("DOTNET_gcServer")]; self.h.state = s; self.h.save()
        self.assertEqual(self.h.run(), 20)
        self.assertIn("IMAGE_DEFAULT_CHANGED:DOTNET_gcServer", self.h.last["detail"])
        self.assert_old_untouched()

    def test_same_image_is_already_current_only_after_the_gates_and_changes_nothing(self):
        s = self.h.load(); s["registry"][REF_OLD] = ID_OLD; self.h.state = s; self.h.save()
        self.h.write_manifest(IDS, OLD_SHA)
        rc = self.h.run(image=REF_OLD, sha=OLD_SHA)
        self.assertEqual((rc, self.h.last["status"]), (0, "ALREADY_CURRENT"), self.h.proc.stdout)
        self.assert_old_untouched()
        # it is not a bypass: a failing readiness check on the same release is a rejection, not a success
        self.h.fault("ready image=OLD")
        self.assertEqual(self.h.run(image=REF_OLD, sha=OLD_SHA, timeout=60), 20)
        self.assertIn("ALREADY_CURRENT_UNHEALTHY", self.h.last["detail"])


class PreStopRejections(Base):
    def reject(self, detail, **kw):
        before = tuple(self.h.containers()[self.h.old_cid()]["restart"])
        rc = self.h.run(**kw)
        self.assertEqual(rc, 20, self.h.proc.stdout + self.h.proc.stderr)
        self.assertEqual(self.h.last["status"], "REJECTED_BEFORE_STOP")
        self.assertIn(detail, self.h.last["detail"])
        self.assert_old_untouched(before)
        # nothing of this run may linger except (at most) a candidate that was removed again
        self.assertEqual([c for c in self.h.containers() if c != self.h.old_cid()], [])

    def test_image_and_release_identity_gates(self):
        self.reject("IMAGE_NOT_A_DIGEST_REFERENCE", image=REPO + ":latest")
        self.reject("IMAGE_NOT_A_DIGEST_REFERENCE", image=REPO + "@sha256:abc")
        self.reject("IMAGE_REPOSITORY_NOT_ALLOWED", image="evil.example/the-bha-api@" + D_CAND)
        self.reject("SOURCE_SHA_MALFORMED", sha="main")
        self.reject("MANIFEST_INVALID_OR_FOR_ANOTHER_SHA", sha="2" * 40)
        s = self.h.load(); s["images_by_id"][ID_CAND]["Labels"]["org.opencontainers.image.source"] = "https://example.invalid/x"; self.h.state = s; self.h.save()
        self.reject("IMAGE_SOURCE_LABEL_DIFFERS")

    def test_revision_label_must_equal_the_requested_sha(self):
        s = self.h.load(); s["images_by_id"][ID_CAND]["Labels"]["org.opencontainers.image.revision"] = "2" * 40; self.h.state = s; self.h.save()
        self.reject("IMAGE_REVISION_LABEL_DIFFERS")

    def test_pull_and_create_failures_do_not_stop_the_old_container(self):
        self.h.fault("pull")
        self.reject("IMAGE_PULL_FAILED")
        self.h.fault("create")
        self.reject("CANDIDATE_CREATE_FAILED")

    def test_current_container_must_be_running_and_match_the_expected_identity(self):
        self.h.write_conf(EXPECTED_CURRENT_IMAGE=REF_CAND)
        s = self.h.load(); s["images"][REF_CAND] = s["images_by_id"][ID_CAND]; self.h.state = s; self.h.save()
        self.reject("CURRENT_IMAGE_DIFFERS_FROM_EXPECTED_CURRENT")
        self.h.write_conf()
        s = self.h.load(); s["containers"][self.h.old_cid()]["running"] = False; self.h.state = s; self.h.save()
        rc = self.h.run()
        self.assertEqual((rc, self.h.last["detail"]), (20, "CURRENT_CONTAINER_NOT_RUNNING"))

    def test_env_value_mismatch_and_manual_extras_and_ambiguous_env_files(self):
        s = self.h.load(); c = s["containers"][self.h.old_cid()]
        c["env"] = [e for e in c["env"] if not e.startswith("Cors__AdminOrigins__0")] + ["Cors__AdminOrigins__0=https://other.invalid"]
        self.h.state = s; self.h.save()
        self.reject("ENV_VALUE_MISMATCH:Cors__AdminOrigins__0")
        self.setUp()
        s = self.h.load(); s["containers"][self.h.old_cid()]["env"].append("HAND_SET=1"); self.h.state = s; self.h.save()
        self.reject("ENV_MANUAL_EXTRA:HAND_SET")
        for bad, why in (("1INVALID=value", "ENVFILE_NAME_INVALID"), ("NOEQUALS", "ENVFILE_LINE_WITHOUT_EQUALS"), (" LEADING=1", "ENVFILE_LEADING_WHITESPACE"),
                         ("ASPNETCORE_ENVIRONMENT=Production", "ENVFILE_DUPLICATE_NAME:ASPNETCORE_ENVIRONMENT")):
            self.setUp()
            self.h.env_lines.append(bad); self.h.write_env()
            self.reject(why)
        self.setUp()
        write(self.h.env, "\ufeff" + "\n".join(self.h.env_lines) + "\n")
        self.reject("ENVFILE_BOM")

    def test_runtime_shape_and_mounts_outside_the_supported_contract_fail_closed(self):
        cases = {
            "privileged": ("hc_extra", {"Privileged": True}, "SHAPE_UNSUPPORTED_HOSTCONFIG_PRIVILEGED"),
            "extra hosts": ("hc_extra", {"ExtraHosts": ["x:1.2.3.4"]}, "SHAPE_UNSUPPORTED_HOSTCONFIG_EXTRAHOSTS"),
            "entrypoint override": ("cfg_extra", {"Entrypoint": ["sh"]}, "SHAPE_OVERRIDES_IMAGE_ENTRYPOINT"),
            "tty": ("cfg_extra", {"Tty": True}, "SHAPE_UNSUPPORTED_CONFIG_TTY"),
            "foreign label": ("labels", {"owner": "someone"}, "SHAPE_EXTRA_LABELS"),
            "bad network": ("network", "host", "SHAPE_NETWORK"),
        }
        for name, (field, value, code) in cases.items():
            with self.subTest(name):
                self.setUp()
                s = self.h.load(); c = s["containers"][self.h.old_cid()]
                if field == "labels": c["labels"].update(value)
                else: c[field] = value
                self.h.state = s; self.h.save()
                self.reject(code)

    def test_wrong_mounts_ports_and_unsupported_restart_policy(self):
        def mutate(fn):
            self.setUp()
            s = self.h.load(); fn(s["containers"][self.h.old_cid()]); self.h.state = s; self.h.save()
        mutate(lambda c: c["mounts"].append({"Type": "bind", "Source": "/etc", "Destination": "/host-etc", "RW": False, "Mode": ""}))
        self.reject("SHAPE_MOUNTS")
        mutate(lambda c: c["mounts"][1].update(RW=True))
        self.reject("SHAPE_MOUNTS")                                    # CA must be read-only
        mutate(lambda c: c["mounts"][0].update(Source="/somewhere/else"))
        self.reject("SHAPE_MOUNTS")
        mutate(lambda c: c.update(ports={"8080/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8080"}]}))
        self.reject("SHAPE_PORT_BINDING")
        mutate(lambda c: c.update(restart=["weird", 0]))
        self.reject("SHAPE_RESTART_POLICY")

    def test_keys_must_be_present_and_the_mounts_accessible(self):
        s = self.h.load(); s["keys"] = {}; self.h.state = s; self.h.save()
        self.reject("KEYS_DIRECTORY_EMPTY_OR_UNREADABLE")
        self.setUp(); self.h.fault("mount-fail name=" + TARGET)
        self.reject("MOUNT_ACCESS_ON_CURRENT")

    def test_candidate_that_differs_from_the_captured_runtime_is_refused_before_the_stop(self):
        # The stub's `docker create` (like a real daemon that dropped a flag) does not reproduce the memory limit: the
        # comparison of the created candidate with the captured configuration must catch it, with the old one still serving.
        s = self.h.load(); s["containers"][self.h.old_cid()]["hc_extra"] = {"Memory": 536870912, "MemorySwap": 1073741824}
        self.h.state = s; self.h.save()
        self.reject("CANDIDATE_RUNTIME_DIFFERS_FROM_CAPTURED")
        creates = [l for l in self.h.log() if l.startswith("create ")]
        self.assertIn("--memory 536870912", creates[0])                 # the supported limit was passed on to docker create

    def test_a_missing_or_malformed_config_is_refused_with_exit_2(self):
        self.h.write_conf(LOOPBACK_PORT="80")
        self.assertEqual(self.h.run(), 2)
        self.h.write_conf()
        os.chmod(self.h.conf, 0o644)
        self.assertEqual(self.h.run(), 2)
        write(self.h.conf, "TARGET_CONTAINER=x\nTARGET_CONTAINER=y\n")
        self.assertEqual(self.h.run(), 2)
        write(self.h.conf, "$(touch /tmp/should-not-exist-bha)=1\n")
        self.assertEqual(self.h.run(), 2)
        write(self.h.conf, "UNKNOWN_KEY=1\n")
        self.assertEqual(self.h.run(), 2)
        self.assertFalse(Path("/tmp/should-not-exist-bha").exists())


class MigrationGate(Base):
    def set_db(self, **kw):
        write(self.h.d / "db.json", json.dumps(dict({"ids": IDS}, **kw)), 0o644)

    def reject(self, detail):
        rc = self.h.run()
        self.assertEqual((rc, self.h.last["status"]), (20, "REJECTED_BEFORE_STOP"), self.h.proc.stdout)
        self.assertIn(detail, self.h.last["detail"])
        self.assert_old_untouched()

    def test_pending_unknown_missing_history_and_reordered(self):
        self.set_db(ids=IDS[:-1]); self.reject("PENDING_MIGRATIONS")
        self.set_db(ids=IDS + ["20270101000000_Extra"]); self.reject("UNKNOWN_APPLIED_MIGRATIONS")
        self.set_db(ids=IDS[:-1] + ["20270101000000_Other"]); self.reject("PENDING_AND_UNKNOWN_MIGRATIONS")
        self.set_db(has_history=False, ids=[]); self.reject("HISTORY_TABLE_MISSING")
        self.set_db(ids=[IDS[1], IDS[0], IDS[2]]); self.reject("ORDER_DIFFERS")

    def test_connection_tls_permission_timeout_and_identity_failures(self):
        for fail, code in (("perm", "PERMISSION_DENIED"), ("tls", "TLS_FAILURE"), ("conn", "CONNECTION_FAILED"), ("timeout", "TIMEOUT"), ("query", "QUERY_FAILED")):
            self.set_db(fail=fail); self.reject(code)
        self.set_db(identity="identity|thebha|postgres|true|on"); self.reject("IDENTITY_DIFFERS_FROM_CONTRACT")
        self.set_db(identity="identity|thebha|bha_app|false|on"); self.reject("IDENTITY_DIFFERS_FROM_CONTRACT")
        self.set_db(identity="identity|thebha|bha_app|true|off"); self.reject("IDENTITY_DIFFERS_FROM_CONTRACT")

    def test_database_error_text_and_passfile_secrets_are_never_printed(self):
        self.set_db(fail="query")
        env = self.h.env_for(); env["CANARY_IN_STDERR"] = CANARY
        p = subprocess.run([str(DEPLOY), "deploy", "--config", str(self.h.conf), "--image", REF_CAND, "--source-sha", SHA, "--manifest", str(self.h.manifest)],
                           env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 20)
        self.assertNotIn(CANARY, p.stdout + p.stderr)

    def test_the_gate_is_a_read_only_session_with_a_sanitised_libpq_environment(self):
        self.assertEqual(self.h.run("preflight"), 0, self.h.proc.stdout)
        sql = (self.h.d / "psql.sql").read_text().upper()
        self.assertIn("BEGIN READ ONLY", sql)
        for forbidden in ("CREATE ", "ALTER ", "DROP ", "INSERT ", "UPDATE ", "DELETE ", "TRUNCATE ", "GRANT ", "REVOKE "):
            self.assertNotIn(forbidden, sql)
        envtext = (self.h.d / "psql.env").read_text()
        for needed in ("PGSERVICEFILE=", "PGSERVICE=app-read", "PGPASSFILE=", "PGSYSCONFDIR=", "default_transaction_read_only=on"):
            self.assertIn(needed, envtext)
        for inherited in ("PGHOST", "PGUSER", "PGDATABASE", "PGSSLMODE", "PGPASSWORD"):
            self.assertNotIn(inherited + "=", envtext)
        self.assertIn("-X", envtext); self.assertIn("-w", envtext)

    def test_inherited_pg_variables_are_dropped(self):
        env = self.h.env_for(); env.update(PGHOST="evil.example", PGPASSWORD="x", PGSSLMODE="disable", PGUSER="postgres")
        p = subprocess.run([str(DEPLOY), "preflight", "--config", str(self.h.conf), "--image", REF_CAND, "--source-sha", SHA, "--manifest", str(self.h.manifest)],
                           env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout)
        envtext = (self.h.d / "psql.env").read_text()
        for name in ("PGHOST=", "PGPASSWORD=", "PGUSER="):
            self.assertNotIn(name, envtext)

    def run_pre(self, **a):
        args = dict(service_file=self.h.svc, pass_file=self.h.pass_, service="app-read", expect_host="db.internal", expect_db="thebha",
                    expect_user="bha_app", ca_file=self.h.ca, ids=self.h.d / "ids")
        args.update(a)
        write(self.h.d / "ids", "\n".join(IDS) + "\n", 0o644)
        argv = [str(PREFLIGHT)] + sum(([("--" + k.replace("_", "-")), str(v)] for k, v in args.items()), [])
        e = self.h.env_for(); e["PSQL_BIN"] = str(self.h.bin / "psql")
        p = subprocess.run(argv, env=e, capture_output=True, text=True)
        return p.returncode, (json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {})

    def test_service_file_must_bind_the_contract_exactly(self):
        for text, code in (("[app-read]\nhost=other.internal\ndbname=thebha\nuser=bha_app\nsslmode=verify-full\nsslrootcert=%s\n", "SERVICE_HOST_DIFFERS"),
                           ("[app-read]\nhost=db.internal\ndbname=thebha\nuser=bha_app\nsslmode=require\nsslrootcert=%s\n", "SERVICE_SSLMODE_NOT_VERIFY_FULL"),
                           ("[app-read]\nhost=db.internal\ndbname=thebha\nuser=bha_app\nsslmode=verify-full\nsslrootcert=/other/ca.pem\n", "SERVICE_CA_DIFFERS"),
                           ("[app-read]\nhost=db.internal\ndbname=thebha\nuser=bha_app\nsslmode=verify-full\nsslrootcert=%s\noptions=-c search_path=x\n", "SERVICE_KEY_NOT_ALLOWED"),
                           ("[app-read]\nhost=db.internal\ndbname=thebha\nuser=bha_app\nsslmode=verify-full\nsslrootcert=%s\npassword=x\n", "SERVICE_KEY_NOT_ALLOWED"),
                           ("[another]\nhost=db.internal\n", "SERVICE_NOT_IN_FILE"),
                           ("[app-read]\nhost=db.internal\ndbname=thebha\nuser=bha_app\nsslmode=verify-full\nsslrootcert=%s\n[app-read]\nhost=x\n", "SERVICE_DEFINED_TWICE")):
            write(self.h.svc, text.replace("%s", str(self.h.ca)))
            rc, res = self.run_pre()
            self.assertEqual((rc, res.get("code")), (10, code), text)
        write(self.h.svc, "[app-read]\nhost=db.internal\ndbname=thebha\nuser=bha_app\nsslmode=verify-full\nsslrootcert=%s\n" % self.h.ca, 0o644)
        self.assertEqual(self.run_pre()[1].get("code"), "SERVICE_FILE_NOT_PRIVATE")
        write(self.h.svc, "[app-read]\nhost=db.internal\ndbname=thebha\nuser=bha_app\nsslmode=verify-full\nsslrootcert=%s\n" % self.h.ca)
        write(self.h.pass_, "x\n", 0o644)
        self.assertEqual(self.run_pre()[1].get("code"), "PASS_FILE_NOT_PRIVATE")

    def test_missing_psql_is_a_prerequisite_failure(self):
        e = self.h.env_for(); e["PSQL_BIN"] = "/nonexistent/psql"; e["PATH"] = "/usr/bin:/bin"
        write(self.h.d / "ids", "\n".join(IDS) + "\n", 0o644)
        p = subprocess.run([str(PREFLIGHT), "--service-file", str(self.h.svc), "--pass-file", str(self.h.pass_), "--service", "app-read", "--expect-host", "db.internal",
                            "--expect-db", "thebha", "--expect-user", "bha_app", "--ca-file", str(self.h.ca), "--ids", str(self.h.d / "ids")], env=e, capture_output=True, text=True)
        self.assertEqual(p.returncode, 11)


class AfterStopFailures(Base):
    def assert_rolled_back(self, detail_part, rc_expected=30):
        self.assertEqual(self.h.last["exit"], rc_expected, self.h.proc.stdout)
        cid, c = self.h.by_name(TARGET)
        self.assertEqual(cid, self.h.old_cid(), "the original container must serve again under the service name")
        self.assertTrue(c["running"])
        self.assertEqual(c["restart"], ["unless-stopped", 0])
        self.assertEqual(c["image_id"], ID_OLD)
        self.assertIn(detail_part, self.h.last["detail"])

    def test_candidate_start_readiness_and_api_failures_restore_the_old_container(self):
        cases = [("start image=CAND", "CANDIDATE_START_FAILED"), ("ready image=CAND", "CANDIDATE_CHECK_READINESS_TIMEOUT"),
                 ("api404 image=CAND", "CANDIDATE_CHECK_API_PROPERTIES_CHECK"), ("me404 image=CAND", "CANDIDATE_CHECK_API_STAFF_ME_NOT_401"),
                 ("keys-empty image=CAND", "CANDIDATE_CHECK_KEY_FILES_NOT_PRESERVED"), ("mount-fail image=CAND", "CANDIDATE_CHECK_MOUNT_ACCESS")]
        for fault, detail in cases:
            with self.subTest(fault):
                self.setUp(); self.h.fault(fault)
                rc = self.h.run(timeout=90)
                self.assertEqual(rc, 30, self.h.proc.stdout + self.h.proc.stderr)
                self.assertEqual(self.h.last["status"], "DEPLOY_FAILED_ROLLED_BACK")
                self.assert_rolled_back(detail)
                self.assertEqual(self.states()[-2:], ["RESTORING", "ROLLED_BACK"])
                # the candidate is kept (stopped, restart=no, renamed) as evidence and never removed
                failed = [c for c in self.h.containers().values() if c["name"].startswith(TARGET + "-failed-") or c["name"].startswith(TARGET + "-run-")]
                self.assertEqual(len(failed), 1)
                self.assertEqual((failed[0]["running"], failed[0]["restart"][0]), (False, "no"))
                self.assertNotIn("rm ", " ".join(l for l in self.h.log() if l.startswith("rm ")) + " ")

    def test_rename_and_restart_policy_failures_after_the_stop_are_rolled_back(self):
        for fault, detail in (("rename image=OLD", "OLD_RENAME_FAILED"), ("rename image=CAND newname=%s" % TARGET, "CANDIDATE_RENAME_FAILED")):
            with self.subTest(fault):
                self.setUp(); self.h.fault(fault)
                self.assertEqual(self.h.run(), 30, self.h.proc.stdout)
                self.assert_rolled_back(detail)
        self.setUp(); self.h.fault("update image=CAND")
        self.assertEqual(self.h.run(), 30, self.h.proc.stdout)
        self.assert_rolled_back("CANDIDATE_RESTART_POLICY_UPDATE")

    def test_failure_to_stop_the_old_container_is_rolled_back_not_ignored(self):
        self.h.fault("stop image=OLD")
        self.assertEqual(self.h.run(), 30, self.h.proc.stdout)
        self.assert_rolled_back("OLD_STOP_FAILED")

    def test_rollback_failure_keeps_everything_and_reports_exit_40(self):
        self.h.fault("start image=CAND", "start image=OLD")
        rc = self.h.run()
        self.assertEqual((rc, self.h.last["status"]), (40, "ROLLBACK_FAILED"), self.h.proc.stdout)
        self.assertIn("PRIOR_START", self.h.last["detail"])
        self.assertEqual(len(self.h.containers()), 2)                  # nothing removed: identities needed for recovery stay
        self.assertEqual(self.states()[-1], "ROLLBACK_FAILED")
        self.assertEqual(self.h.run(), 60)                              # the next run refuses until recover
        self.assertEqual(self.h.last["status"], "INTERRUPTED_STATE")
        os.remove(self.h.d / "faults")
        self.assertEqual(self.h.run("recover"), 0, self.h.proc.stdout)
        self.assertEqual(self.h.last["status"], "RECOVERED")
        cid, c = self.h.by_name(TARGET)
        self.assertEqual((cid, c["running"]), (self.h.old_cid(), True))

    def test_rename_collision_with_an_unrelated_container_is_never_taken_over(self):
        s = self.h.load()
        s["containers"]["8" * 64] = dict(s["containers"][self.h.old_cid()], name=TARGET + "-failed-X", running=False, ports={}, labels={})
        self.h.state = s; self.h.save()
        self.assertEqual(self.h.run(), 0)                               # a different name: no collision
        # but a container squatting on the candidate's own name is a refusal before anything is stopped
        self.setUp()
        self.assertEqual(self.h.run("preflight"), 0)


class SignalsAndRecovery(Base):
    def test_term_during_the_candidate_start_restores_the_old_container(self):
        write(self.h.d / "block-start", "1", 0o644)
        argv = [str(DEPLOY), "deploy", "--config", str(self.h.conf), "--image", REF_CAND, "--source-sha", SHA, "--manifest", str(self.h.manifest)]
        proc = subprocess.Popen(argv, env=self.h.env_for(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.time() + 60
        while not (self.h.d / "blocked").exists() and time.time() < deadline:
            time.sleep(0.2)
        self.assertTrue((self.h.d / "blocked").exists(), "stub never blocked")
        os.remove(self.h.d / "block-start")
        proc.send_signal(signal.SIGTERM)
        os.kill(int((self.h.d / "blocked").read_text()), signal.SIGKILL)   # the blocked docker call ends; the deferred trap then runs
        out, err = proc.communicate(timeout=90)
        last = json.loads(out.strip().splitlines()[-1])
        self.assertEqual((proc.returncode, last["status"]), (30, "DEPLOY_FAILED_ROLLED_BACK"), out + err)
        self.assertIn("INTERRUPTED_BY_SIGNAL", last["detail"])
        cid, c = self.h.by_name(TARGET)
        self.assertEqual((cid, c["running"], c["restart"]), (self.h.old_cid(), True, ["unless-stopped", 0]))

    def crash_after_the_old_was_stopped(self, state):
        """Fabricate what a SIGKILL/power loss leaves behind: a journal at <state> and the matching Docker state."""
        s = self.h.load(); old = s["containers"][self.h.old_cid()]
        cand_id = "7" * 64; run = "20261009T000000Z-deadbeef"
        cand = dict(old, name=TARGET + "-run-" + run, running=False, status="created", restart=["no", 0], image_id=ID_CAND, config_image=REF_CAND,
                    labels={"com.thebha.deploy.run": run, "com.thebha.deploy.target": TARGET})
        old["running"] = False; old["status"] = "exited"; old["restart"] = ["no", 0]
        if state in ("NAMES_SWAPPED", "CANDIDATE_STARTED"):
            old["name"] = TARGET + "-prev-" + run; cand["name"] = TARGET
        s["containers"][cand_id] = cand
        self.h.state = s; self.h.save()
        rd = self.h.journal / "runs" / run; (rd / "evidence").mkdir(parents=True)
        os.chmod(rd, 0o700)
        write(rd / "evidence" / "keys.pre", "%s  /var/keys/key-1.xml\n" % ("h1" * 32))
        fields = dict(KIND="deploy", STATE=state, TARGET=TARGET, SOURCE_SHA=SHA, IMAGE=REF_CAND.replace("@", "@"), OLD_ID=self.h.old_cid(), OLD_IMAGE_ID=ID_OLD,
                      OLD_POLICY="unless-stopped", CAND_ID=cand_id, CAND_IMAGE_ID=ID_CAND,
                      ENV_SHA="0" * 64, CA_SHA="0" * 64, ENV_STAT="0-0-600-1-1", CA_STAT="0-0-644-1-1")
        write(rd / "state", "\n".join("%s=%s" % kv for kv in sorted(fields.items())) + "\n")
        write(rd / "events", "")
        return run, cand_id

    def test_recover_returns_to_the_previous_release_from_each_interrupted_state(self):
        for state in ("STOP_INTENT", "OLD_STOPPED", "NAMES_SWAPPED", "CANDIDATE_STARTED"):
            with self.subTest(state):
                self.setUp()
                run, cand_id = self.crash_after_the_old_was_stopped(state)
                # the host files recorded in the journal must match, otherwise the verification would (rightly) fail
                text = (self.h.journal / "runs" / run / "state").read_text()
                import hashlib
                for key, path in (("ENV_SHA", self.h.env), ("CA_SHA", self.h.ca)):
                    text = text.replace(key + "=" + "0" * 64, key + "=" + hashlib.sha256(Path(path).read_bytes()).hexdigest())
                for key, path in (("ENV_STAT", self.h.env), ("CA_STAT", self.h.ca)):
                    st = os.stat(path)
                    text = text.replace(key + "=" + ("0-0-600-1-1" if key == "ENV_STAT" else "0-0-644-1-1"),
                                        "%s=%d-%d-%o-%d-%d" % (key, st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode), st.st_size, int(st.st_mtime)))
                write(self.h.journal / "runs" / run / "state", text)
                self.assertEqual(self.h.run("deploy"), 60)               # a crashed run blocks every new run
                self.assertEqual(self.h.run("status"), 60)
                self.assertEqual(self.h.run("recover"), 0, self.h.proc.stdout + self.h.proc.stderr)
                cid, c = self.h.by_name(TARGET)
                self.assertEqual((cid, c["running"], c["restart"]), (self.h.old_cid(), True, ["unless-stopped", 0]))
                self.assertIn(cand_id, self.h.containers())              # the candidate is never deleted
                self.assertEqual(self.h.run("recover"), 0)               # idempotent: nothing left to do
                self.assertEqual(self.h.last["detail"], "NOTHING_TO_RECOVER")
                self.assertEqual(self.h.run("status"), 0)

    def test_an_unaccounted_labelled_container_blocks_new_runs(self):
        s = self.h.load()
        s["containers"]["6" * 64] = dict(s["containers"][self.h.old_cid()], name="stray", running=False, ports={},
                                         labels={"com.thebha.deploy.target": TARGET, "com.thebha.deploy.run": "20260101T000000Z-aaaaaaaa"})
        self.h.state = s; self.h.save()
        self.assertEqual(self.h.run(), 60)
        self.assertEqual(self.h.last["detail"], "UNACCOUNTED_CONTAINER_FOR_TARGET")
        self.assertEqual(self.h.mutating(), [])


class LocksAndRollback(Base):
    def test_a_held_lock_blocks_deploy_and_rollback_without_touching_anything(self):
        lockfile = self.h.lock / ("bha-deploy-%s.lock" % TARGET)
        holder = subprocess.Popen(["flock", str(lockfile), "sleep", "6"])
        time.sleep(1)
        try:
            self.assertEqual(self.h.run(), 50)
            self.assertEqual(self.h.last["status"], "LOCK_BUSY")
            self.assertEqual(self.h.run("rollback"), 50)
            self.assertEqual(self.h.run("recover"), 50)
        finally:
            holder.wait(timeout=20)
        self.assertEqual(self.h.mutating(), [])
        self.assertTrue(lockfile.exists())

    def test_the_lock_is_per_target_not_per_config_file(self):
        other = self.h.d / "other.conf"
        self.h.write_conf(JOURNAL_DIR=self.h.journal)               # same target, same lock path regardless of config location
        shutil.copy(self.h.conf, other); os.chmod(other, 0o600)
        lockfile = self.h.lock / ("bha-deploy-%s.lock" % TARGET)
        holder = subprocess.Popen(["flock", str(lockfile), "sleep", "5"])
        time.sleep(1)
        try:
            self.assertEqual(self.h.run(conf=other), 50)
        finally:
            holder.wait(timeout=20)

    def test_explicit_rollback_is_guarded_by_the_protected_record_and_idempotent(self):
        self.assertEqual(self.h.run(), 0)
        new_cid, _ = self.h.by_name(TARGET)
        self.assertEqual(self.h.run("rollback"), 0, self.h.proc.stdout + self.h.proc.stderr)
        self.assertEqual(self.h.last["status"], "ROLLED_BACK")
        cid, c = self.h.by_name(TARGET)
        self.assertEqual((cid, c["running"], c["restart"]), (self.h.old_cid(), True, ["unless-stopped", 0]))
        self.assertEqual(self.h.containers()[new_cid]["running"], False)
        self.assertIn("RECORD_STATE=ROLLED_BACK_EXPLICIT", (self.h.journal / "records" / "latest").read_text())
        before = len(self.h.mutating())
        self.assertEqual(self.h.run("rollback"), 0)
        self.assertEqual(self.h.last["status"], "ALREADY_ROLLED_BACK")
        self.assertEqual(len(self.h.mutating()), before)                # nothing was touched the second time

    def test_a_stale_record_never_overwrites_a_newer_deployment(self):
        self.assertEqual(self.h.run(), 0)
        # somebody (or a later deployment) replaced the container named after the target: the record is stale
        s = self.h.load(); cid, c = self.h.by_name(TARGET)
        newer = "5" * 64
        s["containers"][newer] = dict(s["containers"].pop(cid), name=TARGET)
        s["containers"][cid] = dict(s["containers"][newer], name=TARGET + "-gone", running=False, ports={}, labels={})
        self.h.state = s; self.h.save()
        before = self.h.mutating()
        self.assertEqual(self.h.run("rollback"), 20, self.h.proc.stdout)
        self.assertIn("ROLLBACK_RECORD_STALE", self.h.last["detail"])
        self.assertEqual(self.h.mutating(), before)
        self.assertEqual(self.h.by_name(TARGET)[0], newer)

    def test_rollback_without_any_record_is_refused(self):
        self.assertEqual(self.h.run("rollback"), 20)
        self.assertEqual(self.h.last["detail"], "ROLLBACK_RECORD_MISSING_OR_MALFORMED")

    def test_rollback_refuses_when_the_database_history_changed(self):
        self.assertEqual(self.h.run(), 0)
        write(self.h.d / "db.json", json.dumps({"ids": IDS + ["20270101000000_Later"]}), 0o644)
        self.assertEqual(self.h.run("rollback"), 20)
        self.assertIn("UNKNOWN_APPLIED_MIGRATIONS", self.h.last["detail"])


class SecretsAndOutput(Base):
    def test_no_canary_reaches_stdout_stderr_journal_or_records_on_any_path(self):
        runs = [lambda: self.h.run(), lambda: self.h.run("rollback"), lambda: self.h.run("status")]
        for r in runs:
            r()
        self.h.fault("start image=CAND")
        self.h.write_conf()
        self.h.run(image=REF_CAND)
        blob = ""
        for p in self.h.journal.rglob("*"):
            if p.is_file():
                blob += p.read_text(errors="replace")
        self.assertNotIn(CANARY, blob)
        # raw inspect output never outlives a run
        self.assertEqual(list(self.h.journal.rglob("old.json")) + list(self.h.journal.rglob("cand.json")), [])

    def test_journal_files_and_directories_are_private(self):
        self.assertEqual(self.h.run(), 0)
        for p in self.h.journal.rglob("*"):
            mode = stat.S_IMODE(p.stat().st_mode)
            self.assertEqual(mode & 0o077, 0, str(p))


class ManifestGenerator(unittest.TestCase):
    """Fixtures: a throw-away git repository with fake EF migrations (not the product's)."""

    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="bha-cp02-m-"))
        self.addCleanup(shutil.rmtree, self.d, True)
        m = self.d / "Back_End/src/TheBha.Infrastructure/Persistence/Migrations"; m.mkdir(parents=True)
        (self.d / "deploy/showcase/migrations").mkdir(parents=True)
        self.ids = ["20260101000000_First", "20260202000000_Second"]
        sql = ""
        for i in self.ids:
            (m / (i + ".Designer.cs")).write_text('[DbContext(typeof(X))]\n[Migration("%s")]\npartial class C {}\n' % i)
            (m / (i + ".cs")).write_text("class C {}\n")
            sql += 'DO $EF$\nBEGIN\n    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")\n    VALUES (\'%s\', \'8.0.0\');\nEND $EF$;\n' % i
        (m / "TheBhaDbContextModelSnapshot.cs").write_text("class S {}\n")
        (self.d / "deploy/showcase/migrations/idempotent.sql").write_text(sql)
        self.git("init", "-q"); self.git("add", "-A")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "fixture")
        self.sha = self.git("rev-parse", "HEAD").strip()

    def git(self, *a):
        return subprocess.run(["git", "-C", str(self.d)] + list(a), capture_output=True, text=True, check=True).stdout

    def gen(self, sha=None, *extra):
        return subprocess.run(["python3", "-I", str(MANIFEST), "generate", "--repo", str(self.d), "--source-sha", sha or self.sha, *extra], capture_output=True, text=True)

    def test_orders_ids_from_the_commit_objects_and_cross_checks_both_sources(self):
        p = self.gen()
        self.assertEqual(p.returncode, 0, p.stderr)
        doc = json.loads(p.stdout)
        self.assertEqual((doc["source_sha"], doc["migrations"], doc["count"]), (self.sha, sorted(self.ids), 2))

    def test_refuses_a_head_that_is_not_the_requested_sha_and_dirty_tracked_files(self):
        self.assertIn("HEAD_IS_NOT_SOURCE_SHA", self.gen("f" * 40).stderr)
        (self.d / "deploy/showcase/migrations/idempotent.sql").write_text("changed\n")
        self.assertIn("TRACKED_FILES_MODIFIED", self.gen().stderr)

    def test_refuses_disagreeing_sources_and_mismatched_designer_ids(self):
        self.git("checkout", "-q", "--", ".")
        p = self.d / "deploy/showcase/migrations/idempotent.sql"
        p.write_text(p.read_text() + 'INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")\n    VALUES (\'20260303000000_Phantom\', \'8\');\n')
        self.git("add", "-A"); self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "x")
        self.assertIn("MIGRATION_SOURCES_DISAGREE", self.gen(self.git("rev-parse", "HEAD").strip()).stderr)

    def test_ids_command_validates_the_manifest_for_the_release_sha(self):
        out = self.d / "m.json"
        self.assertEqual(self.gen(None, "--output", str(out)).returncode, 0)
        ok = subprocess.run(["python3", "-I", str(MANIFEST), "ids", "--manifest", str(out), "--source-sha", self.sha], capture_output=True, text=True)
        self.assertEqual(ok.stdout.split(), sorted(self.ids))
        other = subprocess.run(["python3", "-I", str(MANIFEST), "ids", "--manifest", str(out), "--source-sha", "e" * 40], capture_output=True, text=True)
        self.assertEqual(other.returncode, 1)
        self.assertIn("MANIFEST_SOURCE_SHA_MISMATCH", other.stderr)
        doc = json.loads(out.read_text()); doc["migrations"] = list(reversed(doc["migrations"])); out.write_text(json.dumps(doc))
        self.assertIn("NOT_UNIQUE_SORTED", subprocess.run(["python3", "-I", str(MANIFEST), "ids", "--manifest", str(out), "--source-sha", self.sha], capture_output=True, text=True).stderr)


if __name__ == "__main__":
    unittest.main()
