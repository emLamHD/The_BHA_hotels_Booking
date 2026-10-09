# BHA-BACKEND-CD-001-CP01 — completion report (RELEASE_ARTIFACT)

Date: 2026-10-09 (Asia/Saigon). **This is checkpoint 1 only. Backend CD is not complete** (CP02 EC2 deploy/rollback, CP03 SSM/IAM wiring, CP04 Owner live activation are not implemented).

## 1. Identity

| | |
|---|---|
| Work item / roles | `BHA-BACKEND-CD-001-CP01` — `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes) |
| Repository / checkout | `/home/admin1/The_BHA_hotels_Booking` (single checkout, no worktree) |
| Branch / base | `feature/bha-backend-cd-001-cp01-release-artifact` → `develop` |
| Baseline = START_HEAD | `a6d45bf30f93ad15a79ec6b7686ab73c134f8450` (= `origin/develop` after `git fetch --prune origin`; clean tree) |
| Implementation commit | `4d85ad4b563ac1a386792d906f172963738d60c6` (workflows, helpers, tests, parser regex) |
| Validation head | `e9dc620a0f91cefefd2a45b25f9e8d8edd775226` (+ docs); CI below ran on it |
| Report commit / FINAL_HEAD | A commit cannot contain its own hash: the report commit and the actual FINAL_HEAD (with the CI runs on it) are stated in the final handoff, not here |
| Draft PR | https://github.com/emLamHD/The_BHA_hotels_Booking/pull/93 (Draft, base `develop`) |

## 2. Changed files and PR size

GitHub at `e9dc620` (before this report): **+1108 / −111** (8 files). This report adds roughly 130 lines more. That is above the 100–400 target; the reason, by file group (`git diff --numstat origin/develop...HEAD`):

| Group | +/− | Why it is needed |
|---|---|---|
| `backend-image.yml` rewrite, `ci.yml` | 251/102, 8/1 | Per-lane publish jobs, build-once + artifact handoff, PG 18.3 |
| `backend-release-policy.sh`, `backend-ecr-publish.sh` | 127, 84 | Decisions and ECR safety kept out of YAML so they can be tested |
| `test_backend_release.py` | 548 | 39 tests: event/flag matrix, config, transfer integrity, ECR error classes, workflow shape, parser. The safety logic is the deliverable; tests were not trimmed to reach the target |
| Runbooks + SNAPSHOT | 77 new, 10/7, 3/1 | Contract, prerequisites, dated status, limitations |

## 3. Acceptance

**A1 — PR has no AWS; main release uses the exact SHA; develop does not deploy: PASS (with the scope below).**
Real PR #93 run (`Backend image` run `37890225017`): `Plan`, `Backend suite on the source commit`, `Build image` succeeded; `Publish release image to ECR (main)` and `Publish develop image to ECR (not a release)` were **skipped**; no AWS step ran. Workflow shape tests assert: triggers are only `pull_request`/`push` (no `pull_request_target`, no `workflow_dispatch`); `id-token: write` only in `publish-*`; verify/build/plan have no environment and no `aws-actions`; every job checks out `ref: <full SHA>` and asserts `git rev-parse HEAD`; no `always()/failure()/cancelled()/continue-on-error`; no `github.event.*`/`head_ref`/`inputs.*` inside `run:`. Nothing deploys anywhere in the workflow.

**A2 — full suite on PostgreSQL 18.3; image built once and that image is checked/published: PARTIAL for "published"; PASS for the rest.**
* Local: scratch `postgres:18.3` (`postgres@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db`), own name/port, `server_version = 18.3 (Debian 18.3-1.pgdg13+1)`; `dotnet restore` 0, `build --configuration Release --no-restore` 0 (0 warnings), `test --configuration Release --no-build` 0: **unit 244/244, integration 847/847, 0 failed, 0 skipped**. CI matched on both the `Backend` job (`ci.yml`, run `37890225095`) and the `verify` job: `server_version=18.3 (Debian 18.3-1.pgdg13+1)`, 244 + 847 passed.
* Proven on the real runner (build job `113689284136`): image built once; non-root (`uid=1654 keys writable`); Production key-path guard; OCI `revision`/`source` labels equal the SHA/URL; image ID `sha256:03271ca5c11303b522c2087f3370905f7e55e1f30f8e17c742ad04e7dd647d86` **unchanged across `docker save` → `docker rmi` → `docker load`** (tar sha256 `dcfb38715e07c407a05623af8b273a98d00efe685d618768dd430b594ac83c22`).
* **NOT proven by any real run** (publish is disabled, correctly): `upload-artifact`/`download-artifact` handoff between jobs, `amazon-ecr-login`, and real ECR `describe-*`/`push` behavior. Those were exercised only through `aws`/`docker` stubs and YAML-shape tests. That the publish job pushes the very image the build job checked is established by construction (no `docker build` in publish jobs; tar SHA-256 compared to the build job's output, image ID and labels compared after load), not by a live run.

**A3 — main disabled by default; old flag does not enable main; enabled with missing config fails; PR/non-main never main-publish: PASS.** Tests: `BACKEND_RELEASE_PUBLISH_ENABLED` is enabled only by the exact string `true` (unset/empty/`false`/`TRUE`/`1`/`yes`/padded all disabled); `ECR_PUBLISH_ENABLED=true` does not enable main and the main flag does not enable develop; PR with both flags true → `lane none`, `publish false`, source = PR head; other refs/events never publish; enabled with a missing `AWS_ROLE_ARN`/`AWS_REGION`/`ECR_REPOSITORY` fails naming the variable, before `configure-aws-credentials` (step order asserted) and without any AWS call; malformed ARN/region/repository fail. **Limit (not claimed as fail-closed):** a missing *environment* `AWS_REGION`/`ECR_REPOSITORY` silently falls back to the repository variable of the same name in GitHub; mitigations (repo-level `AWS_ROLE_ARN` refused for main, equality warning, role IAM scope) are in the runbook §2.

**A4 — ECR never overwrites or swallows errors; outputs complete and validated: PASS (stubbed, not live).** Stub tests: `AccessDenied`, `RepositoryNotFoundException`, network error, and `ImageNotFoundException` with a non-254 exit all fail with **no** `docker push`; only exit 254 + `(ImageNotFoundException) … DescribeImages` proceeds; an existing tag fails with no `docker tag`/`push` (no reuse — no trusted provenance mechanism exists yet); repository `MUTABLE`, `*_WITH_EXCLUSIONS`, describe errors, or a foreign registry URI fail before lookup; a push rejected for immutability fails and is not re-read into success; empty/`None`/malformed/mismatching digests fail; invalid inputs fail before any AWS call. Outputs `source_sha`, `ecr_repository` (name), `image_uri` (full-SHA tag), `image_digest`; summary adds the by-digest URI, run ID/attempt and local image ID. Mutation checks on the scripts: swallowing all describe errors (caught), accepting MUTABLE (caught), truthy instead of exact `true` (caught), skipping the tar-vs-build-output checksum (caught after adding a test that rewrites tar and metadata together). Skipping the digest regex alone is **not** caught by its own test because the pushed-vs-read-back equality check already rejects the same inputs; both guards stay.

**A5 — dotted-key/value regression; docs reflect OWNER_VERIFIED status and keep history: PASS.**
The EC2 packet line is extracted from the real runbook and run with fake data (values never printed): `Logging.LogLevel.Default=a=b=c` → name `Logging.LogLevel.Default`; `ASPNETCORE_ENVIRONMENT` and `ConnectionStrings__TheBhaDatabase` kept; `1INVALID` and `bad-name` rejected; only names are emitted. With the previous character class the same test is RED (dotted key dropped). Value preservation is shown through the packet's own `cut -d= -f2-` comparison with a value containing `=` (and a one-character difference → absent). The packet never reads the value of a dotted key and only appends to the env file. Docs: dated 2026-10-09 `OWNER_VERIFIED` entry (runbook + SNAPSHOT), earlier entries and `NOT_RUN` items of §7b unchanged, no `CLAUDE_VERIFIED`, no claim about other Admin template modules.

**A6 — one Draft PR, matching heads, clean tree, CI on the final head, no cloud writes: see the final handoff** (final head SHA and the `CI`/`Backend image` run IDs for it are recorded there). Validation-head CI (`e9dc620`): `CI` run `37890225095` (Frontend, Admin, Backend) success; `Backend image` run `37890225017` success with both publish jobs skipped.

## 4. Checks run (tool, command, result)

| Check | Result |
|---|---|
| `rhysd/actionlint:1.7.7` (`rhysd/actionlint@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9`, bundles ShellCheck 0.10.0) on `ci.yml`, `backend-image.yml` | exit 0, 0 errors |
| `koalaman/shellcheck:v0.10.0` (`@sha256:2097951f02e735b613f4a34de20c40f937a6c8f18ecb170612c88c34517221fb`) `-x` on both new scripts; `bash -n` | exit 0 |
| PyYAML 6.0.3 parse (inside the workflow-shape tests) | pass |
| `python3 -m unittest discover -s deploy/showcase/scripts/tests -p "test_*.py"` (Python 3.14.4) | **54 tests OK** (39 new + 15 existing), no failures/skips |
| `dotnet` 8.0.423 restore/build/test on PostgreSQL 18.3 | see A2 |
| `docker build` once (Docker 29.8.1, containerd image store) from the clean committed tree at `4d85ad4` (`git status --porcelain` empty) | local image ID `sha256:202daf92879e5d61c1fd73d3ec87339344e03aeca86878c401e2380db96cc024`; labels revision `4d85ad4b…`, source `https://github.com/emLamHD/The_BHA_hotels_Booking`; user `app`; `uid=1654 keys writable`; Production key-path guard: message matched, exit observed **139** (the step asserts message + non-zero, unchanged from baseline) |
| Real save → rmi → load rehearsal with the helper | tar sha256 `c3a8f34e3f12e1b393b6c072fcaa0cdbca73aa6e91b886d7bd6d34391d728d87`; image ID identical before and after load; metadata and labels re-verified |
| `git diff --check` | clean (per commit and over `origin/develop...HEAD`; see final handoff for the last run) |

