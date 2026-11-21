/**
 * BHA-ADMIN-BADGE-001-PR10 (ADR 0011 §B, §C, §D): the Promotions list says "seen" — through the real session, provider and gate — for ITS Property only, with the watermark of the list that is on
 * screen, and for nothing else. The API client and the connections are replaced; every answer is scripted or deferred by the test, and the scripted reads ignore the AbortSignal (as a late
 * answer from a real transport may). What is asserted is what went to `POST menu-unseen/promotions/seen`: `markMenuSeen(menu, watermark, signal, propertyId)`.
 */
import React, { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, ok } from "@/components/website/websiteTestUtils";
import type { StaffSession } from "@/lib/api/staff";
import type { PromotionSummary } from "@/lib/api/promotions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (original) => ({ ...(await original<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/website/newsletterLive", () => ({ startNewsletterLive: vi.fn(() => ({ retryNow: vi.fn(), dispose: vi.fn() })) }));
vi.mock("@/lib/api/promotions", async (original) => ({
  ...(await original<typeof import("@/lib/api/promotions")>()),
  readPromotions: vi.fn(), listPromotions: vi.fn(), getPromotion: vi.fn(), getPromotionRoomTypes: vi.fn(),
}));
vi.mock("@/lib/api/menuUnseen", async (original) => ({
  ...(await original<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(), markMenuSeen: vi.fn(), markNewsletterSeen: vi.fn(),
}));

import PromotionsScreen from "./PromotionsScreen";
import { MenuUnseenProvider, useMenuUnseen } from "@/components/website/NewsletterBadgeProvider";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import { startNewsletterLive } from "@/lib/website/newsletterLive";
import { fetchStaffSession } from "@/lib/api/staff";
import { fetchMenuUnseenSummary, markMenuSeen, type MenuUnseenEntry, type PropertyUnseen } from "@/lib/api/menuUnseen";
import { getPromotion, getPromotionRoomTypes, readPromotions } from "@/lib/api/promotions";

const seenCall = vi.mocked(markMenuSeen);
const summary = vi.mocked(fetchMenuUnseenSummary);
const read = vi.mocked(readPromotions);

const A = "pA";
const B = "pB";
const manager = (id: string, ...properties: string[]): StaffSession => ({
  staffAccountId: id, email: `${id}@example.com`, permissions: [],
  memberships: properties.map((propertyId) => ({ propertyId, propertyName: `Hotel ${propertyId.slice(1)}`, timeZone: "Asia/Ho_Chi_Minh", role: "Manager" as const })),
});
const STAFF_A = manager("11111111-1111-1111-1111-111111111111", A, B);
const STAFF_B = manager("22222222-2222-2222-2222-222222222222", A, B);

const row = (propertyId: string, count: number, last = "0", current = "10"): PropertyUnseen => ({ propertyId, count, lastSeenWatermark: last, currentWatermark: current });
const promotions = (...rows: PropertyUnseen[]): MenuUnseenEntry => ({ count: rows.reduce((sum, item) => sum + item.count, 0), byProperty: rows });
const promo = (propertyId: string): PromotionSummary => ({
  id: `id-${propertyId}`, propertyId, slug: `promo-${propertyId}`, title: `Promo ${propertyId}`, summary: "s", status: "Draft", kind: "Percent", value: 10, currencyCode: null, allRoomTypes: true,
  roomTypeCount: 0, showOnHomepage: false, sortOrder: 0, bookingFrom: null, bookingTo: null, stayFrom: null, stayTo: null, displayFrom: null, displayTo: null, minNights: 1, publicNow: false,
  coverMediaId: null, version: 1, updatedAtUtc: "2026-11-21T00:00:00Z",
});
const items = (propertyId: string, viewWatermark?: string, empty = false) => ok({ items: empty ? [] : [promo(propertyId)], ...(viewWatermark ? { viewWatermark } : {}) });

/** What the server last said, per Property: an acknowledgement answers the WHOLE entry as of its own moment. */
let server: PropertyUnseen[];
const ackAnswer = (propertyId: string, watermark: string) => {
  server = server.map((item) => (item.propertyId === propertyId ? { ...item, count: 0, lastSeenWatermark: watermark } : item));
  return { kind: "ok", data: promotions(...server) };
};

let session: ReturnType<typeof useStaffSession> | null = null;
function Probe() {
  const value = useStaffSession();
  useEffect(() => {
    session = value;
  });
  return null;
}
function Counts() {
  const entry = useMenuUnseen().promotions;
  return <span data-testid="counts">{entry ? JSON.stringify({ total: entry.count, by: Object.fromEntries((entry.byProperty ?? []).map((item) => [item.propertyId, item.count])) }) : "none"}</span>;
}
function Cursors() {
  const entry = useMenuUnseen().promotions;
  return <span data-testid="cursors">{JSON.stringify(Object.fromEntries((entry?.byProperty ?? []).map((item) => [item.propertyId, item.lastSeenWatermark])))}</span>;
}
const cursors = () => JSON.parse(screen.getByTestId("cursors").textContent!) as Record<string, string>;
const counts = () => JSON.parse(screen.getByTestId("counts").textContent!) as { total: number; by: Record<string, number> };

const mount = () =>
  render(
    <StaffSessionProvider>
      <MenuUnseenProvider>
        <Probe />
        <Counts />
        <Cursors />
        <PromotionsScreen />
      </MenuUnseenProvider>
    </StaffSessionProvider>,
  );
const sent = () => seenCall.mock.calls.map((call) => `${call[0]}:${call[1]}:${call[3]}`);
const flush = (ms = 60) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const hint = async () => {
  const connection = vi.mocked(startNewsletterLive).mock.calls.find((call) => call[0].events?.signal === "menuActivity")!;
  act(() => connection[0].handlers.onSignal(1 as never));
  await flush(450);
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
  for (const m of [seenCall, summary, read, vi.mocked(fetchStaffSession), vi.mocked(startNewsletterLive)]) m.mockReset();
  vi.mocked(startNewsletterLive).mockImplementation((() => ({ retryNow: vi.fn(), dispose: vi.fn() })) as never);
  vi.mocked(getPromotionRoomTypes).mockResolvedValue(ok([]) as never);
  session = null;
  server = [row(A, 2), row(B, 3)];
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_A });
  summary.mockImplementation((async () => ({ kind: "ok", data: { promotions: promotions(...server) } })) as never);
  seenCall.mockImplementation((async (_menu: string, watermark: string, _signal: unknown, propertyId: string) => ackAnswer(propertyId, watermark)) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the displayed list says \"seen\" for its own Property with its own watermark", () => {
  it("acknowledges Property A once with the list's watermark; B stays unread; the selector shows each number and the aggregate is the sum", async () => {
    read.mockResolvedValue(items(A, "7") as never);
    mount();
    await screen.findByTestId("promotion-property");
    expect(await screen.findByRole("option", { name: "Hotel A (2 chưa xem)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Hotel B (3 chưa xem)" })).toBeTruthy();
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA"]));
    expect(seenCall.mock.calls[0][2]).toBeUndefined();                       // the third argument stays the AbortSignal slot
    await waitFor(() => expect(counts()).toEqual({ total: 3, by: { pA: 0, pB: 3 } }));
    expect(screen.getByRole("option", { name: "Hotel B (3 chưa xem)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Hotel A" })).toBeTruthy();
    await flush();
    expect(sent()).toEqual(["promotions:7:pA"]);
  });

  it("an empty list that was displayed is acknowledged too", async () => {
    read.mockResolvedValue(items(A, "7", true) as never);
    mount();
    await screen.findByTestId("promotion-empty");
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA"]));
  });

  it.each([["missing", undefined], ["malformed", "007"]])("data with a %s watermark renders and is never acknowledged", async (_label, value) => {
    read.mockResolvedValue(items(A, value) as never);
    mount();
    await screen.findByTestId("promotion-list");
    await flush();
    expect(sent()).toEqual([]);
  });

  it("a failed read is an error panel and says nothing; the editor, its detail and the room types never say it", async () => {
    read.mockResolvedValueOnce({ kind: "network", message: "Không kết nối được." } as never);
    mount();
    await screen.findByTestId("website-load-error");
    await flush();
    expect(sent()).toEqual([]);

    read.mockResolvedValue(items(A, "7") as never);
    vi.mocked(getPromotion).mockResolvedValue(ok({}) as never);
    await userEvent.click(screen.getByRole("button", { name: /thử lại|retry/i }));
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA"]));
    await userEvent.click(await screen.findByRole("button", { name: /Tạo ưu đãi/ }));
    await screen.findByRole("form", { name: "Tạo ưu đãi" });
    await flush();
    expect(sent()).toEqual(["promotions:7:pA"]);                             // opening the editor changed nothing
  });
});

