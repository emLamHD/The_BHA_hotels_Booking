import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReservationAssignment } from "./client";
import type { CreateReservationAssignmentRequest } from "./types";

const BASE_URL = "https://localhost:7145";
const PROPERTY_ID = "11111111-1111-1111-1111-111111111111";

const request: CreateReservationAssignmentRequest = {
  reservationUnitId: "22222222-2222-2222-2222-222222222222",
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

describe("createReservationAssignment (PMS-CAL-001.2-CP03A)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = BASE_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs exactly the contract body to the Property's assignment route, uncredentialed, with no redirect following", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "seg-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);

    await createReservationAssignment(PROPERTY_ID, request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/admin/v1/properties/${PROPERTY_ID}/reservation-assignments`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body)).toEqual({
      reservationUnitId: request.reservationUnitId,
      physicalRoomId: request.physicalRoomId,
      startDate: "2026-09-03",
      endDate: "2026-09-05",
      confirmCrossRoomType: false,
    });
  });

  it("never sends actor, authorization evidence, reason or a cross-RoomType acknowledgement, even if a caller passes them", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);

    const widened = {
      ...request,
      actorReference: "someone",
      authorizationEvidence: "trust-me",
      reason: "because",
      confirmCrossRoomType: true,
    } as unknown as CreateReservationAssignmentRequest;
    await createReservationAssignment(PROPERTY_ID, widened);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(
      ["confirmCrossRoomType", "endDate", "physicalRoomId", "reservationUnitId", "startDate"].sort()
    );
    expect(body.confirmCrossRoomType).toBe(false);
  });

  it("reports not-sent and never calls fetch when the API base URL is not HTTPS", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:7145";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const outcome = await createReservationAssignment(PROPERTY_ID, request);

    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats 201 as created and returns the segment", async () => {
    const segment = { id: "seg-1", version: 1, physicalRoomId: request.physicalRoomId };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(segment), { status: 201 })));

    await expect(createReservationAssignment(PROPERTY_ID, request)).resolves.toEqual({
      kind: "created",
      segment,
    });
  });

  it("treats 201 with an unreadable body as created — the status is the proof", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 201 })));

    await expect(createReservationAssignment(PROPERTY_ID, request)).resolves.toEqual({
      kind: "created",
      segment: null,
    });
  });

  it("maps 400 to validation with the ProblemDetails detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(problem(400, { title: "Invalid assignment request", detail: "startDate must be earlier than endDate." }))
    );

    await expect(createReservationAssignment(PROPERTY_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 400,
      category: "validation",
      detail: "startDate must be earlier than endDate.",
    });
  });

  it("maps a 400 ValidationProblemDetails to its field messages when there is no detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(400, { title: "One or more validation errors occurred.", errors: { startDate: ["startDate is required."] } })
      )
    );

    const outcome = await createReservationAssignment(PROPERTY_ID, request);
    expect(outcome).toMatchObject({ kind: "rejected", category: "validation", detail: "startDate is required." });
  });

  it("bounds and flattens server text so a large or multi-line body cannot flood the dialog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(400, { detail: `line1\n\n${"x".repeat(1000)}` })));

    const outcome = await createReservationAssignment(PROPERTY_ID, request);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.detail!.length).toBeLessThanOrEqual(300);
      expect(outcome.detail).not.toContain("\n");
    }
  });

  it("maps a closed write gate's empty 404 to not-permitted without reading a body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(createReservationAssignment(PROPERTY_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 404,
      category: "not-permitted",
    });
  });

  it("maps a store 404 to not-permitted and drops its 'does not exist' text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(404, { title: "Assignment target not found", detail: "The requested ReservationUnit does not exist in this Property." })
      )
    );

    const outcome = await createReservationAssignment(PROPERTY_ID, request);
    expect(outcome).toEqual({ kind: "rejected", status: 404, category: "not-permitted" });
  });

  it("maps 403 (origin refused, JSON or not) to not-permitted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>denied</html>", { status: 403 })));

    await expect(createReservationAssignment(PROPERTY_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 403,
      category: "not-permitted",
    });
  });

  it("maps 409 to conflict with the server detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(409, {
          title: "Assignment conflict",
          detail: "This ReservationUnit already has an overlapping Effective assignment for one or more of these dates.",
        })
      )
    );

    await expect(createReservationAssignment(PROPERTY_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "This ReservationUnit already has an overlapping Effective assignment for one or more of these dates.",
    });
  });

  it("maps any other 4xx (e.g. 415) to refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(415, { detail: "Unsupported media type" })));

    const outcome = await createReservationAssignment(PROPERTY_ID, request);
    expect(outcome).toMatchObject({ kind: "rejected", status: 415, category: "refused" });
  });

  it("maps 5xx to unknown — an exception can follow a commit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(500, { title: "Server error" })));

    await expect(createReservationAssignment(PROPERTY_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "server-error",
      status: 500,
    });
  });

  it("maps a network failure (including a browser-hidden CORS refusal) to unknown and does not retry", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createReservationAssignment(PROPERTY_ID, request)).resolves.toEqual({
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

    const pending = createReservationAssignment(PROPERTY_ID, request, { timeoutMs: 5_000 });
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

    const pending = createReservationAssignment(PROPERTY_ID, request, { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "aborted" });
  });
});