Validator images: the Owner approved (in this session, via the question tool) running pinned images with `docker run --rm`; nothing was installed on the host. Cleanup removed only this work item's scratch container (`bha-cd001-pg183`), local image and temp directory; the pre-existing `the-bha-postgres-1` was not touched.

## 5. Contract summary (details: `docs/runbooks/BHA-BACKEND-CD-001.md`)

* Variables: repository `BACKEND_RELEASE_PUBLISH_ENABLED` (main), `ECR_PUBLISH_ENABLED` (develop only); environment `backend-production` with `AWS_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY`; develop keeps `showcase-publish` + `AWS_ECR_ROLE_ARN`/`AWS_REGION`/`ECR_REPOSITORY`.
* Read-only state check (`gh variable list`, `gh api …/environments`): the repository has **no** Actions variables and no `showcase-publish`/`backend-production` environments (only Vercel's); so both publish flags are unset and merging this PR to `develop` publishes nothing.
* Path filters (PR and push): `Back_End/**`, `deploy/showcase/**`, `.github/workflows/backend-image.yml`, `.github/workflows/ci.yml`.
* Single workflow (no `backend-release.yml`): one production publishing path (`publish-main`); two publish jobs because environments, variables and concurrency differ per lane while sharing the same helper.
* **Deliberate `develop` behavior changes:** no rebuild in the publish job (same checked image); an existing tag now fails instead of being reused silently; describe errors are no longer swallowed; config validated in the publish job (after verify) instead of the plan job; the backend suite now runs on every event; `workflow_dispatch` removed (retry = re-run failed jobs of the same run).
* Limitations: existing-tag fail-closed means a retry after a successful publish fails (verify the image by digest by hand); whether a re-run job can download the artifact of an earlier attempt is untested; concurrency is not a queue (intermediate SHAs may be skipped, no FIFO guarantee); actions are pinned by version tag, as before; a PR image is built from the PR head, not the merge result.

## 6. Skills, tools, attribution

* `SKILL_POLICY`: `diagnosing-bugs` not invoked (the only failure — a test-stub exit status — was an obvious harness bug with a direct red/green loop). `GRAPHIFY_POLICY: NOT_APPLICABLE`, not used; source read directly.
* Cloud: **no AWS API was called by Claude at all** (the `aws-mcp` tool was available and unused; the test harness points `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE` at nonexistent paths, unsets the profile and disables IMDS). Opening the PR triggered two Vercel preview deployments through the existing integration; Claude did not start them and changed no Vercel/GitHub/AWS configuration, variable, secret or environment.
* Attribution: the 2026-10-09 deployment status is `OWNER_VERIFIED`, not `CLAUDE_VERIFIED`.

## 7. Status lines

* IMPLEMENTATION_CP01: **PASS** (A1, A3, A4 (stub-level), A5 PASS; A2 PASS except that the publish handoff and registry behavior have never run live — by design, not part of CP01 acceptance; A6 completed in the final handoff)
* REVIEW: NOT_RUN — OWNER_ONLY
* CLOUD_WRITES: NOT_RUN
* PUBLISH_LIVE: NOT_RUN
* DEPLOY_LIVE: NOT_RUN
* ROLLBACK_LIVE: NOT_RUN
* Backend CD is **not** complete; CP02–CP04 remain.
