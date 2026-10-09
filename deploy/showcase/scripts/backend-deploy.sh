#!/usr/bin/env bash
# BHA-BACKEND-CD-001-CP02: digest-based backend container deploy / rollback on ONE Docker host.
#
# Prerequisites on the host (not installed by this script): bash >= 4.4, docker, flock, timeout, curl, python3 >= 3.8,
# sha256sum, stat, and psql (libpq client) for the migration gate. Missing -> exit 3.
#
#   backend-deploy.sh preflight --config F --image REPO@sha256:DIGEST --source-sha SHA --manifest FILE
#   backend-deploy.sh deploy    --config F --image REPO@sha256:DIGEST --source-sha SHA --manifest FILE
#   backend-deploy.sh rollback  --config F        # container rollback to the previous release, from the latest record
#   backend-deploy.sh recover   --config F        # finish/undo an interrupted run (returns to the PREVIOUS release)
#   backend-deploy.sh status    --config F        # read-only, no lock
#
# preflight = every pre-stop gate (config, image, migration history, runtime shape, env, files); it pulls the digest
# but creates/stops/changes no container and touches no env, key, CA or database state.
# deploy    = preflight gates + create candidate (old still serving) + bounded-downtime swap + checks + rollback on failure.
#
# Host config (data file, never sourced; mode 0600/0400, owned by the caller; KEY=VALUE, '#' comments):
#   required: TARGET_CONTAINER ALLOWED_IMAGE_REPOSITORY EXPECTED_SOURCE_URL EXPECTED_CURRENT_IMAGE LOOPBACK_PORT
#             ENV_FILE KEYS_DIR CA_FILE JOURNAL_DIR PG_SERVICE_FILE PG_PASS_FILE PG_SERVICE PG_EXPECT_HOST PG_EXPECT_DB
#             PG_EXPECT_USER API_BASE_URL
#   optional: API_CA_FILE PSQL_BIN READY_TIMEOUT_SECONDS(60) REQUEST_TIMEOUT_SECONDS(5) LOCK_WAIT_SECONDS(20)
#             STOP_TIMEOUT_SECONDS(30) DOCKER_TIMEOUT_SECONDS(120) PREFLIGHT_TIMEOUT_SECONDS(30)
#   Supported runtime shape of TARGET_CONTAINER (anything else is refused before the old container is touched):
#   bridge network, 127.0.0.1:LOOPBACK_PORT -> 8080/tcp, exactly two bind mounts (KEYS_DIR -> /var/keys rw,
#   CA_FILE -> /certs/rds-ca.pem ro), env = image defaults + ENV_FILE, image entrypoint/cmd/user, log driver/options,
#   restart policy, caps, security options, read-only rootfs, memory/cpus/pids limits. Paths must be canonical (no symlinks).
#
# Exit codes (stdout also carries one JSON line {"status","detail","exit","command","run_id","target",...}):
#   0  OK: PREFLIGHT_PASS | SUCCESS | ALREADY_CURRENT | ROLLED_BACK | ALREADY_ROLLED_BACK | RECOVERED | STATUS
#   2  CONFIG_INVALID (arguments / config / manifest)          3  PREREQUISITE_MISSING
#   20 REJECTED_BEFORE_STOP (a gate failed; the old container was not touched, or the run was aborted before the stop)
#   30 DEPLOY_FAILED_ROLLED_BACK (failure after the stop; the previous container serves again and was re-verified)
#   40 ROLLBACK_FAILED (evidence and identities kept; run `recover` or follow the runbook)
#   50 LOCK_BUSY                                                60 INTERRUPTED_STATE (unfinished journal / unaccounted container)
#
# Journal states (JOURNAL_DIR/runs/<run>/state, atomic rewrite before each destructive step):
#   STARTED -> GATES_PASSED -> STOP_INTENT -> OLD_STOPPED -> NAMES_SWAPPED -> CANDIDATE_STARTED -> VERIFIED -> SUCCEEDED
#   failure: REJECTED (before the stop) | RESTORING -> ROLLED_BACK | ROLLBACK_FAILED ; explicit rollback: ... -> ROLLBACK_DONE
#   Terminal: SUCCEEDED REJECTED ROLLED_BACK ROLLBACK_DONE ALREADY_CURRENT_DONE. Anything else blocks the next run (exit 60).
#
# Deliberate properties: bounded downtime (the host port is shared, so the candidate starts only after the old stops);
# the old container is renamed and kept stopped (restart=no) and is never removed; container rollback does not roll back
# the database; the migration gate proves history compatibility only; /health/ready proves database connectivity only.
# Never prints raw docker inspect, env, logs or credentials: those stay in private files under the run's evidence dir.
# shellcheck disable=SC2317,SC2015  # trap handlers are reached indirectly; `A && B || fail` is the intended gate idiom
set -euo pipefail
umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="" CONFIG="" IMAGE="" SOURCE_SHA="" MANIFEST_FILE=""
declare -A CFG=() J=()
RUN_ID="" RUN_DIR="" EV="" FINALIZED=false INTERRUPTED=false DOWNTIME=0
CAND_ID="" OLD_ID=""
TERMINAL_STATES=" SUCCEEDED REJECTED ROLLED_BACK ROLLBACK_DONE ALREADY_CURRENT_DONE "

# ------------------------------------------------------------------------------------------------ embedded JSON tool
read -r -d '' PYTOOL <<'PY' || true
import json, os, re, sys

TOLERATED = {b'DOTNET_VERSION', b'ASPNET_VERSION', b'DOTNET_SDK_VERSION'}
OURS = 'com.thebha.deploy.'
NAME_RE = re.compile(rb'^[A-Za-z_][A-Za-z0-9_.]*$')
OPT_RE = re.compile(r'^[A-Za-z0-9_.:/@%+=,-]*$')


class Reject(Exception):
    pass


