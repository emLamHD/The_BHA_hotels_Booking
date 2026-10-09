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
| CI on the Draft PR at `b69bba4` (checkpoint, 2026-10-09) | run `37962850978` (`CI`, `pull_request`): Backend, Admin, Frontend pass; Vercel previews and Preview Comments pass. **`Backend image` was NOT_TRIGGERED** — no changed path matches its filter (`Back_End/**`, `deploy/showcase/**`, `backend-image.yml`, `ci.yml`), so there was no run and nothing "skipped"; no workflow was dispatched to create evidence |

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
| REVIEW_CP04 | checkpoint `b69bba4`: Codex returned one P2 (§8.1) → corrected in §8; the correction head is `NOT_RUN — OWNER_ONLY` until the Owner invokes the review; a second Owner review follows the evidence checkpoint |
| BACKEND_CD | `NOT_COMPLETE` |

## 7. Waiting on the Owner (in order)

1. Invoke the Codex review of this checkpoint; OC decides.
2. After the Draft PR is merged into `develop`: runbook §11.3 A (audit), B (environment first), C (promotion with both flags unset; record the disabled run), D (dispatch the probe, read `sub`), E (roles from the observed `sub`), F (host), G (variables). Then P2.
3. Claude does not create the activation marker, set a variable or flag, dispatch anything, or send any SSM command.

## 8. C1 — CLEAN_WORKTREE_PROMOTION_GUARD (correction, 2026-10-10)

Evidence above is the 2026-10-09 checkpoint and keeps its attribution. This section is the correction after the Codex review of `b69bba4`; OC routed it through the Owner (`BHA-BACKEND-CD-001-CP04-C1`). Docs only: no probe, workflow, helper, IAM or product change. Nothing live ran.

### 8.1 Codex finding, as returned

`[P2] Guard the promotion reset against a dirty worktree — docs/runbooks/BHA-BACKEND-CD-001.md:285` — "If the Owner runs this packet in a checkout with tracked local changes, `git read-tree -u --reset` can overwrite the index and working-tree files, losing those changes. Require a clean-worktree check before this command; this also aligns with AGENTS.md §7's instruction to preserve unrelated user changes." Codex found no other actionable issue.

### 8.2 Identity and preflight

