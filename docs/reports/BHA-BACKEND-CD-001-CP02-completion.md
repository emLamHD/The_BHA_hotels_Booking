# BHA-BACKEND-CD-001-CP02 — completion report (EC2_DEPLOY_ROLLBACK)

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
