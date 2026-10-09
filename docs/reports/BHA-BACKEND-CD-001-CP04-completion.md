# BHA-BACKEND-CD-001-CP04 — report (OWNER_LIVE_ACTIVATION) — checkpoint 1: diagnostic probe and Owner guide

Date: 2026-10-09 (Asia/Saigon). **Backend CD is NOT_COMPLETE.** This checkpoint contains no live evidence of publish, deploy, SSM, rollback or restoration: it adds the one diagnostic workflow the activation needs and the Owner guide. Every live row below is `NOT_RUN` or `WAITING_OWNER` until the Owner performs it and the evidence is recorded in a later checkpoint. Nothing in this report is isolated evidence presented as live evidence.

## 1. Identity

| | |
|---|---|
| Work item / roles | `BHA-BACKEND-CD-001-CP04` — `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes) |
| Branch / base / baseline | `feature/bha-backend-cd-001-cp04-owner-live-activation` → `develop`; baseline = START_HEAD = `1f039b532447b2c7df15574f277c4394df0e9f47` (= `develop` = `origin/develop`, clean tree, PR #95 merged) |
| FINAL_HEAD | A commit cannot contain its own hash: FINAL_HEAD, the GitHub additions/deletions and the CI runs on it are in the handoff |

## 2. Files

`.github/workflows/backend-oidc-probe.yml` (new, executable code → Codex review checkpoint), `docs/runbooks/BHA-BACKEND-CD-001.md` (typo fix in §10.6 step 8 — six environment names, not "four CP01 names" — pointer in step 2, new §11), `docs/project/SNAPSHOT.md` (short entry), this report. No change to `backend-image.yml`, `ci.yml`, IAM templates, CP01–CP03 helpers/tests, `Back_End/`, `Front_End/`, governance files. The activation marker `deploy/showcase/releases/BHA-BACKEND-CD-001-activation.json` is **not created yet** (P2).

## 3. The probe (why it exists)

No actual `sub` of a `backend-production` job exists as evidence, and a trust policy must come from evidence (a customised subject template or immutable-ID format changes the string). `backend-oidc-probe.yml`: `workflow_dispatch` only with no input; job `if: github.ref == 'refs/heads/main'`; `environment: backend-production`; permissions `contents: read` + `id-token: write`; no checkout, no third-party action, no AWS/SSM/ECR/Docker call, no artifact; one Python step that requests the token for audience `sts.amazonaws.com`, issues `::add-mask::` for the request token and the JWT **before** printing anything, then prints only `iss aud sub repository repository_id repository_owner repository_owner_id ref ref_type sha environment event_name workflow_ref job_workflow_ref run_id run_attempt` and the count of claims not shown; an error prints the exception type name only. It is dispatchable only after it exists on `main` (Owner promotion, flags off).

## 4. Observations before any change (`CLAUDE_VERIFIED_READ_ONLY`; a read-only session as an IAM user, no write call)

ECR `the-bha-api`: `IMMUTABLE`, AES256, no repository policy; tag `6ae3fdd3…` = digest `sha256:d01c7d9d…98b4b6` (pushed 2026-10-07; matches the digest the Owner stated as live) and two untagged digests. EC2: one running instance `the-bha-api`, IMDSv2 required, an instance profile attached. GitHub: no repository variables; no `backend-production` or `showcase-publish` environment; ruleset `protect-main` active (pull request required, deletion and non-fast-forward blocked, no bypass); Actions policy "selected" with GitHub-owned and verified-creator allowed and no patterns; default token permission `read`. **Not readable** with that user: SSM managed-node registration, IAM OIDC provider/roles/instance-profile policies → Owner packet A.

## 5. Checks (this checkpoint; tool, result)

| Check | Result |
|---|---|
| actionlint 1.7.7 (pinned image) on the probe | exit 0 |
| YAML structure assertions on the probe (no inputs; main-only; environment; permissions; single step; no aws/ssm/ecr/docker/artifact/curl/`set -x`/`printenv`) | pass |
| Extracted step script run locally against a fake token endpoint with secret-like extra claims | request token and JWT masked first; only the whitelisted claims printed; actor/jti/signature not printed |
| `git diff --check`, secret scan of the diff | see the handoff for the exact run |
| CI on the Draft PR (Backend, Admin, Frontend, Backend image with publish/deploy skipped) | see the handoff (exact FINAL_HEAD) |

## 6. Required statuses

| Status | Value |
|---|---|
| SETUP_LIVE | `WAITING_OWNER` (steps A–F of runbook §11.3) |
| PUBLISH_LIVE | `NOT_RUN` |
| DEPLOY_LIVE | `NOT_RUN` |
| SSM_LIVE | `NOT_RUN` |
| ROLLBACK_LIVE | `NOT_RUN` |
| RESTORE_AFTER_DRILL_LIVE | `NOT_RUN` |
| FAULT_AFTER_STOP_LIVE / RECOVER_LIVE | `NOT_RUN` (allowed) |
| CLOUD_WRITES | `NOT_RUN` — Claude made none; any Owner write will be listed as `OWNER_EXECUTED` with its time |
| IMPLEMENTATION_CP04 | probe + guide done; live evidence pending |
| REVIEW_CP04 | `PENDING_OWNER_CODEX_REVIEW` (the probe is executable code); a second Owner review follows the evidence checkpoint |
| BACKEND_CD | `NOT_COMPLETE` |

## 7. Waiting on the Owner (in order)

1. Invoke the Codex review of this checkpoint; OC decides.
2. After the Draft PR is merged into `develop`: runbook §11.3 A (audit), B (environment first), C (promotion with both flags unset; record the disabled run), D (dispatch the probe, read `sub`), E (roles from the observed `sub`), F (host), G (variables). Then P2.
3. Claude does not create the activation marker, set a variable or flag, dispatch anything, or send any SSM command.
