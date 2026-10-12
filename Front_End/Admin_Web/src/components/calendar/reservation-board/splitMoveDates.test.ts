import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkSplitDate,
  compareSplitDateToToday,
  countNights,
  defaultSplitDate,
  isoFromGregorianDayNumber,
  shiftIsoDate,
  splitDateBounds,
} from "./splitMoveDates";
import { gregorianDayNumber } from "./splitMoveTarget";

// Every expected value below is a calendar fact written by hand (month lengths; leap years are divisible by 4,
// except centuries not divisible by 400). None is computed with the helpers under test, with dateMath or with Date.

describe("isoFromGregorianDayNumber", () => {
  it.each([
    [1, "0001-01-01"],
    [365, "0001-12-31"],
    [366, "0002-01-01"],
    [1461, "0004-12-31"], // 0004 is a leap year: 366 days
    [1462, "0005-01-01"],
    [36524, "0100-12-31"], // years 1-100 have 24 leap years: 100*365+24
    [36525, "0101-01-01"],
    [146097, "0400-12-31"], // one 400-year cycle: 400*365+97
    [146098, "0401-01-01"],
    [3652059, "9999-12-31"],
  ])("day %i is %s", (dayNumber, iso) => {
    expect(isoFromGregorianDayNumber(dayNumber)).toBe(iso);
  });

  it("is null outside 0001-01-01 … 9999-12-31 and for non-integers", () => {
    for (const bad of [0, -1, 3652060, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isoFromGregorianDayNumber(bad)).toBeNull();
    }
  });

  it("matches an independent calendar walk for every day of 0001-9999 and round-trips through gregorianDayNumber", () => {
    const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const pad = (v: number, w: number) => String(v).padStart(w, "0");
    let year = 1;
    let month = 1;
    let day = 1;
    let dayNumber = 1;
    let mismatches = 0;
    for (;;) {
      const iso = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
      if (isoFromGregorianDayNumber(dayNumber) !== iso || gregorianDayNumber(iso) !== dayNumber) {
        mismatches += 1;
        if (mismatches < 3) throw new Error(`mismatch at ${iso} (day ${dayNumber})`);
      }
      if (year === 9999 && month === 12 && day === 31) break;
      dayNumber += 1;
      day += 1;
      if (day > monthLengths[month - 1] + (month === 2 && leap(year) ? 1 : 0)) {
        day = 1;
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }
    expect(dayNumber).toBe(3652059);
    expect(mismatches).toBe(0);
  });
});

describe("shiftIsoDate", () => {
  it.each([
    ["0099-12-31", 1, "0100-01-01"],
    ["0100-01-01", -1, "0099-12-31"],
    ["0004-02-28", 1, "0004-02-29"],
    ["0100-02-28", 1, "0100-03-01"],
    ["0400-02-28", 2, "0400-03-01"],
    ["2026-09-30", 1, "2026-10-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["0001-01-01", 1, "0001-01-02"],
    ["9999-12-30", 1, "9999-12-31"],
  ])("%s %i days = %s", (iso, days, expected) => {
    expect(shiftIsoDate(iso, days)).toBe(expected);
  });

  it("is null past either end of 0001-9999 and for a date that does not exist", () => {
    expect(shiftIsoDate("0001-01-01", -1)).toBeNull();
    expect(shiftIsoDate("9999-12-31", 1)).toBeNull();
    expect(shiftIsoDate("2026-02-30", 1)).toBeNull();
    expect(shiftIsoDate("0000-12-31", 1)).toBeNull();
  });
});

describe("countNights", () => {
  it.each([
    ["2026-09-02", "2026-09-03", 1],
    ["2026-09-02", "2026-09-04", 2],
    ["2026-09-30", "2026-10-02", 2],
    ["2026-02-27", "2026-03-02", 3], // 2026 is not a leap year
    ["2028-02-27", "2028-03-02", 4], // 2028 is a leap year
    ["0099-12-31", "0100-01-02", 2],
    ["0100-02-27", "0100-03-02", 3], // 0100 is not a leap year
    ["0400-02-27", "0400-03-02", 4], // 0400 is a leap year
    ["0001-01-01", "0002-01-01", 365],
    ["0004-01-01", "0005-01-01", 366],
    ["9999-12-01", "9999-12-31", 30],
  ])("[%s, %s) is %i nights", (start, end, nights) => {
    expect(countNights(start, end)).toBe(nights);
  });

  it.each([
    ["an empty range", "2026-09-02", "2026-09-02"],
    ["a reversed range", "2026-09-04", "2026-09-02"],
    ["year 0000", "0000-12-31", "0001-01-02"],
    ["a day that does not exist", "2026-02-30", "2026-03-04"],
    ["a trailing newline", "2026-09-02\n", "2026-09-04"],
    ["an unpadded date", "2026-9-2", "2026-09-04"],
    ["a five-digit year", "10000-01-01", "10000-01-05"],
    ["text", "soon", "2026-09-04"],
  ])("is null for %s", (_name, start, end) => {
    expect(countNights(start, end)).toBeNull();
  });
});

describe("splitDateBounds — start + 1 … end - 1, strictly inside the source", () => {
  it.each([
    ["a long source", "2026-08-20", "2026-09-25", "2026-08-21", "2026-09-24"],
    ["a month change", "2026-09-30", "2026-10-03", "2026-10-01", "2026-10-02"],
    ["a year change", "2026-12-30", "2027-01-03", "2026-12-31", "2027-01-02"],
    ["the 0099/0100 boundary", "0099-12-30", "0100-01-03", "0099-12-31", "0100-01-02"],
    ["a leap day", "2028-02-27", "2028-03-02", "2028-02-28", "2028-03-01"],
    ["the first year", "0001-01-01", "0001-01-10", "0001-01-02", "0001-01-09"],
    ["the last year", "9999-12-20", "9999-12-31", "9999-12-21", "9999-12-30"],
    ["a source of exactly two nights — one valid date", "2026-09-26", "2026-09-28", "2026-09-27", "2026-09-27"],
  ])("%s", (_name, start, end, min, max) => {
    expect(splitDateBounds(start, end)).toEqual({ min, max });
  });

  it("is null for one night, an empty or reversed range, and an invalid range", () => {
    expect(splitDateBounds("2026-09-25", "2026-09-26")).toBeNull();
    expect(splitDateBounds("0099-12-31", "0100-01-01")).toBeNull();
    expect(splitDateBounds("2026-09-26", "2026-09-26")).toBeNull();
    expect(splitDateBounds("2026-09-28", "2026-09-26")).toBeNull();
    expect(splitDateBounds("0000-12-31", "0001-01-05")).toBeNull();
    expect(splitDateBounds("2026-02-30", "2026-03-05")).toBeNull();
  });
});

describe("checkSplitDate", () => {
  const start = "2026-09-20";
  const end = "2026-09-25";

  it("accepts the nearest interior dates and counts both parts' nights", () => {
    expect(checkSplitDate(start, end, "2026-09-21")).toEqual({ kind: "ok", prefixNights: 1, suffixNights: 4 });
    expect(checkSplitDate(start, end, "2026-09-22")).toEqual({ kind: "ok", prefixNights: 2, suffixNights: 3 });
    expect(checkSplitDate(start, end, "2026-09-24")).toEqual({ kind: "ok", prefixNights: 4, suffixNights: 1 });
  });

  it("refuses the endpoints and anything outside, naming the bounds", () => {
    const outside = { kind: "out-of-range", min: "2026-09-21", max: "2026-09-24" };
    expect(checkSplitDate(start, end, "2026-09-20")).toEqual(outside); // the start itself leaves the first part empty
    expect(checkSplitDate(start, end, "2026-09-25")).toEqual(outside); // the end itself leaves the second part empty
    expect(checkSplitDate(start, end, "2026-09-19")).toEqual(outside);
    expect(checkSplitDate(start, end, "2026-09-26")).toEqual(outside);
    expect(checkSplitDate(start, end, "2027-09-22")).toEqual(outside);
  });

  it("a two-night source has exactly one valid date", () => {
    expect(checkSplitDate("2026-09-26", "2026-09-28", "2026-09-27")).toEqual({ kind: "ok", prefixNights: 1, suffixNights: 1 });
    expect(checkSplitDate("2026-09-26", "2026-09-28", "2026-09-26").kind).toBe("out-of-range");
    expect(checkSplitDate("2026-09-26", "2026-09-28", "2026-09-28").kind).toBe("out-of-range");
  });

  it("a one-night or invalid source has no interior date, whatever the value", () => {
    expect(checkSplitDate("2026-09-25", "2026-09-26", "2026-09-25").kind).toBe("no-interior-date");
    expect(checkSplitDate("2026-09-25", "2026-09-26", "").kind).toBe("no-interior-date");
    expect(checkSplitDate("2026-02-30", "2026-03-05", "2026-03-01").kind).toBe("no-interior-date");
  });

  it("works across 0099/0100, month, year and leap-day changes and at 0001 and 9999", () => {
    expect(checkSplitDate("0099-12-30", "0100-01-03", "0100-01-01")).toEqual({ kind: "ok", prefixNights: 2, suffixNights: 2 });
    expect(checkSplitDate("2026-12-30", "2027-01-03", "2027-01-01")).toEqual({ kind: "ok", prefixNights: 2, suffixNights: 2 });
    expect(checkSplitDate("2028-02-27", "2028-03-02", "2028-02-29")).toEqual({ kind: "ok", prefixNights: 2, suffixNights: 2 });
    expect(checkSplitDate("2026-02-27", "2026-03-02", "2026-02-29").kind).toBe("invalid"); // no 29 February in 2026
    expect(checkSplitDate("0100-02-27", "0100-03-02", "0100-02-29").kind).toBe("invalid"); // none in 0100 either
    expect(checkSplitDate("0400-02-27", "0400-03-02", "0400-02-29")).toEqual({ kind: "ok", prefixNights: 2, suffixNights: 2 });
    expect(checkSplitDate("0001-01-01", "0001-01-04", "0001-01-02")).toEqual({ kind: "ok", prefixNights: 1, suffixNights: 2 });
    expect(checkSplitDate("9999-12-28", "9999-12-31", "9999-12-30")).toEqual({ kind: "ok", prefixNights: 2, suffixNights: 1 });
  });

  it("is empty for no value and invalid for anything that is not an existing zero-padded date", () => {
    expect(checkSplitDate(start, end, "").kind).toBe("empty");
    for (const bad of [
      "2026-09-22\n",
      "\n2026-09-22",
      " 2026-09-22",
      "2026-09-22 ",
      "2026-9-22",
      "2026-02-30",
      "2026-04-31",
      "2026-13-01",
      "2026-09-00",
      "0000-09-22",
      "10000-09-22",
      "22/09/2026",
      "not-a-date",
    ]) {
      expect(checkSplitDate(start, end, bad).kind).toBe("invalid");
    }
  });

  it("does not depend on the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-06-15T12:00:00Z"));
    expect(checkSplitDate(start, end, "2026-09-22").kind).toBe("ok");
    vi.useRealTimers();
  });

  afterEach(() => vi.useRealTimers());
});