def load(path):
    with open(path, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    if isinstance(data, list):
        if len(data) != 1:
            raise Reject('INSPECT_NOT_ONE_OBJECT')
        data = data[0]
    if not isinstance(data, dict):
        raise Reject('INSPECT_SHAPE')
    return data


def empty(value):
    return value in (None, False, 0, '', [], {})


def envmap(entries):
    out = {}
    for entry in entries or []:
        name, sep, value = entry.encode('utf-8', 'surrogateescape').partition(b'=')
        if not sep:
            raise Reject('ENV_ENTRY_WITHOUT_EQUALS')
        out[name] = value
    return out


def parse_envfile(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    if data.startswith(b'\xef\xbb\xbf'):
        raise Reject('ENVFILE_BOM')
    if b'\r' in data or b'\x00' in data:
        raise Reject('ENVFILE_CR_OR_NUL')
    out = {}
    for raw in data.split(b'\n'):
        if raw == b'':
            continue
        if raw[:1] in (b' ', b'\t'):
            raise Reject('ENVFILE_LEADING_WHITESPACE')
        if raw[:1] == b'#':
            continue
        name, sep, value = raw.partition(b'=')
        if not sep:
            raise Reject('ENVFILE_LINE_WITHOUT_EQUALS')
        if not NAME_RE.match(name):
            raise Reject('ENVFILE_NAME_INVALID')
        if name in out:
            raise Reject('ENVFILE_DUPLICATE_NAME:' + name.decode('ascii'))
        out[name] = value
    return out


def names(prefix, items):
    return [prefix + n.decode('utf-8', 'replace') for n in sorted(items)]


def env_pre(old_c, old_i, cand_i, snapshot):
    file_env = parse_envfile(snapshot)
    old_env = envmap(old_c['Config'].get('Env'))
    old_def = envmap(old_i['Config'].get('Env'))
    cand_def = envmap(cand_i['Config'].get('Env'))
    errors = names('ENV_VALUE_MISMATCH:', [n for n, v in file_env.items() if old_env.get(n) != v])
    errors += names('ENV_MANUAL_EXTRA:', [n for n, v in old_env.items() if n not in file_env and old_def.get(n) != v])
    errors += names('IMAGE_DEFAULT_CHANGED:', [n for n, v in old_def.items()
                                               if n not in file_env and n not in TOLERATED and cand_def.get(n) != v])
    if errors:
        raise Reject(' '.join(errors))


def env_post(c, img, snapshot):
    expected = envmap(img['Config'].get('Env'))
    expected.update(parse_envfile(snapshot))
    actual = envmap(c['Config'].get('Env'))
    bad = [n for n in set(expected) | set(actual) if expected.get(n) != actual.get(n)]
    if bad:
        raise Reject(' '.join(names('ENV_DIFFERS:', bad)))


def image_check(img, ref, sha, url):
    if ref not in (img.get('RepoDigests') or []):
        raise Reject('IMAGE_DIGEST_NOT_CONFIRMED')
    iid = img.get('Id') or ''
    if not re.match(r'^sha256:[0-9a-f]{64}$', iid):
        raise Reject('IMAGE_ID_MALFORMED')
    labels = (img.get('Config') or {}).get('Labels') or {}
    if labels.get('org.opencontainers.image.revision') != sha:
        raise Reject('IMAGE_REVISION_LABEL_DIFFERS')
    if labels.get('org.opencontainers.image.source') != url:
        raise Reject('IMAGE_SOURCE_LABEL_DIFFERS')
    user = (img.get('Config') or {}).get('User') or ''
    if user in ('', '0', 'root') or user.startswith('0:') or user.startswith('root:'):
        raise Reject('IMAGE_RUNS_AS_ROOT')
    return iid


def image_compat(old_img, cand_img):
    a, b = old_img.get('Config') or {}, cand_img.get('Config') or {}
    for key in ('Entrypoint', 'Cmd', 'User', 'WorkingDir', 'StopSignal', 'ExposedPorts'):
        if (a.get(key) or None) != (b.get(key) or None):
            raise Reject('IMAGE_CHANGES_' + key.upper())


MUST_BE_EMPTY_HC = ['Privileged', 'PublishAllPorts', 'AutoRemove', 'Init', 'Devices', 'Dns', 'DnsOptions', 'DnsSearch',
                    'ExtraHosts', 'Tmpfs', 'Sysctls', 'Ulimits', 'VolumesFrom', 'Links', 'GroupAdd', 'PidMode',
                    'UsernsMode', 'UTSMode', 'CpuShares', 'CpusetCpus', 'CpusetMems', 'CpuQuota', 'CpuPeriod',
                    'BlkioWeight', 'OomKillDisable', 'DeviceCgroupRules', 'Isolation', 'CgroupParent', 'VolumeDriver',
                    'Cgroup']
MUST_BE_EMPTY_CFG = ['Tty', 'OpenStdin', 'StdinOnce', 'Healthcheck', 'Domainname', 'Shell', 'OnBuild', 'StopTimeout']


def shape(c, img, port, keys, ca):
    """Validate the supported runtime shape. Returns (profile lines, docker create args)."""
    hc, cfg, icfg = c.get('HostConfig') or {}, c.get('Config') or {}, img.get('Config') or {}
    profile, args = [], []
    network = hc.get('NetworkMode')
    if network not in ('default', 'bridge'):
        raise Reject('SHAPE_NETWORK')
    profile.append(('network', network))
    if network == 'bridge':
        args += ['--network', 'bridge']
    if hc.get('PortBindings') != {'8080/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(port)}]}:
        raise Reject('SHAPE_PORT_BINDING')
    args += ['-p', '127.0.0.1:%s:8080' % port]
    listed = c.get('Mounts') or []
    got = {(m.get('Type'), m.get('Source'), m.get('Destination'), bool(m.get('RW'))) for m in listed}
    if len(listed) != 2 or got != {('bind', keys, '/var/keys', True), ('bind', ca, '/certs/rds-ca.pem', False)}:
        raise Reject('SHAPE_MOUNTS')
    profile.append(('mounts', sorted(list(got), key=str)))
    args += ['--mount', 'type=bind,src=%s,dst=/var/keys' % keys,
             '--mount', 'type=bind,src=%s,dst=/certs/rds-ca.pem,readonly' % ca]
    for key, kind in (('Entrypoint', []), ('Cmd', []), ('User', ''), ('WorkingDir', ''), ('StopSignal', '')):
        if (cfg.get(key) or kind or None) != (icfg.get(key) or kind or None):
            raise Reject('SHAPE_OVERRIDES_IMAGE_' + key.upper())
    image_labels = icfg.get('Labels') or {}
    extra = [k for k, v in (cfg.get('Labels') or {}).items() if image_labels.get(k) != v and not k.startswith(OURS)]
    if extra:
        raise Reject('SHAPE_EXTRA_LABELS')
    for key in MUST_BE_EMPTY_HC:
        if not empty(hc.get(key)):
            raise Reject('SHAPE_UNSUPPORTED_HOSTCONFIG_' + key.upper())
    for key in MUST_BE_EMPTY_CFG:
        if not empty(cfg.get(key)):
            raise Reject('SHAPE_UNSUPPORTED_CONFIG_' + key.upper())
    if hc.get('ShmSize') not in (None, 0, 67108864):
        raise Reject('SHAPE_UNSUPPORTED_SHMSIZE')
    if hc.get('Runtime') not in (None, '', 'runc'):
        raise Reject('SHAPE_UNSUPPORTED_RUNTIME')
    if hc.get('IpcMode') not in (None, '', 'private', 'shareable'):
        raise Reject('SHAPE_UNSUPPORTED_IPCMODE')
    log = hc.get('LogConfig') or {}
    ltype, lopts = log.get('Type') or '', log.get('Config') or {}
    if not re.match(r'^[a-z0-9-]*$', ltype) or any(not OPT_RE.match(k) or not OPT_RE.match(str(v)) for k, v in lopts.items()):
        raise Reject('SHAPE_LOG_CONFIG')
    profile.append(('log', [ltype, sorted((k, str(v)) for k, v in lopts.items())]))
    if ltype:
        args += ['--log-driver', ltype]
    for k, v in sorted(lopts.items()):
        args += ['--log-opt', '%s=%s' % (k, v)]
    for key, flag in (('CapAdd', '--cap-add'), ('CapDrop', '--cap-drop'), ('SecurityOpt', '--security-opt')):
        values = sorted(hc.get(key) or [])
        if any(not OPT_RE.match(str(v)) for v in values):
            raise Reject('SHAPE_' + key.upper())
        profile.append((key, values))
        for v in values:
            args += [flag, str(v)]
    ro = bool(hc.get('ReadonlyRootfs'))
    profile.append(('readonly', ro))
    if ro:
        args.append('--read-only')
    for key, flag in (('Memory', '--memory'), ('MemorySwap', '--memory-swap'), ('PidsLimit', '--pids-limit')):
        value = hc.get(key) or 0
        if not isinstance(value, int):
            raise Reject('SHAPE_' + key.upper())
        profile.append((key, value))
        if key == 'PidsLimit' and value > 0 or key != 'PidsLimit' and value != 0:
            args += [flag, str(value)]
    nano = hc.get('NanoCpus') or 0
    if not isinstance(nano, int) or nano < 0:
        raise Reject('SHAPE_NANOCPUS')
    profile.append(('NanoCpus', nano))
    if nano:
        args += ['--cpus', '%d.%09d' % (nano // 10**9, nano % 10**9)]
    return profile, args


def main(argv):
    cmd = argv[0]
    if cmd == 'get':
        node = load(argv[1])
        for part in argv[2].split('.'):
            node = node.get(part) if isinstance(node, dict) else None
        print('true' if node is True else 'false' if node is False else '' if node is None else node)
    elif cmd == 'label':
        print(((load(argv[1]).get('Config') or {}).get('Labels') or {}).get(argv[2], ''))
    elif cmd == 'restart':
        policy = (load(argv[1]).get('HostConfig') or {}).get('RestartPolicy') or {}
        name = policy.get('Name') or 'no'
        maximum = policy.get('MaximumRetryCount') or 0
        if name not in ('no', 'always', 'unless-stopped', 'on-failure') or not isinstance(maximum, int) or maximum < 0:
            raise Reject('SHAPE_RESTART_POLICY')
        print(name + (':%d' % maximum if name == 'on-failure' and maximum else ''))
    elif cmd == 'shape':
        profile, args = shape(load(argv[1]), load(argv[2]), argv[3], argv[4], argv[5])
        with open(argv[6], 'w') as handle:
            for name, value in profile:
                handle.write('%s=%s\n' % (name, json.dumps(value, sort_keys=True)))
        if argv[7] != '-':
            with open(argv[7], 'wb') as handle:
                handle.write(b''.join(a.encode('utf-8') + b'\0' for a in args))
    elif cmd == 'env-pre':
        env_pre(load(argv[1]), load(argv[2]), load(argv[3]), argv[4])
    elif cmd == 'env-post':
        env_post(load(argv[1]), load(argv[2]), argv[3])
    elif cmd == 'image-check':
        print(image_check(load(argv[1]), argv[2], argv[3], argv[4]))
    elif cmd == 'image-compat':
        image_compat(load(argv[1]), load(argv[2]))
    elif cmd == 'api-properties':
        with open(argv[1], 'r', encoding='utf-8') as handle:
            body = json.load(handle)
        if not isinstance(body, list) or not body:
            raise Reject('PROPERTIES_NOT_A_NONEMPTY_ARRAY')
        for item in body:
            if not isinstance(item, dict) or any(not isinstance(item.get(k), str) or not item.get(k) for k in ('id', 'name', 'slug', 'timeZone')):
                raise Reject('PROPERTIES_ITEM_SHAPE')
    else:
        raise Reject('UNKNOWN_TOOL_COMMAND')


try:
    main(sys.argv[1:])
except Reject as error:
    sys.stderr.write('REJECT %s\n' % error)
    sys.exit(1)
except Exception as error:  # codes only: never a value from the inspected data
    sys.stderr.write('REJECT INTERNAL_%s\n' % type(error).__name__)
    sys.exit(1)
PY

py() { python3 -I -c "$PYTOOL" "$@"; }
pyget() { py get "$1" "$2"; }

# ------------------------------------------------------------------------------------------------ output / logging

emit() {  # emit <STATUS> <DETAIL> <exit>
  FINALIZED=true
  local line
  line="$(printf '{"status":"%s","detail":"%s","exit":%s,"command":"%s","run_id":"%s","target":"%s","image":"%s","source_sha":"%s","candidate_id":"%s","previous_id":"%s","downtime_seconds":%s}' \
    "$1" "$2" "$3" "$CMD" "$RUN_ID" "${CFG[TARGET_CONTAINER]:-}" "$IMAGE" "$SOURCE_SHA" "${CAND_ID:-}" "${OLD_ID:-}" "$DOWNTIME")"
  printf '%s\n' "$line"
  if [[ -n "$RUN_DIR" && -d "$RUN_DIR" ]]; then printf '%s\n' "$line" > "$RUN_DIR/result.json"; fi
  # Raw `docker inspect` output carries the environment (secrets): it never outlives the run that needed it.
  if [[ -n "$EV" && -d "$EV" ]]; then
    rm -f "$EV"/old.json "$EV"/new.json "$EV"/cand.json "$EV"/cand-final.json "$EV"/cand-remove.json "$EV"/restore.json \
      "$EV"/verify.json "$EV"/.field.json "$EV"/env.snapshot "$EV"/env.verify
  fi
  exit "$3"
}
config_invalid() { emit CONFIG_INVALID "$1" 2; }
need() { command -v "$1" >/dev/null 2>&1 || emit PREREQUISITE_MISSING "MISSING_$1" 3; }

# ------------------------------------------------------------------------------------------------ configuration
private_file() {  # regular, not a symlink, owned by the caller, no group/other access
  local mode
  [[ -f "$1" && ! -L "$1" && -O "$1" ]] || return 1
  mode="$(stat -c '%a' "$1")"
  (( (8#$mode & 8#077) == 0 ))
}
abs_path_ok() { [[ "$1" =~ ^/[A-Za-z0-9_./+-]+$ && "$1" != *..* && "$1" != *//* ]]; }

validate_value() {  # validate_value KEY VALUE
  local v="$2"
  case "$1" in
    TARGET_CONTAINER) [[ "$v" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$ ]] ;;
    ALLOWED_IMAGE_REPOSITORY) [[ "$v" =~ ^[a-z0-9.-]+(:[0-9]{2,5})?/[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$ ]] ;;
    EXPECTED_SOURCE_URL) [[ "$v" =~ ^https://[A-Za-z0-9._/-]+$ ]] ;;
    EXPECTED_CURRENT_IMAGE) [[ "$v" =~ ^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$ ]] ;;
    LOOPBACK_PORT) [[ "$v" =~ ^[0-9]{4,5}$ && "$v" -ge 1024 && "$v" -le 65535 ]] ;;
    ENV_FILE|KEYS_DIR|CA_FILE|JOURNAL_DIR|PG_SERVICE_FILE|PG_PASS_FILE|API_CA_FILE|PSQL_BIN) abs_path_ok "$v" ;;
    PG_SERVICE) [[ "$v" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] ;;
    PG_EXPECT_HOST) [[ "$v" =~ ^[A-Za-z0-9.:-]{1,253}$ ]] ;;
    PG_EXPECT_DB|PG_EXPECT_USER) [[ "$v" =~ ^[A-Za-z0-9_]{1,63}$ ]] ;;
    API_BASE_URL) [[ "$v" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?$ ]] ;;
    READY_TIMEOUT_SECONDS) [[ "$v" =~ ^[0-9]{2,3}$ && "$v" -ge 10 && "$v" -le 300 ]] ;;
    REQUEST_TIMEOUT_SECONDS) [[ "$v" =~ ^[0-9]{1,2}$ && "$v" -ge 1 && "$v" -le 30 ]] ;;
    LOCK_WAIT_SECONDS) [[ "$v" =~ ^[0-9]{1,3}$ && "$v" -le 120 ]] ;;
    STOP_TIMEOUT_SECONDS) [[ "$v" =~ ^[0-9]{1,3}$ && "$v" -ge 1 && "$v" -le 120 ]] ;;
    DOCKER_TIMEOUT_SECONDS) [[ "$v" =~ ^[0-9]{2,3}$ && "$v" -ge 10 && "$v" -le 600 ]] ;;
    PREFLIGHT_TIMEOUT_SECONDS) [[ "$v" =~ ^[0-9]{2,3}$ && "$v" -ge 5 && "$v" -le 120 ]] ;;
    *) return 1 ;;
  esac
}

