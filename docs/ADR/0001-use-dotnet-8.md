# ADR 0001: Use .NET 8 for the foundation

- Status: Accepted
- Date: 2026-07-20

## Context

The foundation needs a stable backend baseline for local development, local production simulation, and automated CI validation. Compatibility with the current codebase, the team's existing .NET 8 experience, and short-term operational stability are more important than adopting a newer major SDK in this pull request.

## Decision

The project deliberately uses .NET 8 for the current foundation. Every backend project targets `net8.0`, the repository pins the .NET SDK to `8.0.423`, and roll-forward is allowed only within the .NET 8 release line.

This decision does not claim that .NET 8 is required for payment processing. Payment compatibility will be evaluated only after a payment provider has been selected and its supported platforms and integration requirements are known.

## Consequences

- Local development, local production simulation, and GitHub Actions use the same .NET major version.
- The repository does not introduce .NET 9 or .NET 10 dependencies in this foundation.
- The team must create and execute an upgrade plan before .NET 8 reaches end of support on 2026-11-10.
- Provider-specific payment requirements remain deferred and cannot be inferred from this platform decision.
