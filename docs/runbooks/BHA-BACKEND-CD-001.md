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
| `main` (release) | `backend-production` | `AWS_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY` — all three as **environment** variables |
| `develop` (unchanged) | `showcase-publish` | repository variables `AWS_ECR_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY` |

The publish job validates the effective values (present, ARN/region/repository shape) in a step **before** `configure-aws-credentials`; a missing value fails the run with the variable name and nothing reaches AWS. Registry and account come from `amazon-ecr-login` and must equal the `repositoryUri` that ECR reports for the repository; no account ID is hardcoded and no long-lived access key is used (OIDC only; `mask-aws-account-id: false` so the registry host is not dropped from job outputs).

Known limit — GitHub falls back to the repository variable of the same name when an environment variable is absent. `AWS_REGION` and `ECR_REPOSITORY` already exist at repository level for `develop`, so a missing `backend-production` value cannot be detected as missing. Mitigations in CP01: a repository-level `AWS_ROLE_ARN` is refused for `main`; a `main` value equal to the repository-level `AWS_REGION`/`ECR_REPOSITORY` produces a `::warning::`; and the role's IAM scope (below) must allow only the production repository, so an inherited name fails on the first ECR call. Do not rely on "missing region/repository fails closed".

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

1. GitHub: environment `backend-production` with **deployment branches restricted to `main`**; branch protection on `main`; environment variables `AWS_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY`. Do not set `AWS_ROLE_ARN` at repository level. Keep `BACKEND_RELEASE_PUBLISH_ENABLED` unset until the Owner chooses to enable it (repository variable).
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
