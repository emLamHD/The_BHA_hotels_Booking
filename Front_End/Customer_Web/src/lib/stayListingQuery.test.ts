import { testT } from "@/lib/i18n/testkit";
import { describe, expect, it } from "vitest";
import {
  KNOWN_KEYS,
  StayListingQuery,
  brandFromLabel,
  buildListingAliasHref,
  buildStayListingHref,
  describeListingProblems,
  hrefForQuery,
  parseStayListingQuery,
  stayListingKey,
} from "./stayListingQuery";

const parse = (query: string) => parseStayListingQuery(new URLSearchParams(query));

const FULL = "checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=0&rooms=1";

const problemsOf = (query: StayListingQuery) => (query.kind === "invalid" ? query.problems : []);

describe("parseStayListingQuery: browse and brand", () => {
  it("no field at all is the deliberate browse mode of Riverside", () => {
    expect(parse("")).toEqual({ kind: "browse", brand: "riverside" });
    expect(parseStayListingQuery(null)).toEqual({ kind: "browse", brand: "riverside" });
  });

  it("unknown keys are ignored, never a reason to invalidate or to search", () => {
    expect(parse("utm_source=x&q=1")).toEqual({ kind: "browse", brand: "riverside" });
  });

  it("one valid brand is that brand; House and Villa browse without a search", () => {
    expect(parse("brand=riverside")).toEqual({ kind: "browse", brand: "riverside" });
    expect(parse("brand=house")).toEqual({ kind: "browse", brand: "house" });
    expect(parse("brand=villa")).toEqual({ kind: "browse", brand: "villa" });
  });

  it("a repeated, blank, unknown or differently-cased brand is invalid and never falls back to Riverside", () => {
    for (const query of ["brand=house&brand=villa", "brand=riverside&brand=riverside", "brand=", "brand=hotel", "brand=Riverside"]) {
      const parsed = parse(query);
      expect(parsed.kind, query).toBe("invalid");
      expect(parsed.kind === "invalid" && parsed.brand, query).toBeNull();
    }
    expect(problemsOf(parse("brand=house&brand=villa"))).toEqual([{ key: "brand", reason: "repeated" }]);
    expect(problemsOf(parse("brand="))).toEqual([{ key: "brand", reason: "blank" }]);
    expect(problemsOf(parse("brand=hotel"))).toEqual([{ key: "brand", reason: "unknown" }]);
  });

  it("an invalid brand stays invalid even with a perfectly valid search", () => {
    expect(parse(`brand=hotel&${FULL}`).kind).toBe("invalid");
  });

  it("maps the template's location labels to brands", () => {
    expect(brandFromLabel("The BHA Riverside")).toBe("riverside");
    expect(brandFromLabel("The BHA House")).toBe("house");
    expect(brandFromLabel("The BHA Villa")).toBe("villa");
    expect(brandFromLabel("Tokyo")).toBeUndefined();
  });
});

