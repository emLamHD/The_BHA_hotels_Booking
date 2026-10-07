import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AvailabilityDraft,
  calculateNights,
  MAX_REQUESTED_ROOMS,
  MAX_STAY_NIGHTS,
  validateAvailabilityDraft,
} from "../availabilityValidation";

function draft(overrides: Partial<AvailabilityDraft> = {}): AvailabilityDraft {
  return {
    checkIn: "2026-08-01",
    checkOut: "2026-08-03",
    adults: "2",
    children: "0",
    rooms: "1",
    ...overrides,
  };
}

describe("calculateNights", () => {
  it("computes the half-open calendar-day distance", () => {
    expect(calculateNights("2026-08-01", "2026-08-03")).toBe(2);
    expect(calculateNights("2026-08-01", "2026-08-02")).toBe(1);
  });

  it("returns zero for equal dates and a negative value for reversed dates", () => {
    expect(calculateNights("2026-08-01", "2026-08-01")).toBe(0);
    expect(calculateNights("2026-08-03", "2026-08-01")).toBe(-2);
  });

  it("is correct across a month and year boundary", () => {
    expect(calculateNights("2026-07-30", "2026-08-02")).toBe(3);
    expect(calculateNights("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("is correct across a leap-year February boundary", () => {
    expect(calculateNights("2028-02-27", "2028-03-01")).toBe(3);
  });

  it("returns null for a malformed date string", () => {
    expect(calculateNights("not-a-date", "2026-08-03")).toBeNull();
    expect(calculateNights("2026-08-01", "")).toBeNull();
  });

  describe("independence from the host's local time zone", () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it("returns the same night count regardless of process.env.TZ", () => {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      const eastResult = calculateNights("2026-08-01", "2026-08-03");
      process.env.TZ = "Etc/GMT+12"; // UTC-12
      const westResult = calculateNights("2026-08-01", "2026-08-03");

      expect(eastResult).toBe(2);
      expect(westResult).toBe(2);
      expect(eastResult).toBe(westResult);
    });
  });
});

describe("validateAvailabilityDraft", () => {
  it("accepts a valid draft and returns parsed numeric values", () => {
    const result = validateAvailabilityDraft(draft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        adults: 2,
        children: 0,
        rooms: 1,
      });
    }
  });

  it("rejects a missing check-in or check-out date", () => {
    expect(validateAvailabilityDraft(draft({ checkIn: "" })).ok).toBe(false);
    expect(validateAvailabilityDraft(draft({ checkOut: "" })).ok).toBe(false);
  });

  it("rejects equal check-in/check-out dates", () => {
    const result = validateAvailabilityDraft(
      draft({ checkIn: "2026-08-01", checkOut: "2026-08-01" })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a reversed date range", () => {
    const result = validateAvailabilityDraft(
      draft({ checkIn: "2026-08-03", checkOut: "2026-08-01" })
    );
    expect(result.ok).toBe(false);
  });

  it(`accepts exactly ${MAX_STAY_NIGHTS} nights and rejects ${MAX_STAY_NIGHTS + 1}`, () => {
    const okResult = validateAvailabilityDraft(
      draft({ checkIn: "2026-08-01", checkOut: "2026-08-31" })
    );
    expect(okResult.ok).toBe(true);

    const tooLongResult = validateAvailabilityDraft(
      draft({ checkIn: "2026-08-01", checkOut: "2026-09-01" })
    );
    expect(tooLongResult.ok).toBe(false);
  });

  it("rejects adults less than 1", () => {
    expect(validateAvailabilityDraft(draft({ adults: "0" })).ok).toBe(false);
    expect(validateAvailabilityDraft(draft({ adults: "-1" })).ok).toBe(false);
  });

  it("accepts adults of exactly 1", () => {
    expect(validateAvailabilityDraft(draft({ adults: "1" })).ok).toBe(true);
  });

  it("rejects negative children but accepts zero", () => {
    expect(validateAvailabilityDraft(draft({ children: "-1" })).ok).toBe(false);
    expect(validateAvailabilityDraft(draft({ children: "0" })).ok).toBe(true);
  });

  it(`accepts rooms between 1 and ${MAX_REQUESTED_ROOMS} and rejects outside that range`, () => {
    expect(validateAvailabilityDraft(draft({ rooms: "1" })).ok).toBe(true);
    expect(validateAvailabilityDraft(draft({ rooms: String(MAX_REQUESTED_ROOMS) })).ok).toBe(
      true
    );
    expect(validateAvailabilityDraft(draft({ rooms: "0" })).ok).toBe(false);
    expect(
      validateAvailabilityDraft(draft({ rooms: String(MAX_REQUESTED_ROOMS + 1) })).ok
    ).toBe(false);
  });

  it("rejects non-integer guest/room values", () => {
    expect(validateAvailabilityDraft(draft({ adults: "2.5" })).ok).toBe(false);
    expect(validateAvailabilityDraft(draft({ children: "1.5" })).ok).toBe(false);
    expect(validateAvailabilityDraft(draft({ rooms: "abc" })).ok).toBe(false);
  });

  it("associates each structural error with its own field", () => {
    const result = validateAvailabilityDraft(
      draft({ checkIn: "", adults: "0", rooms: "99" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.checkIn).toBeDefined();
      expect(result.errors.adults).toBeDefined();
      expect(result.errors.rooms).toBeDefined();
      expect(result.errors.children).toBeUndefined();
    }
  });

  it("does not validate the Property-local past-date rule client-side", () => {
    // A date far in the past is a structurally valid range; only the server
    // (Property-timezone-aware) may reject it.
    const result = validateAvailabilityDraft(
      draft({ checkIn: "2000-01-01", checkOut: "2000-01-03" })
    );
    expect(result.ok).toBe(true);
  });
});
