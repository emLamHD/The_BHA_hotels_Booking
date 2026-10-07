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

import type { AssignmentCreateOutcome, MoveAssignmentOutcome, UnassignAssignmentOutcome } from "@/lib/api/client";

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
        // PMS-CAL-001.3-CP03-C1: not only configuration — the board also refuses
        // before sending while a lost write locks the room; `detail` says which.
        title: "The request was not sent. Nothing was saved.",
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

/**
 * PMS-CAL-001.2-CP04C.4: the move-attempt counterpart to
 * {@link describeAssignmentOutcome}, sharing the same two rules and the same
 * {@link AssignmentOutcomeView} shape — the dialog that renders a move's
 * result needs no separate presentation contract from the one that renders a
 * create's. Only the wording changes ("assignment" → "move"); the
 * reload/resubmit policy per category is identical, including
 * `cross-room-type-confirmation-required` staying resubmittable as defense
 * in depth even though the same-RoomType-only move dialog never sends
 * `confirmCrossRoomType: true` itself.
 */
export function describeMoveOutcome(outcome: MoveAssignmentOutcome): AssignmentOutcomeView {
  switch (outcome.kind) {
    case "moved":
      return { tone: "success", title: "Room moved.", reloadBoard: true, allowResubmit: false };

    case "not-sent":
      return {
        tone: "error",
        // PMS-CAL-001.3-CP03-C1: not only configuration — the board also refuses
        // before sending while a lost write locks the room; `detail` says which.
        title: "The request was not sent. Nothing was saved.",
        detail: outcome.message,
        reloadBoard: false,
        allowResubmit: true,
      };

    case "rejected":
      switch (outcome.category) {
        case "validation":
          return {
            tone: "error",
            title: "The server did not accept this move. Nothing was saved.",
            detail: outcome.detail,
            reloadBoard: false,
            allowResubmit: true,
          };
        case "not-permitted":
          return {
            tone: "error",
            title: "Room move is not available or not permitted from this Admin session. Nothing was saved.",
            detail:
              outcome.status === 404
                ? "Writes may be disabled on this API host. This does not mean the booking was removed."
                : "The server refused this write.",
            reloadBoard: false,
            allowResubmit: false,
          };
        case "cross-room-type-confirmation-required":
          return {
            tone: "error",
            title: "This destination requires cross-room-type confirmation, which this dialog does not offer. Nothing was saved.",
            detail: outcome.detail ?? "Choose a room of the sold room type instead.",
            reloadBoard: false,
            allowResubmit: true,
          };
        case "conflict":
          return {
            tone: "warning",
            title:
              "This move was not saved: the schedule has changed or the room is no longer suitable. Review the reloaded board before trying again.",
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
          "The result could not be confirmed — the move may or may not have been saved. It was not retried automatically. Check the reloaded board before trying again.",
        detail: cause,
        reloadBoard: true,
        allowResubmit: false,
      };
    }
  }
}

/**
 * PMS-CAL-001.2-CP04D.4A: the unassign-attempt counterpart, sharing the same
 * two rules and the same {@link AssignmentOutcomeView} shape. Only the wording
 * and two category rules differ from create/move:
 *
 * - An unassign removes one room assignment, never the booking, so no text
 *   here speaks of a cancelled/deleted Reservation, and a `403`/`404` is
 *   never worded as though the booking or segment were gone (a `404` is most
 *   often the closed local write gate).
 * - An unassign has no destination, hence no cross-RoomType semantics. If a
 *   `cross-room-type-confirmation-required` outcome ever arrives it is a
 *   contract mismatch, not something the operator can act on: it is treated
 *   as the generic not-permitted refusal — no RoomType/reason guidance, no
 *   resubmit, and the server's own text is not echoed.
 * - `unassigned` is success whether or not its `200` body could be read.
 */
export function describeUnassignOutcome(outcome: UnassignAssignmentOutcome): AssignmentOutcomeView {
  switch (outcome.kind) {
    case "unassigned":
      return {
        tone: "success",
        title: "Room assignment removed.",
        detail: "Only this room assignment was removed. The reservation itself is unchanged.",
        reloadBoard: true,
        allowResubmit: false,
      };

    case "not-sent":
      return {
        tone: "error",
        title: "The unassign request was not sent. Nothing was changed on the server.",
        detail: outcome.message,
        reloadBoard: false,
        allowResubmit: true,
      };

    case "rejected":
      switch (outcome.category) {
        case "validation":
          return {
            tone: "error",
            title: "The server did not accept this unassign request. No assignment change was saved.",
            detail: outcome.detail,
            reloadBoard: false,
            allowResubmit: true,
          };
        case "not-permitted":
        case "cross-room-type-confirmation-required":
          return {
            tone: "error",
            title:
              "Unassigning a room is not available or not permitted from this Admin session. No assignment change was saved.",
            detail:
              outcome.status === 404
                ? "Writes may be disabled on this API host. It does not indicate a problem with the booking."
                : "The server refused this write.",
            reloadBoard: false,
            allowResubmit: false,
          };
        case "conflict":
          return {
            tone: "warning",
            title:
              "This unassign was not saved: the room assignment has changed or is no longer current. Review the reloaded board before trying again.",
            detail: outcome.detail,
            reloadBoard: true,
            allowResubmit: false,
          };
        case "refused":
        default:
          return {
            tone: "error",
            title: `The server refused the request (HTTP ${outcome.status}). No assignment change was saved.`,
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
              : "The connection to the Admin API could not be completed.";
      return {
        tone: "warning",
        title:
          "The result could not be confirmed — the room assignment may or may not have been removed. It was not retried automatically. Check the reloaded board before trying again.",
        detail: `${cause} Closing this dialog does not stop or undo a request that was already sent.`,
        reloadBoard: true,
        allowResubmit: false,
      };
    }
  }
}
