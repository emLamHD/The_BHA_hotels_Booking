import { AvailabilityQuery } from "./availabilityTypes";
import {
  AvailabilityDraft,
  AvailabilityFieldErrors,
  validateAvailabilityDraft,
} from "./availabilityValidation";

export type AvailabilityFormSubmitOutcome = "locked" | "invalid" | "started";

export interface AvailabilityFormSubmitDeps {
  /** The Hold coordinator's read-only, synchronous, same-tick lock check. */
  isAvailabilitySearchLocked: () => boolean;
  setFieldErrors: (errors: AvailabilityFieldErrors) => void;
  /** Starts the actual (still separately gated) Availability search for a valid query. */
  runSearch: (query: AvailabilityQuery) => void;
}

/**
 * The single orchestration path for an explicit Availability form submit
 * (a fresh search — "Retry last search" reuses an already-submitted query
 * and so has no draft to validate). Consults the authoritative same-tick
 * Hold-flow lock *before* draft validation or any field-error state change,
 * so a locked same-tick submit is a complete no-op regardless of whether
 * the current draft is valid or invalid — matching exactly what
 * `SectionAvailabilitySearch.handleSubmit` must do and what its Vitest
 * coverage exercises directly, not a detached duplicate of the rule.
 *
 * `runSearch` still separately consults the committing
 * `tryBeginAvailabilitySearch()` gate (see `bookingHoldFlowController.ts`)
 * exactly once for a valid, unlocked draft — this function only decides
 * whether to reach that point at all.
 */
export function runAvailabilityFormSubmit(
  draft: AvailabilityDraft,
  deps: AvailabilityFormSubmitDeps
): AvailabilityFormSubmitOutcome {
  if (deps.isAvailabilitySearchLocked()) {
    return "locked";
  }

  const result = validateAvailabilityDraft(draft);
  if (!result.ok) {
    deps.setFieldErrors(result.errors);
    return "invalid";
  }

  deps.setFieldErrors({});
  deps.runSearch(result.value);
  return "started";
}