load_config() {
  local line key value required
  [[ -n "$CONFIG" ]] || config_invalid CONFIG_ARGUMENT_MISSING
  private_file "$CONFIG" || config_invalid CONFIG_FILE_NOT_PRIVATE
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != *$'\r'* && "$line" =~ ^([A-Z_]+)=(.*)$ ]] || config_invalid CONFIG_LINE_MALFORMED
    key="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
    [[ -z "${CFG[$key]+x}" ]] || config_invalid "CONFIG_KEY_REPEATED_$key"
    validate_value "$key" "$value" || config_invalid "CONFIG_VALUE_INVALID_$key"
    CFG[$key]="$value"
  done < "$CONFIG"
  for required in TARGET_CONTAINER ALLOWED_IMAGE_REPOSITORY EXPECTED_SOURCE_URL EXPECTED_CURRENT_IMAGE LOOPBACK_PORT ENV_FILE \
      KEYS_DIR CA_FILE JOURNAL_DIR PG_SERVICE_FILE PG_PASS_FILE PG_SERVICE PG_EXPECT_HOST PG_EXPECT_DB PG_EXPECT_USER API_BASE_URL; do
    [[ -n "${CFG[$required]:-}" ]] || config_invalid "CONFIG_KEY_MISSING_$required"
  done
  CFG[READY_TIMEOUT_SECONDS]="${CFG[READY_TIMEOUT_SECONDS]:-60}"
  CFG[REQUEST_TIMEOUT_SECONDS]="${CFG[REQUEST_TIMEOUT_SECONDS]:-5}"
  CFG[LOCK_WAIT_SECONDS]="${CFG[LOCK_WAIT_SECONDS]:-20}"
  CFG[STOP_TIMEOUT_SECONDS]="${CFG[STOP_TIMEOUT_SECONDS]:-30}"
  CFG[DOCKER_TIMEOUT_SECONDS]="${CFG[DOCKER_TIMEOUT_SECONDS]:-120}"
  CFG[PREFLIGHT_TIMEOUT_SECONDS]="${CFG[PREFLIGHT_TIMEOUT_SECONDS]:-30}"
  private_file "${CFG[ENV_FILE]}" || config_invalid ENV_FILE_NOT_PRIVATE
  [[ -d "${CFG[KEYS_DIR]}" && ! -L "${CFG[KEYS_DIR]}" ]] || config_invalid KEYS_DIR_NOT_A_DIRECTORY
  [[ -f "${CFG[CA_FILE]}" && ! -L "${CFG[CA_FILE]}" ]] || config_invalid CA_FILE_NOT_A_REGULAR_FILE
  [[ -z "${CFG[API_CA_FILE]:-}" || -f "${CFG[API_CA_FILE]}" ]] || config_invalid API_CA_FILE_MISSING
  [[ -d "${CFG[JOURNAL_DIR]}" && ! -L "${CFG[JOURNAL_DIR]}" && -O "${CFG[JOURNAL_DIR]}" ]] || config_invalid JOURNAL_DIR_NOT_OWNED_DIRECTORY
  (( (8#$(stat -c '%a' "${CFG[JOURNAL_DIR]}") & 8#077) == 0 )) || config_invalid JOURNAL_DIR_NOT_PRIVATE
  mkdir -p "${CFG[JOURNAL_DIR]}/runs" "${CFG[JOURNAL_DIR]}/records" "${CFG[JOURNAL_DIR]}/tmp"
  [[ -z "${CFG[PSQL_BIN]:-}" ]] || export PSQL_BIN="${CFG[PSQL_BIN]}"
}

check_prerequisites() {
  local tool
  for tool in docker flock timeout curl python3 sha256sum stat mktemp od; do need "$tool"; done
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' || emit PREREQUISITE_MISSING PYTHON_TOO_OLD 3
  (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) || emit PREREQUISITE_MISSING BASH_TOO_OLD 3
  timeout 20 docker version >/dev/null 2>&1 || emit PREREQUISITE_MISSING DOCKER_DAEMON_UNREACHABLE 3
}

# ------------------------------------------------------------------------------------------------ docker / curl helpers
dk() { timeout --foreground "${CFG[DOCKER_TIMEOUT_SECONDS]}" docker "$@"; }
c_exists() { dk container inspect "$1" >/dev/null 2>&1; }
c_json() { dk container inspect "$1" > "$2" 2>/dev/null; }          # c_json <id|name> <file>
i_json() { dk image inspect "$1" > "$2" 2>/dev/null; }
c_field() { local f; f="$EV/.field.json"; c_json "$1" "$f" || return 1; pyget "$f" "$2"; }

http_code() {  # http_code <url> <outfile> [cacert] -> status code, 000 on any transport failure
  local code
  code="$(timeout $(( CFG[REQUEST_TIMEOUT_SECONDS] + 3 )) curl -sS --noproxy '*' --proto '=http,https' --max-redirs 0 \
    --connect-timeout 3 --max-time "${CFG[REQUEST_TIMEOUT_SECONDS]}" -o "$2" -w '%{http_code}' ${3:+--cacert "$3"} "$1" 2>/dev/null)" || true
  printf '%s' "${code:-000}"
}

hash_file() { local h; h="$(sha256sum "$1")"; printf '%s' "${h%% *}"; }

# ------------------------------------------------------------------------------------------------ lock and journal
acquire_lock() {
  local dir="${BHA_DEPLOY_LOCK_DIR:-/run/lock}" file
  [[ -d "$dir" && ! -L "$dir" ]] || emit PREREQUISITE_MISSING LOCK_DIR_MISSING 3
  file="$dir/bha-deploy-${CFG[TARGET_CONTAINER]}.lock"   # one host-wide lock per target, independent of config files
  { exec 9>>"$file"; } 2>/dev/null || emit PREREQUISITE_MISSING LOCK_FILE_UNWRITABLE 3
  flock -w "${CFG[LOCK_WAIT_SECONDS]}" 9 || emit LOCK_BUSY ANOTHER_DEPLOY_OR_ROLLBACK_HOLDS_THE_LOCK 50
}

j_write() {
  [[ -n "$RUN_DIR" ]] || return 0
  local k tmp="$RUN_DIR/.state.tmp"
  for k in "${!J[@]}"; do printf '%s=%s\n' "$k" "${J[$k]}"; done | sort > "$tmp"
  mv -f "$tmp" "$RUN_DIR/state"
}
j_set() {  # j_set KEY VALUE [KEY VALUE ...]
  while (( $# )); do
    J[$1]="$2"
    if [[ -n "$RUN_DIR" ]]; then printf '%s %s=%s\n' "$(date -u +%FT%TZ)" "$1" "$2" >> "$RUN_DIR/events"; fi
    shift 2
  done
  j_write
}
new_run() {  # new_run <kind>
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  RUN_DIR="${CFG[JOURNAL_DIR]}/runs/$RUN_ID"
  mkdir "$RUN_DIR" "$RUN_DIR/evidence"
  EV="$RUN_DIR/evidence"
  J=()
  j_set KIND "$1" STATE STARTED TARGET "${CFG[TARGET_CONTAINER]}" SOURCE_SHA "${SOURCE_SHA:-none}" IMAGE "${IMAGE:-none}"
}
load_state() {  # load_state <run id> -> J, RUN_DIR, EV (strict key=value)
  local line
  RUN_ID="$1" RUN_DIR="${CFG[JOURNAL_DIR]}/runs/$1" EV="${CFG[JOURNAL_DIR]}/runs/$1/evidence"
  [[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ && -f "$RUN_DIR/state" && -O "$RUN_DIR/state" ]] || return 1
  J=()
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Z_0-9]+)=([A-Za-z0-9@:/._,+-]*)$ ]] || return 1
    J[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"
  done < "$RUN_DIR/state"
}
is_terminal() { [[ "$TERMINAL_STATES" == *" $1 "* ]]; }

unfinished_runs() {  # prints ids of runs whose state is not terminal
  local d id st
  for d in "${CFG[JOURNAL_DIR]}"/runs/*/; do
    [[ -d "$d" ]] || continue
    id="$(basename "$d")"
    st="$(sed -n 's/^STATE=//p' "$d/state" 2>/dev/null || true)"
    is_terminal "$st" || printf '%s\n' "$id"
  done
}
refuse_if_unfinished() {
  local id cid run st
  id="$(unfinished_runs | head -n1 || true)"
  [[ -z "$id" ]] || { RUN_ID="$id"; emit INTERRUPTED_STATE "UNFINISHED_RUN_PRESENT_RUN_recover_FIRST" 60; }
  # Second guard: a container labelled for this target that no finished journal accounts for. Refuse only; never delete by scan.
  while read -r cid; do
    [[ -n "$cid" ]] || continue
    run="$(dk container inspect --format '{{index .Config.Labels "com.thebha.deploy.run"}}' "$cid" 2>/dev/null || true)"
    st="$(sed -n 's/^STATE=//p' "${CFG[JOURNAL_DIR]}/runs/$run/state" 2>/dev/null || true)"
    if [[ ! "$run" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || ! is_terminal "$st"; then
      emit INTERRUPTED_STATE UNACCOUNTED_CONTAINER_FOR_TARGET 60
    fi
  done < <(dk ps -aq --no-trunc --filter "label=com.thebha.deploy.target=${CFG[TARGET_CONTAINER]}")
}

# ------------------------------------------------------------------------------------------------ small checks
snapshot_env() {  # snapshot_env <dest>: private copy that is both parsed and handed to docker
  cp "${CFG[ENV_FILE]}" "$1" && chmod 600 "$1"
}
host_baseline() {  # sha256/stat of the files this tool must never change
  J[ENV_SHA]="$(hash_file "${CFG[ENV_FILE]}")"; J[CA_SHA]="$(hash_file "${CFG[CA_FILE]}")"
  J[ENV_STAT]="$(stat -c '%u-%g-%a-%s-%Y' "${CFG[ENV_FILE]}")"; J[CA_STAT]="$(stat -c '%u-%g-%a-%s-%Y' "${CFG[CA_FILE]}")"
  j_set ENV_SHA "${J[ENV_SHA]}" CA_SHA "${J[CA_SHA]}" ENV_STAT "${J[ENV_STAT]}" CA_STAT "${J[CA_STAT]}"
}
host_files_unchanged() {
  [[ "$(hash_file "${CFG[ENV_FILE]}")" == "${J[ENV_SHA]:-}" && "$(hash_file "${CFG[CA_FILE]}")" == "${J[CA_SHA]:-}" ]] &&
  [[ "$(stat -c '%u-%g-%a-%s-%Y' "${CFG[ENV_FILE]}")" == "${J[ENV_STAT]:-}" && "$(stat -c '%u-%g-%a-%s-%Y' "${CFG[CA_FILE]}")" == "${J[CA_STAT]:-}" ]]
}
keys_hash() {  # keys_hash <container id> <outfile>: hashes as seen BY the container (owner uid 1654, mode 0600)
  { dk exec "$1" find /var/keys -maxdepth 1 -type f -exec sha256sum {} + 2>/dev/null || true; } | sort > "$2"
}
keys_preserved() {  # every pre-existing key file still present with identical content
  [[ -s "$EV/keys.pre" ]] && [[ -z "$(comm -23 "$EV/keys.pre" "$EV/keys.now")" ]]
}

VERIFY_CODE=""
verify_running() {  # verify_running <container id> <expected image id> -> 0, or 1 with VERIFY_CODE
  local cid="$1" image_id="$2" deadline code f="$EV/verify.json" ready="http://127.0.0.1:${CFG[LOOPBACK_PORT]}/health/ready"
  VERIFY_CODE=""
  c_json "$cid" "$f" || { VERIFY_CODE=CONTAINER_MISSING; return 1; }
  [[ "$(pyget "$f" Id)" == "$cid" && "$(pyget "$f" Image)" == "$image_id" ]] || { VERIFY_CODE=IDENTITY_DIFFERS; return 1; }
  deadline=$(( SECONDS + CFG[READY_TIMEOUT_SECONDS] ))
  while :; do
    c_json "$cid" "$f" || { VERIFY_CODE=CONTAINER_MISSING; return 1; }
    [[ "$(pyget "$f" State.Running)" == true ]] || { VERIFY_CODE=CONTAINER_NOT_RUNNING; return 1; }
    code="$(http_code "$ready" "$EV/ready.body")"
    [[ "$code" == 200 && "$(cat "$EV/ready.body" 2>/dev/null)" == Healthy ]] && break
    (( SECONDS < deadline )) || { VERIFY_CODE=READINESS_TIMEOUT; return 1; }
    sleep 1
  done
  # API contract through the TLS terminator (the forwarded scheme must be trusted: a 404 here means it is not).
  code="$(http_code "${CFG[API_BASE_URL]}/api/v1/properties" "$EV/properties.json" "${CFG[API_CA_FILE]:-}")"
  [[ "$code" == 200 ]] && py api-properties "$EV/properties.json" 2>/dev/null || { VERIFY_CODE=API_PROPERTIES_CHECK; return 1; }
  code="$(http_code "${CFG[API_BASE_URL]}/api/admin/v1/me" "$EV/me.body" "${CFG[API_CA_FILE]:-}")"
  [[ "$code" == 401 ]] || { VERIFY_CODE=API_STAFF_ME_NOT_401; return 1; }
  dk exec "$cid" sh -c 'test -r /var/keys && test -w /var/keys && test -r /certs/rds-ca.pem && ! test -w /certs/rds-ca.pem' >/dev/null 2>&1 || { VERIFY_CODE=MOUNT_ACCESS; return 1; }
  keys_hash "$cid" "$EV/keys.now"
  keys_preserved || { VERIFY_CODE=KEY_FILES_NOT_PRESERVED; return 1; }
  i_json "$image_id" "$EV/verify-image.json" || { VERIFY_CODE=IMAGE_MISSING; return 1; }
  snapshot_env "$EV/env.verify"
  py env-post "$f" "$EV/verify-image.json" "$EV/env.verify" 2>"$EV/env.err" || { rm -f "$EV/env.verify"; VERIFY_CODE=ENV_DIFFERS; return 1; }
  rm -f "$EV/env.verify"
  host_files_unchanged || { VERIFY_CODE=ENV_OR_CA_FILE_CHANGED; return 1; }
  return 0
}

# ------------------------------------------------------------------------------------------------ restore the previous container
policy_arg() { printf '%s' "$1"; }

# Idempotent: inspects what Docker actually shows and performs only the steps that are still missing.
# Inputs (journal): TARGET, OLD_ID (the container to restore), OLD_IMAGE_ID, OLD_POLICY, FAILED_ID (may be empty), RUN_ID.
RESTORE_CODE=""
restore_previous() {
  local target="${CFG[TARGET_CONTAINER]}" prior="${J[OLD_ID]:-}" failed="${J[FAILED_ID]:-}" cur f="$EV/restore.json"
  RESTORE_CODE=""
  [[ "$prior" =~ ^[0-9a-f]{64}$ ]] || { RESTORE_CODE=NO_PRIOR_ID; return 1; }
  j_set STATE RESTORING
  if [[ "$failed" =~ ^[0-9a-f]{64}$ ]] && c_json "$failed" "$f"; then
    if [[ "$(pyget "$f" State.Running)" == true ]]; then dk stop -t 10 "$failed" >/dev/null 2>&1 || { RESTORE_CODE=FAILED_STOP; return 1; }; fi
    dk update --restart=no "$failed" >/dev/null 2>&1 || { RESTORE_CODE=FAILED_RESTART_POLICY; return 1; }
    if [[ "$(pyget "$f" Name)" == "/$target" ]]; then
      dk rename "$failed" "${target}-failed-$RUN_ID" >/dev/null 2>&1 || { RESTORE_CODE=FAILED_RENAME; return 1; }
    fi
  fi
  c_json "$prior" "$f" || { RESTORE_CODE=PRIOR_CONTAINER_MISSING; return 1; }
  cur="$(pyget "$f" Name)"
  if [[ "$cur" != "/$target" ]]; then
    if c_exists "$target"; then RESTORE_CODE=TARGET_NAME_OCCUPIED; return 1; fi
    dk rename "$prior" "$target" >/dev/null 2>&1 || { RESTORE_CODE=PRIOR_RENAME; return 1; }
  fi
  dk update --restart="$(policy_arg "${J[OLD_POLICY]:-no}")" "$prior" >/dev/null 2>&1 || { RESTORE_CODE=PRIOR_RESTART_POLICY; return 1; }
  c_json "$prior" "$f" || { RESTORE_CODE=PRIOR_CONTAINER_MISSING; return 1; }
  [[ "$(py restart "$f")" == "${J[OLD_POLICY]:-no}" ]] || { RESTORE_CODE=PRIOR_RESTART_POLICY_NOT_APPLIED; return 1; }
  if [[ "$(pyget "$f" State.Running)" != true ]]; then dk start "$prior" >/dev/null 2>&1 || { RESTORE_CODE=PRIOR_START; return 1; }; fi
  verify_running "$prior" "${J[OLD_IMAGE_ID]}" || { RESTORE_CODE="PRIOR_NOT_SERVING_$VERIFY_CODE"; return 1; }
  return 0
}

remove_candidate_if_ours() {  # only a container proven to carry THIS run's labels, and never a running one
  local cid="${J[CAND_ID]:-}"
  [[ "$cid" =~ ^[0-9a-f]{64}$ ]] || return 0
  c_exists "$cid" || return 0
  [[ "$(c_field "$cid" Id)" == "$cid" ]] || return 0
  c_json "$cid" "$EV/cand-remove.json" || return 0
  if [[ "$(py label "$EV/cand-remove.json" com.thebha.deploy.run)" == "$RUN_ID" && "$(pyget "$EV/cand-remove.json" State.Running)" != true ]]; then
    dk rm "$cid" >/dev/null 2>&1 || true
  fi
}

after_stop_failure() {  # after_stop_failure <detail>
  local detail="$1"
  J[FAILED_ID]="${J[CAND_ID]:-}"
  if restore_previous; then
    j_set STATE ROLLED_BACK
    emit DEPLOY_FAILED_ROLLED_BACK "$detail" 30
  fi
  j_set STATE ROLLBACK_FAILED RESTORE_CODE "$RESTORE_CODE"
  emit ROLLBACK_FAILED "${detail}__$RESTORE_CODE" 40
}

# Backstop for signals and unexpected errors: pre-stop -> reject; from STOP_INTENT on -> restore the previous container.
on_exit() {
  local rc=$? st
  trap '' INT TERM HUP
  trap - EXIT
  [[ "$FINALIZED" == true || -z "$RUN_DIR" || ! -d "$RUN_DIR" ]] && exit "$rc"
  set +e
  st="${J[STATE]:-STARTED}"
  local why=UNEXPECTED_ERROR
  [[ "$INTERRUPTED" == true ]] && why=INTERRUPTED_BY_SIGNAL
  case "$st" in
    STARTED|GATES_PASSED)
      remove_candidate_if_ours
      j_set STATE REJECTED
      emit REJECTED_BEFORE_STOP "$why" 20 ;;
    STOP_INTENT|OLD_STOPPED|NAMES_SWAPPED|CANDIDATE_STARTED|VERIFIED|RESTORING|ROLLBACK_FAILED)
      if [[ "${J[KIND]:-}" == rollback ]]; then
        if restore_previous; then j_set STATE ROLLBACK_DONE; emit ROLLED_BACK "$why" 0; fi
        j_set STATE ROLLBACK_FAILED; emit ROLLBACK_FAILED "${why}__$RESTORE_CODE" 40
      fi
      after_stop_failure "$why" ;;
    SUCCEEDED) J[RECORD_RUN_ID]="$RUN_ID" J[RECORD_STATE]=SUCCEEDED; write_record; emit SUCCESS NEW_RELEASE_SERVING_PREVIOUS_RETAINED_STOPPED 0 ;;
    ROLLED_BACK) emit DEPLOY_FAILED_ROLLED_BACK "$why" 30 ;;
    ROLLBACK_DONE) emit ROLLED_BACK "$why" 0 ;;
    REJECTED) emit REJECTED_BEFORE_STOP "$why" 20 ;;
    ALREADY_CURRENT_DONE) emit ALREADY_CURRENT SAME_IMAGE_ID_RUNNING_AND_VERIFIED 0 ;;
    *) emit INTERRUPTED_STATE "$why" 60 ;;
  esac
}
on_signal() { INTERRUPTED=true; exit 143; }

# ------------------------------------------------------------------------------------------------ pre-stop gates
reject() {  # reject <CODE>: a gate failed; nothing has been stopped
  remove_candidate_if_ours
  if [[ -n "$RUN_DIR" ]]; then j_set STATE REJECTED DETAIL "$1"; fi
  emit REJECTED_BEFORE_STOP "$1" 20
}

reject_from() {  # reject_from <file with a "REJECT CODE..." line from the JSON tool>
  local c
  c="$(sed -n 's/^REJECT //p' "$1" | head -n1 | tr ' ' ',')"
  reject "${c:-UNKNOWN_REJECTION}"
}

parse_run_args() {
  while (( $# )); do
    case "$1" in
      --config) CONFIG="${2:-}"; shift 2 ;;
      --image) IMAGE="${2:-}"; shift 2 ;;
      --source-sha) SOURCE_SHA="${2:-}"; shift 2 ;;
      --manifest) MANIFEST_FILE="${2:-}"; shift 2 ;;
      *) emit CONFIG_INVALID UNKNOWN_ARGUMENT 2 ;;
    esac
  done
}

gate_inputs() {
  [[ "$IMAGE" =~ ^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$ ]] || { IMAGE=""; reject IMAGE_NOT_A_DIGEST_REFERENCE; }
  [[ "${IMAGE%@*}" == "${CFG[ALLOWED_IMAGE_REPOSITORY]}" ]] || reject IMAGE_REPOSITORY_NOT_ALLOWED
  [[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || reject SOURCE_SHA_MALFORMED
  [[ -n "$MANIFEST_FILE" && -f "$MANIFEST_FILE" ]] || reject MANIFEST_MISSING
  python3 -I "$SCRIPT_DIR/backend-migration-manifest.py" ids --manifest "$MANIFEST_FILE" --source-sha "$SOURCE_SHA" > "$EV/expected.ids" 2> "$EV/manifest.err" || reject MANIFEST_INVALID_OR_FOR_ANOTHER_SHA
  J[HISTORY_SHA256]="$(hash_file "$EV/expected.ids")"
  j_set HISTORY_SHA256 "${J[HISTORY_SHA256]}"
}

gate_current_container() {
  local expected_id
  c_json "${CFG[TARGET_CONTAINER]}" "$EV/old.json" || reject CURRENT_CONTAINER_MISSING
  OLD_ID="$(pyget "$EV/old.json" Id)"
  [[ "$OLD_ID" =~ ^[0-9a-f]{64}$ ]] || reject CURRENT_CONTAINER_ID_MALFORMED
  [[ "$(pyget "$EV/old.json" State.Running)" == true ]] || reject CURRENT_CONTAINER_NOT_RUNNING
  J[OLD_IMAGE_ID]="$(pyget "$EV/old.json" Image)"
  expected_id="$(dk image inspect --format '{{.Id}}' "${CFG[EXPECTED_CURRENT_IMAGE]}" 2>/dev/null || true)"
  [[ -n "$expected_id" && "$expected_id" == "${J[OLD_IMAGE_ID]}" ]] || reject CURRENT_IMAGE_DIFFERS_FROM_EXPECTED_CURRENT
  i_json "${J[OLD_IMAGE_ID]}" "$EV/old-image.json" || reject CURRENT_IMAGE_NOT_INSPECTABLE
  J[OLD_POLICY]="$(py restart "$EV/old.json" 2>/dev/null)" || reject SHAPE_RESTART_POLICY
  j_set OLD_ID "$OLD_ID" OLD_IMAGE_ID "${J[OLD_IMAGE_ID]}" OLD_POLICY "${J[OLD_POLICY]}" PREV_NAME "${CFG[TARGET_CONTAINER]}-prev-$RUN_ID"
}

gate_candidate_image() {
  dk pull -q "$IMAGE" >/dev/null 2>&1 || reject IMAGE_PULL_FAILED
  i_json "$IMAGE" "$EV/cand-image.json" || reject IMAGE_NOT_INSPECTABLE_AFTER_PULL
  J[CAND_IMAGE_ID]="$(py image-check "$EV/cand-image.json" "$IMAGE" "$SOURCE_SHA" "${CFG[EXPECTED_SOURCE_URL]}" 2>"$EV/image.err")" || reject_from "$EV/image.err"
  j_set CAND_IMAGE_ID "${J[CAND_IMAGE_ID]}"
  py image-compat "$EV/old-image.json" "$EV/cand-image.json" 2>"$EV/image.err" || reject_from "$EV/image.err"
}

gate_migration_history() {
  local rc=0 code
  "$SCRIPT_DIR/backend-migration-preflight.sh" --service-file "${CFG[PG_SERVICE_FILE]}" --pass-file "${CFG[PG_PASS_FILE]}" \
    --service "${CFG[PG_SERVICE]}" --expect-host "${CFG[PG_EXPECT_HOST]}" --expect-db "${CFG[PG_EXPECT_DB]}" \
    --expect-user "${CFG[PG_EXPECT_USER]}" --ca-file "${CFG[CA_FILE]}" --ids "$EV/expected.ids" \
    --timeout "${CFG[PREFLIGHT_TIMEOUT_SECONDS]}" --evidence-dir "$EV" > "$EV/preflight.json" 2>/dev/null || rc=$?
  code="$(sed -n 's/.*"code":"\([A-Z_a-z]*\)".*/\1/p' "$EV/preflight.json" | head -n1)"
  case "$rc" in
    0) return 0 ;;
    11) emit PREREQUISITE_MISSING "MIGRATION_GATE_${code:-PSQL_MISSING}" 3 ;;
    10) reject "MIGRATION_GATE_CONFIG_${code:-INVALID}" ;;
    *) reject "MIGRATION_GATE_${code:-FAILED}" ;;
  esac
}

