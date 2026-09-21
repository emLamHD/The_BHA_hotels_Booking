import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unassignReservationAssignment } from "./client";
import type { UnassignReservationAssignmentRequest } from "./types";

const BASE_URL = "https://localhost:7145";
const PROPERTY_ID = "11111111-1111-1111-1111-111111111111";
const SEGMENT_ID = "44444444-4444-4444-4444-444444444444";

const request: UnassignReservationAssignmentRequest = {
  expectedVersion: 3,
};

function problem(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

describe("unassignReservationAssignment (PMS-CAL-001.2-CP04D.1)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = BASE_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs exactly {expectedVersion} to the segment's unassign route, uncredentialed, with no redirect following — and drops actor/evidence/extra fields even if a caller passes them", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const widened = {
      ...request,
      actorReference: "someone",
      authorizationEvidence: "trust-me",
      physicalRoomId: "should-never-be-sent",
    } as unknown as UnassignReservationAssignmentRequest;
    await unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, widened);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `${BASE_URL}/api/admin/v1/properties/${PROPERTY_ID}/reservation-assignments/${SEGMENT_ID}/unassign`
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body)).toEqual({ expectedVersion: 3 });
  });

  it("URL-encodes the propertyId and segmentId path segments", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await unassignReservationAssignment("prop id/../x", "seg id?y=1", request);

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `${BASE_URL}/api/admin/v1/properties/${encodeURIComponent("prop id/../x")}/reservation-assignments/${encodeURIComponent("seg id?y=1")}/unassign`
    );
  });

  it("omits the reason key entirely when the caller does not supply one", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect("reason" in body).toBe(false);
  });

  it("sends the caller's reason verbatim, and only the two contract fields, when supplied", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, {
      ...request,
      reason: "Guest cancelled the extra room.",
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.reason).toBe("Guest cancelled the extra room.");
    expect(Object.keys(body).sort()).toEqual(["expectedVersion", "reason"]);
  });

  it("treats 200 as unassigned and returns the mutated (superseded) segments", async () => {
    const segments = [{ id: "seg-1", version: 4, status: "Cancelled" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(segments), { status: 200 })));

    await expect(unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unassigned",
      segments,
    });
  });

  it("treats 200 with an unreadable body as unassigned — the status is the proof, not the body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    await expect(unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unassigned",
      segments: null,
    });
  });

  it("maps 400 to validation with the ProblemDetails detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(problem(400, { title: "Invalid assignment request", detail: "expectedVersion is required." }))
    );

    await expect(unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 400,
      category: "validation",
      detail: "expectedVersion is required.",
    });
  });

  it("maps 403 to the generic not-permitted category — never the cross-RoomType title create/move detect, since unassign can never be cross-RoomType", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(403, {
          title: "Cross-RoomType confirmation required",
          detail: "This title must be ignored for an unassign request.",
        })
      )
    );

    await expect(unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 403,
      category: "not-permitted",
    });
  });

  it("maps a closed write gate's empty 404 to not-permitted without reading a body, never as a deleted booking", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 404,
      category: "not-permitted",
    });
  });

  it("maps 409 (stale expectedVersion) to conflict with the server detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(409, { title: "Assignment conflict", detail: "The segment has since changed; expectedVersion no longer matches." })
      )
    );

    await expect(unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "The segment has since changed; expectedVersion no longer matches.",
    });
  });

  it("maps 5xx to unknown — an exception can follow a commit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(500, { title: "Server error" })));

    await expect(unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "server-error",
      status: 500,
    });
  });

  it("maps a network failure to unknown and makes exactly one attempt — no automatic retry", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "network",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts after the client-side timeout and reports unknown/timeout, without retrying", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const pending = unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { timeoutMs: 5_000 });
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

    const pending = unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "aborted" });
  });

  it("reports not-sent and never calls fetch for a signal already aborted before the call", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const outcome = await unassignReservationAssignment(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });

    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
