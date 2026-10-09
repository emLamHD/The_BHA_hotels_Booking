# BHA-BACKEND-CD-001-CP02 — completion report (EC2_DEPLOY_ROLLBACK)

> **CP02-C1 (SAFE_RESULT_SERIALIZATION) is a correction on top of this report.** Sections 1–7 describe CP02 before C1 (head `b5eda8f`) and stay as that evidence; section 8 covers the correction. Counts and rehearsal results in sections 3–4 are the pre-C1 ones and are not attributed to the C1 head.

Date: 2026-10-09 (Asia/Saigon). **Checkpoint 2 only. Backend CD is not complete.** CP03 (SSM/IAM/workflow wiring) and CP04 (Owner live activation) are NOT_STARTED. Nothing here ran on the EC2 host, RDS, ECR, SSM or any AWS API.

## 1. Identity

| | |
|---|---|
| Work item / roles | `BHA-BACKEND-CD-001-CP02` — `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes) |
| Branch / base / baseline | `feature/bha-backend-cd-001-cp02-ec2-deploy-rollback` → `develop`; baseline = START_HEAD = `56c8b77fecd1970cf75361aa8a9fe50f51b74c9a` (= `origin/develop`, clean tree, checked after `git fetch --prune origin`) |
| Script validation SHA | `8ed52350450b08089d32050160e0f42179603e4c` — the three scripts, the harness and the tests are byte-identical from here to FINAL_HEAD (only docs, a removed bytecode file and file modes changed afterwards) |
| FINAL_HEAD | A commit cannot contain its own hash: the report commit, FINAL_HEAD and the CI runs on it are stated in the final handoff |
| Draft PR | https://github.com/emLamHD/The_BHA_hotels_Booking/pull/94 (Draft, base `develop`) |
| Commits | Seven `wip(cp02)` checkpoints (the clean-tree rehearsal needs committed source; AGENTS.md forbids squashing, so they stay; they carry no `Co-Authored-By` trailer), then the docs commit and the report commit, both with the trailer |

## 2. Files and PR size

New: `backend-deploy.sh` (938), `backend-migration-preflight.sh` (159), `backend-migration-manifest.py` (116), `tests/test_backend_deploy.py` (984), `tests/rehearse_backend_deploy.sh` (439). Updated: `docs/runbooks/BHA-BACKEND-CD-001.md` (+74), `docs/runbooks/CUST-WEB-SHOWCASE-001-deploy.md` (+2), `docs/project/SNAPSHOT.md` (+3/−1), this report. The actual GitHub additions/deletions are in the final handoff. The PR is far above the 100–400 target: roughly 2,500 lines of scripts and tests plus documentation. The scripts implement a lock, journal, state machine, restore, gates and a read-only database gate; about 60% of the diff is the mock suite and the real rehearsal harness that prove them. No required safety check or test was removed to shrink it. No fixture files were needed beyond what the tests generate.

## 3. Acceptance

**A1 — digest/SHA/manifest/runtime gates fail before the stop; migration preflight is read-only and exact-match: PASS.**
* Real (rehearsal): mutable tag, foreign repository, digest absent from the registry, manifest for another SHA, OCI revision label ≠ requested SHA, pending migration, unknown applied migration, missing history table, TLS `verify-full` against a wrong CA, unreachable database, env-file value the running container lacks — each exits 20 with the old container's ID and `StartedAt` unchanged and no labelled container created.
* Real: schema + data + history dump hash (pg_dump 18.3, privileged fixture identity, separate from the deploy identity) identical before and after `preflight`, after the deploy and after the rollback.
* Mock: manual env extras, ambiguous env files (leading space, BOM, line without `=`, duplicate name, invalid name), wrong/extra/writable mounts, wrong port binding, unsupported restart policy, privileged/extra hosts/entrypoint override/TTY/foreign label/host network, hostname/MAC/exposed-port/volume overrides, **any** HostConfig member the candidate does not reproduce (`OomScoreAdj`, `MemoryReservation`, `MemorySwappiness`, blkio, `StorageOpt`, `ReadonlyPaths` — RED before the full-HostConfig comparison existed, GREEN after), empty key ring, mount access, pull/create failure, permission/TLS/connection/timeout/query/identity failures of the history gate, reordered history, service file not binding the contract (host, db, user, `sslmode`, CA, extra keys, repeated section), non-private files, missing psql; the SQL is a `BEGIN READ ONLY` session without any DDL/DML keyword and runs with a sanitised `PG*` environment.

**A2 — host lock and ownership prevent takeover, collisions and stale rollback: PASS.** Real: `deploy` and `rollback` while another process holds the per-target lock → exit 50, nothing changed, lock file kept. Mock: the lock is per target, not per config file; `recover` never takes over a name held by an unrelated container (`ROLLBACK_FAILED/TARGET_NAME_OCCUPIED`, nothing renamed or removed); a stale record (container named after the target is not the recorded one) is refused with exit 20 and changes nothing; an unfinished run and an unaccounted labelled container both block with exit 60; candidates are removed only when proven to carry this run's label and not running.

**A3 — create-before-stop; env/CA/keys and supported runtime preserved; unsupported shape fails closed: PASS (same-daemon comparison).** Real: the candidate is created while the old one serves; after the swap every env-file line (including `Logging.LogLevel.Default=a=b=c` and a connection string with many `=`) is in the new container's env, mounts (keys rw, CA ro), loopback binding, log driver/options and restart policy match, existing key files are byte-identical (hashed inside the container), `ENV_FILE`/`CA_FILE` sha256 unchanged. A real daemon showed `OomKillDisable: null` on one container and `false` on the other; null/false/0/empty are therefore treated as equal on both sides.

**A4 — real isolated success by digest with readiness/API checks and a retained old container: PASS.** Real: candidate pulled by digest from a loopback registry (`docker image inspect` of the digest reference failed before the pull and succeeded after), `SUCCESS`, downtime 4 s (3–4 s in earlier runs); `/health/ready` 200 `Healthy`; `GET /api/v1/properties` 200 with the JSON contract and unauthenticated Staff `me` 401 through a loopback TLS proxy with its own CA (no `-k`); previous container stopped, `restart=no`, renamed, same ID; original policy applied to the new one. A Staff session cookie issued **before** the swap read `me` = 200 after the swap, after the explicit rollback and after the failed deploy; credentials were synthetic and never printed. `ALREADY_CURRENT` re-runs the checks; the mock shows it turns into a rejection when readiness fails. Also real: explicit `rollback` returns the **same original container ID** with its original policy, keeps the rolled-back release stopped with `restart=no`, and a second `rollback` is `ALREADY_ROLLED_BACK`.

**A5 — real failure after the stop restores the old container; failure statuses never read as success: PASS.** Real: a TEST_ONLY candidate (same entrypoint/user/env defaults, invalid `appsettings.json`) passes every pre-stop gate, then fails after the start → exit 30 `DEPLOY_FAILED_ROLLED_BACK`, the original container serves again under the service name with its policy and a passing readiness/API/mount check, the failed candidate is kept stopped (`restart=no`), the session still reads 200, the journal is `ROLLED_BACK`, and the next deploy succeeds. Mock only: candidate start, readiness timeout, API 404, `me` ≠ 401, empty key ring, mount access, old-rename failure, candidate-rename failure, candidate restart-policy update failure, old-stop failure (all exit 30 and restore), rollback failure (exit 40 `ROLLBACK_FAILED`, both containers kept, next run exit 60, then `recover` exit 0), stale record, rollback pre-stop env check (RED before: the failure would only appear after the stop), SIGTERM during the candidate start (restored, `INTERRUPTED_BY_SIGNAL`), `recover` from each of `STOP_INTENT/OLD_STOPPED/NAMES_SWAPPED/CANDIDATE_STARTED` and idempotent repeats. SIGKILL is not handled: it leaves a non-terminal journal that blocks later runs until `recover` (runbook §9.6).

**A6 — scripts/tests/validators/CI pass, Draft PR, clean tree: see the final handoff** for FINAL_HEAD, alignment, the `CI` and `Backend image` runs and the GitHub size. Local results below.

## 4. Checks (tool, result)

| Check | Result |
|---|---|
| `python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py"` (Python 3.14.4) | **111 tests OK**: 47 new mock tests + 49 `test_backend_release.py` + 15 existing; 0 failures, 0 skips |
| Real rehearsal `tests/rehearse_backend_deploy.sh` on `8ed5235` (Docker 29.8.1, containerd image store, psql 18.4, curl 8.18.0, openssl 3.5.5, bash 5.3.9, flock 2.41.3) | **61 checks PASS, 0 FAIL**, exit 0 |
| `koalaman/shellcheck:v0.10.0` `-x` on all new and existing shell scripts (images pinned in the CP01 report) | exit 0 |
| `python3 -m py_compile` of the new Python files; `git diff --check` | clean |
| Workflows | not changed in CP02, so actionlint was not required and was not re-run |
| Backend product suite / image build | not re-run: no product, Dockerfile or workflow input changed; CI re-runs them on the final head |

