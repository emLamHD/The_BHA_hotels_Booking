# BHA-BACKEND-CD-001 — backend release, deploy and SSM wiring (CP01–CP03)

> **Current status (2026-10-09, CP03 implemented — not live).** CP01 (release artifact), CP02 (deploy/rollback engine, rehearsed only on a local isolated stack) and CP03 (disabled-by-default main → SSM wiring, remote result confirmation, concrete Owner setup packet; §10) exist in the repository. CP03 was rehearsed end to end on the same isolated stack with a **mocked** SSM/ECR-login boundary; nothing ran in AWS. Backend continuous delivery is **not** complete: CP04 (Owner live activation) has not started and `PUBLISH_LIVE`, `DEPLOY_LIVE`, `ROLLBACK_LIVE`, `SSM_LIVE`, `CLOUD_WRITES` are `NOT_RUN`. The dated sections below keep the contracts and the evidence of the work item that introduced them (§1–§8: CP01/C1; §9: CP02/C1/C2; §10: CP03).
>
> Owner decisions kept: feature → `develop` for CI, release → `main` for publishing. Target flow after the whole work item: verify exact SHA → immutable ECR image → deploy by digest through SSM → readiness/API checks → rollback of the container on failure. CP01 delivers the first arrow's worth only.
>
> Evidence attribution: the current deployment state (Customer Web, Admin Web and backend deployed and tested; frontends with CI/CD; backend with CI and a manual deployment on EC2 + Docker + Caddy, RDS PostgreSQL 18.3, ECR) is `OWNER_VERIFIED` (2026-10-09), not `CLAUDE_VERIFIED`. It does not say every Admin template module is wired to the backend.

Workflow: `.github/workflows/backend-image.yml`. Helpers: `deploy/showcase/scripts/backend-release-policy.sh` (plan, config validation, image checks, save/load), `backend-ecr-publish.sh` (ECR). Tests: `deploy/showcase/scripts/tests/test_backend_release.py`. One production publishing path exists; it is the `publish-main` job of that workflow.

## 1. Events

| Event | verify + build | `develop` publish | `main` publish |
|---|---|---|---|
| `pull_request` into `develop` or `main` (relevant paths) | yes, PR head | never | never — no AWS step, no OIDC, no environment |
| `push` `develop` | yes | only if `ECR_PUBLISH_ENABLED` is `true`; **not a production release**, nothing is deployed | never |
| `push` `main` | yes | never | only if `BACKEND_RELEASE_PUBLISH_ENABLED` is exactly `true` and verify + build passed |
| any other event or ref | — (not triggered) | never | never |

* Relevant paths (actual filters, both `pull_request` and `push`): `Back_End/**`, `deploy/showcase/**` (includes the helpers and their tests), `.github/workflows/backend-image.yml`, `.github/workflows/ci.yml`. A `main` commit that touches none of them produces no image; deploying such a commit is a CP02 question.
* There is **no** `workflow_dispatch`. Retry a failed publish with "Re-run failed jobs" on the same run (same `github.sha`); no arbitrary ref, SHA or digest can be published. Whether the artifact of an earlier attempt can be downloaded by a re-run job is **untested**; if it cannot, re-run all jobs.
* `ECR_PUBLISH_ENABLED` controls `develop` only; it never enables `main`. `BACKEND_RELEASE_PUBLISH_ENABLED` is checked by the plan job, which runs outside any environment, so it **must be a repository variable**. Unset, empty, `false`, `TRUE`, `1` … all mean disabled; only the exact string `true` enables. Default: disabled.

## 2. Configuration contract

| Lane | Environment | Variables |
|---|---|---|
| `main` (release) | `backend-production` | `BACKEND_RELEASE_AWS_ROLE_ARN`, `BACKEND_RELEASE_AWS_REGION`, `BACKEND_RELEASE_ECR_REPOSITORY` — all three, and **only**, as variables of the environment `backend-production`; never at organization or repository scope |
| `develop` (unchanged) | `showcase-publish` | repository variables `AWS_ECR_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY` |

Main uses these three names only. It never falls back to `AWS_ROLE_ARN`, `AWS_ECR_ROLE_ARN`, `AWS_REGION` or `ECR_REPOSITORY` (those stay the `develop` contract), and there is no alias or default. The `config` step of `publish-main` validates the effective values (present, ARN/region/repository shape) **before** `configure-aws-credentials`, ECR login or any ECR call; a missing value fails the run with the variable name and nothing reaches AWS. `configure-aws-credentials` and the ECR helper then read only that step's validated outputs (`role_arn`, `region`, `repository`), never `vars` again. The registry and account come from `amazon-ecr-login` and must equal the `repositoryUri` ECR reports for the repository; no account ID is hardcoded and no long-lived access key is used (OIDC only; `mask-aws-account-id: false` so the registry host is not dropped from job outputs).

**Scope guard (CP01-C1).** Inside an environment GitHub resolves `vars.X` to the environment value, else the repository, else the organization value, so a missing environment value cannot be told apart from an inherited one by looking at the effective value. The `plan` job has no environment, so for the three release names it sees only inherited (organization/repository) values and passes **booleans** (`inherited_*_set`, never the values) to `publish-main`. When main publishing is enabled, the `config` step refuses the run if any of the three names has an inherited value — even when `backend-production` also defines a valid override — or if that information is absent or not an exact `false`. The message names the variable and the policy, not the value. A pull request, `develop`, or main with the flag off never evaluates this guard and does not depend on production setup. Remaining limit: the guard sees organization/repository variables through the `vars` context only; it cannot prove that the environment itself holds the right account/region/repository — the role's IAM scope (§6) remains the control for that.

## 3. Job outputs (publish job)

`source_sha` (full 40-hex commit), `ecr_repository` (the repository **name**), `image_uri` (`<registry>/<repository>:<full SHA>`), `image_digest` (`sha256:` + 64 hex, read back from the registry by repository + SHA tag and equal to the digest `docker push` reported). The step summary also lists `<registry>/<repository>@<digest>`, the run ID/attempt and the local Docker image ID. The Docker image ID (config identity) and the ECR manifest digest are two different identities; deploy by digest.

## 4. Exact SHA, build once, provenance

* A push builds `github.sha` only; PRs build the PR head and the summary says "tested source SHA", never "main release". Every job checks out `ref: <full SHA>` and asserts `git rev-parse HEAD` equals it. The publish job does not check out a moving branch.
* The image is built **once** per run (`build` job): labels `org.opencontainers.image.revision=<full SHA>` and `org.opencontainers.image.source=<server URL>/<repository>` are set at build time and re-read from the built image. The non-root check and the Production key-path guard run on that image.
* On every event the job then does `docker save` → `docker rmi` → `docker load` and re-checks image ID and labels, so identity across save/load is exercised on the runner even when nothing is published. When a publish will follow, the same directory (`image.tar` + `metadata.json`) is uploaded as `backend-image-<SHA>-<run id>-<attempt>` (retention 3 days).
* The publish job downloads that artifact by the name in the build job's outputs (current run only: no `run-id`/token input), verifies the tar's SHA-256 against the **build job output**, the metadata (SHA, run ID, image ID), loads it, and compares image ID, revision and source label again. It never rebuilds.

## 5. ECR policy

