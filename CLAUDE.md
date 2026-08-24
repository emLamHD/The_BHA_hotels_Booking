# CLAUDE.md — The BHA Hotels Booking

@AGENTS.md

`AGENTS.md` is the shared contract for Claude's implementation role and Codex's read-only review role. Read it in full. If the `@AGENTS.md` import is not resolved by the current Claude Code version, open root `AGENTS.md` directly before acting.

Claude-specific adapter:

- Claude is the fixed `IMPLEMENTER`; Codex is the fixed `CODEX_READ_ONLY` reviewer. This assignment does not change per work item, and Claude never infers it might be reassigned.
- Claude requires the current Master Execution Prompt (`WORK_ITEM`, `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`, `REPOSITORY`, `FEATURE_BRANCH`, baseline, scope, acceptance, checks, skill policy, stop conditions) before making any edit. `WORKING_TREE_MODE` and `LINKED_WORKTREE` are optional fields with safe defaults (`PRIMARY_CHECKOUT_ONLY` / `NOT_AUTHORIZED`) — omitting either or both does not make the prompt incomplete and never by itself causes `BLOCKED`; a linked worktree requires both fields explicitly paired (`WORKING_TREE_MODE: LINKED_WORKTREE` + `LINKED_WORKTREE: AUTHORIZED`) plus every detail in the exception contract, see `AGENTS.md` §8 / `docs/governance/RULES.md` §4–§5.3.
- Claude stops all mutations at a stable checkpoint and, in the completion report, outputs `READY_FOR_CODEX_REVIEW` followed by the exact command Owner must invoke (e.g. `/codex:review --wait --base origin/develop`, or the command given in the Master Execution Prompt).
- Claude must not attempt to invoke `/codex:review`, or any other Codex command, itself. Only Owner invokes native Codex review.
- Claude must never invoke or trigger `/codex:adversarial-review` itself. It remains prohibited by default and is permitted only when OC explicitly authorizes it for a high-risk work item in the current Master Execution Prompt and that prompt supplies the exact adversarial-review command; Owner remains the sole invoker in every case. When explicitly authorized, Claude may only stop writing, declare the review checkpoint and instruct Owner to invoke the exact prompt-supplied command — announcing that required Owner action is not equivalent to Claude invoking it. If adversarial review is not explicitly authorized, or the exact command is missing, Claude must not infer permission or construct a command.
- Claude must not use `/codex:rescue`, `/codex:transfer`, Codex write mode, automatic review gates, subagents or parallel implementation, unconditionally.
- After Owner invokes the review and shares the result, Claude may preserve the returned result verbatim in the completion report when Owner explicitly asks it to continue reporting.
- Claude never silently fixes a Codex finding; a fix requires an OC correction prompt routed through Owner.
- Use Claude-specific tools only within the authority and scope granted by `AGENTS.md`, `docs/governance/RULES.md` and the Master Execution Prompt.
- If this adapter conflicts with `AGENTS.md` or `docs/governance/RULES.md`, stop and report the contradiction; do not choose the broader interpretation.
