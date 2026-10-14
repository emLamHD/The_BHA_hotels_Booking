import { describe, expect, it, vi } from "vitest";
import type { AvailabilityOfferDto } from "@/lib/api/availabilityTypes";
import { ApiConfigError, ApiHttpError, ApiNetworkError, ApiValidationError } from "@/lib/api/errors";
import type { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { quoteForRoomType } from "@/lib/roomQuote";
import {
  ListingDeps,
  ListingState,
  buildListingCards,
  createListingController,
  describeListingError,
} from "./stayListingSearch";
import { StayListingQuery, parseStayListingQuery } from "./stayListingQuery";

const PROPERTY_ID = "10000000-0000-0000-0000-000000000001";
const OTHER_PROPERTY_ID = "20000000-0000-0000-0000-000000000002";
const ROOM_A = "a0000000-0000-0000-0000-00000000000a";
const ROOM_B = "b0000000-0000-0000-0000-00000000000b";
const ROOM_C = "c0000000-0000-0000-0000-00000000000c";

const property = (over: Partial<PropertyDto> = {}): PropertyDto => ({
  id: PROPERTY_ID,
  name: "The BHA Riverside",
  slug: "the-bha-riverside",
  description: null,
  address: null,
  city: null,
  country: null,
  timeZone: null,
  checkInTime: "14:00:00",
  checkOutTime: "12:00:00",
  amenities: [],
  media: [],
  ...over,
});

const roomType = (id: string, over: Partial<RoomTypeDto> = {}): RoomTypeDto => ({
  id,
  propertyId: PROPERTY_ID,
  code: null,
  name: `Room ${id.slice(0, 1)}`,
  slug: null,
  description: null,
  baseOccupancy: 2,
  maxOccupancy: 3,
  amenities: [],
  media: [],
  ...over,
});

const offer = (roomTypeId: string, over: Partial<AvailabilityOfferDto> = {}): AvailabilityOfferDto => ({
  propertyId: PROPERTY_ID,
  roomTypeId,
  roomTypeCode: null,
  roomTypeName: null,
  roomTypeDescription: null,
  media: [],
  ratePlanId: "r0000000-0000-0000-0000-000000000001",
  ratePlanCode: "BAR",
  ratePlanName: "Standard",
  currencyCode: "VND",
  checkIn: "2026-11-10",
  checkOut: "2026-11-12",
  nights: 2,
  requestedRooms: 1,
  availableRooms: 3,
  nightlyRates: [
    { stayDate: "2026-11-10", amount: 1000000 },
    { stayDate: "2026-11-11", amount: 1000000 },
  ],
  totalAmount: 2000000,
  ...over,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

interface Calls {
  properties: Deferred<PropertyDto[]>[];
  rooms: { propertyId: string; d: Deferred<RoomTypeDto[]>; signal?: AbortSignal }[];
  availability: { propertyId: string; query: Parameters<ListingDeps["searchAvailability"]>[1]; d: Deferred<AvailabilityOfferDto[]>; signal?: AbortSignal }[];
}

function harness() {
  const calls: Calls = { properties: [], rooms: [], availability: [] };
  const deps: ListingDeps = {
    getProperties: vi.fn((options) => {
      const d = deferred<PropertyDto[]>();
      calls.properties.push(d);
      options.signal?.addEventListener("abort", () => undefined);
      return d.promise;
    }),
    getRoomTypes: vi.fn((propertyId, options) => {
      const d = deferred<RoomTypeDto[]>();
      calls.rooms.push({ propertyId, d, signal: options.signal });
      return d.promise;
    }),
    searchAvailability: vi.fn((propertyId, query, options) => {
      const d = deferred<AvailabilityOfferDto[]>();
      calls.availability.push({ propertyId, query, d, signal: options.signal });
      return d.promise;
    }),
  };
  const controller = createListingController(deps);
  const states: ListingState[] = [];
  controller.subscribe(() => states.push(controller.getState()));
  return { calls, deps, controller, states };
}

const q = (query: string): StayListingQuery => parseStayListingQuery(new URLSearchParams(query));
const DATES_A = "checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=0&rooms=1";
const DATES_B = "checkIn=2026-12-01&checkOut=2026-12-03&adults=3&children=1&rooms=2";

/** Brings a harness to a ready Riverside catalog, answering the two catalog requests. */
async function readyCatalog(h: ReturnType<typeof harness>, rooms: RoomTypeDto[] = [roomType(ROOM_A), roomType(ROOM_B)]) {
  h.calls.properties[0].resolve([property({ id: OTHER_PROPERTY_ID, slug: "other" }), property()]);
  await flush();
  h.calls.rooms[0].d.resolve(rooms);
  await flush();
}

function riverside(state: ListingState) {
  if (state.kind !== "riverside") throw new Error(`expected riverside, got ${state.kind}`);
  return state;
}

describe("browse mode", () => {
  it("loads the catalog and asks for no availability", async () => {
    const h = harness();
    h.controller.setQuery(q(""));
    expect(riverside(h.controller.getState()).catalog).toEqual({ status: "loading" });
    expect(riverside(h.controller.getState()).availability).toEqual({ status: "none" });

    await readyCatalog(h);
    const state = riverside(h.controller.getState());
    expect(state.catalog.status).toBe("ready");
    expect(state.availability).toEqual({ status: "none" });
    expect(h.deps.searchAvailability).not.toHaveBeenCalled();
  });

  it("finds Riverside by its slug, not by position, and reads that property's room types", async () => {
    const h = harness();
    h.controller.setQuery(q(""));
    h.calls.properties[0].resolve([property({ id: OTHER_PROPERTY_ID, slug: "someone-else" }), property()]);
    await flush();
    expect(h.calls.rooms).toHaveLength(1);
    expect(h.calls.rooms[0].propertyId).toBe(PROPERTY_ID);
  });

  it("room types that belong to another property are never kept", async () => {
    const h = harness();
    h.controller.setQuery(q(""));
    await readyCatalog(h, [roomType(ROOM_A), roomType(ROOM_B, { propertyId: OTHER_PROPERTY_ID })]);
    const catalog = riverside(h.controller.getState()).catalog;
    expect(catalog.status === "ready" && catalog.roomTypes.map((r) => r.id)).toEqual([ROOM_A]);
  });

  it("tells a missing property, an empty catalog and a failed read apart", async () => {
    const missing = harness();
    missing.controller.setQuery(q(""));
    missing.calls.properties[0].resolve([property({ slug: "not-riverside" })]);
    await flush();
    expect(riverside(missing.controller.getState()).catalog.status).toBe("missing");
    expect(missing.deps.getRoomTypes).not.toHaveBeenCalled();

    const empty = harness();
    empty.controller.setQuery(q(""));
    await readyCatalog(empty, []);
    expect(riverside(empty.controller.getState()).catalog.status).toBe("empty");

    const failed = harness();
    failed.controller.setQuery(q(""));
    failed.calls.properties[0].reject(new ApiNetworkError());
    await flush();
    const state = riverside(failed.controller.getState());
    expect(state.catalog.status).toBe("error");
    expect(JSON.stringify(state)).not.toMatch(/axios|ECONN|http/i);
  });
});

describe("dated Riverside query", () => {
  it("loads the catalog first, then asks availability once for the property's id and the five values", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    expect(riverside(h.controller.getState()).availability).toEqual({ status: "loading" });
    expect(h.deps.searchAvailability).not.toHaveBeenCalled();

    await readyCatalog(h);
    expect(h.calls.availability).toHaveLength(1);
    expect(h.calls.availability[0].propertyId).toBe(PROPERTY_ID);
    expect(h.calls.availability[0].query).toEqual({ checkIn: "2026-11-10", checkOut: "2026-11-12", adults: 2, children: 0, rooms: 1 });

    h.calls.availability[0].d.resolve([offer(ROOM_A)]);
    await flush();
    const state = riverside(h.controller.getState());
    expect(state.availability.status).toBe("success");
    expect(state.search).toEqual({ checkIn: "2026-11-10", checkOut: "2026-11-12", adults: "2", children: "0", rooms: "1" });
  });

  it("success with no offers is a success, not an error", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    await readyCatalog(h);
    h.calls.availability[0].d.resolve([]);
    await flush();
    expect(riverside(h.controller.getState()).availability).toEqual({ status: "success", offers: [] });
  });

  it("network, rejected and server errors are errors with fixed safe copy — never an empty result", async () => {
    for (const [error, retryable] of [
      [new ApiNetworkError(), true],
      [new ApiHttpError(500, { title: "Boom", status: 500, detail: "SqlException at 10.0.0.5" }), true],
      [new ApiHttpError(401, { title: "Unauthorized", status: 401, detail: "token abc123" }), true],
      [new ApiValidationError(400, { title: "v", status: 400, errors: { checkIn: ["secret detail"] } }), false],
      [new ApiConfigError("NEXT_PUBLIC_API_BASE_URL is missing"), false],
    ] as const) {
      const h = harness();
      h.controller.setQuery(q(DATES_A));
      await readyCatalog(h);
      h.calls.availability[0].d.reject(error);
      await flush();
      const availability = riverside(h.controller.getState()).availability;
      expect(availability.status).toBe("error");
      if (availability.status === "error") {
        expect(availability.retryable).toBe(retryable);
        expect(availability.message).not.toMatch(/SqlException|10\.0\.0\.5|abc123|secret|NEXT_PUBLIC|Boom|Unauthorized/);
      }
    }
  });

  it("a failed catalog leaves availability unasked", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    h.calls.properties[0].reject(new ApiNetworkError());
    await flush();
    const state = riverside(h.controller.getState());
    expect(state.catalog.status).toBe("error");
    expect(state.availability).toEqual({ status: "none" });
    expect(h.deps.searchAvailability).not.toHaveBeenCalled();
  });
});