* The repository must exist and report `imageTagMutability` exactly `IMMUTABLE` (`MUTABLE`, `*_WITH_EXCLUSIONS` and describe errors fail before any push). CP01 does not change cloud policy.
* Tag lookup uses `describe-images`. The tag is absent **only** on exit status 254 with `(ImageNotFoundException) when calling the DescribeImages operation`. `AccessDenied`, `RepositoryNotFoundException`, network/timeouts, bad region, malformed output → the run fails.
* An existing tag is never overwritten, deleted, re-tagged or reused: CP01 has no trusted-provenance mechanism, so it **fails closed on every existing tag**. Limitation: if a publish succeeded and the job then failed (or the run is re-run), the retry fails on the existing tag; verify the existing image by digest by hand (CP02/CP03 may add a provenance check).
* Check-then-push races are handled by immutability: a rejected duplicate push fails the job and is not turned into success by re-reading the tag.
* After the push the digest is read back; empty, `None`, non-`sha256:<64 hex>` or different from the pushed digest → fail.

## 6. Cloud prerequisites the Owner creates (nothing here was done by Claude)

1. GitHub: environment `backend-production` with **deployment branches restricted to `main`**; branch protection on `main`; environment variables `BACKEND_RELEASE_AWS_ROLE_ARN`, `BACKEND_RELEASE_AWS_REGION`, `BACKEND_RELEASE_ECR_REPOSITORY` — defined **only** there, not at organization or repository scope (a value there blocks the release). Keep `BACKEND_RELEASE_PUBLISH_ENABLED` unset until the Owner chooses to enable it (repository variable).
2. ECR repository with tag immutability `IMMUTABLE`.
3. IAM role for GitHub OIDC (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`). Ordinary subject for the environment: `repo:emLamHD/The_BHA_hotels_Booking:environment:backend-production`. **Verify the actual `sub` of a real token** (a customised subject template or immutable repository/owner IDs change its format) before writing the condition. The environment subject does not by itself restrict the branch: add the `main` restriction on the environment (above) and, where the claims allow, a `job_workflow_ref`/`ref` condition. The existing `showcase-publish` trust does not cover `main`; do not widen it.
4. Role permissions, scoped to that one repository ARN: `ecr:DescribeRepositories`, `ecr:DescribeImages`, `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`; plus `ecr:GetAuthorizationToken` on `*`. No delete/batch-delete, no `ecr:PutImageTagMutability`. IAM/SSM wiring for deployment is CP03.

## 7. Local checks (what CP01 ran; no cloud)

```bash
python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py" -v     # stubs for aws/docker, no daemon needed
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.7 -color=false .github/workflows/ci.yml .github/workflows/backend-image.yml
docker run --rm -v "$PWD":/repo -w /repo koalaman/shellcheck:v0.10.0 -x deploy/showcase/scripts/backend-*.sh
```

Backend suite: a scratch `postgres:18.3` container on its own name/port and `ConnectionStrings__TheBhaDatabase` pointing at it (never RDS), then restore, `build --configuration Release --no-restore`, `test --configuration Release --no-build`. The integration tests create and drop their own databases on the server they are given.

## 8. Not done / limitations

* No deploy, no rollback, no SSM/IAM, no live publish; CP02 (EC2 deploy/rollback), CP03 (SSM/IAM wiring) and CP04 (Owner live activation) remain.
* Concurrency (`cancel-in-progress: false` for pushes and for the main publish job) is not a queue: a waiting run can be replaced by a newer one, so not every intermediate `main` SHA is published and order is not guaranteed FIFO.
* Actions are referenced by version tag (`actions/*@v4`, `aws-actions/*@v4|v2`), as before; SHA pinning is not part of CP01.
* `develop` lane behavior changes (deliberate): the publish job no longer rebuilds, an existing tag now fails instead of being reused silently, tag-lookup errors are no longer swallowed, config is validated in the publish job instead of the plan job, and the backend suite now runs on every event.
* A `pull_request` image is built from the PR head, not from the merge result.

## 9. CP02 — EC2 deploy / rollback engine (isolated rehearsal only)

> Status 2026-10-09. `backend-deploy.sh`, `backend-migration-preflight.sh` and `backend-migration-manifest.py` exist and were rehearsed on a **local isolated** Docker + PostgreSQL 18.3 stack. They were **not** run on the EC2 host, against RDS, ECR or SSM. `DEPLOY_LIVE`, `ROLLBACK_LIVE`, `SSM_LIVE`, `CLOUD_WRITES`: `NOT_RUN`. CP03 (SSM/IAM/workflow wiring) and CP04 (Owner live activation) have not started; backend CD is not complete. Every production path below is the **documented contract** (runbook `CUST-WEB-SHOWCASE-001` §7b/§11), not something inspected in this session.

### 9.1 CLI

```
backend-deploy.sh preflight --config F --image REPO@sha256:DIGEST --source-sha FULLSHA --manifest FILE
backend-deploy.sh deploy    --config F --image REPO@sha256:DIGEST --source-sha FULLSHA --manifest FILE
backend-deploy.sh rollback  --config F      # previous release, from the latest protected record
backend-deploy.sh recover   --config F      # finish/undo an interrupted run (always returns to the PREVIOUS release)
backend-deploy.sh status    --config F      # read-only, no lock
backend-migration-manifest.py generate --repo DIR --source-sha SHA [--output F]   # at release time, from a clean checkout of SHA
backend-migration-preflight.sh ...                                               # called by deploy/preflight; usable alone
```

`preflight` runs every pre-stop gate (it pulls the digest, but creates/stops/changes no container and touches no env, key, CA or database state). `deploy` = the same gates, then create-before-stop, a bounded-downtime swap, checks and rollback on failure.

Exit codes (each run also prints one JSON line `{"status","detail","exit","command","run_id","target","image","source_sha","candidate_id","previous_id","downtime_seconds"}`; `detail` is a code, never a value):

| Exit | Status | Meaning |
|---|---|---|
| 0 | `PREFLIGHT_PASS` `SUCCESS` `ALREADY_CURRENT` `ROLLED_BACK` `ALREADY_ROLLED_BACK` `RECOVERED` `STATUS` | `ALREADY_CURRENT` still runs readiness, API, schema-history, env and preservation checks |
| 2 | `CONFIG_INVALID` | arguments, host config or manifest malformed |
| 3 | `PREREQUISITE_MISSING` | a host tool, the Docker daemon, the lock directory or psql is missing |
| 20 | `REJECTED_BEFORE_STOP` | a gate failed; the old container was not touched (or the run aborted before the stop) |
| 30 | `DEPLOY_FAILED_ROLLED_BACK` | failure after the stop; the previous container serves again and was re-verified. Never a success |
| 40 | `ROLLBACK_FAILED` | evidence and identities kept; run `recover` or follow §9.6 |
| 50 | `LOCK_BUSY` | another deploy/rollback/recover holds the per-target host lock |
| 60 | `INTERRUPTED_STATE` | an unfinished journal run, or a container labelled for the target that no finished journal accounts for |

Result semantics (CP02-C1): stdout is **exactly one physical line holding one JSON object** for every invocation, including rejections, early errors, prerequisite failures and signal paths; every field is produced by a JSON serializer (values are passed as arguments, never interpolated), `exit` and `downtime_seconds` are numbers and `running` (status) is a boolean. `result.json` in the run directory is the same line, written privately and atomically. `--image` and `--source-sha` are validated against their exact grammar while the arguments are parsed: a malformed value is **never stored or reflected** (the field stays `""`, the run is rejected with `IMAGE_NOT_A_DIGEST_REFERENCE` / `SOURCE_SHA_MALFORMED`), so it cannot reach the journal, the events log, the records or the output. A valid digest/SHA is reported exactly as accepted. If the serializer (python3) is unavailable the line is built from trusted constants only, keeps the failure's own status and exit code, and a would-be success is reported as `PREREQUISITE_MISSING` / `SERIALIZER_UNAVAILABLE` (exit 3), never as success. Codes persisted in the journal are reduced to `[A-Za-z0-9_.:,-]`.

### 9.2 Host config (data file, never sourced)

Private (`0600`/`0400`, owned by the caller), `KEY=VALUE`, unknown/duplicate keys refused. Required: `TARGET_CONTAINER ALLOWED_IMAGE_REPOSITORY EXPECTED_SOURCE_URL EXPECTED_CURRENT_IMAGE LOOPBACK_PORT ENV_FILE KEYS_DIR CA_FILE JOURNAL_DIR PG_SERVICE_FILE PG_PASS_FILE PG_SERVICE PG_EXPECT_HOST PG_EXPECT_DB PG_EXPECT_USER API_BASE_URL`. Optional: `API_CA_FILE PSQL_BIN READY_TIMEOUT_SECONDS(60) REQUEST_TIMEOUT_SECONDS(5) LOCK_WAIT_SECONDS(20) STOP_TIMEOUT_SECONDS(30) DOCKER_TIMEOUT_SECONDS(120) PREFLIGHT_TIMEOUT_SECONDS(30)`. The old production digest is not hardcoded: `EXPECTED_CURRENT_IMAGE` is supplied per release and its local image ID must equal the running container's image ID (IDs are compared with IDs, never with digests). It must be updated after every deploy or rollback (the CP03 release packet's job).

Release inputs bind together: `--image` must be `ALLOWED_IMAGE_REPOSITORY@sha256:…` (no tag); `--source-sha` is the full SHA; the manifest's `source_sha` must equal it; the image's `org.opencontainers.image.revision` must equal it and `…source` must equal `EXPECTED_SOURCE_URL`; the image must not run as root.

Supported runtime shape of `TARGET_CONTAINER` (anything else is refused before the stop): default/bridge network; `127.0.0.1:LOOPBACK_PORT → 8080/tcp`; exactly two bind mounts, created with `--mount` (`KEYS_DIR → /var/keys` rw, `CA_FILE → /certs/rds-ca.pem` ro), canonical paths; env = image defaults + `ENV_FILE`; image entrypoint/cmd/user/working dir; log driver/options; restart policy; caps, security options, read-only rootfs, memory/swap/cpus/pids. After `docker create` the **full HostConfig and Config** of the candidate are compared with the old container's (null/false/0/empty are the same value); only the restart policy is excluded, because the candidate is created with `--restart=no` and the original policy is applied and re-verified after every check passed. A container that was created with `-v` (Binds instead of Mounts) is refused, by design.

### 9.3 Gates before the old container is stopped

1. config + prerequisites; per-target `flock` lock (`/run/lock/bha-deploy-<target>.lock`, never deleted, independent of the config file; `BHA_DEPLOY_LOCK_DIR` exists for tests only); no unfinished journal run; no unaccounted labelled container (refuse only, never delete by scanning).
2. image/SHA/manifest binding (above); `docker pull` of the digest; the digest must appear in the image's `RepoDigests`.
3. current container: running, ID recorded, image ID equals `EXPECTED_CURRENT_IMAGE`'s.
4. **migration-history gate** (`backend-migration-preflight.sh`): application identity through a libpq service file + passfile (private), `sslmode=verify-full` against the same CA file that is mounted into the API container, sanitised `PG*` environment (no inherited variables, no system `pg_service.conf`), `BEGIN READ ONLY` with statement/lock timeouts. In-session assertions: database, session user, TLS in use, `transaction_read_only = on`. The full ordered list of applied IDs must equal the manifest exactly. Pending, unknown, missing history, permission, TLS, connection, timeout and query failures all stop the run. Nothing is migrated, repaired, seeded or altered — not even in a rolled-back transaction. History equality proves migration compatibility only, not the absence of manual schema drift; a release that needs a schema change is refused until a separate Owner migration procedure has run. Container rollback never rolls back the database.
5. runtime shape (above), env check (every `ENV_FILE` value equals the running container's value; no variable that is in neither the file nor the old image defaults; base-image version variables `DOTNET_VERSION ASPNET_VERSION DOTNET_SDK_VERSION` may differ, any other image-default change is refused; `ENV_FILE` is parsed strictly — leading whitespace, BOM, CR, lines without `=` and duplicate names are refused, dotted names are valid, the value is everything after the first `=`), key ring present and hashed **inside the container** (owner uid 1654, mode 0600), CA read-only, `ENV_FILE`/`CA_FILE` sha256 and stat recorded.
6. candidate created (not started) under a unique run name with run/target labels, from a private copy of the env file that is parsed and passed to docker, then deleted; its identity, labels, runtime profile and env are compared before the stop.

`/health/ready` is an `AddDbContextCheck` on PostgreSQL: it proves database connectivity only, not schema compatibility. The release checks are readiness **plus** the history gate **plus** the API GETs.

### 9.4 Swap, checks, rollback

State machine (journal `JOURNAL_DIR/runs/<run>/state`, rewritten atomically before each destructive step): `STARTED → GATES_PASSED → STOP_INTENT → OLD_STOPPED → NAMES_SWAPPED → CANDIDATE_STARTED → VERIFIED → SUCCEEDED`; failure: `REJECTED` (before the stop) or `RESTORING → ROLLED_BACK | ROLLBACK_FAILED`; explicit rollback ends in `ROLLBACK_DONE`. Terminal states: `SUCCEEDED REJECTED ROLLED_BACK ROLLBACK_DONE ALREADY_CURRENT_DONE`; anything else blocks the next run (exit 60).

Sequence: record the original restart policy → `docker update --restart=no` on the old container → `docker stop` → rename old to `<target>-prev-<run>` → rename the candidate to `<target>` → `docker start` the candidate → checks → apply the original restart policy to the candidate and re-read it → write the record. The old container is never removed and stays stopped with `restart=no`. The shared host port makes this **bounded downtime**, not zero downtime (3–4 s measured in the rehearsal).

Checks after the start: container running with the expected ID/image ID; `/health/ready` = 200 and body `Healthy` within `READY_TIMEOUT_SECONDS` (no redirect followed); `GET /api/v1/properties` = 200 with the JSON contract; unauthenticated `GET /api/admin/v1/me` = 401 through `API_BASE_URL` (HTTPS via the trusted proxy; a 404 means the forwarded scheme is not trusted — never fix that by faking headers); mount access as the container user; every pre-existing key file still present with identical content; effective env = candidate image defaults + env file; `ENV_FILE`/`CA_FILE` unchanged. No login, booking or other write is attempted; no `curl -k`.

Any failure after `STOP_INTENT` runs `restore_previous`, which **inspects what Docker actually shows** and performs only the missing steps (stop the failed container, rename it to `<target>-failed-<run>`, rename the previous one back, restore its restart policy, start it, re-verify it). The failed candidate is kept stopped as evidence. A name held by an unrelated container is never taken over (`ROLLBACK_FAILED`, `TARGET_NAME_OCCUPIED`).

`rollback` works from `records/latest` only and refuses (20) when the record is stale — the container named after the target is not the recorded one — when the previous container is not in its recorded state, when the database history no longer equals the recorded manifest, or when the previous container no longer matches the current env file (all checked **before** anything is stopped). A second `rollback` reports `ALREADY_ROLLED_BACK` after re-verifying the serving container.

### 9.5 Prerequisites (documented contracts, not live inspections)

bash ≥ 4.4, python3 ≥ 3.8, docker, flock, timeout, curl, sha256sum, and a libpq `psql` ≥ 10 (the gate uses `\if`) on the host; `/run/lock` exists; the host reaches its own public HTTPS name (hairpin) for the API checks; `bha_app` has `SELECT` on `public."__EFMigrationsHistory"` (runbook `CUST-WEB-SHOWCASE-001` §11 step 8 grants `SELECT` on all tables in `public`; not verified live — if it is missing the gate fails closed with `PERMISSION_DENIED` and CP04 must fix the grant, not the gate); private service file + passfile + CA for the read connection (templates in the rehearsal harness). Nothing is installed by these scripts.

### 9.6 Interrupted runs and recovery

`EXIT/INT/TERM/HUP` are handled with bounded time: before the stop the run is rejected; after it, the previous container is restored. A `SIGKILL`, kernel panic or power loss cannot be handled: the journal is left in a non-terminal state, every later run refuses with exit 60, and `status` shows it. `recover` then inspects Docker, undoes the run (it never *completes* a deploy) and exits 0 only when the previous release serves again and was re-verified. **A reboot during the deploy window leaves the service down**: both containers have `restart=no` until the original policy is applied at the end, so nothing restarts by itself — run `recover`. If `recover` reports `ROLLBACK_FAILED`, the identities in the journal (`state` file) and the retained containers are the recovery material: `docker start` the previous container ID after renaming it back to the target name and restoring its recorded restart policy by hand. A crash between `STATE=SUCCEEDED` and the record write leaves the earlier record in place: a later `rollback` then refuses as stale (safe, but the tool cannot roll that deployment back).

Transient evidence (CP02-C2): raw `docker inspect` and `docker image inspect` output (container and image `Config.Env` can hold secrets) and the private copies of the env file are removed, by exact file name, from the run's verified, owned evidence directory when **any** run ends — success, rejection, rolled-back failure, explicit rollback, `recover`, handled signal, serializer fallback — and the `preflight`/`status` temporary directories are deleted. Files: `old.json new.json cand.json cand-final.json cand-remove.json restore.json verify.json .field.json c.json old-image.json cand-image.json verify-image.json env.snapshot env.verify`. What recovery needs is never raw environment and stays: `state`, `events`, `result.json`, `records/`, and `evidence/{expected.ids,keys.pre,profile.old,profile.cand,preflight.json,*.err}`; `evidence/candidate.log` (last log lines of a candidate that failed its checks) is kept privately for diagnosis and is not inspect output. If a file cannot be removed (or the evidence directory is a symlink or not owned), the deployment outcome is **unchanged** — same `status` and exit code — but the result `detail` gains the suffix `__EVIDENCE_CLEANUP_FAILED`, the journal gets `EVIDENCE_CLEANUP=FAILED`, and a warning naming the directory (no content) goes to stderr; remove the listed files by hand. A `SIGKILL` or reboot cannot run the cleanup: the raw files stay in that run's private (`0700`) directory until `recover` finishes the run and scrubs them; historical runs are not scrubbed in bulk.

### 9.7 Limitations

Rollback uses the latest record only; each successful deploy leaves one more stopped `-prev-<run>` container that nothing removes; the rehearsal ran on a containerd image store whereas the EC2 host probably uses the classic store (the scripts compare image IDs with image IDs on the same host only); the release manifest/packet transfer, provenance validation and SSM orchestration are CP03; the live runtime shape is unverified until CP04.

## 10. CP03 — main → SSM deployment wiring (implemented, disabled by default, not live)

### 10.1 Flow and gates

`push` to `main` → (CP01) plan → verify + build → `publish-main` → **`deploy-main`**, in the same run and only with this run's own outputs (`source_sha`, `image_uri`, `image_digest`). There is no `workflow_dispatch` and no input: no ref, SHA or digest can be supplied by a caller, nothing is rebuilt, no "latest" tag is queried, no artifact of another run is used.

| Switch / variable (all `backend-production` **environment** variables unless stated) | Meaning |
|---|---|
| `BACKEND_RELEASE_DEPLOY_ENABLED` (**repository** variable) | exactly `true` enables the deploy job; unset/empty/anything else = off. Needs `BACKEND_RELEASE_PUBLISH_ENABLED=true` too: enabled without publishing fails the plan job with a clear error before any AWS step |
| `BACKEND_RELEASE_DEPLOY_AWS_ROLE_ARN` | the deploy role (not the publish role): OIDC → `SendCommand` + result reads |
| `BACKEND_RELEASE_EC2_INSTANCE_ID` | exactly one instance, `i-` + 17 hex; no tags, no fleets |
| `BACKEND_RELEASE_HOST_CONFIG_PATH` | absolute path of the private CP02 host config on that instance |
| `BACKEND_RELEASE_AWS_REGION` | reused from CP01 (same environment variable) |

The three new names follow the C1 pattern: the `plan` job (no environment) reports booleans for inherited organization/repository values; the deploy configuration gate refuses an inherited value even if the environment also defines one, any missing or malformed value, and any scope indicator that is not exactly `false`, **before** OIDC or SSM; nothing downstream reads `vars` again; the deploy role, the publish role and the registry of the published image must belong to one AWS account, and the published image must be the SHA-tagged image of this run. Pull requests, `develop` and a main push with the deploy switch off never evaluate any of this.

Before anything is sent, `deploy-main` checks that its commit is still the tip of `main` (`git ls-remote`): a stale run never deploys, so re-running an old run later cannot act as an implicit rollback. Race limit: `main` can advance between that read and the swap; the host lock plus the engine's exact-history and expected-current gates are the controls for that window. `deploy-main` has job-level `concurrency` with `cancel-in-progress: false`, 40 minutes `timeout-minutes`, `permissions` `contents: read` + `id-token: write`; the workflow-level group already never cancels push runs. Concurrency is not a queue: a waiting run can be replaced by a newer one, so not every intermediate `main` SHA is built or deployed and the order is not guaranteed FIFO. The host lock serialises actual changes.

### 10.2 Exact release packet and transport

`backend-release-packet.py generate` builds `packet.json` from the **git objects** of the exact full SHA (HEAD asserted, tracked files clean): repository, SHA, the digest reference (`repository@sha256:…` derived from the published URI), run id/attempt, the SHA-256 and size of each of four allowlisted scripts (`backend-remote-release.sh`, `backend-deploy.sh`, `backend-migration-preflight.sh`, `backend-migration-manifest.py`) and the migration manifest of that commit. The runner computes every hash; the hash of the packet is sent in the command itself, never fetched from the remote endpoint.

`backend-ssm-release.py` sends **one** `AWS-RunShellScript` command to exactly one instance (`--instance-ids`, `--max-concurrency 1 --max-errors 0`, no `--targets`, no CloudWatch/S3 output export): a short bootstrap whose only inputs are validated constants (SHA, repository, correlation, packet SHA-256, host-config path, region, action) plus the base64 packet. On the host the bootstrap verifies the packet bytes, downloads exactly the four allowlisted paths over HTTPS from `raw.githubusercontent.com/<repository>/<full SHA>/…` (public repository, immutable SHA, fixed host, no redirects, size-capped) into a private staging directory (`/var/lib/the-bha/release-staging/<correlation>`, owned, not a symlink), verifies each SHA-256 against the runner's packet **before** anything is executed, then runs the wrapper. A mismatch, missing file or bad packet exits with a single JSON line (`BOOTSTRAP_FAILED`), removes the staging directory and never reaches the engine or the serving container. No S3 bucket or registry is created; images never travel through SSM.

### 10.3 Host wrapper (`backend-remote-release.sh`)

* Reuses the CP02 engine unchanged (`backend-deploy.sh deploy|rollback|recover`, exact image/SHA/manifest binding, migration READ ONLY gate, create-before-stop, readiness/API checks, container rollback, C1 one-line JSON, C2 evidence cleanup). Automatic rollback is the engine's job when a deploy fails; the wrapper never rolls back or recovers on its own, and a lost connection does not trigger either.
* Takes an outer per-target release lock (`bha-release-<target>.lock`, different from the engine's `bha-deploy-<target>.lock`; bounded wait 30 s) around reading and validating state, the engine call and the metadata commit.
* ECR pull login uses the **instance profile** (`aws ecr get-login-password | docker login --password-stdin`) into a private `DOCKER_CONFIG` inside the staging directory that is deleted with it; the runner's OIDC credentials never reach the host; the registry must be `<account>.dkr.ecr.<region>.amazonaws.com` of the validated region and the repository the configured one, else it fails before the engine.
* A watchdog `timeout --preserve-status -s TERM -k 300 900` surrounds the engine: on TERM the engine restores the previous container and prints its own result; only a KILL after the grace leaves no result (`ENGINE_TIMEOUT`).
* **EXPECTED_CURRENT_IMAGE ownership.** The Owner supplies the first value once (the digest verified in CP04). After that only the wrapper advances that one line, by atomic private replacement (temp file in the same directory, fsync, concurrent-modification check, rename), after it reconciled the **actual** container: image ID, `RepoDigests` entry, revision label (deploy) and the engine record (`SUCCEEDED`, same container ID and SHA). A second private file, `release-state` in the journal directory, holds `CURRENT_IMAGE`, `PREVIOUS_IMAGE` and a `PENDING` intent written before the engine runs. Disagreements are never guessed: unreadable state, a config that differs from the state, a running container that is not the expected image, or a pending intent that does not match the evidence stop with `STATE_RECONCILE_REQUIRED` before the engine runs. A crash between swap, record and metadata leaves `PENDING`; the next run completes it only when the record and the running container prove the swap, otherwise it stops. A config write that fails after a successful swap reports `STATE_SYNC_FAILED` and states which release is serving.
* stdout is exactly one JSON line (`v`, `correlation`, `command`, `source_sha`, `image`, `target`, `release`, `detail`, `engine_status`, `engine_exit`, `run_id`, `downtime_seconds`, `state_sync`, `reverified`, `cleanup`); raw subprocess output goes to a private log (`<journal>/release-logs/<correlation>.log`), stderr carries codes only. No inspect output, env, `candidate.log` or secrets are sent anywhere.

### 10.4 What counts as a release PASS (runner)

`backend-ssm-release.py` polls the saved `CommandId` + `InstanceId` with `GetCommandInvocation` and confirms the result. A PASS needs **all** of: the invocation's identity (CommandId, InstanceId, `AWS-RunShellScript`, plugin `aws:runShellScript`); a terminal `Success`/`Success` with `ResponseCode` 0; exactly one line of valid JSON in stdout (shorter than the 24,000-character truncation) with the exact schema and types, the requested correlation, command, SHA and digest reference; an engine outcome `SUCCESS` or `ALREADY_CURRENT` (deploy; `ROLLED_BACK`/`ALREADY_ROLLED_BACK` for rollback, `RECOVERED` for recover) with engine exit 0; `state_sync` OK; `reverified` true; `cleanup` OK and no `__EVIDENCE_CLEANUP_FAILED`. SendCommand accepted, an aggregated `Success`, or exit 0 on their own are never a pass.

| Client exit | Outcome | Meaning |
|---|---|---|
| 0 | `PASS` | all of the above |
| 10 | `RELEASE_FAILED` | the remote reported a failure: `FAILED_ROLLED_BACK` (the old service was restored and re-verified — still a failed release), `ROLLBACK_FAILED`, `LOCK_BUSY`, `INTERRUPTED_STATE`, `REJECTED`, `BOOTSTRAP_FAILED`, delivery timed out (nothing ran) … |
| 11 | `RELEASE_INCOMPLETE` | the service outcome is as reported but the evidence cleanup, the state sync or the re-verification did not finish; the deployment outcome is not rolled back for that |
| 12 | `RESULT_INVALID` | terminal invocation whose result cannot be confirmed (missing/multiple/truncated/invalid JSON, wrong identity, inconsistent Status/ResponseCode) |
| 20 | `REMOTE_RESULT_UNKNOWN` | ambiguous SendCommand (never resent), poll deadline, `ExecutionTimedOut`/`Cancelled`, runner cancelled, repeated poll failures — the CommandId, instance and correlation are saved and **concrete read-only reconciliation steps** are printed |
| 30 | `NOT_SENT` | validation or a definite SendCommand refusal (`AccessDenied`, `InvalidInstanceId`, `ValidationException`, …) |

Polling retries only `GetCommandInvocation` reads: `InvocationDoesNotExist` within 60 s of the send (the Run Command API is eventually consistent), a bounded number (5) of transport errors; `AccessDenied`, `InvalidInstanceId`, `InvalidCommandId` and anything else are never treated as "not found" or success. A send whose outcome is unknown (timeout, no response, unreadable response, unknown error) is **never** resent.

Timeout budget (seconds, one place: `backend-ssm-release.py`): remote overhead 240 (4 downloads × 30, ECR login 30, lock wait 30, state sync 30, re-verify 30) + engine watchdog 900 + TERM-to-KILL grace 300 = 1440 < SSM `executionTimeout` 1500; delivery timeout `--timeout-seconds` 120 (the AWS minimum is 30); total command timeout 120 + 1500 = 1620 (per the SSM user guide, delivery timeout + execution timeout); the poll deadline is 120 + 1500 + 120 margin = 1740; the Actions job allows 2400 (40 minutes). Tests assert these orderings.

### 10.5 Retry, cancellation and the limits that remain

* A failed or unknown run is **not** retried by re-sending: reconcile read-only first (steps in the client output): `aws ssm get-command-invocation`, the host's `backend-deploy.sh status`, `docker inspect` of the target, `release-state` and `records/latest`. An unfinished engine journal keeps blocking CP02 (exit 60) until the recover command of the same wrapper has run.
* Deploy-only retry of the same run (workflow "Re-run failed jobs") reuses the published outputs only if GitHub keeps them; that GitHub re-run behavior is **not** proven by anything here. A re-run of an old run whose commit is no longer the tip of `main` is refused. Re-running `publish-main` fails closed on the existing immutable tag (CP01) and never overwrites or reuses it. If a case cannot be retried safely the path is: reconcile, then ship a new commit; there is no arbitrary-digest dispatch.
* Explicit rollback and recover use the same wrapper (the Owner runs the client with a packet generated with `--no-image`): rollback is **latest-record only** (`records/latest`), never an older digest; the config follows only after the engine record and the running container confirm it.
* A cancelled Actions job does not stop the remote command: the client reports `REMOTE_RESULT_UNKNOWN`, keeps the CommandId and exits; the remote engine keeps its own watchdog and journal.
* `AWS-RunShellScript` runs arbitrary shell as root on the node: scoping `SendCommand` to one instance and one document does **not** restrict what is executed. The controls are the `main`-only environment, the branch protection, the deploy role's narrow trust and permissions, the hash-verified immutable-SHA packet, and the host's own allowlist/hash checks. IAM cannot enforce "deploy only".
* A document-only advancement of `main` (a push that changes none of the release paths) produces no image and no deployment; the host keeps serving the previous digest until a later release.
* CP02 engine limitation found while rehearsing CP03 (not changed here, outside CP03's allowed files): if the host lacks `psql`, the engine ends the run with `PREREQUISITE_MISSING` (exit 3) but leaves its journal run in `STARTED`; the next run refuses with exit 60 until `recover` (safe, one command). A later CP02 correction can mark that run `REJECTED`.
* Not proven live: the real SSM Agent behavior, the real ECR login, the instance's egress to `raw.githubusercontent.com`, GitHub re-run semantics, the real IAM evaluation. Resource-level permission of `GetCommandInvocation` could not be confirmed from the AWS documentation fetched for this work item (the Run Command guide lists `ListCommands` and `ListCommandInvocations` with `Resource: "*"`); the template therefore grants the three read actions on `*`, and they reveal command status/output of any command in the account that the role can name — keep the account's Run Command usage in mind.

### 10.6 Owner setup packet (CP04; nothing below has been applied)

Placeholders are in `<ANGLE_CAPS>`; every value is the Owner's. Order matters; flags stay off until step 10.

1. **GitHub environment and rules.** Environment `backend-production`: deployment branches = `main` only; add required reviewers if wanted. Branch protection on `main`. Do not create any of the new variables at repository or organization level.
2. **Verify the real OIDC subject** before writing the trust. Default for an environment job: `repo:<OWNER>/<REPO>:environment:backend-production`; a customised subject template or the immutable-ID format (`repo:<OWNER>@<ID>/<REPO>@<ID>:environment:…`, repositories created after the GitHub cut-over or opted in) changes it. Capture a real token's `sub` with the CP04 probe (§11.4, step P1-D) — a throw-away run in that environment (never print other claims) and put exactly that string in `<VERIFIED_SUB_CLAIM>`. AWS only supports `aud` and `sub` for GitHub in trust conditions (the GitHub doc: custom claims are unavailable in AWS) — the template uses nothing else. The environment subject does not replace the `main`-only branch rule of step 1; the existing `showcase-publish` trust does not cover this role.
3. **Deploy role** (`deploy/showcase/iam/backend-release-deploy-trust.json` + `backend-release-deploy-policy.json`): create the role `<DEPLOY_ROLE_NAME>` with that trust and inline policy; fill `<ACCOUNT_ID>`, `<REGION>`, `<INSTANCE_ID>`. `SendCommand` is limited to the `AWS-RunShellScript` document ARN and the one instance ARN; the three read actions are `Resource: "*"` (see 10.5). No ECR, no publish, no DB permission.
4. **Instance profile** of `<INSTANCE_ID>`: keep `AmazonSSMManagedInstanceCore` (SSM Agent running and registered; the node must be a managed node) and attach `backend-release-instance-ecr-policy.json` (pull of `<ECR_REPOSITORY>` + `GetAuthorizationToken` on `*`; no `PutImage`, no upload actions). Egress from the instance to the SSM endpoints, ECR (`<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com` and S3 layers), `raw.githubusercontent.com:443` and the RDS endpoint; `/run/lock` and `/var/lib/the-bha` writable by root.
5. **Host prerequisites** (documented contract, audit them): bash ≥ 4.4, python3 ≥ 3.8, docker, flock, timeout, curl, sha256sum, `aws` CLI v2 (for the ECR login), `psql` ≥ 10; the engine's own prerequisites in §9.5.
6. **Host config and libpq files** (private, root, mode 600): the CP02 host config (§9.2) at `<HOST_CONFIG_PATH>`, with `EXPECTED_CURRENT_IMAGE=<BOOTSTRAP_DIGEST_REFERENCE>` — the digest reference of the container that serves **now**, verified by you: `docker inspect -f '{{.Image}} {{.Config.Image}}' the-bha-api` against `docker image inspect <reference> -f '{{.Id}}'`. `EXPECTED_SOURCE_URL=https://github.com/<OWNER>/<REPO>` must equal the repository of the packet. Also the libpq service file, passfile and CA of §9.3 step 4.
7. **Runtime audit before the first release** (read-only): `backend-deploy.sh status`; container name/port/mounts/env file/restart policy/log driver as in §9.2; keys directory non-empty; `docker image inspect` of the bootstrap digest works locally.
8. **Environment variables** in `backend-production`: the six names in total: the three CP01 names (`BACKEND_RELEASE_AWS_ROLE_ARN`, `BACKEND_RELEASE_AWS_REGION`, `BACKEND_RELEASE_ECR_REPOSITORY`) and the three CP03 names above (`BACKEND_RELEASE_DEPLOY_AWS_ROLE_ARN`, `BACKEND_RELEASE_EC2_INSTANCE_ID`, `BACKEND_RELEASE_HOST_CONFIG_PATH`); the two on/off switches are repository variables, not environment ones.
9. **Disabled verification:** with both flags still unset, merge a release-path change to `main` (or inspect a PR run): plan reports `publish=false deploy=false`; `publish-main` and `deploy-main` are skipped.
10. **Activation order:** set `BACKEND_RELEASE_PUBLISH_ENABLED=true`, release once (CP01 publish only) and check the digest in ECR; then set `BACKEND_RELEASE_DEPLOY_ENABLED=true`; the next release publishes and deploys. Never set the deploy flag alone.
11. **First release checks:** the client summary says `PASS`; `docker inspect` shows the new digest; `EXPECTED_CURRENT_IMAGE` in `<HOST_CONFIG_PATH>` equals it; `release-state` and `records/latest` agree; `/health/ready` 200; one read-only Staff session check in the browser; the previous container is retained stopped.
12. **Rollback and recover** (the same wrapper, packet generated with `--no-image` from the commit currently deployed): `python3 deploy/showcase/scripts/backend-release-packet.py generate --repo . --source-sha <DEPLOYED_SHA> --github-repository <OWNER>/<REPO> --no-image --run-id 0 --run-attempt 0 --out <DIR>` then `python3 deploy/showcase/scripts/backend-ssm-release.py rollback|recover --packet <DIR>/packet.json --instance-id <INSTANCE_ID> --region <REGION> --host-config <HOST_CONFIG_PATH> --out <OUT_DIR>` with credentials for the deploy role. Rollback is latest-record only; both end with the same confirmation rules as a deploy.
13. **Timeout / unknown-result reconciliation:** follow the printed steps (10.5) and never resend before the state is known; `python3 deploy/showcase/scripts/backend-ssm-release.py status --command-id <COMMAND_ID> --instance-id <INSTANCE_ID> --region <REGION>` is a single read-only poll.

### 10.7 Local verification (what CP03 ran; no cloud)

`python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py"`; actionlint 1.7.7 and ShellCheck 0.10.0 (pinned images, §7); `tests/rehearse_backend_ssm_release.sh` (real client → mocked SSM → real bootstrap/wrapper → real CP02 engine on Docker, PostgreSQL 18.3, loopback registry, TLS proxy). The rehearsal mocks only AWS: `ssm send-command`, `ssm get-command-invocation`, `ecr get-login-password` and the raw.githubusercontent.com download; everything else is real. Test-only switches in the scripts (all of them can only relax toward loopback or a non-root test user, none is reachable from the workflow): `BHA_RELEASE_PATH_PREFIX`, `BHA_RELEASE_STAGE_ROOT`, `BHA_RELEASE_LOCK_DIR`, `BHA_RELEASE_LOCK_WAIT`, `BHA_RELEASE_ALLOW_LOOPBACK_REGISTRY`.

## 11. CP04 — Owner live activation (guide and evidence ledger; nothing below is live until a dated Owner entry says so)

Claude guides, monitors and verifies read-only; **the Owner executes every cloud, GitHub-setting, host and flag write.** Evidence is labelled `OWNER_EXECUTED` / `OWNER_VERIFIED` (the Owner did or saw it) or `CLAUDE_VERIFIED_READ_ONLY` (a read check by Claude); isolated rehearsal evidence (§7, §9, §10.7) is never counted as live evidence. Account-specific values stay in the Owner's shell variables and in private temp files outside Git; no secret, token, cookie, password or raw `docker inspect` goes into a chat, a commit or a report.

### 11.1 Observed state at the start of CP04 (2026-10-09)

| Item | Observed (label) | Expected | Pending |
|---|---|---|---|
| ECR `the-bha-api` | exists, tag immutability `IMMUTABLE`, no repository policy; tag `6ae3fdd3…` is the bootstrap digest `sha256:d01c7d9d…98b4b6` (`CLAUDE_VERIFIED_READ_ONLY`) | IMMUTABLE | P2 adds the first `main` SHA tag |
| EC2 | exactly one running instance `the-bha-api`, IMDSv2 required, an instance profile attached (`CLAUDE_VERIFIED_READ_ONLY`) | one managed node | SSM registration, profile contents and host prerequisites: **not readable by the audit user** → Owner packet A |
| GitHub variables / environments | no repository variable; no `backend-production` environment; ruleset `protect-main` active (PR required, no force-push/deletion, no bypass) (`CLAUDE_VERIFIED_READ_ONLY`) | environment `main`-only, six env names, two flags unset | P1 |
| Actions policy | "selected actions": GitHub-owned and verified-creator allowed, no patterns | `aws-actions/configure-aws-credentials` and `aws-actions/amazon-ecr-login` runnable | confirm in P1-B; add the two patterns if the first run is refused |
| OIDC `sub` of a `backend-production` job | **no evidence** | read from a real token | P1-D (probe) |
| IAM roles / OIDC provider | not readable by the audit user | publish role, deploy role, provider | P1-E |
| Live publish / deploy / SSM / rollback | none | — | P2–P4 |

### 11.2 Workflow of the work item

P1 setup with **both flags off** → P2 publish only → P3 first automatic deploy → P4 explicit rollback drill, then restoration through a **new** `main` release. Stop at any `WAITING_OWNER` row. Release commits are real commits on `main` that touch `deploy/showcase/**` (the path filter of `backend-image.yml`); CP04 uses the small non-executable marker `deploy/showcase/releases/BHA-BACKEND-CD-001-activation.json`, created in P2 and changed once per release. Nothing is re-run to simulate a release: an existing SHA tag fails closed.

### 11.3 Owner packets (copy-paste; `<…>` values are the Owner's)

**A — audit with an admin profile (read-only, anywhere).** Set `ACCOUNT_ID`, `REGION`, `INSTANCE_ID` in the shell first.
```bash
aws sts get-caller-identity --query Account --output text            # must equal $ACCOUNT_ID
aws iam list-open-id-connect-providers                               # token.actions.githubusercontent.com present?
aws ssm describe-instance-information --region "$REGION" --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
  --query 'InstanceInformationList[].[InstanceId,PingStatus,AgentVersion]' --output text   # expect: Online
aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" --query 'Reservations[].Instances[].IamInstanceProfile.Arn' --output text
```
Stop if the account differs, the node is not `Online`, or you cannot read these (then grant the read or run them as the account owner).

**B — GitHub environment (Owner, GitHub UI or `gh`).** The probe job names `backend-production`; GitHub **auto-creates** a missing environment **without** branch rules, so create it first:
```bash
gh api -X PUT repos/<OWNER>/<REPO>/environments/backend-production --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST repos/<OWNER>/<REPO>/environments/backend-production/deployment-branch-policies -f name=main -f type=branch
gh api repos/<OWNER>/<REPO>/actions/permissions/selected-actions      # patterns must allow aws-actions/* if GitHub refuses the AWS actions
```
Do not define any `BACKEND_RELEASE_*` variable yet. Required reviewers on the environment are optional (they add a click per deployment).

**C — promotion of reviewed source to `main`, both flags still unset (Owner; Claude does not promote).** `main` and `develop` are different histories (the trees differ by the work of CP01–CP04). After the probe PR is merged into `develop`, run this **in the project's one checkout, which must be clean** (no staged, unstaged or untracked path; do not stash, clean or reset to make it so — resolve your own changes first). It is a self-contained script: any failing command or refused guard ends it (nonzero, a `PROMOTION_STOP:` or `DIRTY_WORKTREE_STOP` code on stderr) before the next step, without closing your shell. An unreadable `git status` is a refusal, never "clean". It pins the fetched `main` and `develop` commits once (never over an existing local or remote branch), builds the promotion commit from git objects only — parent = pinned `main`, tree = the pinned `develop` tree, so additions, changes and deletions are exact and `main`'s history is not rewritten — and checks it out with `git switch --no-overwrite-ignore`, which refuses (changing nothing) when a local change, an untracked file or even an **ignored** file stands in the way; it never overwrites, stashes or cleans. It re-checks cleanliness right before and right after the switch, asserts the resulting tree and parent, and only then pushes (no force).
```bash
bash -s <<'PROMOTE'
set -euo pipefail
stop() { echo "PROMOTION_STOP: $1" >&2; exit 1; }
clean_or_stop() {   # staged, unstaged and untracked paths all count; the status text itself is never printed
  local state
  state="$(git status --porcelain=v1 --untracked-files=all 2>/dev/null)" || stop GIT_STATUS_FAILED
  if [ -n "$state" ]; then echo "DIRTY_WORKTREE_STOP" >&2; exit 1; fi
}
BRANCH=promote/backend-cd-001-to-main
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || stop NOT_IN_A_GIT_CHECKOUT
cd "$ROOT"
clean_or_stop
START="$(git symbolic-ref -q --short HEAD || git rev-parse --verify HEAD)"
git fetch --prune origin >/dev/null 2>&1 || stop FETCH_FAILED
MAIN="$(git rev-parse --verify --quiet "refs/remotes/origin/main^{commit}")" || stop MAIN_REF_MISSING
DEVELOP="$(git rev-parse --verify --quiet "refs/remotes/origin/develop^{commit}")" || stop DEVELOP_REF_MISSING
MAIN_TREE="$(git rev-parse --verify --quiet "$MAIN^{tree}")" || stop MAIN_TREE_MISSING
DEV_TREE="$(git rev-parse --verify --quiet "$DEVELOP^{tree}")" || stop DEVELOP_TREE_MISSING
[ "$MAIN_TREE" != "$DEV_TREE" ] || stop NOTHING_TO_PROMOTE
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then stop LOCAL_BRANCH_EXISTS; fi
rc=0; git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 2 ] || stop REMOTE_BRANCH_EXISTS_OR_UNREADABLE
NEW="$(git commit-tree "$DEV_TREE" -p "$MAIN" -m "chore(release): promote develop to main (BHA-BACKEND-CD-001)")" || stop COMMIT_TREE_FAILED
{ [ "$(git rev-parse "$NEW^{tree}")" = "$DEV_TREE" ] && [ "$(git rev-parse "$NEW^")" = "$MAIN" ]; } || stop PROMOTION_COMMIT_MISMATCH
clean_or_stop
git switch --no-overwrite-ignore -c "$BRANCH" "$NEW" || stop SWITCH_REFUSED
clean_or_stop
{ [ "$(git rev-parse HEAD)" = "$NEW" ] && [ "$(git rev-parse "HEAD^{tree}")" = "$DEV_TREE" ]; } || stop PROMOTION_TREE_MISMATCH
git push -u origin "$BRANCH" || stop PUSH_FAILED
echo "PROMOTION_PUSHED branch=$BRANCH promotion_commit=$(git rev-parse HEAD)"
echo "PINNED_MAIN=$MAIN"
echo "PINNED_DEVELOP=$DEVELOP"
echo "PINNED_DEVELOP_TREE=$DEV_TREE"
echo "return to your previous branch with: git switch $START"
PROMOTE
```
Keep the printed `PINNED_*` lines. Open a PR from `promote/backend-cd-001-to-main` into `main` and merge it yourself (merge commit or squash, per your ruleset). After the merge, **fetch again** and compare with the pinned tree, not with whatever `develop` is by then:
```bash
git fetch --prune origin && test "$(git rev-parse "refs/remotes/origin/main^{tree}")" = "<PINNED_DEVELOP_TREE printed above>" && echo MAIN_TREE_IS_THE_PINNED_DEVELOP_TREE
```
Anything else (another commit reached `main`, the tree differs) is a stop: do not continue with D until the difference is explained. The merge triggers `backend-image.yml` on `main` with flags unset: expect plan `publish=false deploy=false`, `publish-main` and `deploy-main` **skipped** (record the run).

**D — the real OIDC subject (Owner).** The probe lives in `.github/workflows/backend-oidc-probe.yml`: `workflow_dispatch` only, `main` only, environment `backend-production`, no checkout, no AWS call, masks the token and prints only the listed claims.
```bash
gh workflow run backend-oidc-probe.yml --ref main
gh run watch "$(gh run list --workflow backend-oidc-probe.yml --limit 1 --json databaseId -q '.[0].databaseId')"
gh run view --log "$(gh run list --workflow backend-oidc-probe.yml --limit 1 --json databaseId -q '.[0].databaseId')" | grep -E 'claim (sub|aud|environment|ref|repository) '
```
Expected: `aud = "sts.amazonaws.com"`, `sub` is exactly the string you will put in the trust (normally `repo:<OWNER>/<REPO>:environment:backend-production`; a different format changes the trust, never guess it). Keep that line for the report; delete the probe later through a reviewed change if it is no longer wanted.

**E — IAM roles (Owner; render from the templates into private files).**
```bash
umask 077; T="$(mktemp -d)"; echo "private render dir: $T"
SUB='<exact sub from D>'
r() { sed -e "s/<ACCOUNT_ID>/$ACCOUNT_ID/g" -e "s/<REGION>/$REGION/g" -e "s/<INSTANCE_ID>/$INSTANCE_ID/g" -e "s/<ECR_REPOSITORY>/the-bha-api/g" -e "s|<VERIFIED_SUB_CLAIM>|$SUB|g" "$1"; }
r deploy/showcase/iam/backend-release-deploy-trust.json        > "$T/trust.json"
r deploy/showcase/iam/backend-release-deploy-policy.json       > "$T/deploy-policy.json"
r deploy/showcase/iam/backend-release-instance-ecr-policy.json > "$T/instance-ecr.json"
for f in "$T"/*.json; do python3 -m json.tool "$f" >/dev/null && ! grep -q '<' "$f" && echo "ok $f"; done
```
Create the **deploy role** (`trust.json` + `deploy-policy.json`) and attach `instance-ecr.json` to the instance profile's role. The **publish role** uses the same trust (same `sub`; the publish and deploy jobs both run in the environment) and the ECR actions of §6 step 4 on the `the-bha-api` repository ARN, `ecr:GetAuthorizationToken` on `*`; keep it a **separate** role from the deploy role. Never use a wildcard `sub`, and do not widen the `showcase-publish` trust.

**F — host (Owner, on the instance through Session Manager).** Read-only audit first; each line prints one fact:
```bash
for c in docker python3 flock timeout curl sha256sum aws psql; do command -v "$c" >/dev/null && echo "have $c" || echo "MISSING $c"; done
python3 -c 'import sys; print("python", sys.version_info[:2] >= (3, 8))'; psql --version; aws --version
sudo docker ps --filter name=the-bha-api --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
# proof that the digest reference names the container that serves NOW (compare image IDs, never the tag in Config.Image):
REF='<ECR_URI>@sha256:<BOOTSTRAP_DIGEST>'
test "$(sudo docker inspect -f '{{.Image}}' the-bha-api)" = "$(sudo docker image inspect "$REF" -f '{{.Id}}')" && echo BOOTSTRAP_MATCH
curl -fsS -o /dev/null --max-time 10 https://raw.githubusercontent.com/<OWNER>/<REPO>/main/README.md && echo RAW_OK
```
A missing `psql` leaves a `STARTED` engine journal run (§10.5): install it **before** the first release. Then create the private host config of §9.2 at `<HOST_CONFIG_PATH>` (root, `0600`) with `EXPECTED_CURRENT_IMAGE=$REF`, plus the libpq files of §9.3 step 4; run `backend-deploy.sh status` from a checkout of the promoted commit and expect a clean state. Do not edit the live Caddy, app environment file, key ring or CA.

**G — variables, flags and releases (Owner, GitHub UI or `gh`).** In the environment `backend-production`: `BACKEND_RELEASE_AWS_ROLE_ARN`, `BACKEND_RELEASE_AWS_REGION`, `BACKEND_RELEASE_ECR_REPOSITORY`, `BACKEND_RELEASE_DEPLOY_AWS_ROLE_ARN`, `BACKEND_RELEASE_EC2_INSTANCE_ID`, `BACKEND_RELEASE_HOST_CONFIG_PATH` (never at repository/organization level). Repository variables: `BACKEND_RELEASE_PUBLISH_ENABLED=true` for P2, and only after P2 is verified `BACKEND_RELEASE_DEPLOY_ENABLED=true` for P3 (never the deploy flag alone). Each release is a reviewed PR into `main` that changes the marker; the Owner merges it.

### 11.4 Phases and what counts as evidence

* **P1 setup (flags off):** A–F done; D's `sub` recorded; roles created from the observed `sub`; disabled run on `main` recorded. Status `SETUP_LIVE` needs the Owner's evidence for each, not Claude's belief.
* **P2 publish only:** publish flag on, deploy flag unset. Evidence: the run on the **actual `main` merge SHA**; `publish-main` success; ECR tag = that full SHA, digest recorded, tag immutability still `IMMUTABLE`; `deploy-main` skipped; the API still serves the bootstrap digest (`docker ps` / `/health/ready`). Claude re-reads ECR and the run read-only.
* **P3 first deploy:** deploy flag on, a new marker commit on `main`. `PASS` needs the client `PASS` **and** the SSM invocation identity/status/`ResponseCode`, engine `SUCCESS`/`ALREADY_CURRENT`, `state_sync` OK, `reverified` true, `cleanup` OK, the live container's image ID, `RepoDigest` and revision label equal to the published digest/SHA, `EXPECTED_CURRENT_IMAGE`, `release-state` and `records/latest` in agreement, the previous container retained **stopped**; then `/health/ready` 200, the public properties read, the unauthenticated Staff `me` read answers 401, and an Owner browser read-only smoke. Downtime is reported as measured or `NOT_MEASURED`.
* **P4 rollback drill and restoration:** the packet for the rollback is generated with `--no-image` from the **immutable deployed commit** (detach-checkout of that SHA with a clean tree, then back to the working branch), the Owner runs the client with deploy-role credentials, **latest record only**, no DB rollback, **no fault injection on production**. Evidence as in P3 but for `ROLLED_BACK` and the restored previous digest. Then restore with a **new** `main` release (a new marker commit → new SHA, tag, digest, deploy); the old publish is never re-run. A fault or `recover` drill is `NOT_RUN` unless the Owner explicitly decides otherwise.

### 11.5 Failure policy

`FAILED_ROLLED_BACK` is a failed release (the old service was restored). `REMOTE_RESULT_UNKNOWN`, an ambiguous send, a poll deadline or a cancelled job: **stop mutating**, keep the CommandId and correlation, reconcile read-only (§10.5), and never resend, re-run, roll back or recover blindly. An existing SHA tag fails closed; GitHub re-run semantics are unproven. A result that needs a change to CP01–CP03 code is `BLOCKED` with a concrete proposal and an OC correction prompt; it is never fixed inline.
