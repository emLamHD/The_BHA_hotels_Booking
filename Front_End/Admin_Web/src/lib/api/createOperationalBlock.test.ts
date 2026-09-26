import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOperationalBlock } from "./client";
import type { CreateOperationalBlockRequest } from "./types";

const BASE_URL = "https://localhost:7145";
const PROPERTY_ID = "11111111-1111-1111-1111-111111111111";

const request: CreateOperationalBlockRequest = {
  physicalRoomId: "22222222-2222-2222-2222-222222222222",
  startDate: "2026-09-01",
  endDate: "2026-09-04",
  reason: "Burst pipe",
};

function problem(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

describe("createOperationalBlock (PMS-CAL-001.3-CP03)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = BASE_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs exactly the four contract fields to the Property's operational-blocks route, uncredentialed, with no redirect following — dropping any actor/evidence a caller passes", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);

    const widened = {
      ...request,
      actorReference: "someone",
      authorizationEvidence: "trust-me",
    } as unknown as CreateOperationalBlockRequest;
    await createOperationalBlock(PROPERTY_ID, widened);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/admin/v1/properties/${PROPERTY_ID}/operational-blocks`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it("URL-encodes the propertyId path segment", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);

    await createOperationalBlock("prop id/../x", request);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/admin/v1/properties/${encodeURIComponent("prop id/../x")}/operational-blocks`
    );
  });

  it("treats 201 as created with the header id and segment, and an unreadable 201 body as created too", async () => {
    const block = { roomBlockId: "block-1", segment: { id: "seg-1", version: 1 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(block), { status: 201 })));
    await expect(createOperationalBlock(PROPERTY_ID, request)).resolves.toEqual({ kind: "created", block });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 201 })));
    await expect(createOperationalBlock(PROPERTY_ID, request)).resolves.toEqual({ kind: "created", block: null });
  });

  it("maps 400 to validation with the ProblemDetails detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        problem(400, { title: "Invalid operational block request", detail: "startDate must be earlier than endDate." })
      )
    );

    await expect(createOperationalBlock(PROPERTY_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 400,
      category: "validation",
      detail: "startDate must be earlier than endDate.",
    });
  });

  it("maps the gate's 403 and a closed gate's empty 404 to not-permitted, without server detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(403, { title: "Origin not allowed", detail: "x" })));
    await expect(createOperationalBlock(PROPERTY_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 403,
      category: "not-permitted",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(createOperationalBlock(PROPERTY_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 404,
      category: "not-permitted",
    });
  });

  it("maps 409 to conflict with the server detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(problem(409, { title: "Operational block conflict", detail: "Room is occupied." }))
    );

    await expect(createOperationalBlock(PROPERTY_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "Room is occupied.",
    });
  });

  it("maps 5xx and a network failure to unknown, making exactly one attempt each", async () => {
    const serverError = vi.fn().mockResolvedValue(problem(500, { title: "Server error" }));
    vi.stubGlobal("fetch", serverError);
    await expect(createOperationalBlock(PROPERTY_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "server-error",
      status: 500,
    });
    expect(serverError).toHaveBeenCalledTimes(1);

    const networkError = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", networkError);
    await expect(createOperationalBlock(PROPERTY_ID, request)).resolves.toEqual({ kind: "unknown", reason: "network" });
    expect(networkError).toHaveBeenCalledTimes(1);
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

    const pending = createOperationalBlock(PROPERTY_ID, request, { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "timeout" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    const pending = createOperationalBlock(PROPERTY_ID, request, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "aborted" });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const outcome = await createOperationalBlock(PROPERTY_ID, request, { signal: controller.signal });
    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports not-sent when the API base URL is not configured", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const outcome = await createOperationalBlock(PROPERTY_ID, request);

    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
