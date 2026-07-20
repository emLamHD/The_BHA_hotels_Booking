# ADR 0001: Use .NET 8 for the foundation

- Status: Accepted
- Date: 2026-07-20

## Context

The foundation needs a stable backend baseline for local development, local production simulation, and automated CI validation. Compatibility with the current codebase, the team's existing .NET 8 experience, and operational stability support a consistent backend platform.

## Decision

The project uses .NET 8 as its fixed backend platform, following the project owner's final decision. Every backend project targets `net8.0`, the repository pins the .NET SDK to `8.0.423`, and roll-forward is allowed only within the .NET 8 release line.

There is no backlog item, deadline, or plan to change the backend major framework. The platform decision is final and is not subject to further reconsideration.

This decision does not claim that .NET 8 is required for payment processing. Payment compatibility will be evaluated only after a payment provider has been selected and its supported platforms and integration requirements are known.

## Consequences

- Local development, local production simulation, and GitHub Actions use the same .NET major version.
- The SDK remains pinned within the .NET 8 release line.
- No issue, deadline, backlog item, or implementation plan is created for a backend major framework change.
- Provider-specific payment requirements remain deferred and cannot be inferred from this platform decision.