START_HEAD = `b69bba44be76fd68a0c9148978fa1736ffd34e0b` (= local = `origin/<feature>` = PR #96 head; Draft; `origin/develop` = baseline `1f039b5…`; `origin/main` = `0243160…`; clean tree). FINAL_HEAD, GitHub additions/deletions and the CI on it are in the handoff.

### 8.3 What changed in packet C (runbook §11.3 C)

A self-contained `bash -s <<'PROMOTE'` script (`set -euo pipefail`, so a refusal ends the packet, not the Owner's shell). Guard `clean_or_stop` = `git status --porcelain=v1 --untracked-files=all`: staged, unstaged **and** untracked paths refuse with `DIRTY_WORKTREE_STOP`; a failing `git status` refuses with `GIT_STATUS_FAILED` (empty stdout from a failed command is not "clean"); the status text is never printed. It pins fetched `main` and `develop` once, refuses a missing ref, a fetch failure, identical trees, an existing local or remote promotion branch, builds the promotion commit with `git commit-tree <develop tree> -p <pinned main>`, asserts tree and parent, guards, runs `git switch --no-overwrite-ignore -c`, guards and asserts again, and only then pushes (no force). The post-merge check compares `origin/main`'s tree with the **pinned** `PINNED_DEVELOP_TREE`, after a fresh fetch.

Design note (found by the fixtures, not assumed): the first GREEN run, with `git read-tree -m -u HEAD <develop>`, **silently overwrote an ignored file** that collided with an incoming tracked path (3 failed checks). Because requirement 7 forbids overwriting, the apply step became `commit-tree` + `switch --no-overwrite-ignore`, which refuses ignored/untracked collisions and conflicting local changes and changes nothing. Side effects: no hooks run on the plumbing commit and `commit.gpgsign` is not applied (sign by hand if a ruleset ever requires it); `git switch` needs Git ≥ 2.23 (older Git stops with `SWITCH_REFUSED` before any change).

### 8.4 RED — original packet at `b69bba4` on disposable fixtures

Fixtures (`git init`/`git init --bare` in the scratchpad, local-file `origin`): `main` (2 commits) and an unrelated `develop` history (a changed file, an added file, a deleted file, a changed subdirectory file, a tracked file under an ignored directory, a file identical on both), checkout on `feature` = `develop` + 1 commit. The original 5 lines extracted with `git show b69bba4:docs/runbooks/BHA-BACKEND-CD-001.md | awk …`, run with plain `bash` (no fail-fast), never in the project checkout.

| Case | Observed |
|---|---|
| unstaged change to a file identical on both trees | packet exit 0, branch `feature`→`promote/…`, sentinel **lost**, promotion branch pushed |
| staged change, same file | exit 0, staged sentinel **lost** (index and worktree), pushed |
| unstaged change to a file that differs (`switch` refuses) | exit 1 but the later lines still ran: sentinel lost and the promotion commit landed **on the start branch** |

9/9 defect assertions held (sentinel lost, state snapshot changed, pushed / wrong-branch commit).

### 8.5 GREEN — the updated Markdown block, extracted verbatim, 35 lines, `bash -n` ok

The first `bash` block after the `**C —` line of `docs/runbooks/BHA-BACKEND-CD-001.md` is cut out with `awk` (a three-pattern state machine) and run in each fixture with a PATH shim that only logs mutating Git subcommands (and, for two fixture-only faults, appends to a file just before `switch` or swaps the tree given to `commit-tree`). Snapshot = HEAD + branch + `ls-files -s` + SHA-256 of every worktree file; origin snapshot = `for-each-ref`. **88 checks, 88 passed, 0 failed.**

| Scenario | Result |
|---|---|
| clean, different histories, add/change/delete | exit 0; commit tree == `origin/develop` tree; parent == pinned `main`; `main`/`develop` refs on origin untouched; deletion and addition applied; tracked-under-ignored file present; pushed; `PINNED_DEVELOP_TREE` printed; worktree clean; `feature` branch intact |
| dirty unstaged (same file; differing file), staged, untracked, untracked colliding with an incoming path | exit 1 `DIRTY_WORKTREE_STOP`; no mutating Git command; snapshot unchanged; no branch; origin unchanged |
| ignored file colliding with an incoming tracked path | exit 1 `SWITCH_REFUSED` (git: "untracked working tree files would be overwritten"); ignored file intact; snapshot unchanged; no branch; no push |
| `git status` fails (corrupt index, empty stdout) | exit 1 `GIT_STATUS_FAILED`; no mutating command; snapshot unchanged |
| missing `develop` / `main` ref, fetch failure, identical trees | exit 1 `DEVELOP_REF_MISSING` / `MAIN_REF_MISSING` / `FETCH_FAILED` / `NOTHING_TO_PROMOTE`; no branch, no push |
| existing local branch / existing remote branch | exit 1 `LOCAL_BRANCH_EXISTS` (tip unchanged) / `REMOTE_BRANCH_EXISTS_OR_UNREADABLE`; nothing overwritten |
| tree assertion (shim hands `commit-tree` the wrong tree) | exit 1 `PROMOTION_COMMIT_MISMATCH`; no `switch`, no push; snapshot unchanged |
| change appears between the guard and `switch` (shim) | conflicting file → `SWITCH_REFUSED`, change preserved, no branch; carried file → post-switch `DIRTY_WORKTREE_STOP`, change preserved, no push |
| not inside a Git checkout | exit 1 `NOT_IN_A_GIT_CHECKOUT` |

### 8.6 Other checks, tools, limits

Heredoc body (33 lines) linted with the pinned `koalaman/shellcheck:v0.10.0` image: exit 0 (the earlier file-level run only saw the heredoc as data and was discarded). Git 2.53.0, GNU bash; `git diff --check` clean. No skill invoked (`diagnosing-bugs` not triggered: cause known; reproduction by fixtures); Graphify `NOT_APPLICABLE`. Not run: the helper suite and Docker rehearsals (docs-only correction), a real GitHub PR/merge of the promotion, the packet on the Owner's own checkout, Git versions other than 2.53.0. Fixture scripts live outside the repository (scratchpad) and are reproducible from §8.4–8.5.

### 8.7 Statuses

IMPLEMENTATION_CP04_C1 `PASS` (correction checks only); REVIEW_CP04_C1 `NOT_RUN — OWNER_ONLY` (the earlier review of `b69bba4` does not cover this head); CP04_LIVE `WAITING_OWNER`; CLOUD_WRITES `NOT_RUN`; BACKEND_CD `NOT_COMPLETE`.
