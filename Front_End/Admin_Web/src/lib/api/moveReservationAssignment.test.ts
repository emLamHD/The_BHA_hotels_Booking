import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveReservationAssignment } from "./client";
import type { MoveReservationAssignmentRequest } from "./types";

const BASE_URL = "https://localhost:7145";
const PROPERTY_ID = "11111111-1111-1111-1111-111111111111";
const SEGMENT_ID = "44444444-4444-4444-4444-444444444444";

const request: MoveReservationAssignmentRequest = {
  expectedVersion: 3,
  physicalRoomId: "33333333-3333-3333-3333-333333333333",
  startDate: "2026-09-03",
  endDate: "2026-09-05",
  confirmCrossRoomType: false,
};

function problem(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

describe("moveReservationAssignment (PMS-CAL-001.2-CP04C.1)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = BASE_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs exactly the contract body to the segment's move route, uncredentialed, with no redirect following", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "seg-1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `${BASE_URL}/api/admin/v1/properties/${PROPERTY_ID}/reservation-assignments/${SEGMENT_ID}/move`
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body)).toEqual({
      expectedVersion: 3,
      physicalRoomId: request.physicalRoomId,
      startDate: "2026-09-03",
      endDate: "2026-09-05",
      confirmCrossRoomType: false,
    });
  });

  it("URL-encodes the propertyId and segmentId path segments", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await moveReservationAssignment("prop id/../x", "seg id?y=1", request);

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `${BASE_URL}/api/admin/v1/properties/${encodeURIComponent("prop id/../x")}/reservation-assignments/${encodeURIComponent("seg id?y=1")}/move`
    );
  });

  it("never sends actor or authorization evidence, even if a caller passes them", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const widened = {
      ...request,
      actorReference: "someone",
      authorizationEvidence: "trust-me",
    } as unknown as MoveReservationAssignmentRequest;
    await moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, widened);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(
      ["confirmCrossRoomType", "endDate", "expectedVersion", "physicalRoomId", "startDate"].sort()
    );
  });

  it("omits the reason key entirely for a same-RoomType (confirmCrossRoomType: false) request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect("reason" in body).toBe(false);
  });

  it("sends confirmCrossRoomType:true and the caller's reason verbatim for a cross-RoomType request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, {
      ...request,
      confirmCrossRoomType: true,
      reason: "Operational need; only a Deluxe room was free.",
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.confirmCrossRoomType).toBe(true);
    expect(body.reason).toBe("Operational need; only a Deluxe room was free.");
    expect(Object.keys(body).sort()).toEqual(
      ["confirmCrossRoomType", "endDate", "expectedVersion", "physicalRoomId", "reason", "startDate"].sort()
    );
  });

  it("reports not-sent and never calls fetch when the API base URL is not HTTPS", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:7145";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const outcome = await moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request);

    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats 200 as moved and returns the mutated segments", async () => {
    const segments = [
      { id: "seg-1", version: 4, status: "Cancelled" },
      { id: "seg-2", version: 1, physicalRoomId: request.physicalRoomId },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(segments), { status: 200 })));

    await expect(moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "moved",
      segments,
    });
  });

  it("treats 200 with an unreadable body as moved — the status is the proof", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    await expect(moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "moved",
      segments: null,
    });
  });

  it("maps 400 to validation with the ProblemDetails detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(problem(400, { title: "Invalid assignment request", detail: "The replacement range does not exactly cover the source segment." }))
    );

    await expect(moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 400,
      category: "validation",
      detail: "The replacement range does not exactly cover the source segment.",
    });
  });

  it("bounds and flattens server text so a large or multi-line body cannot flood the dialog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(400, { detail: `line1\n\n${"x".repeat(1000)}` })));

    const outcome = await moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.detail!.length).toBeLessThanOrEqual(300);
      expect(outcome.detail).not.toContain("\n");
    }
  });

  it("maps a closed write gate's empty 404 to not-permitted without reading a body, never as a deleted booking", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 404,
      category: "not-permitted",
    });
  });

  it("maps 403 (origin refused, JSON or not) to not-permitted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>denied</html>", { status: 403 })));

    await expect(moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 403,
      category: "not-permitted",
    });
  });

  it("maps the store's 403 'Cross-RoomType confirmation required' to its own category with the server detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(403, {
          title: "Cross-RoomType confirmation required",
          detail: "Cross-RoomType assignment requires non-empty authorization evidence and a recorded reason.",
        })
      )
    );

    await expect(
      moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, { ...request, confirmCrossRoomType: true, reason: "" })
    ).resolves.toEqual({
      kind: "rejected",
      status: 403,
      category: "cross-room-type-confirmation-required",
      detail: "Cross-RoomType assignment requires non-empty authorization evidence and a recorded reason.",
    });
  });

  it("maps 409 (stale expectedVersion or a conflicting destination) to conflict with the server detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(409, {
          title: "Assignment conflict",
          detail: "The segment has since changed; expectedVersion no longer matches.",
        })
      )
    );

    await expect(moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "The segment has since changed; expectedVersion no longer matches.",
    });
  });

  it("maps any other 4xx (e.g. 415) to refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(415, { detail: "Unsupported media type" })));

    const outcome = await moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request);
    expect(outcome).toMatchObject({ kind: "rejected", status: 415, category: "refused" });
  });

  it("maps 5xx to unknown — an exception can follow a commit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(500, { title: "Server error" })));

    await expect(moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "server-error",
      status: 500,
    });
  });

  it("maps a network failure (including a browser-hidden CORS refusal) to unknown and does not retry", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "network",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts after the timeout and reports unknown/timeout, without retrying", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const pending = moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "timeout" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reports an abort after sending as unknown, never as cancelled", async () => {
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

    const pending = moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "aborted" });
  });

  it("PMS-CAL-001.2-CP04C.1-C1: reports not-sent, never fetches, for a signal already aborted before the call", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const outcome = await moveReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });

    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