describe("other brands and invalid URLs make no request", () => {
  it("House and Villa never read the Riverside catalog or availability", () => {
    for (const brand of ["house", "villa"]) {
      const h = harness();
      h.controller.setQuery(q(`brand=${brand}`));
      expect(h.controller.getState()).toMatchObject({ kind: "unsupported-brand", brand });
      h.controller.setQuery(q(`brand=${brand}&${DATES_A}`));
      expect(h.controller.getState()).toMatchObject({ kind: "unsupported-brand", brand });
      expect(h.deps.getProperties).not.toHaveBeenCalled();
      expect(h.deps.getRoomTypes).not.toHaveBeenCalled();
      expect(h.deps.searchAvailability).not.toHaveBeenCalled();
    }
  });

  it("invalid URLs make no request and expose their problems", () => {
    for (const query of ["checkIn=2026-11-10", `${DATES_A}&rooms=2`, "brand=hotel", "checkIn=2026-02-31&checkOut=2026-03-01&adults=2&children=0&rooms=1"]) {
      const h = harness();
      h.controller.setQuery(q(query));
      const state = h.controller.getState();
      expect(state.kind, query).toBe("invalid");
      expect(h.deps.getProperties).not.toHaveBeenCalled();
      expect(h.deps.searchAvailability).not.toHaveBeenCalled();
    }
  });
});

