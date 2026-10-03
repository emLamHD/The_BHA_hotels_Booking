/**
 * PMS-ADMIN-AUTH-001-CP06 evidence groups 1, 2, 12, 15 and 16: the Calendar
 * client per access mode — credentials, the 401 rejection, and nothing sent
 * for an invalid mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_ENDED_DETAIL,
  cancelOperationalBlock,
  createOperationalBlock,
  createReservationAssignment,
  fetchActiveProperties,
  fetchReservationBoard,
  moveReservationAssignment,
  unassignReservationAssignment,
} from "./client";

const BASE_URL = "https://localhost:7145";

const writes = {
  create: () =>
    createReservationAssignment("prop-a", {
      reservationUnitId: "unit-1",
      physicalRoomId: "room-201",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      confirmCrossRoomType: true,
      reason: "Upgrade",
    }),
  move: () =>
    moveReservationAssignment("prop-a", "seg-1", {
      expectedVersion: 1,
      physicalRoomId: "room-102",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      confirmCrossRoomType: false,
    }),
  unassign: () => unassignReservationAssignment("prop-a", "seg-1", { expectedVersion: 1 }),
  blockCreate: () =>
    createOperationalBlock("prop-a", { physicalRoomId: "room-101", startDate: "2026-10-01", endDate: "2026-10-03", reason: "Repair" }),
  blockCancel: () => cancelOperationalBlock("prop-a", "seg-2", { expectedVersion: 1 }),
};

const successStatus: Record<keyof typeof writes, number> = {
  create: 201,
  move: 200,
  unassign: 200,
  blockCreate: 201,
  blockCancel: 200,
};

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE_URL));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Staff mode", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff"));

  it("reads the board with the Staff cookie", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchReservationBoard("prop-a", "2026-10-01", "2026-10-15");
    expect(fetchSpy.mock.calls[0][1].credentials).toBe("include");
  });

  it.each(Object.keys(writes) as (keyof typeof writes)[])(
    "sends %s with the Staff cookie, the same JSON body and no actor, role or evidence",
    async (name) => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: successStatus[name] }));
      vi.stubGlobal("fetch", fetchSpy);
      await writes[name]();
      const init = fetchSpy.mock.calls[0][1];
      expect(init.credentials).toBe("include");
      expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
      expect(init.headers).not.toHaveProperty("Origin");
      expect(init.body).not.toMatch(/actor|evidence|role|staff/i);
    }
  );

  it.each(Object.keys(writes) as (keyof typeof writes)[])(
    "reports a 401 on %s as a rejection — proof of no write — that says the session ended",
    async (name) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "Authentication required" }), { status: 401 })));
      expect(await writes[name]()).toEqual({ kind: "rejected", status: 401, category: "refused", detail: SESSION_ENDED_DETAIL });
    }
  );

  it("keeps the store's cross-RoomType 403 apart from a permission 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "Cross-RoomType confirmation required", detail: "x" }), { status: 403 }))
    );
    expect(await writes.create()).toMatchObject({ kind: "rejected", category: "cross-room-type-confirmation-required" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "Access denied" }), { status: 403 })));
    expect(await writes.create()).toMatchObject({ kind: "rejected", status: 403, category: "not-permitted" });
  });

  it("still reports 200/201 with an unreadable body as success, and a lost answer as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 201 })));
    expect(await writes.create()).toEqual({ kind: "created", segment: null });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await writes.move()).toEqual({ kind: "unknown", reason: "network" });
  });
});

describe("LocalGate mode (unset)", () => {
  it.each(Object.keys(writes) as (keyof typeof writes)[])("keeps %s uncredentialed", async (name) => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: successStatus[name] }));
    vi.stubGlobal("fetch", fetchSpy);
    await writes[name]();
    expect(fetchSpy.mock.calls[0][1].credentials).toBe("omit");
  });

  it("leaves the board and catalog reads exactly as before (browser-default credentials)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchActiveProperties();
    await fetchReservationBoard("prop-a", "2026-10-01", "2026-10-15");
    for (const [, init] of fetchSpy.mock.calls) expect(init).not.toHaveProperty("credentials");
  });
});

describe("an invalid access mode", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Stafff"));

  it("sends no Calendar request at all", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await fetchActiveProperties()).ok).toBe(false);
    expect((await fetchReservationBoard("prop-a", "2026-10-01", "2026-10-15")).ok).toBe(false);
    for (const write of Object.values(writes)) expect((await write()).kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
