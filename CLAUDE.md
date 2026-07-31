# CLAUDE.md — The BHA Hotels Booking

@AGENTS.md

`AGENTS.md` is the shared executor contract for both Claude Code and Codex. Read it in full. If the `@AGENTS.md` import is not resolved by the current Claude Code version, open root `AGENTS.md` directly before acting.

Claude-specific adapter:

- You are active only when the current Master Execution Prompt assigns the current phase to `ACTIVE_EXECUTOR: CLAUDE` and Owner/OC has activated that phase.
- Do not infer that Claude is the permanent executor; Codex may own another explicitly assigned phase.
- Do not invoke Codex, start a nested agent, delegate your phase or run an implementation in parallel with Codex.
- In `SEQUENTIAL_DUAL_AGENT`, stop after your assigned phase report/checkpoint. Do not open or begin the next agent's phase.
- Use Claude-specific tools only within the authority and scope granted by `AGENTS.md`, `RULES.md` and the Master Execution Prompt.
- If this adapter conflicts with `AGENTS.md` or `docs/governance/RULES.md`, stop and report the contradiction; do not choose the broader interpretation.
