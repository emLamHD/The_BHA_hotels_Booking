# BHA-BACKEND-CD-001 — backend release artifact (CP01)

> Status 2026-10-09. **CP01 only: the release artifact.** Backend continuous delivery is **not** complete. Deploy to EC2, rollback, SSM/IAM wiring and live activation are CP02–CP04 and do not exist yet. `PUBLISH_LIVE`, `DEPLOY_LIVE`, `ROLLBACK_LIVE`, `CLOUD_WRITES`: `NOT_RUN`.
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

### 9.7 Limitations

Rollback uses the latest record only; each successful deploy leaves one more stopped `-prev-<run>` container that nothing removes; the rehearsal ran on a containerd image store whereas the EC2 host probably uses the classic store (the scripts compare image IDs with image IDs on the same host only); the release manifest/packet transfer, provenance validation and SSM orchestration are CP03; the live runtime shape is unverified until CP04.
