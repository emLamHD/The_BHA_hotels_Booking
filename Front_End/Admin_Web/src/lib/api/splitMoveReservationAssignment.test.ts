import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ENDED_DETAIL, splitMoveReservationAssignment } from "./client";
import type { SplitMoveReservationAssignmentRequest } from "./types";

const BASE_URL = "https://localhost:7145";
const PROPERTY_ID = "11111111-1111-1111-1111-111111111111";
const SEGMENT_ID = "44444444-4444-4444-4444-444444444444";
const ROUTE = `${BASE_URL}/api/admin/v1/properties/${PROPERTY_ID}/reservation-assignments/${SEGMENT_ID}/split-move`;

const request: SplitMoveReservationAssignmentRequest = {
  expectedVersion: 3,
  splitDate: "2026-11-06",
  destinationPhysicalRoomId: "room-102",
};

const problem = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/problem+json" } });

const hangingFetch = () =>
  vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
  );

describe("splitMoveReservationAssignment (PMS-CAL-002-CP03)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE_URL);
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POSTs exactly the three required fields to the split-move route, uncredentialed, no redirect, and omits unsupplied optionals", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(ROUTE);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body)).toEqual({ expectedVersion: 3, splitDate: "2026-11-06", destinationPhysicalRoomId: "room-102" });
  });

  it("sends the supplied optional fields verbatim — including an explicit false", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, { ...request, confirmCrossRoomType: true, reason: "AC failure in 101" });
    await splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, { ...request, confirmCrossRoomType: false });

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      expectedVersion: 3,
      splitDate: "2026-11-06",
      destinationPhysicalRoomId: "room-102",
      confirmCrossRoomType: true,
      reason: "AC failure in 101",
    });
    const second = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(second.confirmCrossRoomType).toBe(false);
    expect("reason" in second).toBe(false);
  });

  it("drops actor, evidence, role, Unit, source range and replacement list even when a caller passes a wider object", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const widened = {
      ...request,
      actorReference: "someone",
      authorizationEvidence: "trust-me",
      role: "Manager",
      reservationUnitId: "unit-1",
      startDate: "2026-11-01",
      endDate: "2026-11-10",
      physicalRoomId: "room-101",
      replacements: [{ physicalRoomId: "room-102", startDate: "2026-11-06", endDate: "2026-11-10" }],
    } as unknown as SplitMoveReservationAssignmentRequest;
    await splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, widened);

    expect(Object.keys(JSON.parse(fetchSpy.mock.calls[0][1].body)).sort()).toEqual(["destinationPhysicalRoomId", "expectedVersion", "splitDate"]);
  });

  it("URL-encodes the Property and segment path segments separately", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await splitMoveReservationAssignment("prop id/../x", "seg id?y=1", request);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/admin/v1/properties/${encodeURIComponent("prop id/../x")}/reservation-assignments/${encodeURIComponent("seg id?y=1")}/split-move`
    );
  });

  it("treats 200 as split and returns the three segments", async () => {
    const segments = [{ id: "src", status: "Cancelled" }, { id: "prefix" }, { id: "suffix" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(segments), { status: 200 })));
    await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "split", segments });
  });

  it("treats 200 with an unreadable body as split — the status is the proof, not the body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "split", segments: null });
  });

  it.each([
    ["400", problem(400, { title: "Invalid assignment request", detail: "splitDate must fall strictly inside the segment's nights." }), { status: 400, category: "validation", detail: "splitDate must fall strictly inside the segment's nights." }],
    ["401", problem(401, { title: "Authentication required" }), { status: 401, category: "refused", detail: SESSION_ENDED_DETAIL }],
    ["409", problem(409, { title: "Assignment conflict", detail: "expectedVersion no longer matches." }), { status: 409, category: "conflict", detail: "expectedVersion no longer matches." }],
    ["415", new Response("", { status: 415 }), { status: 415, category: "refused", detail: undefined }],
    ["422 (other 4xx)", problem(422, { detail: "Nope." }), { status: 422, category: "refused", detail: "Nope." }],
  ])("maps %s to a rejection — proof of no write", async (_name, response, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "rejected", ...expected });
  });

  it("keeps the store's exact cross-RoomType 403 apart from a permission or Origin 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(403, { title: "Cross-RoomType confirmation required", detail: "Reason is required." })));
    await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 403,
      category: "cross-room-type-confirmation-required",
      detail: "Reason is required.",
    });
    for (const title of ["Access denied", "Origin not allowed", "cross-roomtype confirmation required"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(403, { title, detail: "x" })));
      await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
        kind: "rejected",
        status: 403,
        category: "not-permitted",
      });
    }
  });

  it("maps 404 to a detail-free not-permitted — never a claim that the booking was deleted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(404, { title: "Assignment target not found", detail: "Segment gone." })));
    await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 404,
      category: "not-permitted",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toMatchObject({ category: "not-permitted" });
  });

  it.each([500, 503, 204, 302, 100])("maps status %s to unknown — it may follow a commit or is unexpected", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status, ok: false, text: async () => "", json: async () => ({}) }));
    await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "server-error",
      status,
    });
  });

  it("maps a network failure to unknown with exactly one attempt", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({ kind: "unknown", reason: "network" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reports unknown/timeout after the client-side timeout and clears its timer", async () => {
    vi.useFakeTimers();
    const fetchSpy = hangingFetch();
    vi.stubGlobal("fetch", fetchSpy);
    const pending = splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "timeout" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports an abort after sending as unknown and removes its abort listener", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", hangingFetch());
    const pending = splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "aborted" });
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });

  it("cleans up its timer and listener after a normal response", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200 })));
    await splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("reports not-sent, with no fetch, for a signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const outcome = await splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports not-sent, with no fetch, when the API base URL is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await splitMoveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