gate_runtime_shape_and_env() {
  py shape "$EV/old.json" "$EV/old-image.json" "${CFG[LOOPBACK_PORT]}" "${CFG[KEYS_DIR]}" "${CFG[CA_FILE]}" "$EV/profile.old" "$EV/create.args" 2>"$EV/shape.err" \
    || reject_from "$EV/shape.err"
  snapshot_env "$EV/env.snapshot"
  py env-pre "$EV/old.json" "$EV/old-image.json" "$EV/cand-image.json" "$EV/env.snapshot" 2>"$EV/env.err" \
    || { rm -f "$EV/env.snapshot"; reject_from "$EV/env.err"; }
  keys_hash "$OLD_ID" "$EV/keys.pre"
  [[ -s "$EV/keys.pre" ]] || reject KEYS_DIRECTORY_EMPTY_OR_UNREADABLE
  dk exec "$OLD_ID" sh -c 'test -w /var/keys && test -r /certs/rds-ca.pem && ! test -w /certs/rds-ca.pem' >/dev/null 2>&1 || reject MOUNT_ACCESS_ON_CURRENT
  host_baseline
}

# Create-before-stop: the candidate exists (not started) and was compared with the captured configuration.
create_candidate() {
  local name="${CFG[TARGET_CONTAINER]}-run-$RUN_ID" prev="${CFG[TARGET_CONTAINER]}-prev-$RUN_ID" id
  local -a args=()
  c_exists "$name" && reject CANDIDATE_NAME_COLLISION
  c_exists "$prev" && reject PREVIOUS_NAME_COLLISION
  c_exists "${CFG[TARGET_CONTAINER]}-failed-$RUN_ID" && reject FAILED_NAME_COLLISION
  mapfile -d '' -t args < "$EV/create.args"
  # restart=no during the window: the original policy is applied only after every check passed.
  id="$(dk create --name "$name" --label "com.thebha.deploy.run=$RUN_ID" --label "com.thebha.deploy.target=${CFG[TARGET_CONTAINER]}" \
    --restart=no --env-file "$EV/env.snapshot" "${args[@]}" "$IMAGE" 2>"$EV/create.err")" || { rm -f "$EV/env.snapshot"; reject CANDIDATE_CREATE_FAILED; }
  rm -f "$EV/env.snapshot"
  [[ "$id" =~ ^[0-9a-f]{64}$ ]] || reject CANDIDATE_ID_MALFORMED
  CAND_ID="$id"
  j_set CAND_ID "$id" CAND_NAME "$name"
  c_json "$id" "$EV/cand.json" || reject CANDIDATE_NOT_INSPECTABLE
  [[ "$(py label "$EV/cand.json" com.thebha.deploy.run)" == "$RUN_ID" && "$(pyget "$EV/cand.json" Image)" == "${J[CAND_IMAGE_ID]}" \
    && "$(pyget "$EV/cand.json" State.Status)" == created ]] || reject CANDIDATE_IDENTITY_DIFFERS
  py shape "$EV/cand.json" "$EV/cand-image.json" "${CFG[LOOPBACK_PORT]}" "${CFG[KEYS_DIR]}" "${CFG[CA_FILE]}" "$EV/profile.cand" - 2>"$EV/shape.err" \
    || reject_from "$EV/shape.err"
  cmp -s "$EV/profile.old" "$EV/profile.cand" || reject CANDIDATE_RUNTIME_DIFFERS_FROM_CAPTURED
  snapshot_env "$EV/env.verify"
  py env-post "$EV/cand.json" "$EV/cand-image.json" "$EV/env.verify" 2>"$EV/env.err" || { rm -f "$EV/env.verify"; reject CANDIDATE_ENV_DIFFERS; }
  rm -f "$EV/env.verify"
}

