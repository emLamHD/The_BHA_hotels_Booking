/**
 * PMS-CAL-001.2-CP03A: the one place that decides what an operator is told,
 * and what the board does next, after an assignment-create attempt. Kept pure
 * so every branch is covered by unit tests rather than inferred from UI.
 *
 * Two rules shape everything here:
 *
 * 1. Nothing is claimed that was not observed. Only `created` says the
 *    assignment was saved; `unknown` says the result could not be confirmed —
 *    it is never worded as a failure, and never as a cancellation.
 * 2. Resubmitting is offered only when the server has *proven* nothing was
 *    written and a different choice could succeed (a `400`, or a request that
 *    never left the browser). After a conflict or an unknown result the
 *    selection may be stale or already applied, so the operator goes back to
 *    the freshly reloaded board instead of pressing Confirm again.
 */

import type { AssignmentCreateOutcome } from "@/lib/api/client";

export type AssignmentOutcomeTone = "success" | "error" | "warning";

export interface AssignmentOutcomeView {
  tone: AssignmentOutcomeTone;
  title: string;
  /** Server-provided, already sanitized, plain text — rendered as text, never as HTML. */
  detail?: string;
  /** Re-read the authoritative board from the backend. */
  reloadBoard: boolean;
  /** The same dialog may submit again. */
  allowResubmit: boolean;
}

export function describeAssignmentOutcome(outcome: AssignmentCreateOutcome): AssignmentOutcomeView {
  switch (outcome.kind) {
    case "created":
      return { tone: "success", title: "Room assigned.", reloadBoard: true, allowResubmit: false };

    case "not-sent":
      return {
        tone: "error",
        title: "The request was not sent because the Admin API is not configured.",
        detail: outcome.message,
        reloadBoard: false,
        allowResubmit: true,
      };

    case "rejected":
      switch (outcome.category) {
        case "validation":
          return {
            tone: "error",
            title: "The server did not accept this assignment. Nothing was saved.",
            detail: outcome.detail,
            reloadBoard: false,
            allowResubmit: true,
          };
        case "not-permitted":
          return {
            tone: "error",
            title:
              "Room assignment is not available or not permitted from this Admin session. Nothing was saved.",
            detail:
              outcome.status === 404
                ? "Writes may be disabled on this API host. This does not mean the booking was removed."
                : "The server refused this write.",
            reloadBoard: false,
            allowResubmit: false,
          };
        case "cross-room-type-confirmation-required":
          // PMS-CAL-001.2-CP03B: the dialog already blocks sending without a
          // confirmed acknowledgement and a non-empty reason, so this is
          // defense in depth against a contract mismatch, not the expected
          // path. Nothing was written — the store rolls back before
          // responding — so the same room/reason may be resubmitted once
          // corrected.
          return {
            tone: "error",
            title: "This cross-room-type placement was not confirmed. Nothing was saved.",
            detail: outcome.detail ?? "Confirm the placement and enter a reason, then try again.",
            reloadBoard: false,
            allowResubmit: true,
          };
        case "conflict":
          return {
            tone: "warning",
            title:
              "This assignment was not saved: the schedule has changed or the room is no longer suitable. Review the reloaded board before trying again.",
            detail: outcome.detail,
            reloadBoard: true,
            allowResubmit: false,
          };
        case "refused":
        default:
          return {
            tone: "error",
            title: `The server refused the request (HTTP ${outcome.status}). Nothing was saved.`,
            detail: outcome.detail,
            reloadBoard: false,
            allowResubmit: false,
          };
      }

    case "unknown":
    default: {
      const cause =
        outcome.reason === "timeout"
          ? "The server did not respond in time."
          : outcome.reason === "server-error"
            ? `The server returned an unexpected response${outcome.status ? ` (HTTP ${outcome.status})` : ""}.`
            : outcome.reason === "aborted"
              ? "The request was interrupted after it was sent."
              : "The connection to the Admin API failed.";
      return {
        tone: "warning",
        title:
          "The result could not be confirmed — the assignment may or may not have been saved. It was not retried automatically. Check the reloaded board before trying again.",
        detail: cause,
        reloadBoard: true,
        allowResubmit: false,
      };
    }
  }
}
