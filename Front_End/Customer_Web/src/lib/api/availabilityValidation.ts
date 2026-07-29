import { AvailabilityQuery } from "./availabilityTypes";

export const MAX_STAY_NIGHTS = 30;
export const MAX_REQUESTED_ROOMS = 10;

/** Editable draft form values, kept as raw strings until validated on submit. */
export interface AvailabilityDraft {
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
  rooms: string;
}

export interface AvailabilityFieldErrors {
  checkIn?: string;
  checkOut?: string;
  adults?: string;
  children?: string;
  rooms?: string;
}

export type AvailabilityValidationResult =
  | { ok: true; value: AvailabilityQuery }
  | { ok: false; errors: AvailabilityFieldErrors };

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

function parseIsoDate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Howard Hinnant's "days from civil" algorithm: converts a proleptic
 * Gregorian (year, month, day) to a day count since 1970-01-01 using only
 * integer arithmetic. Deliberately avoids constructing a `Date` and
 * subtracting timestamps, which would be sensitive to the host's local
 * time zone and DST transitions.
 */
function daysFromCivil({ year, month, day }: CivilDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * Calendar-day distance between two ISO "YYYY-MM-DD" hotel dates, matching
 * the backend's half-open `checkIn <= stayDate < checkOut` semantics. Returns
 * `null` for a malformed value rather than throwing. Pure integer math — no
 * local-time/DST drift regardless of the host's time zone.
 */
export function calculateNights(checkIn: string, checkOut: string): number | null {
  const start = parseIsoDate(checkIn);
  const end = parseIsoDate(checkOut);
  if (!start || !end) {
    return null;
  }
  return daysFromCivil(end) - daysFromCivil(start);
}

function parseStructuralInteger(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) {
    return null;
  }
  return Number(raw);
}

/**
 * Rejects only clear structural violations (missing dates, reversed/equal
 * dates, a stay over MAX_STAY_NIGHTS, non-integer or out-of-range guest/room
 * counts). Does not attempt the Property-local past-date rule — the backend
 * remains the sole authority for that, since the browser's local date is not
 * a trustworthy stand-in for the Property's time zone.
 */
export function validateAvailabilityDraft(
  draft: AvailabilityDraft
): AvailabilityValidationResult {
  const errors: AvailabilityFieldErrors = {};

  if (!draft.checkIn) {
    errors.checkIn = "Check-in date is required.";
  }
  if (!draft.checkOut) {
    errors.checkOut = "Check-out date is required.";
  }

  if (!errors.checkIn && !errors.checkOut) {
    const nights = calculateNights(draft.checkIn, draft.checkOut);
    if (nights === null) {
      errors.checkOut = "Enter valid check-in and check-out dates.";
    } else if (nights <= 0) {
      errors.checkOut = "Check-out must be after check-in.";
    } else if (nights > MAX_STAY_NIGHTS) {
      errors.checkOut = `Stay cannot exceed ${MAX_STAY_NIGHTS} nights.`;
    }
  }

  const adults = parseStructuralInteger(draft.adults);
  if (adults === null || adults < 1) {
    errors.adults = "Adults must be at least 1.";
  }

  const children = parseStructuralInteger(draft.children);
  if (children === null || children < 0) {
    errors.children = "Children cannot be negative.";
  }

  const rooms = parseStructuralInteger(draft.rooms);
  if (rooms === null || rooms < 1 || rooms > MAX_REQUESTED_ROOMS) {
    errors.rooms = `Rooms must be between 1 and ${MAX_REQUESTED_ROOMS}.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      adults: adults as number,
      children: children as number,
      rooms: rooms as number,
    },
  };
}