write_record() {  # atomic, private; rollback reads only this
  local tmp="${CFG[JOURNAL_DIR]}/records/.latest.tmp" k
  {
    for k in RECORD_RUN_ID TARGET OLD_ID PREV_NAME OLD_IMAGE_ID OLD_POLICY CAND_ID CAND_IMAGE_ID IMAGE SOURCE_SHA HISTORY_SHA256 RECORD_STATE; do
      printf '%s=%s\n' "$k" "${J[$k]:-}"
    done
  } > "$tmp"
  mv -f "$tmp" "${CFG[JOURNAL_DIR]}/records/latest"
}

# ------------------------------------------------------------------------------------------------ commands
common_gates() {  # shared by preflight and deploy; the old container is untouched
  gate_inputs
  gate_current_container
  gate_candidate_image
  gate_migration_history
  gate_runtime_shape_and_env
}

cmd_preflight() {
  parse_run_args "$@"; load_config; check_prerequisites
  RUN_DIR=""; EV="$(mktemp -d "${CFG[JOURNAL_DIR]}/tmp/preflight.XXXXXX")"
  trap 'rm -rf "$EV"' EXIT
  acquire_lock
  refuse_if_unfinished
  J=([STATE]=STARTED)
  common_gates
  if [[ "${J[CAND_IMAGE_ID]}" == "${J[OLD_IMAGE_ID]}" ]]; then emit PREFLIGHT_PASS CANDIDATE_IS_THE_RUNNING_RELEASE 0; fi
  emit PREFLIGHT_PASS ALL_PRE_STOP_GATES_PASSED 0
}