Rehearsal identities: scratch PostgreSQL `18.3 (Debian 18.3-1.pgdg13+1)` (`postgres@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db`); registry `registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373` bound to 127.0.0.1; API images built from `git archive` of the committed tree (not the working tree), old/candidate/fault differ by revision label or TEST_ONLY layer; last-run digests old `sha256:15c8a059…`, candidate `sha256:f63ca1df…`, fault `sha256:1a70d67a…`; source SHA `8ed5235…`. Every resource was created by this harness, recorded only after a successful create and removed by exact ID/tag; the only pre-existing container on the host (`the-bha-postgres-1`) was never touched. `registry:2` was pulled by this work item's first setup-only run and is removed again (exact reference).

## 5. Findings fixed during the work (evidence)

* Result line lost on the signal path: a signal handler runs inside the interrupted command's `>/dev/null` redirection. RED = the SIGTERM mock test saw empty stdout with exit 30; fixed by saving fds 3/4 and writing the result there; GREEN afterwards.
* `pg_dump` 18 prints a random `\restrict` token per dump, which made the "database unchanged" hash differ on identical data; the token lines are excluded.
* Rehearsal image was built from the working tree; now from `git archive` of the commit.
* Secrets: canaries in the env-file password, passfile and Staff password were searched for in every captured stdout/stderr, the harness log, journals, records and evidence of the last real run, plus the mock runs: none found. Raw `docker inspect` output (which carries the environment) is deleted from the run directory when a run ends; psql stderr is kept only in a private evidence file.