describe("parseStayListingQuery: search", () => {
  it("accepts all five fields once, valid, whatever their order, with a brand or without", () => {
    const expected = { checkIn: "2026-11-10", checkOut: "2026-11-12", adults: "2", children: "0", rooms: "1" };
    expect(parse(FULL)).toEqual({ kind: "search", brand: "riverside", search: expected });
    expect(parse("rooms=1&children=0&adults=2&checkOut=2026-11-12&checkIn=2026-11-10")).toEqual({
      kind: "search",
      brand: "riverside",
      search: expected,
    });
    expect(parse(`brand=villa&${FULL}`)).toEqual({ kind: "search", brand: "villa", search: expected });
  });

  it("accepts a leap day, children 0, the maximum of 30 nights and 10 rooms", () => {
    expect(parse("checkIn=2028-02-28&checkOut=2028-03-01&adults=1&children=0&rooms=1").kind).toBe("search");
    expect(parse("checkIn=2026-11-01&checkOut=2026-12-01&adults=3&children=2&rooms=10").kind).toBe("search");
  });

  it("any one search field without the others is invalid with the others reported missing — nothing is filled in", () => {
    const parsed = parse("checkIn=2026-11-10");
    expect(parsed.kind).toBe("invalid");
    expect(problemsOf(parsed)).toEqual([
      { key: "checkOut", reason: "missing" },
      { key: "adults", reason: "missing" },
      { key: "children", reason: "missing" },
      { key: "rooms", reason: "missing" },
    ]);
    expect(parse("adults=2").kind).toBe("invalid");
    expect(parse("rooms=1&children=0&adults=2").kind).toBe("invalid");
  });

  it("empty values are invalid, not browse and not defaults", () => {
    const parsed = parse("checkIn=&checkOut=&adults=&children=&rooms=");
    expect(parsed.kind).toBe("invalid");
    expect(problemsOf(parsed).every((problem) => problem.reason === "blank")).toBe(true);
  });

  it("a repeated field is invalid; the last (or first) value is never silently chosen", () => {
    const withBad = (extra: string) => parse(`${FULL}&${extra}`);
    for (const extra of ["checkIn=2026-11-11", "checkOut=2026-11-13", "adults=3", "children=1", "rooms=2"]) {
      const parsed = withBad(extra);
      expect(parsed.kind, extra).toBe("invalid");
      expect(problemsOf(parsed).some((problem) => problem.reason === "repeated"), extra).toBe(true);
    }
  });

  it("rejects malformed and impossible dates (including Feb 31 and a non-leap Feb 29)", () => {
    for (const bad of ["2026-02-31", "2026-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "2026-1-5", "10/11/2026", "2026-11-10T00:00:00", " 2026-11-10", "20261110"]) {
      const parsed = parse(`checkIn=${encodeURIComponent(bad)}&checkOut=2026-12-01&adults=2&children=0&rooms=1`);
      expect(parsed.kind, bad).toBe("invalid");
      expect(problemsOf(parsed), bad).toContainEqual({ key: "checkIn", reason: "malformed" });
    }
  });

  it("rejects reversed, equal and over-30-night stays", () => {
    expect(problemsOf(parse("checkIn=2026-11-12&checkOut=2026-11-10&adults=2&children=0&rooms=1"))).toEqual([{ key: "stay", reason: "order" }]);
    expect(problemsOf(parse("checkIn=2026-11-10&checkOut=2026-11-10&adults=2&children=0&rooms=1"))).toEqual([{ key: "stay", reason: "order" }]);
    expect(problemsOf(parse("checkIn=2026-11-01&checkOut=2026-12-02&adults=2&children=0&rooms=1"))).toEqual([{ key: "stay", reason: "too-long" }]);
  });

  it("rejects out-of-range adults and rooms", () => {
    expect(problemsOf(parse("checkIn=2026-11-10&checkOut=2026-11-12&adults=0&children=0&rooms=1"))).toEqual([{ key: "adults", reason: "out-of-range" }]);
    expect(problemsOf(parse("checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=0&rooms=0"))).toEqual([{ key: "rooms", reason: "out-of-range" }]);
    expect(problemsOf(parse("checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=0&rooms=11"))).toEqual([{ key: "rooms", reason: "out-of-range" }]);
  });

  it("rejects counts that are not plain non-negative integers: decimal, exponent, hex, NaN, Infinity, sign, spaces, leading zeros, unsafe", () => {
    const bad = ["1.5", "2.0", "1e1", "0x2", "NaN", "Infinity", "-1", "+2", " 2", "2 ", "02", "٢", "9007199254740993", "99999999999999999999"];
    for (const value of bad) {
      for (const key of ["adults", "children", "rooms"] as const) {
        const fields: Record<string, string> = { checkIn: "2026-11-10", checkOut: "2026-11-12", adults: "2", children: "0", rooms: "1" };
        fields[key] = value;
        const parsed = parseStayListingQuery(new URLSearchParams(fields));
        expect(parsed.kind, `${key}=${value}`).toBe("invalid");
        expect(problemsOf(parsed).length, `${key}=${value}`).toBeGreaterThan(0);
      }
    }
  });

  it("does not use today's date: a date in the past is still structurally valid (the server is the authority)", () => {
    expect(parse("checkIn=2020-01-01&checkOut=2020-01-03&adults=2&children=0&rooms=1").kind).toBe("search");
  });
});

describe("buildStayListingHref / canonical round trip", () => {
  const search = { checkIn: "2026-11-10", checkOut: "2026-11-12", adults: "2", children: "1", rooms: "1" };

  it("builds browse URLs, with the brand only when it is not the default", () => {
    expect(buildStayListingHref("riverside")).toBe("/listing-stay");
    expect(buildStayListingHref("house")).toBe("/listing-stay?brand=house");
  });

  it("serializes a search in a fixed order", () => {
    expect(buildStayListingHref("riverside", search)).toBe(
      "/listing-stay?checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=1&rooms=1"
    );
    expect(buildStayListingHref("villa", search)).toBe(
      "/listing-stay?brand=villa&checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=1&rooms=1"
    );
  });

  it("round-trips through the parser to the same query and the same key", () => {
    for (const brand of ["riverside", "house", "villa"] as const) {
      for (const withSearch of [false, true]) {
        const href = buildStayListingHref(brand, withSearch ? search : null);
        const query = parse(href.split("?")[1] ?? "");
        expect(query.kind).toBe(withSearch ? "search" : "browse");
        expect(hrefForQuery(query)).toBe(href);
        expect(stayListingKey(parse(href.split("?")[1] ?? ""))).toBe(stayListingKey(query));
      }
    }
  });

  it("never carries a price, rate plan, contact, token or an unknown key", () => {
    const href = buildStayListingHref("riverside", search);
    expect(Array.from(new URL(href, "https://x.test").searchParams.keys())).toEqual(["checkIn", "checkOut", "adults", "children", "rooms"]);
    expect(hrefForQuery({ kind: "invalid", brand: null, problems: [] })).toBeNull();
  });

  it("gives different keys to different queries and to different invalid URLs", () => {
    const a = stayListingKey(parse(FULL));
    const b = stayListingKey(parse(FULL.replace("rooms=1", "rooms=2")));
    expect(a).not.toBe(b);
    expect(stayListingKey(parse("brand=house"))).not.toBe(stayListingKey(parse("")));
    expect(stayListingKey(parse("adults=2"))).not.toBe(stayListingKey(parse("brand=x")));
  });
});

describe("buildListingAliasHref", () => {
  it("is always the fixed /listing-stay path, with no key at all when there is none", () => {
    expect(buildListingAliasHref({})).toBe("/listing-stay");
    expect(buildListingAliasHref(undefined)).toBe("/listing-stay");
    expect(buildListingAliasHref({ utm: "https://evil.example" })).toBe("/listing-stay");
  });

  it("keeps every known key by name and value", () => {
    const href = buildListingAliasHref({
      brand: "house",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      adults: "2",
      children: "0",
      rooms: "1",
    });
    expect(href).toBe("/listing-stay?brand=house&checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=0&rooms=1");
    expect(parse(href.split("?")[1]).kind).toBe("search");
  });

  it("keeps repeated known keys so the destination still reports them as invalid", () => {
    const href = buildListingAliasHref({
      checkIn: ["2026-11-10", "2026-11-11"],
      checkOut: "2026-11-12",
      adults: "2",
      children: "0",
      rooms: "1",
    });
    expect(href).toContain("checkIn=2026-11-10&checkIn=2026-11-11");
    const parsed = parse(href.split("?")[1]);
    expect(parsed.kind).toBe("invalid");
    expect(problemsOf(parsed)).toContainEqual({ key: "checkIn", reason: "repeated" });
  });

  it("keeps blank values (the destination reports them) and a repeated brand", () => {
    const href = buildListingAliasHref({ brand: ["house", "villa"], rooms: "" });
    expect(href).toBe("/listing-stay?brand=house&brand=villa&rooms=");
    expect(parse(href.split("?")[1]).kind).toBe("invalid");
  });

  it("drops unknown keys and never follows a value as a location", () => {
    const href = buildListingAliasHref({ redirect: "//evil.example", next: "/x", checkIn: "2026-11-10" });
    expect(href).toBe("/listing-stay?checkIn=2026-11-10");
    expect(href.startsWith("/listing-stay")).toBe(true);
    expect(buildListingAliasHref({ brand: "//evil.example" })).toBe("/listing-stay?brand=%2F%2Fevil.example");
  });

  it("ignores inherited properties of the params object", () => {
    const inherited = Object.create({ checkIn: "2026-11-10" });
    expect(buildListingAliasHref(inherited)).toBe("/listing-stay");
  });

  it("only ever reads the keys the parser knows", () => {
    expect([...KNOWN_KEYS]).toEqual(["brand", "checkIn", "checkOut", "adults", "children", "rooms"]);
  });
});

describe("describeListingProblems", () => {
  it("says what is wrong in Vietnamese, one line per problem", () => {
    const lines = describeListingProblems(problemsOf(parse("checkIn=2026-02-31&checkOut=2026-03-01&adults=2&children=0&rooms=1&rooms=2")), testT("vi"));
    expect(lines.length).toBe(2);
    expect(lines.join(" ")).toMatch(/Ngày nhận phòng/);
    expect(lines.join(" ")).toMatch(/Số phòng/);
  });
});