describe("compareSplitDateToToday (D4)", () => {
  it("before / on / after the Property's date", () => {
    expect(compareSplitDateToToday("2026-09-21", "2026-09-22")).toBe("before");
    expect(compareSplitDateToToday("2026-09-22", "2026-09-22")).toBe("on-or-after");
    expect(compareSplitDateToToday("2026-09-23", "2026-09-22")).toBe("on-or-after");
  });

  it("compares real dates across month, year, leap and 0099/0100 boundaries", () => {
    expect(compareSplitDateToToday("2026-09-30", "2026-10-01")).toBe("before");
    expect(compareSplitDateToToday("2026-12-31", "2027-01-01")).toBe("before");
    expect(compareSplitDateToToday("2028-02-29", "2028-03-01")).toBe("before");
    expect(compareSplitDateToToday("0099-12-31", "0100-01-01")).toBe("before");
    expect(compareSplitDateToToday("0100-01-01", "0099-12-31")).toBe("on-or-after");
    expect(compareSplitDateToToday("0001-01-02", "9999-12-31")).toBe("before");
  });

  it("is null — cannot tell — when either date is not a real date", () => {
    expect(compareSplitDateToToday("2026-09-22", "")).toBeNull();
    expect(compareSplitDateToToday("2026-09-22", "2026-02-30")).toBeNull();
    expect(compareSplitDateToToday("2026-09-22", "2026-09-22\n")).toBeNull();
    expect(compareSplitDateToToday("0000-01-01", "2026-09-22")).toBeNull();
    expect(compareSplitDateToToday("", "2026-09-22")).toBeNull();
  });
});

describe("defaultSplitDate", () => {
  it("is localToday only when it is a real date strictly inside the source", () => {
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2026-09-22")).toBe("2026-09-22");
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2026-09-21")).toBe("2026-09-21");
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2026-09-24")).toBe("2026-09-24");
  });

  it("is empty — never clamped — when localToday is outside, on an endpoint, or not a real date", () => {
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2026-09-19")).toBe("");
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2026-09-20")).toBe("");
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2026-09-25")).toBe("");
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2030-01-01")).toBe("");
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "")).toBe("");
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2026-09-22\n")).toBe("");
    expect(defaultSplitDate("2026-09-20", "2026-09-25", "2026-02-30")).toBe("");
  });

  it("is empty for a source with no interior date", () => {
    expect(defaultSplitDate("2026-09-25", "2026-09-26", "2026-09-25")).toBe("");
  });

  it("works for ancient and far dates", () => {
    expect(defaultSplitDate("0099-12-30", "0100-01-03", "0100-01-01")).toBe("0100-01-01");
    expect(defaultSplitDate("9999-12-28", "9999-12-31", "9999-12-30")).toBe("9999-12-30");
  });
});
