import { describe, expect, it } from "vitest";
import {
  dateToIso,
  initialStayDraft,
  isoToDate,
  parseSearchQuery,
  searchQueryParams,
  todayLocal,
  toAvailabilityDraft,
} from "./staySearch";

describe("dateToIso / isoToDate", () => {
  it("uses the local calendar day, not the UTC day", () => {
    // Local midnight and local end of day of the same date give the same ISO string in any time zone.
    expect(dateToIso(new Date(2026, 9, 7, 0, 0, 0))).toBe("2026-10-07");
    expect(dateToIso(new Date(2026, 9, 7, 23, 59, 59))).toBe("2026-10-07");
    expect(dateToIso(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(dateToIso(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });

  it("does not shift a local midnight back a day the way toISOString().slice would east of UTC", () => {
    const midnight = new Date(2026, 9, 7, 0, 0, 0);
    expect(dateToIso(midnight)).toBe("2026-10-07");
    // In UTC+7 the naive conversion would say 2026-10-06; the helper must never agree with it there.
    if (midnight.getTimezoneOffset() < 0) expect(midnight.toISOString().slice(0, 10)).not.toBe(dateToIso(midnight));
  });

  it("round-trips real dates and rejects impossible ones", () => {
    for (const iso of ["2026-10-07", "2027-02-28", "2028-02-29", "2026-12-31"]) {
      const date = isoToDate(iso);
      expect(date && dateToIso(date)).toBe(iso);
    }
    for (const bad of ["", "2026-02-31", "2026-13-01", "2026-1-1", "10/07/2026", "2026-10-07T00:00", null, undefined]) {
      expect(isoToDate(bad as string)).toBeNull();
    }
  });

  it("builds local midnight", () => {
    const date = isoToDate("2026-10-07")!;
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 7, 0]);
  });
});

describe("todayLocal", () => {
  it("drops the time of day", () => {
    const today = todayLocal(new Date(2026, 9, 7, 23, 59, 59));
    expect([today.getHours(), today.getMinutes(), dateToIso(today)]).toEqual([0, 0, "2026-10-07"]);
  });
});

describe("initial draft", () => {
  it("starts on Riverside with no dates and a sensible party", () => {
    expect(initialStayDraft()).toEqual({ brand: "The BHA Riverside", checkIn: "", checkOut: "", adults: 2, children: 0, rooms: 1 });
  });
});

describe("search query", () => {
  const reader = (search: string) => new URLSearchParams(search);
  const valid = { checkIn: "2026-11-02", checkOut: "2026-11-04", adults: "2", children: "1", rooms: "1" };

  it("round-trips a valid search and carries nothing else", () => {
    const params = searchQueryParams(valid);
    expect(Array.from(params.keys()).sort()).toEqual(["adults", "checkIn", "checkOut", "children", "rooms"]);
    expect(parseSearchQuery(reader(params.toString()))).toEqual(valid);
  });

  it.each([
    ["missing part", "checkIn=2026-11-02&checkOut=2026-11-04&adults=2&children=0"],
    ["bad date", "checkIn=2026-11-31&checkOut=2026-12-02&adults=2&children=0&rooms=1"],
    ["reversed", "checkIn=2026-11-04&checkOut=2026-11-02&adults=2&children=0&rooms=1"],
    ["too long", "checkIn=2026-11-01&checkOut=2026-12-15&adults=2&children=0&rooms=1"],
    ["no adult", "checkIn=2026-11-02&checkOut=2026-11-04&adults=0&children=0&rooms=1"],
    ["too many rooms", "checkIn=2026-11-02&checkOut=2026-11-04&adults=2&children=0&rooms=11"],
    ["text count", "checkIn=2026-11-02&checkOut=2026-11-04&adults=two&children=0&rooms=1"],
    ["repeated", "checkIn=2026-11-02&checkIn=2026-11-03&checkOut=2026-11-04&adults=2&children=0&rooms=1"],
    ["empty", ""],
  ])("ignores a %s", (_label, search) => {
    expect(parseSearchQuery(reader(search))).toBeNull();
  });

  it("ignores no query object", () => {
    expect(parseSearchQuery(null)).toBeNull();
  });
});

describe("toAvailabilityDraft", () => {
  it("turns the counters into the strings the form validates", () => {
    expect(toAvailabilityDraft({ checkIn: "2026-11-02", checkOut: "2026-11-04", adults: 2, children: 0, rooms: 3 })).toEqual({
      checkIn: "2026-11-02",
      checkOut: "2026-11-04",
      adults: "2",
      children: "0",
      rooms: "3",
    });
  });
});
