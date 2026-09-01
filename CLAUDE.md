# CLAUDE.md — The BHA Hotels Booking

@AGENTS.md

`AGENTS.md` is the shared contract for the prompt-selected implementer/reviewer role pair. Read it in full. If the `@AGENTS.md` import is not resolved by the current Claude Code version, open root `AGENTS.md` directly before acting.

Claude-specific adapter:

- Each Master Execution Prompt selects `IMPLEMENTER: CLAUDE` + `REVIEWER: CODEX_READ_ONLY`, or `IMPLEMENTER: CODEX` + `REVIEWER: CLAUDE_READ_ONLY` (`docs/governance/RULES.md` §2.4). Claude cannot hold both roles for the same work item, and the role does not change during that work item.
- If `IMPLEMENTER: CLAUDE`: Claude is the sole writable `ACTIVE_EXECUTOR`. Claude requires the current Master Execution Prompt (`WORK_ITEM`, `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY`, `REPOSITORY`, `FEATURE_BRANCH`, baseline, scope, acceptance, checks, skill policy, stop conditions) before making any edit. The project uses exactly one existing repository checkout — `git worktree add` and any additional execution checkout are prohibited, with no exception; see `AGENTS.md` §8 / `docs/governance/RULES.md` §5.
- Claude stops all mutations at a stable checkpoint and, in the completion report, outputs `READY_FOR_CODEX_REVIEW` followed by the exact command Owner must invoke (e.g. `/codex:review --wait --base origin/develop`, or the command given in the Master Execution Prompt).
- Claude must not attempt to invoke `/codex:review`, or any other Codex command, itself. Only Owner invokes native Codex review.
- Claude must never invoke or trigger `/codex:adversarial-review` itself. It remains prohibited by default and is permitted only when OC explicitly authorizes it for a high-risk work item in the current Master Execution Prompt and that prompt supplies the exact adversarial-review command; Owner remains the sole invoker in every case. When explicitly authorized, Claude may only stop writing, declare the review checkpoint and instruct Owner to invoke the exact prompt-supplied command — announcing that required Owner action is not equivalent to Claude invoking it. If adversarial review is not explicitly authorized, or the exact command is missing, Claude must not infer permission or construct a command.
- Claude must not use `/codex:rescue`, `/codex:transfer`, Codex write mode, automatic review gates, subagents or parallel implementation, unconditionally.
- After Owner invokes the review and shares the result, Claude may preserve the returned result verbatim in the completion report when Owner explicitly asks it to continue reporting.
- Claude never silently fixes a Codex finding; a fix requires an OC correction prompt routed through Owner.
- A correction always returns write authority to Claude as the same original implementer of that work item; Claude never hands a work item to Codex mid-item.
- If `REVIEWER: CLAUDE_READ_ONLY`: Claude only reads and returns findings for Owner and OC — no file edits, formatter writes, commits, pushes, PR changes, merges or branch deletion. Claude does not invoke itself into this role and does not fix findings.
- If Claude is not selected as `IMPLEMENTER` or `REVIEWER` for a work item, Claude does not act on it.
- Use Claude-specific tools only within the authority and scope granted by `AGENTS.md`, `docs/governance/RULES.md` and the Master Execution Prompt.
- If this adapter conflicts with `AGENTS.md` or `docs/governance/RULES.md`, stop and report the contradiction; do not choose the broader interpretation.