describe("query changes while a request is in flight (A then B)", () => {
  it("a late success for A never becomes B's page", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    await readyCatalog(h);
    h.controller.setQuery(q(DATES_B));
    expect(h.calls.availability).toHaveLength(2);
    expect(h.calls.availability[0].signal?.aborted).toBe(true);

    h.calls.availability[1].d.resolve([offer(ROOM_B, { checkIn: "2026-12-01", checkOut: "2026-12-03", requestedRooms: 2, totalAmount: 5 })]);
    await flush();
    h.calls.availability[0].d.resolve([offer(ROOM_A)]); // late, from the aborted request
    await flush();

    const state = riverside(h.controller.getState());
    expect(state.search?.checkIn).toBe("2026-12-01");
    expect(state.availability.status === "success" && state.availability.offers.map((o) => o.roomTypeId)).toEqual([ROOM_B]);
  });

  it("a late error for A never becomes B's page", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    await readyCatalog(h);
    h.controller.setQuery(q(DATES_B));
    h.calls.availability[0].d.reject(new ApiNetworkError());
    await flush();
    expect(riverside(h.controller.getState()).availability).toEqual({ status: "loading" });
    h.calls.availability[1].d.resolve([]);
    await flush();
    expect(riverside(h.controller.getState()).availability.status).toBe("success");
  });

  it("A while the catalog is still loading, then B: the catalog is read once and availability asks for B only", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    h.controller.setQuery(q(DATES_B));
    expect(h.deps.getProperties).toHaveBeenCalledTimes(1);
    await readyCatalog(h);
    expect(h.calls.availability).toHaveLength(1);
    expect(h.calls.availability[0].query).toMatchObject({ checkIn: "2026-12-01", rooms: 2 });
  });

  it("dated → invalid / House / browse cancels the old quote at once and a late answer does nothing", async () => {
    for (const next of [`${DATES_A}&rooms=2`, "brand=house", ""]) {
      const h = harness();
      h.controller.setQuery(q(DATES_A));
      await readyCatalog(h);
      h.controller.setQuery(q(next));
      expect(h.calls.availability[0].signal?.aborted).toBe(true);
      const before = h.controller.getState();
      h.calls.availability[0].d.resolve([offer(ROOM_A)]);
      await flush();
      expect(h.controller.getState()).toBe(before);
      if (before.kind === "riverside") expect(before.availability).toEqual({ status: "none" });
    }
  });

  it("an answer arriving for a query is published only with that query's key", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    await readyCatalog(h);
    const keyA = h.controller.getState();
    h.controller.setQuery(q(DATES_B));
    const keyB = h.controller.getState();
    expect(keyA.kind === "riverside" && keyB.kind === "riverside" && keyA.key !== keyB.key).toBe(true);
  });

  it("leaving Riverside aborts the catalog; coming back reads it again", async () => {
    const h = harness();
    h.controller.setQuery(q(""));
    h.controller.setQuery(q("brand=villa"));
    h.calls.properties[0].resolve([property()]);
    await flush();
    expect(h.deps.getRoomTypes).not.toHaveBeenCalled();
    expect(h.controller.getState().kind).toBe("unsupported-brand");
    h.controller.setQuery(q(""));
    expect(h.deps.getProperties).toHaveBeenCalledTimes(2);
  });

  it("a catalog that finished is reused when the query changes within Riverside", async () => {
    const h = harness();
    h.controller.setQuery(q(""));
    await readyCatalog(h);
    h.controller.setQuery(q(DATES_A));
    expect(h.deps.getProperties).toHaveBeenCalledTimes(1);
    expect(h.calls.availability).toHaveLength(1);
    expect(riverside(h.controller.getState()).catalog.status).toBe("ready");
  });
});

