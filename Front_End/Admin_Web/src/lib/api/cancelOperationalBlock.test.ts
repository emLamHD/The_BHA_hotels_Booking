/**
 * PMS-CAL-001.3-CP04: the cancel half of the operational-block client. The
 * shape guarantees mirror `createOperationalBlock.test.ts`; what differs is the
 * evidence each status carries, so the board can never present a refusal as a
 * lifted block or a lost response as a failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelOperationalBlock } from "./client";
import type { CancelOperationalBlockRequest } from "./types";

const BASE_URL = "https://localhost:7145";
const PROPERTY_ID = "11111111-1111-1111-1111-111111111111";
const SEGMENT_ID = "33333333-3333-3333-3333-333333333333";

const request: CancelOperationalBlockRequest = { expectedVersion: 4 };

const cancelUrl = (propertyId = PROPERTY_ID, segmentId = SEGMENT_ID) =>
  `${BASE_URL}/api/admin/v1/properties/${encodeURIComponent(propertyId)}/operational-blocks/${encodeURIComponent(segmentId)}/cancel`;

function problem(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

describe("cancelOperationalBlock (PMS-CAL-001.3-CP04)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = BASE_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs only expectedVersion to the segment's cancel route, uncredentialed, with no redirect following — dropping any actor/evidence a caller passes", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const widened = {
      ...request,
      actorReference: "someone",
      authorizationEvidence: "trust-me",
      physicalRoomId: "room-1",
      startDate: "2026-09-01",
    } as unknown as CancelOperationalBlockRequest;
    await cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, widened);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(cancelUrl());
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    // No room and no dates: a cancel never reshapes the block it lifts.
    expect(JSON.parse(init.body)).toEqual({ expectedVersion: 4 });
  });

  it("sends a reason only when the caller set one, and never an empty property", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, { expectedVersion: 2, reason: "Repair finished" });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      expectedVersion: 2,
      reason: "Repair finished",
    });

    await cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, { expectedVersion: 2 });
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({ expectedVersion: 2 });
    expect(Object.keys(JSON.parse(fetchSpy.mock.calls[1][1].body))).not.toContain("reason");
  });

  it("URL-encodes both the propertyId and the segmentId path segments", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await cancelOperationalBlock("prop id/../x", "seg id/../y", request);

    expect(fetchSpy.mock.calls[0][0]).toBe(cancelUrl("prop id/../x", "seg id/../y"));
  });

  it("treats 200 as cancelled with the superseded segment, and an unreadable 200 body as cancelled too", async () => {
    const segment = { id: SEGMENT_ID, status: "Cancelled", version: 5 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(segment), { status: 200 })));
    await expect(cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "cancelled",
      segment,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    await expect(cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "cancelled",
      segment: null,
    });
  });

  it("reports 400 as validation with the problem detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(problem(400, { detail: "expectedVersion is required." }))
    );
    await expect(cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 400,
      category: "validation",
      detail: "expectedVersion is required.",
    });
  });

  it.each([403, 404])(
    "reports %i as not-permitted without server detail, so a closed gate is never shown as a lifted block",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(problem(status, { detail: "Segment not found." }))
      );
      const outcome = await cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request);
      expect(outcome).toEqual({ kind: "rejected", status, category: "not-permitted" });
      expect(JSON.stringify(outcome)).not.toContain("Segment not found.");
    }
  );

  it("reports an empty-bodied 404 — a closed write gate — as not-permitted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 404,
      category: "not-permitted",
    });
  });

  it("reports 409 as conflict with the detail — a stale expectedVersion or an already-cancelled segment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(problem(409, { detail: "The segment version is stale." }))
    );
    await expect(cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 409,
      category: "conflict",
      detail: "The segment version is stale.",
    });
  });

  it("reports any other 4xx as refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(415, { detail: "Unsupported media type." })));
    await expect(cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "rejected",
      status: 415,
      category: "refused",
      detail: "Unsupported media type.",
    });
  });

  it.each([500, 503])("reports %i as unknown/server-error — it may follow a commit", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(problem(status, { detail: "boom" })));
    await expect(cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "server-error",
      status,
    });
  });

  it("reports a network failure as unknown/network, without retrying", async () => {
    const networkError = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", networkError);
    await expect(cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request)).resolves.toEqual({
      kind: "unknown",
      reason: "network",
    });
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

    const pending = cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request, { timeoutMs: 5_000 });
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
    const pending = cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: "unknown", reason: "aborted" });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const outcome = await cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request, { signal: controller.signal });
    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports not-sent when the API base URL is not configured", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const outcome = await cancelOperationalBlock(PROPERTY_ID, SEGMENT_ID, request);

    expect(outcome.kind).toBe("not-sent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
