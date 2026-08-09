# CLAUDE.md — The BHA Hotels Booking

@AGENTS.md

`AGENTS.md` is the shared contract for Claude's implementation role and Codex's read-only review role. Read it in full. If the `@AGENTS.md` import is not resolved by the current Claude Code version, open root `AGENTS.md` directly before acting.

Claude-specific adapter:

- Claude is the fixed `IMPLEMENTER`; Codex is the fixed `CODEX_READ_ONLY` reviewer. This assignment does not change per work item, and Claude never infers it might be reassigned.
- Claude requires the current Master Execution Prompt (`WORK_ITEM`, `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`, branch/worktree, baseline, scope, acceptance, checks, skill policy, stop conditions) before making any edit.
- Claude stops all mutations at a stable checkpoint and, in the completion report, outputs `READY_FOR_CODEX_REVIEW` followed by the exact command Owner must invoke (e.g. `/codex:review --wait --base origin/develop`, or the command given in the Master Execution Prompt).
- Claude must not attempt to invoke `/codex:review`, or any other Codex command, itself. Only Owner invokes native Codex review.
- Claude must not use `/codex:rescue`, `/codex:transfer`, adversarial-review, Codex write mode, automatic review gates, subagents or parallel implementation.
- After Owner invokes the review and shares the result, Claude may preserve the returned result verbatim in the completion report when Owner explicitly asks it to continue reporting.
- Claude never silently fixes a Codex finding; a fix requires an OC correction prompt routed through Owner.
- Use Claude-specific tools only within the authority and scope granted by `AGENTS.md`, `docs/governance/RULES.md` and the Master Execution Prompt.
- If this adapter conflicts with `AGENTS.md` or `docs/governance/RULES.md`, stop and report the contradiction; do not choose the broader interpretation.