describe("unmount", () => {
  it("aborts every request and publishes nothing afterwards", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    await readyCatalog(h);
    h.controller.dispose();
    expect(h.calls.availability[0].signal?.aborted).toBe(true);
    const published = h.states.length;
    h.calls.availability[0].d.resolve([offer(ROOM_A)]);
    await flush();
    expect(h.states.length).toBe(published);
    expect(h.controller.getState()).toEqual({ kind: "idle" });
  });

  it("a catalog answer after dispose is dropped and starts no availability", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    h.controller.dispose();
    h.calls.properties[0].resolve([property()]);
    await flush();
    expect(h.deps.getRoomTypes).not.toHaveBeenCalled();
    expect(h.deps.searchAvailability).not.toHaveBeenCalled();
  });

  it("works again after dispose (a remounted page applies its URL anew)", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    h.controller.dispose();
    h.controller.setQuery(q(DATES_A));
    expect(riverside(h.controller.getState()).catalog).toEqual({ status: "loading" });
    expect(h.deps.getProperties).toHaveBeenCalledTimes(2);
  });
});

describe("same query and retry", () => {
  it("applying the same URL again is a no-op", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    await readyCatalog(h);
    h.controller.setQuery(q(DATES_A));
    expect(h.calls.availability).toHaveLength(1);
  });

  it("retry after an availability error reads the current query once and shows no old answer meanwhile", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    await readyCatalog(h);
    h.calls.availability[0].d.reject(new ApiNetworkError());
    await flush();

    h.controller.retry();
    h.controller.retry(); // a second activation while the first is on its way
    expect(h.calls.availability).toHaveLength(2);
    expect(riverside(h.controller.getState()).availability).toEqual({ status: "loading" });
    expect(h.calls.availability[1].query).toMatchObject({ checkIn: "2026-11-10" });
    h.calls.availability[1].d.resolve([offer(ROOM_A)]);
    await flush();
    expect(riverside(h.controller.getState()).availability.status).toBe("success");
  });

  it("submitting the same applied query again re-reads the server instead of reusing the old price", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    await readyCatalog(h);
    h.calls.availability[0].d.resolve([offer(ROOM_A, { totalAmount: 111 })]);
    await flush();

    h.controller.retry();
    expect(riverside(h.controller.getState()).availability).toEqual({ status: "loading" });
    expect(h.calls.availability).toHaveLength(2);
    h.calls.availability[1].d.resolve([offer(ROOM_A, { totalAmount: 222 })]);
    await flush();
    const availability = riverside(h.controller.getState()).availability;
    expect(availability.status === "success" && availability.offers[0].totalAmount).toBe(222);
    expect(h.deps.getProperties).toHaveBeenCalledTimes(1); // the good catalog is reused
  });

  it("retry after a catalog error reads the catalog again, then the availability", async () => {
    const h = harness();
    h.controller.setQuery(q(DATES_A));
    h.calls.properties[0].reject(new ApiNetworkError());
    await flush();
    h.controller.retry();
    expect(riverside(h.controller.getState()).catalog).toEqual({ status: "loading" });
    expect(h.calls.properties).toHaveLength(2);
    h.calls.properties[1].resolve([property()]);
    await flush();
    h.calls.rooms[0].d.resolve([roomType(ROOM_A)]);
    await flush();
    expect(h.calls.availability).toHaveLength(1);
  });

  it("retry after a missing or empty catalog reads the catalog again", async () => {
    const h = harness();
    h.controller.setQuery(q(""));
    h.calls.properties[0].resolve([]);
    await flush();
    expect(riverside(h.controller.getState()).catalog.status).toBe("missing");
    h.controller.retry();
    expect(h.calls.properties).toHaveLength(2);
  });

  it("retry in browse mode with a ready catalog, on an invalid URL or on House does nothing", async () => {
    const h = harness();
    h.controller.setQuery(q(""));
    await readyCatalog(h);
    h.controller.retry();
    expect(h.deps.searchAvailability).not.toHaveBeenCalled();
    expect(h.deps.getProperties).toHaveBeenCalledTimes(1);
    h.controller.setQuery(q("brand=house"));
    h.controller.retry();
    h.controller.setQuery(q("brand=x"));
    h.controller.retry();
    expect(h.deps.getProperties).toHaveBeenCalledTimes(1);
  });
});