cmd_deploy() {
  parse_run_args "$@"; load_config; check_prerequisites; acquire_lock; refuse_if_unfinished
  new_run deploy
  trap on_exit EXIT; trap on_signal INT TERM HUP
  common_gates
  if [[ "${J[CAND_IMAGE_ID]}" == "${J[OLD_IMAGE_ID]}" ]]; then
    # Same release already serving: still no bypass of the readiness / config / schema / preservation gates.
    verify_running "$OLD_ID" "${J[OLD_IMAGE_ID]}" || reject "ALREADY_CURRENT_UNHEALTHY_$VERIFY_CODE"
    j_set STATE ALREADY_CURRENT_DONE
    emit ALREADY_CURRENT SAME_IMAGE_ID_RUNNING_AND_VERIFIED 0
  fi
  create_candidate
  j_set STATE GATES_PASSED
  local target="${CFG[TARGET_CONTAINER]}" t0=$SECONDS
  # --- destructive window: journal first, then act ---
  j_set STATE STOP_INTENT
  dk update --restart=no "$OLD_ID" >/dev/null 2>&1 || after_stop_failure OLD_RESTART_POLICY_UPDATE
  dk stop -t "${CFG[STOP_TIMEOUT_SECONDS]}" "$OLD_ID" >/dev/null 2>&1 || after_stop_failure OLD_STOP_FAILED
  [[ "$(c_field "$OLD_ID" State.Running)" == false ]] || after_stop_failure OLD_STILL_RUNNING
  j_set STATE OLD_STOPPED
  dk rename "$OLD_ID" "${J[PREV_NAME]}" >/dev/null 2>&1 || after_stop_failure OLD_RENAME_FAILED
  dk rename "$CAND_ID" "$target" >/dev/null 2>&1 || after_stop_failure CANDIDATE_RENAME_FAILED
  j_set STATE NAMES_SWAPPED
  dk start "$CAND_ID" >/dev/null 2>&1 || after_stop_failure CANDIDATE_START_FAILED
  j_set STATE CANDIDATE_STARTED
  verify_running "$CAND_ID" "${J[CAND_IMAGE_ID]}" || { c_json "$CAND_ID" "$EV/cand-final.json" && dk logs --tail 200 "$CAND_ID" > "$EV/candidate.log" 2>&1 || true; after_stop_failure "CANDIDATE_CHECK_$VERIFY_CODE"; }
  DOWNTIME=$(( SECONDS - t0 ))
  j_set STATE VERIFIED DOWNTIME "$DOWNTIME"
  dk update --restart="${J[OLD_POLICY]}" "$CAND_ID" >/dev/null 2>&1 || after_stop_failure CANDIDATE_RESTART_POLICY_UPDATE
  c_json "$CAND_ID" "$EV/cand-final.json" && [[ "$(py restart "$EV/cand-final.json")" == "${J[OLD_POLICY]}" ]] || after_stop_failure CANDIDATE_RESTART_POLICY_NOT_APPLIED
  J[RECORD_RUN_ID]="$RUN_ID" J[RECORD_STATE]=SUCCEEDED J[TARGET]="$target"
  j_set STATE SUCCEEDED
  write_record
  emit SUCCESS NEW_RELEASE_SERVING_PREVIOUS_RETAINED_STOPPED 0
}

