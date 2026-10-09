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

## 9. C2 — PROBE_DISPATCH_CORRELATION_AND_PACKET_GATES (correction, 2026-10-10)

Sections 1–8 keep their attribution (`b69bba4` checkpoint, `2a93c43` C1). This section is the correction `BHA-BACKEND-CD-001-CP04-C2`, routed by OC through the Owner. Docs only: probe workflow, packet C, release workflows, helpers, IAM templates and product code are untouched. Nothing live ran: no real dispatch, no GitHub/AWS call, no flag or environment change.

### 9.1 Codex finding on `2a93c43`, as returned

`[P2] Correlate the probe logs with the dispatched run — docs/runbooks/BHA-BACKEND-CD-001.md:329-330` — "If a previous probe run exists, or the new dispatch has not appeared in the run list yet, `--limit 1` can select the wrong run. The later command queries again, so it can even display logs from a different run than the one being watched; the Owner could record a stale `sub` and build a trust policy from it. Capture and reuse the run ID for the dispatch being performed." Codex found no other issue. OC additionally reproduced two fail-open defects (packet E validation loop, packet F equality test).

### 9.2 Identity

START_HEAD = `2a93c43867c9202903441fd8d8a1022da2573b1c` (= local = `origin/<feature>` = PR #96 head; Draft; `origin/develop` = baseline `1f039b5…`; clean tree). FINAL_HEAD, the GitHub additions/deletions and the CI on it are in the handoff. The PR leaves the 100–400 line target because D and E became tested scripts instead of three-line command lists (about 350 added runbook lines of executable Owner packets, one file) — the size is the packets, not scope creep.

### 9.3 What changed (runbook §11.3)

* **D — exact dispatch/run binding.** One self-contained `python3 -I - <<'PROBE'` packet, `gh api` only, every call with an explicit `repos/<BHA_REPO>/…` endpoint and `X-GitHub-Api-Version: 2026-03-10`. It pins repository (`default_branch main`), workflow (path, id, active), the `backend-production` environment (custom policies, exactly `branch:main`), both flags off (unset, empty or `false`) and the `main` SHA by read-only API **before** the single `POST …/dispatches` (`ref=main`, no inputs). It keeps only the `workflow_run_id` from that response (positive integer, not bool/null/string; `run_url`/`html_url` must be that repository and ID), saves a non-secret `anchor.json` in a private `mktemp -d` and prints the `PROBE_ANCHOR` line immediately. Every later read uses that ID and the attempt pinned from the first read: repository, workflow id/path, event `workflow_dispatch`, branch `main`, head SHA, attempt (must be 1 on a fresh dispatch) must match, polled through `runs/{id}/attempts/{n}` with bounded retries only for transient evidence (network, 5xx, 429, and 404 while a fresh run/log becomes visible). Claims are read only after the same run completed `success`, from the one job of that attempt, and only from `claim NAME = JSON` lines; duplicate/missing/unexpected/malformed claims, `aud ≠ sts.amazonaws.com`, or a repository/ref/sha/run_id/run_attempt/environment/event_name/iss that does not match the pinned run reject the evidence. `sub` only has to be a non-empty printable string. A last read of the run detects a re-run/new attempt. Success writes `evidence.json` (0600) and prints the verified lines; every other path writes nothing for packet E. A failed or ambiguous POST is never repeated: definite 4xx refusals → `DISPATCH_REFUSED_BY_API_n`; anything else → `DISPATCH_RESULT_UNKNOWN` (exit 20, resume hint). Poll deadline → exit 20 with `PROBE_RUN_ID`/`PROBE_PINNED_SHA` resume (no second dispatch, no latest-run lookup). `gh run watch` is not used (its manual: not supported with fine-grained PATs).
* **E — render gate.** `python3` renderer: validates inputs and the evidence file, parses and re-serialises the JSON templates (single-pass literal substitution, so no `sed`/JSON quoting hazard), rejects `*`/`?` in `sub`, unknown or leftover placeholders, then writes three files (0600, private unique dir) and **re-reads each one** against its expected content (trust aud/sub/provider; the two exact `SendCommand` resources; the one repository ARN). `RENDER_ALL_VALID` only when all three pass; otherwise the files of that run are deleted and the exit is nonzero.
* **F — bootstrap proof.** One `bash -s` script (`set -euo pipefail`): validates `REF`/container name, tools, python ≥ 3.8, psql ≥ 10, aws CLI v2, then checks the target is running, each inspect's exit status, both image IDs well-formed `sha256:` and equal before `BOOTSTRAP_MATCH`; read-only, prints codes only; also removes the unquoted `<OWNER>/<REPO>` of the old curl line (the shell read `<OWNER>` as a redirection — visible in the RED run).
* **B — environment.** Concrete defect from the audit (§9.7): the old packet PUT the environment unconditionally and the GitHub documentation does not state what an omitted `reviewers`/`wait_timer` becomes on update. Now: read first; existing environment → no write; absent → create with only `deployment_branch_policy` plus the `main` policy; always read back and stop unless the environment is `custom_branch_policies` with exactly `branch:main`.
* §10.6 step 2 now points to "§11.3 packet D" (it pointed to a section that does not hold the probe).

### 9.4 Primary sources read (API behaviour is documentation, not live evidence)

`docs.github.com/en/rest/actions/workflows?apiVersion=2026-03-10#create-a-workflow-dispatch-event` (200 with `workflow_run_id`, `run_url`, `html_url`; body `ref`, optional `inputs`); `…/rest/about-the-rest-api/breaking-changes#version-2026-03-10` ("always returns `200` with the workflow run details", `return_run_details` removed); `…/rest/actions/workflow-runs` (Get a workflow run / run attempt fields); `…/rest/actions/workflow-jobs` (jobs of an attempt; job logs endpoint answers a 302 to plain text valid for one minute); `…/rest/deployments/environments` and `…/branch-policies` (PUT semantics for omitted parameters not documented; duplicate policy answers 303); `cli.github.com/manual/gh_api`, `gh_run_view`, `gh_run_watch`. A real dispatch was **not** made, so the response shape, the run `path` form (the packet also accepts a `@ref` suffix) and the job-log text are not live-proven.

### 9.5 RED — original blocks at `2a93c43`, on stubs/fixtures (5/5 defect checks)

| Block | Observed |
|---|---|
| D | old run `100` exists, the new one is visible later: `gh run list` ×2 returned `100` then `200`; the packet watched `100`, read the logs of `200`, printed `repo:OTHER-RUN-200` as the evidence and exited 0 |
| E | first template invalid JSON, the other two valid: the loop's exit status is the last file's → exit 0 with `ok` lines for the other two |
| F | both `docker inspect` commands fail with empty stdout: `BOOTSTRAP_MATCH` printed |

### 9.6 GREEN — the updated Markdown blocks, extracted verbatim (D 201 lines, E 96, F 27, B 26), **419 checks, 419 passed**

`gh`/`docker`/`sudo`/`psql`/`aws`/`curl` are test doubles that log their arguments; no network, no token, no GitHub API call, fake clock (`PROBE_POLL_INTERVAL=0`, deadline 2 s). A canary line inside the fake job log is asserted never to reach stdout/stderr.

| Packet | Checks | Covered |
|---|---|---|
| D | 276 | success with exactly one POST (`ref=main` only, version header), every run call on the returned ID, no run list; old/concurrent runs; delayed 404 visibility; transient network error; resume without a POST; 11 dispatch-response failure modes (204/empty, bad JSON, missing/null/string/bool/zero/negative ID, wrong URL, network, 500) → exit 20 with one POST; 403/422 refusals; run metadata mismatch for id, workflow id, path, event, branch, head SHA, attempt, repository and `main` advanced after the pin; failure/skipped/cancelled/timed_out; never-completes deadline; attempt changed after logs; modified after read; job count/conclusion/run/sha mismatch; logs 500/404/empty; duplicate/unexpected/malformed/missing claims; wrong aud/repository/ref/sha/run_id/attempt/environment/event/iss; empty/int/control-character `sub`; preconditions (workflow missing/path, default branch, repository, environment not main-only or with an extra policy, flag on/odd/unreadable, bad SHA, bad `BHA_REPO`, bad tuning) — each with no `evidence.json` and no POST where applicable |
| E | 90 | all-valid exact content, private modes, a second run in a new dir; five special `sub` values (`& | \ " ' $ #`, `\1`, `<ACCOUNT_ID>` text, unicode) byte-exact; invalid/missing inputs; evidence missing/not JSON/list/wrong status/format/aud/sub; for **each** of trust, deploy policy and instance policy: missing, not JSON, unknown placeholder, leftover in a key; content-violating templates (extra condition, wrong action, extra resource, wide read, wide ARN, `PutImage`); no `RENDER_ALL_VALID` and no leftover directory in any failure |
| F | 45 | match and exit 0 with only the two facts; differ, each inspect failing, both failing, empty and malformed outputs, stopped/missing target, bad `REF`/name, old psql, aws v1, raw host unreachable, missing tools, no `BHA_REPO` — never `BOOTSTRAP_MATCH`, only read-only `docker inspect` calls |
| B | 8 | existing main-only → zero writes; existing all-branches / extra policy / tag policy → stop, zero writes; absent → one PUT with only `deployment_branch_policy` and one POST, read-back verified; read-back wrong; read error → no blind PUT; bad repo → no call |

### 9.7 Bounded A–G audit (static plus the tests above; not cloud PASS)

| Packet | Purpose / mutation boundary | Finding | Action |
|---|---|---|---|
| A | read-only AWS observations; the Owner compares account, node, profile | no defect: only `get`/`list`/`describe` calls, stop conditions stated | unchanged |
| B | create/verify the main-only environment (a write) | **defect**: unconditional PUT on an existing environment (documented semantics unspecified for omitted reviewers/timer), no read-back, unquoted `<OWNER>/<REPO>` | rewritten, tested (8) |
| C | promotion (a write on a branch) | C1 packet | **byte-unchanged**: block hash `3e5dd1d72373a5b9` and §C text hash identical at `2a93c43` and now |
| D | dispatch + evidence (one workflow write) | P2 + no exact binding | rewritten, tested (276) |
| E | local private render | **defect** (fail-open loop; `sed` with an unescaped `$SUB`) | rewritten, tested (90) |
| F | read-only host facts | **defect** (equality of two failed commands; `<OWNER>` redirection) | rewritten, tested (45) |
| G | variables/flags (Owner writes) | no defect: six names only in the environment, two flags at repository scope, deploy never alone, P2 before P3; the workflow gates (CP01/CP03) enforce scope and flags | unchanged |

Out of allowance, recorded not fixed: the **publish role** policy has no template (only prose in §6/E), so packet E cannot render it; adding one would be a new IAM template path → needs an OC decision.

### 9.8 Unchanged proof, tools, limits, statuses

`git diff 2a93c43 -- .github/workflows/backend-oidc-probe.yml` is empty; packet C unchanged (hashes above); `git diff --stat 2a93c43` outside `docs/` is empty. B and F bodies linted with `koalaman/shellcheck:v0.10.0` (exit 0); D/E compiled with `python3 -m py_compile`; `git diff --check` clean; secret scan of the diff: nothing. Tools: bash 5.3.9, Python 3.14.4 (blocks avoid syntax newer than 3.8 but were **not run on 3.8**), `gh` 2.101.0 present but only the doubles were executed. The 88 C1 checks, the helper suite and Docker rehearsals were not rerun (packet C and all code unchanged). No skill invoked (`diagnosing-bugs` not triggered); Graphify `NOT_APPLICABLE`. The doubles encode my reading of the documented responses; the first real dispatch can still differ (§9.4).

IMPLEMENTATION_CP04_C2 `PASS` (correction checks only); REVIEW_CP04_C2 `NOT_RUN — OWNER_ONLY` (the earlier reviews cover `b69bba4` and `2a93c43`, not this head); CP04_LIVE `WAITING_OWNER`; PUBLISH_LIVE / DEPLOY_LIVE / ROLLBACK_LIVE / SSM_LIVE / CLOUD_WRITES `NOT_RUN`; BACKEND_CD `NOT_COMPLETE`.

## 10. C3 — EVIDENCE_IDENTITY_BINDING_AND_COMPLETE_IAM_PACKET (correction, 2026-10-10)

Sections 1–9 keep their attribution (`b69bba4`, `2a93c43` C1, `609cb11` C2). The Codex review of §9 covered `609cb11` only. This section is `BHA-BACKEND-CD-001-CP04-C3`, routed by OC (`CORRECTION_REQUIRED`) through the Owner. Nothing live ran: no AWS/GitHub call, no dispatch, no IAM/environment/variable/flag change, nothing applied.

### 10.1 Codex finding on `609cb11`, as returned

`[P2] Bind rendered trust to the expected repository — docs/runbooks/BHA-BACKEND-CD-001.md:582-583` — "If the Owner supplies a stale or incorrect `EVIDENCE_DIR`, this accepts any file with `status: verified`, the expected audience, and a printable `sub`; it never checks the evidence's `repo` or workflow identity. The renderer can therefore create a deploy-role trust policy for a different repository's subject. Validate the evidence identity against the intended repository and probe before using its `sub`." Codex found no other defect.

### 10.2 Identity

START_HEAD = `609cb11307969882be97cc168f38a29ab4693dae` (= local = `origin/<feature>` = PR #96 head; Draft; `origin/develop` = baseline `1f039b5…`; clean tree). FINAL_HEAD, GitHub additions/deletions and CI on it are in the handoff. The PR stays outside the 100–400 target because C2 already carried the D/E/F/B packets; C3 adds about 90 lines (E, one template, one test, this section).

### 10.3 Root cause and fix

Root cause: packet E derived everything it checked from the evidence file itself (`format`, `status`, `aud`, `sub`) and compared nothing with an identity the Owner had chosen, so a stale or foreign `EVIDENCE_DIR` passed. Fix (runbook §11.3 E; D, its producer, is unchanged): E now requires `BHA_REPO` (must be `emLamHD/The_BHA_hotels_Booking`, case-insensitive), `PROBE_WORKFLOW_ID`, `PROBE_RUN_ID`, `PROBE_RUN_ATTEMPT`, `PROBE_PINNED_SHA` (copied by the Owner from the `PROBE_EVIDENCE_VERIFIED` line of the D run it chose) and an absolute, existing `EVIDENCE_DIR` (no default, never the current directory). The expected identity comes from those inputs and constants of the packet, never from the file. It refuses an evidence object whose keys are not exactly the D schema; `format` not the integer 1; `status`/`aud` wrong; `repo` ≠ `BHA_REPO`; `workflow` ≠ exactly `.github/workflows/backend-oidc-probe.yml`; `workflow_id`/`run_id`/`run_attempt` not real positive integers (bool/float/string/null refused) or ≠ the inputs; `head_sha` ≠ `PROBE_PINNED_SHA`; `run_url`/`html_url` ≠ exactly `https://api.github.com/repos/<repo>/actions/runs/<id>` / `https://github.com/<repo>/actions/runs/<id>` (case-insensitive path; host, scheme, userinfo, port, query, fragment, trailing slash all fail). Refusals print a code with a field name only — never `sub`, payload or paths of the evidence — and happen before any file is rendered. The `sub` checks are unchanged (non-empty string ≤ 1024, no control character, no `*`/`?`) and the `sub` is inserted verbatim by JSON parse/serialise; no repository is inferred from it, so custom subject templates remain possible. Limit written into the runbook: identity matching rejects mistaken evidence; a hand-written JSON file with the right schema is not OIDC evidence — the anchor is a successful D run, its private directory and the identity lines the Owner saved; `RENDER_ALL_VALID` proves rendered content, not IAM authorisation.

### 10.4 Publish policy template (OC allowance) and `BatchGetImage`

New `deploy/showcase/iam/backend-release-publish-policy.json` (not applied anywhere): `Version 2012-10-17`; `ecr:GetAuthorizationToken` on `*`; and on the single `arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/<ECR_REPOSITORY>`: `DescribeRepositories`, `DescribeImages`, `BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`, `BatchGetImage`. The first seven are what `backend-ecr-publish.sh` (`describe-repositories`, `describe-images`) and `docker push` need; `BatchGetImage` is added on purpose because AWS's own single-repository push policy example lists it (<https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html>, read for this correction). §6 step 4 now says so and names the template. E renders it as the fourth file `publish-policy.json`; its validator checks `Version`, the exact statement key set, `Effect`, the exact action set (order-independent, no duplicates) and the exact repository ARN; every document must have exactly the top-level keys `Version` and `Statement`. Roles stay independent: publish role = `trust.json` + `publish-policy.json`, deploy role = `trust.json` + `deploy-policy.json`, instance role ← `instance-ecr.json`; the runbook adds the stop-and-compare instruction for customised OIDC subject templates (the verified `sub` came from the probe workflow, not from `backend-image.yml`).

One file outside the stated allowance had to change, with the Owner's explicit approval given in this session: the CP03 test `deploy/showcase/scripts/tests/test_backend_release.py` asserted that the IAM directory holds exactly three templates (`IamTemplates.test_every_template_is_valid_json_with_explicit_placeholders_only`). Change: the fourth file name added to that set and one new test `test_publish_policy_can_push_one_repository_and_nothing_else`; nothing else in the module moved.

### 10.5 RED — old E block (`609cb11`), synthetic evidence, scratch fixtures (3/3 defect checks)

Evidence for `other-org/other-repo`, another workflow, run 999999/attempt 7 and a canary subject: the old block exited 0, printed `RENDER_ALL_VALID`, and the written `trust.json` contained that foreign subject (compared in a separate process; the value is not in this report or the transcript). A stale run of the same repository and probe (run 4000, attempt 3, other SHA) was also accepted.

### 10.6 GREEN — the new E block, extracted verbatim (134 lines), 409 checks, 409 passed

Real templates copied into a scratch repository root per case; `TMPDIR` holds a pre-existing output directory with a sentinel file that must stay untouched and be the only entry after every refusal; a canary `sub` must never reach stdout/stderr.

| Group | Covered |
|---|---|
| valid | exit 0, four files in a private 0700/0600 directory, independent assertions of trust, publish policy (exact JSON), deploy and instance policies; second run in a new directory leaves the first intact |
| identity | case-only repo match (both sides); foreign repo (both consistent, evidence only, everything); 8 workflow near-misses; each of workflow ID, run ID, attempt, SHA wrong on either side (incl. uppercase, non-string); stale same-repo/probe run; Owner choosing another run/attempt/SHA/workflow |
| URLs | 12 `run_url` and 11 `html_url` variants (other host, http, userinfo, port, query, fragment, trailing slash, trailing `?`, other repo/run, swapped, trailing space) and a non-string |
| inputs | each of the ten inputs missing; malformed IDs (`0`, `01`, `abc`, `-1`, `1.5`, `1 `, empty) and SHAs; `EVIDENCE_DIR` empty/relative/`.`/missing/a file/an empty directory/evidence only in the current directory |
| evidence shape | not JSON, not an object (list, string, null, number), each of the 12 fields missing, an extra field, bool/float/string/null/zero/negative/list in each numeric field, `format` true/"1"/1.0/2/null/0, bad `status`/`aud` |
| `sub` | six accepted values kept byte-for-byte (special characters, placeholder-looking text, unicode, a custom non-`repo:` subject); empty, blank, int, null, `*`, `?`, control characters, 1025 characters refused |
| publish template | missing, not JSON, unknown placeholder, leftover in a key; each of the 8 actions removed; 9 extra actions; duplicate action; other repo/account/region ARN; repository wildcard; `*`; resource as list; token scoped to a repository; wrong token action; `Deny`; wrong `Version`; extra statement/key/top-level key; `NotAction`; action as string |
| whole-result failure | early file bad with the rest valid, late file bad with the rest valid, two bad files, and each of the other three templates missing/broken/unknown placeholder/content — never `RENDER_ALL_VALID`, only this run's files removed |

### 10.7 Other checks, unchanged proof, tools, limits

* `python3 -m py_compile` on the extracted E Python (exit 0) and `bash -n` on the extracted block; the only shell is the heredoc wrapper line, so no ShellCheck result is claimed for E. JSON template validated (`python3 -m json.tool`). `IamTemplates` 5 tests OK; the whole `test_backend_release` module 64 tests OK (2.3 s).
* Unchanged since `609cb11`: the executable blocks B, C, D, F (hashes `7152150919fb38d1`, `3e5dd1d72373a5b9`, `6e1dbc6e6bb7c385`, `8ec6359f9625be22`, identical) and the whole text of sections B, C, D, F, G; `git diff 609cb11` is empty for `.github/`, `deploy/showcase/scripts/` (except the one test), `Back_End/`, `Front_End/` and the three existing IAM templates.
* `NOT_RERUN_UNCHANGED`: the C1 88 checks, the C2 D/B/F suites (276/8/45) and the helper suite apart from the module named above — their inputs are byte-identical, and no total of an earlier head is attributed to this one.
* `git diff --check` clean; secret scan of the diff finds no key, token or 12-digit number. bash 5.3.9, Python 3.14.4 (not run on 3.8). No skill invoked (`diagnosing-bugs` not triggered: cause known); Graphify `NOT_APPLICABLE`.

IMPLEMENTATION_CP04_C3 `PASS` (correction checks only); REVIEW_CP04_C3 `NOT_RUN — OWNER_ONLY`; CP04_LIVE `WAITING_OWNER`; PUBLISH_LIVE / DEPLOY_LIVE / ROLLBACK_LIVE / SSM_LIVE / CLOUD_WRITES `NOT_RUN`; BACKEND_CD `NOT_COMPLETE`.