## 6. Limitations and deviations

* **Mock versus real coverage.** Real: topology, gates (list in A1), success, explicit rollback and its idempotency, failure-after-stop restore, lock contention, session continuity, read-only database proof. Mock only: signals, rename/restart-policy/start/stop failures, rollback failure and `recover`, stale record, name collisions, unfinished-journal handling, env-file parser edge cases, psql/libpq hygiene.
* **Image store.** Rehearsal used the containerd image store; EC2 probably uses the classic store (scripts compare image IDs with image IDs on one host only).
* **Operational.** Reboot during the deploy window leaves the service down until `recover` (both containers are `restart=no`); each success leaves one more stopped `-prev-<run>` container; rollback uses the latest record only; `EXPECTED_CURRENT_IMAGE` must be updated after every deploy/rollback (CP03); a crash between `STATE=SUCCEEDED` and the record write makes a later `rollback` refuse as stale; `/health/ready` proves database connectivity only; the full-HostConfig comparison is fail-closed and may reject a container created by a different Docker version or with `-v`.
* **Documented contracts, not inspected live:** EC2 paths/mounts/env, the Docker version and image store on the host, `bha_app`'s `SELECT` on `__EFMigrationsHistory`, host tools (bash ≥ 4.4, python3 ≥ 3.8, psql ≥ 10, flock, timeout, curl), hairpin access to the public name, `/run/lock`.
* **Skills.** `diagnosing-bugs` is not in this session's skill list; the two non-obvious defects (lost result line, random `\restrict` token) were diagnosed by reproduction and trace. `GRAPHIFY_POLICY: NOT_APPLICABLE`, not used.
* **Authorization notes.** `registry:2` was pulled once (loopback registry allowed by the work item); the validator images are the CP01 pinned ones. A tooling slip briefly changed the file mode of two existing tests; reverted. Claude made no AWS/SSM/ECR/RDS/EC2 call and changed no GitHub, Vercel or AWS configuration.