read_record() {  # strict parse of records/latest into R[]
  local line
  declare -gA R=()
  [[ -f "${CFG[JOURNAL_DIR]}/records/latest" && -O "${CFG[JOURNAL_DIR]}/records/latest" ]] || return 1
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Z_0-9]+)=([A-Za-z0-9@:/._,+-]*)$ ]] || return 1
    R[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"
  done < "${CFG[JOURNAL_DIR]}/records/latest"
}

cmd_rollback() {
  parse_run_args "$@"; load_config; check_prerequisites; acquire_lock; refuse_if_unfinished
  local target="${CFG[TARGET_CONTAINER]}" cur_id src
  new_run rollback
  trap on_exit EXIT; trap on_signal INT TERM HUP
  read_record || reject ROLLBACK_RECORD_MISSING_OR_MALFORMED
  [[ "${R[TARGET]:-}" == "$target" && "${R[OLD_ID]:-}" =~ ^[0-9a-f]{64}$ && "${R[CAND_ID]:-}" =~ ^[0-9a-f]{64}$ ]] || reject ROLLBACK_RECORD_NOT_FOR_THIS_TARGET
  src="${CFG[JOURNAL_DIR]}/runs/${R[RECORD_RUN_ID]:-x}/evidence/expected.ids"
  [[ -f "$src" && "$(hash_file "$src")" == "${R[HISTORY_SHA256]:-}" ]] || reject ROLLBACK_RECORD_HISTORY_EVIDENCE_MISSING
  cp "$src" "$EV/expected.ids"
  J[OLD_ID]="${R[OLD_ID]}" J[OLD_IMAGE_ID]="${R[OLD_IMAGE_ID]}" J[OLD_POLICY]="${R[OLD_POLICY]}" J[FAILED_ID]="${R[CAND_ID]}" J[CAND_ID]=""
  OLD_ID="${R[OLD_ID]}" CAND_ID="${R[CAND_ID]}"
  j_set OLD_ID "$OLD_ID" OLD_IMAGE_ID "${R[OLD_IMAGE_ID]}" OLD_POLICY "${R[OLD_POLICY]}" FAILED_ID "${R[CAND_ID]}" SOURCE_SHA "${R[SOURCE_SHA]:-none}"
  cur_id="$(c_field "$target" Id 2>/dev/null || true)"
  if [[ "${R[RECORD_STATE]:-}" == ROLLED_BACK_EXPLICIT ]]; then
    [[ "$cur_id" == "$OLD_ID" ]] || reject ROLLBACK_RECORD_STALE_CURRENT_CHANGED
    keys_hash "$OLD_ID" "$EV/keys.pre"; host_baseline
    verify_running "$OLD_ID" "${R[OLD_IMAGE_ID]}" || reject "ALREADY_ROLLED_BACK_UNHEALTHY_$VERIFY_CODE"
    j_set STATE ROLLBACK_DONE
    emit ALREADY_ROLLED_BACK PREVIOUS_RELEASE_ALREADY_SERVING 0
  fi
  [[ "${R[RECORD_STATE]:-}" == SUCCEEDED && "$cur_id" == "${R[CAND_ID]}" ]] || reject ROLLBACK_RECORD_STALE_CURRENT_CHANGED
  c_json "$OLD_ID" "$EV/old.json" || reject ROLLBACK_PREVIOUS_CONTAINER_MISSING
  [[ "$(pyget "$EV/old.json" State.Running)" == false && "$(pyget "$EV/old.json" Image)" == "${R[OLD_IMAGE_ID]}" && "$(pyget "$EV/old.json" Name)" == "/${R[PREV_NAME]}" ]] \
    || reject ROLLBACK_PREVIOUS_CONTAINER_STATE_UNEXPECTED
  c_json "$target" "$EV/new.json" && [[ "$(pyget "$EV/new.json" Image)" == "${R[CAND_IMAGE_ID]}" ]] || reject ROLLBACK_CURRENT_IMAGE_DIFFERS
  gate_migration_history
  keys_hash "$CAND_ID" "$EV/keys.pre"      # every key the current release holds must survive the rollback
  [[ -s "$EV/keys.pre" ]] || reject KEYS_DIRECTORY_EMPTY_OR_UNREADABLE
  host_baseline
  j_set STATE STOP_INTENT
  if restore_previous; then
    j_set STATE ROLLBACK_DONE
    R[RECORD_STATE]=ROLLED_BACK_EXPLICIT
    local tmp="${CFG[JOURNAL_DIR]}/records/.latest.tmp" k
    { for k in RECORD_RUN_ID TARGET OLD_ID PREV_NAME OLD_IMAGE_ID OLD_POLICY CAND_ID CAND_IMAGE_ID IMAGE SOURCE_SHA HISTORY_SHA256 RECORD_STATE; do printf '%s=%s\n' "$k" "${R[$k]:-}"; done; } > "$tmp"
    mv -f "$tmp" "${CFG[JOURNAL_DIR]}/records/latest"
    emit ROLLED_BACK PREVIOUS_RELEASE_SERVING 0
  fi
  j_set STATE ROLLBACK_FAILED RESTORE_CODE "$RESTORE_CODE"
  emit ROLLBACK_FAILED "$RESTORE_CODE" 40
}