describe("Property switches, queues and late answers", () => {
  it("A → B: a read of A that answers after B is on screen (its AbortSignal ignored) is never acknowledged; B says its own watermark", async () => {
    const lateA = deferred<unknown>();
    read.mockImplementation(((propertyId: string) => (propertyId === A ? lateA.promise : Promise.resolve(items(B, "9")))) as never);
    mount();
    await userEvent.selectOptions(await screen.findByTestId("promotion-property"), B);
    await waitFor(() => expect(sent()).toEqual(["promotions:9:pB"]));
    await act(async () => { lateA.resolve(items(A, "5")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual(["promotions:9:pB"]);
    expect(counts().by).toEqual({ pA: 2, pB: 0 });
  });

  it("a pending acknowledgement of A neither blocks nor drops B's, and A's late answer does not overwrite B's newer number", async () => {
    const gate = deferred<void>();
    read.mockImplementation(((propertyId: string) => Promise.resolve(items(propertyId, propertyId === A ? "7" : "9"))) as never);
    seenCall.mockImplementation((async (_menu: string, watermark: string, _signal: unknown, propertyId: string) => {
      if (propertyId === A) {
        await gate.promise;
        // A's answer was computed BEFORE B was acknowledged: it still shows B unread.
        return { kind: "ok", data: promotions(row(A, 0, watermark, "10"), row(B, 3)) };
      }
      return ackAnswer(propertyId, watermark);
    }) as never);
    mount();
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA"]));
    await userEvent.selectOptions(await screen.findByTestId("promotion-property"), B);
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA", "promotions:9:pB"]));   // B went out while A was still pending
    await waitFor(() => expect(counts().by).toEqual({ pA: 2, pB: 0 }));
    await act(async () => { gate.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(counts()).toEqual({ total: 0, by: { pA: 0, pB: 0 } }));    // only A's row was merged; B stays acknowledged
    expect(sent()).toEqual(["promotions:7:pA", "promotions:9:pB"]);
  });

  it("A newer watermark queued behind a pending call of the same Property goes out afterwards, once", async () => {
    const gate = deferred<void>();
    let first = true;
    read.mockResolvedValueOnce(items(A, "7") as never).mockResolvedValue(items(A, "8") as never);
    seenCall.mockImplementation((async (_menu: string, watermark: string, _signal: unknown, propertyId: string) => {
      if (first) {
        first = false;
        await gate.promise;
      }
      return ackAnswer(propertyId, watermark);
    }) as never);
    mount();
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA"]));
    await userEvent.click(await screen.findByRole("button", { name: /Tạo ưu đãi/ }));
    await screen.findByRole("form", { name: "Tạo ưu đãi" });
    await userEvent.click(screen.getByRole("button", { name: /quay lại|Quay lại|Danh sách/ }));
    await screen.findByTestId("promotion-list");
    await flush();
    expect(sent()).toEqual(["promotions:7:pA"]);                              // still one on the wire for A
    await act(async () => { gate.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA", "promotions:8:pA"]));
  });

  it("losing A's permission keeps A's late read from being sent, never brings A back, and restoring it sends the waiting watermark", async () => {
    const lateA = deferred<unknown>();
    read.mockReturnValueOnce(lateA.promise as never);
    mount();
    await screen.findByTestId("promotion-property");
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    server = [row(B, 3)];                                                     // the latest summary no longer lists A
    await hint();
    await waitFor(() => expect(counts()).toEqual({ total: 3, by: { pB: 3 } }));
    await act(async () => { lateA.resolve(items(A, "9")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual([]);                                               // nothing for a Property the summary does not list
    expect(counts().by).toEqual({ pB: 3 });                                   // and nothing resurrected it

    server = [row(A, 2), row(B, 3)];                                          // restored
    await hint();
    await waitFor(() => expect(sent()).toEqual(["promotions:9:pA"]));
    await waitFor(() => expect(counts().by).toEqual({ pA: 0, pB: 3 }));
  });

  it("a read of an older filter that answers after the filter changed (its AbortSignal ignored) is never acknowledged; the new read says its own watermark", async () => {
    const old = deferred<unknown>();
    read.mockReturnValueOnce(old.promise as never).mockResolvedValue(items(A, "9") as never);
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await userEvent.type(await screen.findByTestId("promotion-filter-q"), "sớm");
    await waitFor(() => expect(sent()).toEqual(["promotions:9:pA"]), { timeout: 3000 });
    await act(async () => { old.resolve(items(A, "5")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual(["promotions:9:pA"]);
  });

  it("a read that answers after the screen unmounted is never acknowledged", async () => {
    const late = deferred<unknown>();
    read.mockReturnValueOnce(late.promise as never);
    const view = mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { late.resolve(items(A, "5")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual([]);
  });

  // BHA-ADMIN-BADGE-001-PR10-C1 (1): the latest summary's membership is authoritative even when one row of it is a stale cursor.
  it("a summary with a stale cursor for A that omits the revoked B keeps A's newer cursor, drops B, totals only A, and a late acknowledgement of B cannot bring B back", async () => {
    const gateB = deferred<void>();
    read.mockImplementation(((propertyId: string) => Promise.resolve(items(propertyId, propertyId === A ? "7" : "9"))) as never);
    seenCall.mockImplementation((async (_menu: string, watermark: string, _signal: unknown, propertyId: string) => {
      if (propertyId === B) await gateB.promise;
      return ackAnswer(propertyId, watermark);
    }) as never);
    mount();
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA"]));
    await waitFor(() => expect(cursors().pA).toBe("7"));
    await userEvent.selectOptions(await screen.findByTestId("promotion-property"), B);
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA", "promotions:9:pB"]));   // B's acknowledgement is on the wire

    summary.mockResolvedValue({ kind: "ok", data: { promotions: promotions(row(A, 2, "0", "10")) } } as never);   // issued before A's acknowledgement: A's cursor is stale; B was revoked
    await hint();
    await waitFor(() => expect(counts()).toEqual({ total: 0, by: { pA: 0 } }));            // B is gone and the total is A's own (A keeps its newer number)
    expect(cursors()).toEqual({ pA: "7" });                                                  // A keeps its newer cursor

    await act(async () => { gateB.resolve(); await Promise.resolve(); });
    await flush();
    expect(counts()).toEqual({ total: 0, by: { pA: 0 } });                                   // the late acknowledgement of B restored nothing
    expect(cursors()).toEqual({ pA: "7" });
  });

  // (2): a list that answered before the first summary keeps its watermark; nothing is sent until the summary confirms the Property.
  it("a list read that completes before the first summary keeps its watermark, sends nothing until the summary lists the Property, then sends exactly that watermark without a reload", async () => {
    const first = deferred<unknown>();
    summary.mockReset();
    summary.mockReturnValueOnce(first.promise as never).mockImplementation((async () => ({ kind: "ok", data: { promotions: promotions(...server) } })) as never);
    read.mockResolvedValue(items(A, "7") as never);
    mount();
    await screen.findByTestId("promotion-list");
    await flush(200);
    expect(sent()).toEqual([]);                                               // the summary has not confirmed the Property yet

    await act(async () => { first.resolve({ kind: "ok", data: { promotions: promotions(row(A, 2, "0", "10"), row(B, 3)) } }); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["promotions:7:pA"]));
    await waitFor(() => expect(counts()).toEqual({ total: 3, by: { pA: 0, pB: 3 } }));   // the number follows the acknowledgement
    expect(read).toHaveBeenCalledTimes(1);                                    // the screen was not reloaded
    await flush();
    expect(sent()).toEqual(["promotions:7:pA"]);
  });

  it("a Property the first summary does not list is never acknowledged, and a watermark waiting for Staff A is not sent for Staff B", async () => {
    const first = deferred<unknown>();
    summary.mockReset();
    summary.mockReturnValueOnce(first.promise as never).mockImplementation((async () => ({ kind: "ok", data: { promotions: promotions(...server) } })) as never);
    read.mockResolvedValueOnce(items(A, "7") as never);
    mount();
    await screen.findByTestId("promotion-list");
    await flush(200);
    expect(sent()).toEqual([]);

    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    read.mockResolvedValue(items(A, "9") as never);
    await act(async () => { await session!.refresh(); });
    await waitFor(() => expect(sent()).toEqual(["promotions:9:pA"]));        // Staff B says its own watermark …
    await act(async () => { first.resolve({ kind: "ok", data: { promotions: promotions(row(A, 2), row(B, 3)) } }); await Promise.resolve(); });
    await flush(200);
    expect(sent()).toEqual(["promotions:9:pA"]);                              // … and Staff A's old-life 7 is gone for good
  });

  it("a read started by Staff A that answers after Staff B took over is not used to acknowledge for B", async () => {
    const late = deferred<unknown>();
    read.mockReturnValueOnce(late.promise as never);
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    read.mockResolvedValue(items(A, "9") as never);
    await act(async () => { await session!.refresh(); });
    await waitFor(() => expect(sent()).toEqual(["promotions:9:pA"]));
    expect(seenCall).toHaveBeenCalledTimes(1);

    await act(async () => { late.resolve(items(A, "5")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual(["promotions:9:pA"]);
  });
});