## 7. Status lines

* IMPLEMENTATION_CP02: **PASS** (local acceptance and checks above; final-head CI in the handoff)
* DEPLOY_ISOLATED: PASS · ROLLBACK_ISOLATED: PASS
* REVIEW_CP02: NOT_RUN — OWNER_ONLY
* PUBLISH_LIVE / DEPLOY_LIVE / ROLLBACK_LIVE / SSM_LIVE / CLOUD_WRITES: NOT_RUN
* CP03 / CP04: NOT_STARTED. Backend CD is not complete.

## 8. CP02-C1 — SAFE_RESULT_SERIALIZATION (correction, 2026-10-09)

| | |
|---|---|
| Roles | `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes) |
| Finding (Codex review of `b5eda8f`, forwarded by the Owner) | **[P2] Escape untrusted fields before emitting JSON — `backend-deploy.sh:336-337`**: `emit()` inserted `--image` / `--source-sha` into a `printf` format, so a rejected malformed argument could corrupt the stdout line and `result.json`. Codex could not run the tests (read-only temporary-directory limit): that is not a PASS or FAIL of the suite. OC added: `new_run` wrote the raw values to the key=value `state`/`events` files before the gates ran |
| REVIEW_CP02 before the correction | RUN by the Owner on `b5eda8f`: one P2 finding (above). It is not a review of C1 |
| C1 START_HEAD | `b5eda8f8145ea40dee0d959a9b0fae29ca65f7b5` (= local = remote = PR #94 head, clean tree, base `develop`/`56c8b77`) |
| C1 validation SHA | `541f86b209a93154da1a7bf5f783c7810652f916` — the committed source that the full suite and the real rehearsal below ran on; this report/runbook/SNAPSHOT commit and FINAL_HEAD are in the final handoff |
| PR | https://github.com/emLamHD/The_BHA_hotels_Booking/pull/94 (same Draft PR); actual GitHub additions/deletions and CI runs are in the final handoff. Size reasons are unchanged (section 2): the correction adds one serializer, argument validation and tests |

**Root cause.** Two weaknesses with one source: (1) `emit()` built its JSON with `printf` and the raw `IMAGE` / `SOURCE_SHA` values, which are only validated later by `gate_inputs`; (2) `new_run`, called before the gates, persisted the same raw values into the strict key=value journal, so a value containing a newline could forge journal fields (`STATE=…`) and break `status`/`recover`. The status JSON had the same `printf` pattern.

**Fix (only `backend-deploy.sh`, tests, harness, docs).**
* A real JSON serializer (`json.dumps`, Python already a prerequisite) produces every result and the `status` line; values are passed as argv, never interpolated; same field names, order and types (`exit`, `downtime_seconds` numbers; `running` boolean).
* `result.json` is the same line, written to a private temp file and moved atomically.
* `--image` and `--source-sha` are checked against their exact grammar **in the argument parser**: a malformed value is never stored (variable empty + a flag), the run is rejected by `gate_inputs` with the same documented codes, and the journal, events, records and outputs only ever see validated values or `none`/`""`. A missing option value (`--image` as last argument) now returns a JSON `CONFIG_INVALID/ARGUMENT_VALUE_MISSING` instead of exiting silently.
* `reject` persists a reduced code (`[A-Za-z0-9_.:,-]`).
* Serializer unavailable (python3 missing): a static line from trusted constants; failures keep their own status/exit code; a would-be success becomes `PREREQUISITE_MISSING/SERIALIZER_UNAVAILABLE` exit 3. No recursion into the traps; fd 3/4 handling unchanged.

**RED / GREEN.**
* RED, same tests against the `b5eda8f` scripts (`SCRIPTS_UNDER_TEST` points the suite at an archive of that commit): `test_backend_deploy.HostileInput` 6 tests → **18 failures + 14 errors**; e.g. `--source-sha 'a"b'` printed invalid JSON, and a forged value printed a second physical stdout line.
* GREEN on `541f86b`: the 6 tests pass. They exercise, for `--source-sha` and `--image` independently, double quote, backslash, newline, CR, tab, control characters, forged JSON, forged `STATE=` line, a valid digest/SHA followed by a newline, a secret canary and non-ASCII separators; each combined with an unknown flag, a missing/non-existent `--config`, and the `status/rollback/recover/preflight` commands. Assertions: the **whole** stdout is exactly one physical line and one strict JSON object; `image`/`source_sha` are `""` and nothing is reflected; `result.json` equals stdout and is private; every `state` line matches the strict grammar and has a single `STATE=`; no canary or forged text in any journal file; `status` exits 0 with nothing unfinished and `recover` says `NOTHING_TO_RECOVER`; Docker log shows no stop/start/rename/update and the old container keeps its ID, state and policy. Also: accepted identities are preserved exactly with the published field order and types; python3 missing → valid JSON, exit 3, `MISSING_python3`; serializer failing (python shim) → status as exit 3 and a rejection keeping exit 20.
* The harness now parses every command's stdout strictly (one line, one JSON object), which re-checks all 41 earlier mock tests.

**Checks.** `python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py"` (Python 3.14.4): **117 tests OK** (53 in `test_backend_deploy.py`, 49 release, 15 existing); `bash -n`, ShellCheck v0.10.0 `-x` (pinned image from the CP01 report): exit 0 for every shell script; `py_compile`: ok; `git diff --check`: clean. Workflows were not changed (no actionlint needed).