cmd_recover() {
  parse_run_args "$@"; load_config; check_prerequisites; acquire_lock
  local ids id st kind
  ids="$(unfinished_runs)"
  [[ -n "$ids" ]] || emit RECOVERED NOTHING_TO_RECOVER 0
  [[ "$(printf '%s\n' "$ids" | wc -l)" -eq 1 ]] || emit INTERRUPTED_STATE MORE_THAN_ONE_UNFINISHED_RUN_MANUAL_RECOVERY 60
  id="$ids"
  load_state "$id" || emit INTERRUPTED_STATE UNFINISHED_RUN_STATE_UNREADABLE 60
  OLD_ID="${J[OLD_ID]:-}" CAND_ID="${J[CAND_ID]:-}" IMAGE="${J[IMAGE]:-}" SOURCE_SHA="${J[SOURCE_SHA]:-}"
  [[ "$IMAGE" == none ]] && IMAGE=""; [[ "$SOURCE_SHA" == none ]] && SOURCE_SHA=""
  st="${J[STATE]:-}" kind="${J[KIND]:-}"
  trap on_exit EXIT; trap on_signal INT TERM HUP
  case "$st" in
    STARTED|GATES_PASSED)
      remove_candidate_if_ours; j_set STATE REJECTED DETAIL RECOVERED_BEFORE_STOP
      emit RECOVERED RUN_ABORTED_BEFORE_THE_STOP_PREVIOUS_UNTOUCHED 0 ;;
    *)
      [[ -s "$EV/keys.pre" ]] || emit ROLLBACK_FAILED KEYS_PRE_EVIDENCE_MISSING 40
      [[ "$kind" == deploy ]] && J[FAILED_ID]="${J[CAND_ID]:-}"
      if [[ "$st" == SUCCEEDED ]]; then
        J[RECORD_RUN_ID]="$RUN_ID" J[RECORD_STATE]=SUCCEEDED; write_record
        emit RECOVERED SUCCEEDED_RUN_RECORD_REWRITTEN 0
      fi
      j_set STATE STOP_INTENT
      if restore_previous; then
        if [[ "$kind" == rollback ]]; then j_set STATE ROLLBACK_DONE; else j_set STATE ROLLED_BACK; fi
        emit RECOVERED PREVIOUS_RELEASE_RESTORED_AND_VERIFIED 0
      fi
      j_set STATE ROLLBACK_FAILED RESTORE_CODE "$RESTORE_CODE"
      emit ROLLBACK_FAILED "$RESTORE_CODE" 40 ;;
  esac
}

cmd_status() {
  parse_run_args "$@"; load_config; check_prerequisites
  local id cid="" run_state="none" rec_state="none" running="false" rec_run=""
  EV="$(mktemp -d "${CFG[JOURNAL_DIR]}/tmp/status.XXXXXX")"
  trap 'rm -rf "$EV"' EXIT
  c_json "${CFG[TARGET_CONTAINER]}" "$EV/c.json" && { cid="$(pyget "$EV/c.json" Id)"; running="$(pyget "$EV/c.json" State.Running)"; }
  id="$(unfinished_runs | head -n1 || true)"
  [[ -z "$id" ]] || { RUN_ID="$id"; run_state="$(sed -n 's/^STATE=//p' "${CFG[JOURNAL_DIR]}/runs/$id/state" 2>/dev/null)"; }
  if read_record; then rec_state="${R[RECORD_STATE]:-}" rec_run="${R[RECORD_RUN_ID]:-}"; fi
  OLD_ID="$cid"
  printf '{"status":"STATUS","target":"%s","container_id":"%s","running":%s,"unfinished_run":"%s","unfinished_state":"%s","record_run":"%s","record_state":"%s"}\n' \
    "${CFG[TARGET_CONTAINER]}" "$cid" "${running:-false}" "$id" "$run_state" "$rec_run" "$rec_state"
  [[ -z "$id" ]] || { FINALIZED=true; exit 60; }
  FINALIZED=true
  exit 0
}

main() {
  CMD="${1:-}"
  [[ -n "$CMD" ]] && shift
  case "$CMD" in
    preflight) cmd_preflight "$@" ;;
    deploy) cmd_deploy "$@" ;;
    rollback) cmd_rollback "$@" ;;
    recover) cmd_recover "$@" ;;
    status) cmd_status "$@" ;;
    *) CMD=""; emit CONFIG_INVALID "USAGE_preflight_deploy_rollback_recover_status" 2 ;;
  esac
}
main "$@"