describe("buildListingCards", () => {
  const rooms = [roomType(ROOM_A), roomType(ROOM_B), roomType(ROOM_C)];
  const search = { checkIn: "2026-11-10", checkOut: "2026-11-12", adults: "2", children: "0", rooms: "1" };

  it("browse: one card per room type of the property, no quote, a link by the two ids and no search", () => {
    const { cards, ignoredOffers } = buildListingCards(property(), rooms, null, null);
    expect(cards.map((card) => card.roomType.id)).toEqual([ROOM_A, ROOM_B, ROOM_C]);
    expect(cards.every((card) => card.quote === null)).toBe(true);
    expect(ignoredOffers).toBe(0);
    const url = new URL(cards[0].href, "https://x.test");
    expect(url.pathname).toBe("/listing-stay-detail");
    expect(Array.from(url.searchParams.keys())).toEqual(["propertyId", "roomTypeId"]);
    expect(url.searchParams.get("propertyId")).toBe(PROPERTY_ID);
    expect(url.searchParams.get("roomTypeId")).toBe(ROOM_A);
  });

  it("search: only room types that have an offer, each with its own quote and all five search fields on the link", () => {
    const { cards } = buildListingCards(property(), rooms, search, [offer(ROOM_B), offer(ROOM_A, { totalAmount: 3000000 })]);
    expect(cards.map((card) => card.roomType.id)).toEqual([ROOM_A, ROOM_B]);
    expect(cards[0].quote?.totalAmount).toBe(3000000);
    expect(cards[1].quote?.totalAmount).toBe(2000000);
    const params = new URL(cards[0].href, "https://x.test").searchParams;
    expect(Array.from(params.keys()).sort()).toEqual(["adults", "checkIn", "checkOut", "children", "propertyId", "rooms", "roomTypeId"].sort());
    expect(params.get("checkIn")).toBe("2026-11-10");
    expect(params.get("rooms")).toBe("1");
  });

  it("search with no offer for any room type has no card", () => {
    expect(buildListingCards(property(), rooms, search, []).cards).toEqual([]);
  });

  it("uses the real quote helper: the cheapest of two rate plans, and a uniform nightly only when every night is equal", () => {
    const offers = [
      offer(ROOM_A, { ratePlanName: "Flexible", totalAmount: 2400000, nightlyRates: [{ stayDate: "2026-11-10", amount: 1200000 }, { stayDate: "2026-11-11", amount: 1200000 }] }),
      offer(ROOM_A, { ratePlanName: "Saver", totalAmount: 1900000, nightlyRates: [{ stayDate: "2026-11-10", amount: 800000 }, { stayDate: "2026-11-11", amount: 1100000 }] }),
    ];
    const { cards } = buildListingCards(property(), rooms, search, offers);
    expect(cards).toHaveLength(1);
    expect(cards[0].quote).toEqual(quoteForRoomType(offers, ROOM_A));
    expect(cards[0].quote?.ratePlanName).toBe("Saver");
    expect(cards[0].quote?.totalAmount).toBe(1900000);
    expect(cards[0].quote?.uniformNightlyAmount).toBeNull(); // 800k then 1.1M: no average, no per-night claim

    const uniform = buildListingCards(property(), rooms, search, [offer(ROOM_B)]);
    expect(uniform.cards[0].quote?.uniformNightlyAmount).toBe(1000000);
  });

  it("never uses an offer of another property, another room type or another query", () => {
    const offers = [
      offer(ROOM_A, { propertyId: OTHER_PROPERTY_ID }),
      offer(ROOM_B, { checkIn: "2026-11-11" }),
      offer(ROOM_C, { requestedRooms: 2 }),
      offer("d0000000-0000-0000-0000-00000000000d"), // not a room type of this property
    ];
    const { cards, ignoredOffers } = buildListingCards(property(), rooms, search, offers);
    expect(cards).toEqual([]);
    expect(ignoredOffers).toBe(4);
  });

  it("a room type of another property is not a card, in browse or in search", () => {
    const foreign = roomType(ROOM_C, { propertyId: OTHER_PROPERTY_ID });
    expect(buildListingCards(property(), [roomType(ROOM_A), foreign], null, null).cards.map((c) => c.roomType.id)).toEqual([ROOM_A]);
    expect(buildListingCards(property(), [foreign], search, [offer(ROOM_C)]).cards).toEqual([]);
  });

  it("matches ids case-insensitively like the rest of the app", () => {
    const { cards } = buildListingCards(property(), [roomType(ROOM_A)], search, [offer(ROOM_A.toUpperCase())]);
    expect(cards).toHaveLength(1);
  });
});

describe("describeListingError", () => {
  it("is fixed copy per kind of failure", () => {
    expect(describeListingError(new ApiNetworkError(), "catalog")).toMatchObject({ retryable: true });
    expect(describeListingError(new ApiConfigError("x"), "catalog")).toMatchObject({ retryable: false });
    expect(describeListingError(new ApiHttpError(503, { title: "t", status: 503 }), "availability")).toMatchObject({ retryable: true });
    expect(describeListingError(new ApiHttpError(400, { title: "t", status: 400 }), "availability")).toMatchObject({ retryable: false });
    // A 400 from the catalog is not a rejected search: it stays a retryable fault.
    expect(describeListingError(new ApiHttpError(400, { title: "t", status: 400 }), "catalog")).toMatchObject({ retryable: true });
    expect(describeListingError(new Error("boom"), "availability")).toMatchObject({ retryable: true });
  });
});
