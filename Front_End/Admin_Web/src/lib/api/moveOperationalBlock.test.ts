/**
 * PMS-CAL-003-CP02: the move half of the operational-block client. The shape guarantees mirror
 * `cancelOperationalBlock.test.ts`; what differs is the body (a destination room, never dates), the
 * evidence each status carries, and the absence of any cross-RoomType branch — a block has none.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveOperationalBlock } from "./client";
import type { MoveOperationalBlockRequest } from "./types";

const BASE_URL = "https://localhost:7145";
const PROPERTY_ID = "11111111-1111-1111-1111-111111111111";
const SEGMENT_ID = "33333333-3333-3333-3333-333333333333";
const ROOM_ID = "44444444-4444-4444-4444-444444444444";

const request: MoveOperationalBlockRequest = { expectedVersion: 42, destinationPhysicalRoomId: ROOM_ID };

const moveUrl = (propertyId = PROPERTY_ID, segmentId = SEGMENT_ID) =>
  `${BASE_URL}/api/admin/v1/properties/${encodeURIComponent(propertyId)}/operational-blocks/${encodeURIComponent(segmentId)}/move`;

function problem(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/problem+json" } });
}

describe("moveOperationalBlock (PMS-CAL-003-CP02)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = BASE_URL;
    // This file pins the LocalGate wire contract, an explicit opt-in (Staff is the default); the Staff
    // cookie is covered by clientAccessMode.test.ts.
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POSTs exactly expectedVersion and destinationPhysicalRoomId to the segment's move route — dropping anything a wider runtime object carries", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const widened = {
      ...request,
      actorReference: "someone",
      authorizationEvidence: "trust-me",
      confirmCrossRoomType: true,
      startDate: "2026-11-01",
      endDate: "2026-11-04",
      physicalRoomId: "room-1",
      roomBlockId: "header-1",
      replacements: [{ physicalRoomId: "room-9" }],
      role: "Manager",
    } as unknown as MoveOperationalBlockRequest;
    await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, widened);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(moveUrl());
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({ expectedVersion: 42, destinationPhysicalRoomId: ROOM_ID });
  });

  it("sends a reason only when the caller set one, and never an empty property", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, { ...request, reason: "Closure follows the repair" });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ ...request, reason: "Closure follows the repair" });

    await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request);
    expect(Object.keys(JSON.parse(fetchSpy.mock.calls[1][1].body)).sort()).toEqual(["destinationPhysicalRoomId", "expectedVersion"]);
  });

  it("URL-encodes both the propertyId and the segmentId path segments", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await moveOperationalBlock("prop id/../x", "seg id/../y", request);

    expect(fetchSpy.mock.calls[0][0]).toBe(moveUrl("prop id/../x", "seg id/../y"));
  });

  it("treats every 200 as moved — with the store result, with an unreadable body, with null, and with an empty body", async () => {
    const segments = [
      { id: SEGMENT_ID, status: "Cancelled", version: 43 },
      { id: "succ", status: "Effective", version: 1 },
    ];
    for (const [body, expected] of [
      [JSON.stringify(segments), segments],
      ["not json", null],
      ["null", null],
      ["", null],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
      await expect(moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "moved", segments: expected });
    }
  });

  it("reports 400 as validation with the problem detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(400, { detail: "The destination PhysicalRoom must differ from the block's current room." })));
    await expect(moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 400,
      category: "validation",
      detail: "The destination PhysicalRoom must differ from the block's current room.",
    });
  });

  it("reports 401 as a refusal whose marker says the session ended (proof of no write)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(401, { title: "Authentication required" })));
    const outcome = await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request);
    expect(outcome).toMatchObject({ kind: "rejected", status: 401, category: "refused" });
    expect((outcome as { detail?: string }).detail).toMatch(/session/i);
  });

  it.each([403, 404])("reports %i as not-permitted without server detail — including the cross-RoomType title a block never has", async (status) => {
    for (const body of [{ detail: "Segment not found." }, { title: "Cross-RoomType confirmation required", detail: "x" }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(status, body)));
      const outcome = await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request);
      expect(outcome).toEqual({ kind: "rejected", status, category: "not-permitted" });
      expect(JSON.stringify(outcome)).not.toMatch(/not found|Cross-RoomType/);
    }
  });

  it("reports an empty-bodied 404 — a closed write gate — as not-permitted, never as a removed block", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "rejected", status: 404, category: "not-permitted" });
  });

  it("reports 409 as conflict with the safe detail, and never a block-specific success or loss", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(409, { detail: "The schedule changed since it was last read. Reload and retry." })));
    await expect(moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "The schedule changed since it was last read. Reload and retry.",
    });
  });

  it.each([415, 422, 429, 418])("reports %i as refused", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(status, { detail: "No." })));
    await expect(moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "rejected", status, category: "refused", detail: "No." });
  });

  it.each([500, 502, 503, 504])("reports %i as unknown/server-error — it may follow a commit", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(status, { detail: "boom" })));
    await expect(moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "unknown", reason: "server-error", status });
  });

  it.each([201, 204, 301, 302, 399])("reports the unexpected status %i as unknown, never a success or a refusal", async (status) => {
    const body = status === 204 ? null : "{}";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
    const outcome = await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request);
    expect(outcome).toMatchObject({ kind: "unknown", reason: "server-error", status });
  });

  it("makes exactly one fetch for every outcome — never a retry", async () => {
    const outcomes: (() => Promise<Response>)[] = [
      () => Promise.resolve(new Response("[]", { status: 200 })),
      () => Promise.resolve(problem(400, {})),
      () => Promise.resolve(problem(409, {})),
      () => Promise.resolve(problem(503, {})),
      () => Promise.reject(new TypeError("Failed to fetch")),
    ];
    for (const next of outcomes) {
      const fetchSpy = vi.fn(next);
      vi.stubGlobal("fetch", fetchSpy);
      await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("reports a network failure as unknown/network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "unknown", reason: "network" });
  });

  it("aborts after the client-side timeout and reports unknown/timeout, leaving no timer or listener behind", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const pending = moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request, { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "timeout" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timeout and removes the abort listener after a normal answer, an unreadable body and an error", async () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const removeSpy = vi.spyOn(external.signal, "removeEventListener");
    for (const make of [
      () => new Response("[]", { status: 200 }),
      () => new Response("not json", { status: 200 }),
      () => problem(409, { detail: "x" }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make()));
      await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request, { signal: external.signal });
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(removeSpy).toHaveBeenCalledTimes(3);
    removeSpy.mockRestore();
  });

  it("reports an abort after sending as unknown, and an abort before the call as not-sent without fetching", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          })
      )
    );
    const pending = moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "aborted" });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const outcome = await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports not-sent, with zero fetches, for a missing, non-https or invalid base URL and for an invalid access mode", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect((await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).kind).toBe("not-sent");
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:7145";
    expect((await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).kind).toBe("not-sent");
    process.env.NEXT_PUBLIC_API_BASE_URL = "not a url";
    expect((await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).kind).toBe("not-sent");
    process.env.NEXT_PUBLIC_API_BASE_URL = BASE_URL;
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "bogus");
    expect((await moveOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).kind).toBe("not-sent");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
