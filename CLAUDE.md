# CLAUDE.md — The BHA Hotels Booking

@AGENTS.md

`AGENTS.md` is the shared contract for the prompt-selected implementer/reviewer role pair. Read it in full. If the `@AGENTS.md` import is not resolved by the current Claude Code version, open root `AGENTS.md` directly before acting.

Claude-specific adapter:

- Claude's role in a work item is whatever the current Master Execution Prompt selects — `IMPLEMENTER: CLAUDE` or `REVIEWER: CLAUDE_READ_ONLY` — never both in the same work item. Claude does not infer it might hold the other role, or both roles, for a work item; see `AGENTS.md` §2 and `docs/governance/RULES.md` §2.4/§3.1 for the two allowed pairs and the work-item-lifetime role lock.

### When `IMPLEMENTER: CLAUDE` (Claude is `ACTIVE_EXECUTOR`)

- Claude is the sole writable `ACTIVE_EXECUTOR` for that work item. Claude requires the current Master Execution Prompt (`WORK_ITEM`, `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`, `REPOSITORY`, `FEATURE_BRANCH`, baseline, scope, acceptance, checks, skill policy, the full independent-review contract — `INDEPENDENT_REVIEW_INVOKER: OWNER_ONLY`, `REVIEW_BASE`/`REVIEW_BASE_SHA`/`REVIEW_TARGET`, `CODEX_REVIEW_COMMAND` and invocation limit — and stop conditions) before making any edit; a missing or invalid field is `BLOCKED` at preflight, not discovered only after implementation. The project uses exactly one existing repository checkout — `git worktree add` and any additional execution checkout are prohibited, with no exception; see `AGENTS.md` §8 / `docs/governance/RULES.md` §5.
- Claude stops all mutations at a stable checkpoint and, in the completion report, outputs `READY_FOR_CODEX_REVIEW` with the resolved `REVIEW_BASE_SHA` and exact `FINAL_HEAD`, followed by the exact command Owner must invoke (e.g. `/codex:review --wait --base origin/develop`, or the command given in the Master Execution Prompt).
- Claude must not attempt to invoke `/codex:review`, or any other Codex command, itself. Only Owner invokes native Codex review.
- Claude must never invoke or trigger `/codex:adversarial-review` itself. It remains prohibited by default and is permitted only when OC explicitly authorizes it for a high-risk work item in the current Master Execution Prompt and that prompt supplies the exact adversarial-review command; Owner remains the sole invoker in every case. When explicitly authorized, Claude may only stop writing, declare the review checkpoint and instruct Owner to invoke the exact prompt-supplied command — announcing that required Owner action is not equivalent to Claude invoking it. If adversarial review is not explicitly authorized, or the exact command is missing, Claude must not infer permission or construct a command.
- Claude must not use `/codex:rescue`, `/codex:transfer`, Codex write mode, automatic review gates, subagents or parallel implementation, unconditionally.
- After Owner invokes the review, Owner forwards Claude's already-submitted completion report and the review result directly to OC as two separate items — Claude stays stopped and is never recalled merely to insert the result into its report (`docs/governance/RULES.md` §3.6).
- Claude never silently fixes a Codex finding; a fix requires an OC correction prompt routed through Owner.
- A correction always returns write authority to Claude as the same original implementer of that work item. Claude never hands a work item to Codex mid-item and never infers such a transfer is authorized (`docs/governance/RULES.md` §3.1).

### When `REVIEWER: CLAUDE_READ_ONLY` (Claude is the independent reviewer)

- Owner opens a separate Claude review session — separate from the implementer's session, not a second checkout. It reads the same single active execution checkout, pinned at the stable Git checkpoint the implementer left it in (`REVIEW_BASE_SHA`, `FINAL_HEAD`), with the review contract.
- This session must not create a linked worktree, clone, or any additional execution checkout — `git worktree add` remains prohibited with no exception (`docs/governance/RULES.md` §5).
- Claude performs no working-tree mutation in this role: no file edits, formatter writes, commits, pushes, PR changes, merges or branch deletion. If a credible read-only runtime/permission configuration cannot be established for the session, Claude reports the review as `NOT RUN` and the work item is `BLOCKED`, rather than proceeding as if it were read-only.
- Claude does not invoke itself into this role, does not invoke the paired implementer (Codex), and does not fix findings — Claude returns findings only, for Owner and OC.

### In both roles

- Claude cannot hold `IMPLEMENTER` and `REVIEWER` for the same work item, and Claude's own self-review while implementing never satisfies the independent-review gate that a separate reviewer must clear.
- Claude does not merge, mark a PR Ready, delete branches, create a worktree, transfer work to another agent, or start a parallel/nested implementation, in either role.
- Use Claude-specific tools only within the authority and scope granted by `AGENTS.md`, `docs/governance/RULES.md` and the Master Execution Prompt.
- If this adapter conflicts with `AGENTS.md` or `docs/governance/RULES.md`, stop and report the contradiction; do not choose the broader interpretation.
