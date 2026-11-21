/**
 * BHA-ADMIN-BADGE-001-PR11 (ADR 0011 §B, §D): the Catalog list view says "seen" — through the real session, provider and gate — for the one global `catalog` stream, with the LOWER watermark of the two
 * list reads that fill the screen, and for nothing else. The API client and the connections are replaced; every answer is scripted or deferred by the test (and ignores the AbortSignal, as a late
 * answer from a real transport may). What is asserted is what went to `POST menu-unseen/catalog/seen`: `markMenuSeen("catalog", watermark)` and no Property.
 */
import React, { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED, deferred, ok } from "@/components/website/websiteTestUtils";
import type { CatalogEditor, CatalogProductSummary, PropertyChoice } from "@/lib/api/catalog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (original) => ({ ...(await original<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/website/newsletterLive", () => ({ startNewsletterLive: vi.fn(() => ({ retryNow: vi.fn(), dispose: vi.fn() })) }));
vi.mock("@/lib/api/catalog", async (original) => ({
  ...(await original<typeof import("@/lib/api/catalog")>()),
  readCatalogProperties: vi.fn(), readCatalogProducts: vi.fn(), getCatalogProperties: vi.fn(), getCatalogProducts: vi.fn(), getPhysicalRooms: vi.fn(), getCatalog: vi.fn(),
  createProperty: vi.fn(), createRoomType: vi.fn(), createPhysicalRoom: vi.fn(),
}));
vi.mock("@/lib/api/menuUnseen", async (original) => ({
  ...(await original<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(), markMenuSeen: vi.fn(), markNewsletterSeen: vi.fn(),
}));

import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import CatalogWorkspace from "./CatalogWorkspace";
import { MenuUnseenProvider, useMenuUnseen } from "@/components/website/NewsletterBadgeProvider";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import { fetchStaffSession } from "@/lib/api/staff";
import { fetchMenuUnseenSummary, markMenuSeen, type MenuUnseenEntry } from "@/lib/api/menuUnseen";
import { createProperty, createRoomType, getCatalog, getCatalogProducts, getCatalogProperties, getPhysicalRooms, readCatalogProducts, readCatalogProperties } from "@/lib/api/catalog";

const seenCall = vi.mocked(markMenuSeen);
const summary = vi.mocked(fetchMenuUnseenSummary);
const readProps = vi.mocked(readCatalogProperties);
const readProducts = vi.mocked(readCatalogProducts);

const STAFF_A = ALLOWED;
const STAFF_B = { ...ALLOWED, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };
const P1: PropertyChoice = { id: "p1", name: "The BHA Riverside", slug: "the-bha-riverside" };
const P2: PropertyChoice = { id: "p2", name: "Other", slug: "other" };
const entry = (count: number, last: string, current: string): MenuUnseenEntry => ({ count, lastSeenWatermark: last, currentWatermark: current });
const product = (propertyId: string, id = "r1"): CatalogProductSummary => ({
  propertyId, roomTypeId: id, code: id, name: `Room ${id}`, description: null, baseOccupancy: 2, maxOccupancy: 4, physicalRoomCount: 1, galleryCount: 0, coverMediaId: null, coverAltText: null, isActive: true,
});
const props = (list: PropertyChoice[], viewWatermark?: string) => ok({ items: list, ...(viewWatermark ? { viewWatermark } : {}) });
const products = (list: CatalogProductSummary[], viewWatermark?: string) => ok({ items: list, ...(viewWatermark ? { viewWatermark } : {}) });

let session: ReturnType<typeof useStaffSession> | null = null;
function Probe() {
  const value = useStaffSession();
  useEffect(() => {
    session = value;
  });
  return null;
}
function Count() {
  return <span data-testid="count">{useMenuUnseen().catalog?.count ?? "-"}</span>;
}
const mount = () =>
  render(
    <StaffSessionProvider>
      <MenuUnseenProvider>
        <Probe />
        <Count />
        <WebsiteAccessGate returnTo="/products"><CatalogWorkspace /></WebsiteAccessGate>
      </MenuUnseenProvider>
    </StaffSessionProvider>,
  );
const sent = () => seenCall.mock.calls.map((call) => `${call[0]}:${call[1]}`);
const flush = (ms = 80) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
  sessionStorage.clear();
  for (const m of [seenCall, summary, readProps, readProducts, vi.mocked(getCatalogProperties), vi.mocked(getCatalogProducts), vi.mocked(getPhysicalRooms), vi.mocked(getCatalog),
    vi.mocked(createProperty), vi.mocked(createRoomType), vi.mocked(fetchStaffSession)]) m.mockReset();
  session = null;
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_A });
  summary.mockResolvedValue({ kind: "ok", data: { catalog: entry(3, "0", "12") } } as never);
  seenCall.mockImplementation((async (_menu: string, watermark: string) => ({ kind: "ok", data: entry(0, watermark, "12") })) as never);
  vi.mocked(getPhysicalRooms).mockResolvedValue(ok([]) as never);
  readProps.mockResolvedValue(props([P1, P2], "7") as never);
  readProducts.mockImplementation((async (propertyId: string) => products(propertyId === "p1" ? [product("p1")] : [], "7")) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the list view says \"seen\" once, with the lower of its two watermarks, through the global queue", () => {
  it.each([["properties lower", "9", "12", "9"], ["products lower", "12", "9", "9"], ["compared as integers, not text", "10", "9", "9"]])("%s", async (_name, propsMark, productsMark, expected) => {
    readProps.mockResolvedValue(props([P1, P2], propsMark) as never);
    readProducts.mockResolvedValue(products([product("p1")], productsMark) as never);
    mount();
    await waitFor(() => expect(sent()).toEqual([`catalog:${expected}`]));
    expect(seenCall.mock.calls[0]).toEqual(["catalog", expected]);                  // global: just the watermark, no Property, no signal
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));   // the number follows the server's answer
    await flush();
    expect(sent()).toEqual([`catalog:${expected}`]);
    expect(readProps).toHaveBeenCalledTimes(1);                                      // no extra GET to obtain a mark
    expect(readProducts).toHaveBeenCalledTimes(1);
  });

  it("a valid empty products list is acknowledged", async () => {
    readProducts.mockResolvedValue(products([], "7") as never);
    mount();
    await screen.findByText("Cơ sở này chưa có loại phòng để hiển thị.");
    await waitFor(() => expect(sent()).toEqual(["catalog:7"]));
  });

  it("nothing is said while either list is pending, and it is said once both have answered", async () => {
    const slowProps = deferred<unknown>();
    readProps.mockReturnValueOnce(slowProps.promise as never);
    mount();
    await waitFor(() => expect(readProducts).toHaveBeenCalledTimes(0));              // products wait for the Property, which comes from the properties list
    await flush(150);
    expect(sent()).toEqual([]);
    await act(async () => { slowProps.resolve(props([P1, P2], "7")); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["catalog:7"]));
  });

  it("a pending products list keeps the acknowledgement back", async () => {
    const slowProducts = deferred<unknown>();
    readProducts.mockReturnValueOnce(slowProducts.promise as never);
    mount();
    await screen.findByRole("heading", { name: "The BHA Riverside" });
    await flush(150);
    expect(sent()).toEqual([]);
    await act(async () => { slowProducts.resolve(products([product("p1")], "7")); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["catalog:7"]));
  });

  it.each([
    ["properties header missing", () => { readProps.mockResolvedValue(props([P1, P2]) as never); }],
    ["products header missing", () => { readProducts.mockResolvedValue(products([product("p1")]) as never); }],
    ["a failed properties read", () => { readProps.mockResolvedValue({ kind: "network", message: "Không kết nối được." } as never); }],
    ["a failed products read", () => { readProducts.mockResolvedValue({ kind: "network", message: "Không kết nối được." } as never); }],
  ])("%s: nothing is acknowledged", async (_name, script) => {
    script();
    mount();
    await flush(250);
    expect(sent()).toEqual([]);
  });

  it("data with a missing watermark still renders", async () => {
    readProducts.mockResolvedValue(products([product("p1")]) as never);
    mount();
    expect(await screen.findByText("1 loại phòng")).toBeTruthy();
    await flush();
    expect(sent()).toEqual([]);
  });

  it("the unconfigured Riverside placeholder never acknowledges (no persisted Property is selected)", async () => {
    readProps.mockResolvedValue(props([P2], "7") as never);
    mount();
    await flush(250);
    expect(readProducts).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
  });
});