**Real isolated rehearsal on the committed source `541f86b`** (Docker 29.8.1, PostgreSQL `18.3 (Debian 18.3-1.pgdg13+1)`, loopback registry pinned by digest, API images from `git archive`): **67 checks PASS, 0 FAIL**. Actual success by digest (downtime 3 s), `ALREADY_CURRENT`, explicit rollback to the original container ID and its idempotent repeat, failure after the stop with restore, second success, Staff session continuity through every transition, database dump hash unchanged, no secret canary in any capture, and every command result of the run exactly one valid JSON line (`JSON_BAD=0`). New real checks: hostile `--source-sha` and `--image` (quote, newline, forged `STATE=`/JSON) → exit 20 with one valid JSON line, nothing reflected, strict journal, `status` exit 0, old container untouched. Mock-only: serializer unavailable, python3 missing, signals, and the rest as in section 6. All rehearsal resources were removed by exact ID/tag; no AWS/ECR/SSM/EC2/RDS call.

**Status lines (C1).** IMPLEMENTATION_CP02_C1: **PASS** (local acceptance and checks above; final-head CI in the handoff) · REVIEW_CP02_C1: NOT_RUN — OWNER_ONLY · DEPLOY_ISOLATED: PASS · ROLLBACK_ISOLATED: PASS (both from the C1 rehearsal) · PUBLISH_LIVE / DEPLOY_LIVE / ROLLBACK_LIVE / SSM_LIVE / CLOUD_WRITES: NOT_RUN · CP03 / CP04: NOT_STARTED · backend CD is not complete.