describe("a read for another Property, view, Staff member or a gone screen is never used", () => {
  it("a products read of Property 1 that answers after Property 2 is on screen (its AbortSignal ignored) is not acknowledged; Property 2 says its own", async () => {
    const lateP1 = deferred<unknown>();
    readProducts.mockImplementation(((propertyId: string) => (propertyId === "p1" ? lateP1.promise : Promise.resolve(products([product("p2")], "9")))) as never);
    mount();
    await screen.findByRole("heading", { name: "The BHA Riverside" });
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Cơ sở" }), "p2");
    await waitFor(() => expect(sent()).toEqual(["catalog:7"]));                       // properties list 7, Property 2 products 9: the lower
    await act(async () => { lateP1.resolve(products([product("p1")], "3")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual(["catalog:7"]);                                            // the late "3" of Property 1 changed nothing
  });

  it("a read started by Staff A that answers after Staff B took over is not used to acknowledge for B", async () => {
    const late = deferred<unknown>();
    readProducts.mockReturnValueOnce(late.promise as never);
    mount();
    await waitFor(() => expect(readProducts).toHaveBeenCalledTimes(1));
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    readProps.mockResolvedValue(props([P1, P2], "9") as never);
    readProducts.mockResolvedValue(products([product("p1")], "9") as never);
    await act(async () => { await session!.refresh(); });
    await waitFor(() => expect(sent()).toEqual(["catalog:9"]));
    await act(async () => { late.resolve(products([product("p1")], "2")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual(["catalog:9"]);
  });

  it("a read that answers after the screen unmounted is never acknowledged", async () => {
    const late = deferred<unknown>();
    readProducts.mockReturnValueOnce(late.promise as never);
    const view = mount();
    await waitFor(() => expect(readProducts).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { late.resolve(products([product("p1")], "5")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual([]);
  });
});

describe("only the list view acknowledges: the editor, the physical rooms and the read-back of a write never do", () => {
  it("opening the editor or a room type, reading its physical rooms, creating a room type and coming back say nothing more", async () => {
    mount();
    await waitFor(() => expect(sent()).toEqual(["catalog:7"]));
    vi.mocked(getCatalog).mockResolvedValue(ok({ propertyId: "p1" } as unknown as CatalogEditor) as never);
    await userEvent.click((await screen.findAllByRole("button", { name: "Xem / Chỉnh sửa" }))[0]);
    await screen.findByRole("heading", { name: "Phòng thuộc loại này" });
    readProducts.mockResolvedValue(products([product("p1"), product("p1", "r2")], "20") as never);
    vi.mocked(createRoomType).mockResolvedValue(ok(product("p1", "r2")) as never);
    vi.mocked(getCatalogProducts).mockResolvedValue(ok([product("p1"), product("p1", "r2")]) as never);
    await userEvent.click(screen.getByRole("button", { name: "Thêm loại phòng" }));
    await userEvent.type(screen.getByLabelText("Mã loại phòng *"), "R2");
    await userEvent.type(screen.getByLabelText("Tên *"), "Room r2");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await screen.findByText("2 loại phòng");
    await flush(200);
    expect(sent()).toEqual(["catalog:7"]);
    expect(seenCall).toHaveBeenCalledTimes(1);
  });

  it("a property created from the section is read back with a list read that is NOT a mark: the new Property's list does not acknowledge the verification's watermark", async () => {
    const fresh: PropertyChoice = { id: "p3", name: "The BHA House", slug: "the-bha-house" };
    mount();
    await waitFor(() => expect(sent()).toEqual(["catalog:7"]));
    vi.mocked(createProperty).mockResolvedValue(ok(fresh) as never);
    vi.mocked(getCatalogProperties).mockResolvedValue(ok([P1, P2, fresh]) as never);
    readProps.mockResolvedValue(props([P1, P2, fresh], "15") as never);                                   // the verification's own list read
    readProducts.mockImplementation((async (propertyId: string) => products(propertyId === "p3" ? [] : [product("p1")], "20")) as never);
    await userEvent.click(await screen.findByRole("button", { name: "Thêm cơ sở" }));
    await userEvent.type(screen.getByLabelText("Tên cơ sở *"), fresh.name);
    await userEvent.type(screen.getByLabelText("Địa chỉ *"), "Test address");
    await userEvent.type(screen.getByLabelText("Thành phố *"), "Test city");
    await userEvent.type(screen.getByLabelText("Quốc gia *"), "Test country");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Cơ sở" })).toHaveValue("p3"));
    await screen.findByText("Cơ sở này chưa có loại phòng để hiển thị.");
    await flush(250);
    expect(sent()).toEqual(["catalog:7"]);                                                              // 15 and 20 were both displayed, neither came from a normal list view read
  });
});
