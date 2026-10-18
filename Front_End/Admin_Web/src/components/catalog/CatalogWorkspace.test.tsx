import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED, WITHOUT_PERMISSION, deferred, ok } from "@/components/website/websiteTestUtils";
import type { WebsiteResult } from "@/lib/api/website";
import type { CatalogEditor } from "@/lib/api/catalog";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api/staff", async original => ({ ...await original<typeof import("@/lib/api/staff")>(), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/catalog", async original => ({ ...await original<typeof import("@/lib/api/catalog")>(), getCatalogProperties: vi.fn(), getCatalogProducts: vi.fn(), getCatalog: vi.fn(), saveCatalog: vi.fn(), createAmenity: vi.fn(), uploadCatalog: vi.fn(), catalogImage: () => "/picture.webp" }));
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import CatalogWorkspace from "./CatalogWorkspace";
import { fetchStaffSession, staffLogout } from "@/lib/api/staff";
import { createAmenity, getCatalog, getCatalogProducts, getCatalogProperties, saveCatalog, uploadCatalog, type CatalogProductSummary } from "@/lib/api/catalog";

const rooms = ["r1", "r2", "r3"].map(id => ({ id, code: id, name: `Room ${id}` }));
function editor(propertyId = "p1", roomTypeId: string | null = null): CatalogEditor {
  return { propertyId, roomTypeId, version: 1, sourceLocale: "vi", name: roomTypeId ? `Room ${roomTypeId}` : `Property ${propertyId}`, description: "Original description", slug: propertyId, code: roomTypeId,
    address: "Address", city: "City", country: "Country", areaSquareMeters: null, bedrooms: null, bedDescription: null,
    baseOccupancy: 2, maxOccupancy: 4, physicalRoomCount: 3, isActive: true, timeZone: "Asia/Ho_Chi_Minh", checkInTime: "14:00", checkOutTime: "12:00", updatedAt: "2026-10-18T00:00:00Z", updatedByStaffId: null,
    roomTypes: propertyId === "p1" ? rooms : [], gallery: [{ mediaId: "m1", url: "/picture.webp", altText: "Original alt", isCover: true }], amenityIds: [], amenities: [{ id: "a1", code: "wifi", name: "Wifi", category: "Room" }], translationOverrideKeys: [] };
}
let server: Map<string, CatalogEditor>;
const key = (p: string, r: string | null) => `${p}:${r ?? "property"}`;
const name = () => screen.getByRole("textbox", { name: /^Tên\s*\*/ });
const save = () => screen.getByRole("button", { name: "Lưu thay đổi" });
async function open() {
  render(<WebsiteAccessGate returnTo="/products"><CatalogWorkspace /></WebsiteAccessGate>);
  await screen.findByRole("heading", { name: "Cơ sở & loại phòng" });
  await userEvent.click(await screen.findByRole("button", { name: "Chỉnh sửa thông tin cơ sở" }));
  await screen.findByRole("textbox", { name: /^Tên\s*\*/ });
}
const summary = (room: { id: string; code: string; name: string }): CatalogProductSummary => ({ propertyId: "p1", roomTypeId: room.id, code: room.code, name: room.name, description: "Room description", baseOccupancy: 2, maxOccupancy: 4, physicalRoomCount: 1, galleryCount: 1, coverMediaId: "m1", coverAltText: null, isActive: true });
async function changeName(value: string) { await userEvent.clear(name()); await userEvent.type(name(), value); }
async function switchOwner(control: "Cơ sở" | "Loại phòng", value: string, decision = "Bỏ sửa và chuyển") {
  await userEvent.selectOptions(screen.getByRole("combobox", { name: control }), value);
  const dialog = screen.queryByRole("dialog");
  if (dialog) await userEvent.click(within(dialog).getByRole("button", { name: decision.startsWith("Bỏ sửa") ? /^Bỏ sửa/ : decision }));
  if (!screen.queryByRole("textbox", { name: /^Tên\s*\*/ }) && screen.queryByRole("button", { name: "Chỉnh sửa thông tin cơ sở" }))
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa thông tin cơ sở" }));
}
async function add() {
  await userEvent.type(screen.getByRole("textbox", { name: "Mã tiện nghi" }), "desk");
  await userEvent.type(screen.getByRole("textbox", { name: "Tên tiện nghi" }), "Desk");
  await userEvent.type(screen.getByRole("textbox", { name: "Nhóm" }), "Room");
  await userEvent.click(screen.getByRole("button", { name: "Thêm tiện nghi" }));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  server = new Map([editor(), editor("p2"), ...rooms.map(r => editor("p1", r.id))].map(x => [key(x.propertyId, x.roomTypeId), x]));
  vi.mocked(getCatalogProperties).mockResolvedValue(ok([{ id: "p1", name: "The BHA Riverside", slug: "the-bha-riverside" }, { id: "p2", name: "Other", slug: "other" }]));
  vi.mocked(getCatalogProducts).mockImplementation(async p => ok(p === "p1" ? rooms.map(summary) : []));
  vi.mocked(getCatalog).mockImplementation(async (p, r) => ok(structuredClone(server.get(key(p, r))!)));
  vi.mocked(saveCatalog).mockImplementation(async (p, r, body) => {
    const current = server.get(key(p, r))!;
    if (current.version !== body.expectedVersion) return { kind: "refused", status: 409, code: "stale-version", field: null, detail: "Conflict" };
    const next = { ...current, ...body, version: current.version + 1 };
    server.set(key(p, r), next);
    return ok(next);
  });
  vi.mocked(createAmenity).mockImplementation(async p => {
    const amenity = { id: "a2", code: "desk", name: "Desk", category: "Room" };
    server.get(key(p, null))!.amenities.push(amenity);
    return ok(amenity);
  });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("CatalogWorkspace correction regressions, real gate and hooks", () => {
  it("F1 keeps the draft revision after adding an amenity refresh; tab B content survives a stale Save", async () => {
    await open(); await changeName("Tab A name");
    server.set(key("p1", null), { ...server.get(key("p1", null))!, version: 2, description: "Tab B description" });
    await add(); await waitFor(() => expect(screen.getByRole("checkbox", { name: /Desk/ })).toBeChecked());
    await userEvent.click(save());
    await waitFor(() => expect(saveCatalog).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveCatalog).mock.calls[0][2].expectedVersion).toBe(1);
    expect(server.get(key("p1", null))!.description).toBe("Tab B description");
    expect(name()).toHaveValue("Tab A name");
    expect(screen.getByText(/Conflict/)).toBeInTheDocument();
  });
  it("starts with the product list, opens the selected product, and returns to the same property list", async () => {
    render(<WebsiteAccessGate returnTo="/products"><CatalogWorkspace /></WebsiteAccessGate>);
    expect(await screen.findByRole("heading", { name: "Cơ sở & loại phòng" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Tên\s*\*/ })).toBeNull();
    await screen.findAllByRole("button", { name: "Xem / Chỉnh sửa" });
    await userEvent.click(screen.getAllByRole("button", { name: "Xem / Chỉnh sửa" })[1]);
    await waitFor(() => expect(name()).toHaveValue("Room r2"));
    await userEvent.click(screen.getByRole("button", { name: "← Quay lại danh sách" }));
    expect(await screen.findByRole("heading", { name: "Cơ sở & loại phòng" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Cơ sở" })).toHaveValue("p1");
    expect(screen.queryByRole("textbox", { name: /^Tên\s*\*/ })).toBeNull();
  });
  it("resolves the legacy Hotel row as Riverside without adding a duplicate placeholder", async () => {
    vi.mocked(getCatalogProperties).mockResolvedValue(ok([{ id: "p1", name: "The BHA Hotel", slug: "the-bha-hotel" }, { id: "p2", name: "Other", slug: "other" }]));
    render(<WebsiteAccessGate returnTo="/products"><CatalogWorkspace /></WebsiteAccessGate>);
    const selector = await screen.findByRole("combobox", { name: "Cơ sở" });
    expect(selector).toHaveValue("p1");
    const riversideOptions = within(selector).getAllByRole("option").filter(option => option.textContent === "The BHA Riverside");
    expect(riversideOptions).toHaveLength(1);
    expect(screen.queryByText("The BHA Riverside — chưa thiết lập")).toBeNull();
    expect(screen.getByRole("heading", { name: "The BHA Riverside" })).toBeInTheDocument();
  });
  it("keeps workspace controls themed in both Tailwind modes", async () => {
    render(<WebsiteAccessGate returnTo="/products"><CatalogWorkspace /></WebsiteAccessGate>);
    await screen.findByRole("heading", { name: "Cơ sở & loại phòng" });
    const selector = screen.getByRole("combobox", { name: "Cơ sở" });
    expect(selector.className).toContain("dark:bg-gray-900");
    expect(selector.className).toContain("text-gray-900");
    const card = (await screen.findAllByRole("article"))[0];
    expect(card.className).toContain("dark:bg-white/[0.03]");
  });
  it.each(["save", "upload"] as const)("F3 reconciles unknown %s by owner readback without retrying the old mutation", async operation => {
    await open(); await changeName("Draft");
    if (operation === "save") { vi.mocked(saveCatalog).mockResolvedValue({ kind: "unverified", message: "Unknown save" }); await userEvent.click(save()); }
    else { vi.mocked(uploadCatalog).mockResolvedValue({ kind: "unverified", message: "Unknown upload" }); await userEvent.upload(screen.getByLabelText("Tải ảnh lên"), new File(["image"], "a.webp", { type: "image/webp" })); }
    await userEvent.click(await screen.findByRole("button", { name: "Đọc lại trước khi tiếp tục" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Đọc lại trước khi tiếp tục" })).toBeNull());
    if (operation === "upload") expect(screen.getByText(/chưa xác định.*upload|upload.*chưa xác định|ảnh tải.*chưa xác định/i)).toBeInTheDocument();
    await changeName("Next deliberate edit"); vi.mocked(saveCatalog).mockResolvedValue(ok({ ...editor(), name: "Next deliberate edit", version: 2 }));
    await userEvent.click(save());
    await waitFor(() => expect(saveCatalog).toHaveBeenCalledTimes(operation === "save" ? 2 : 1));
    expect(uploadCatalog).toHaveBeenCalledTimes(operation === "upload" ? 1 : 0);
  });
  it("F4 discard removes the old product draft and temporary fields permanently", async () => {
    await open(); await userEvent.click(screen.getByRole("button", { name: "← Quay lại danh sách" }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Xem / Chỉnh sửa" }))[0]);
    await waitFor(() => expect(name()).toHaveValue("Room r1"));
    await changeName("Discard me"); await userEvent.type(screen.getByRole("textbox", { name: "Mã tiện nghi" }), "temporary");
    await userEvent.click(screen.getByRole("button", { name: "← Quay lại danh sách" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^Bỏ sửa/ }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Xem / Chỉnh sửa" }))[0]);
    await waitFor(() => expect(name()).toHaveValue("Room r1"));
    expect(screen.getByRole("textbox", { name: "Mã tiện nghi" })).toHaveValue("");
  });
  it("F5 locks every edit, switch, discard and sign-out through deferred Save AND readback", async () => {
    await open(); await changeName("Sent snapshot");
    const posting = deferred<WebsiteResult<CatalogEditor>>(); const reading = deferred<WebsiteResult<CatalogEditor>>();
    vi.mocked(saveCatalog).mockReturnValue(posting.promise);
    await userEvent.click(save());
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Cơ sở" })).toBeDisabled();
    expect(screen.getByRole("radio")).toBeDisabled(); expect(screen.getByRole("checkbox", { name: /Wifi/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Đăng xuất" })).toBeDisabled();
    fireEvent.change(name(), { target: { value: "Edit during Save" } });
    expect(name()).toHaveValue("Sent snapshot");
    vi.mocked(getCatalog).mockReturnValueOnce(reading.promise);
    await act(async () => posting.resolve(ok({ ...editor(), name: "Sent snapshot", version: 2 })));
    expect(name()).toBeDisabled(); expect(screen.getByRole("button", { name: "Đăng xuất" })).toBeDisabled();
    fireEvent.change(name(), { target: { value: "Edit during readback" } }); expect(name()).toHaveValue("Sent snapshot");
    await act(async () => reading.resolve(ok({ ...editor(), name: "Sent snapshot", version: 2 })));
    await waitFor(() => expect(name()).toBeEnabled()); expect(name()).toHaveValue("Sent snapshot");
    expect(saveCatalog).toHaveBeenCalledTimes(1);
  });
  it.each(["failed", "wrong-owner"] as const)("F3 leaves unknown blocked after a %s read; only an owner-matching read releases it", async failure => {
    await open(); await changeName("Keep draft");
    vi.mocked(saveCatalog).mockResolvedValue({ kind: "unverified", message: "Unknown save" });
    await userEvent.click(save());
    vi.mocked(getCatalog).mockResolvedValueOnce(failure === "failed" ? { kind: "network", message: "Read failed" } : ok(editor("p2")));
    await userEvent.click(await screen.findByRole("button", { name: "Đọc lại trước khi tiếp tục" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Đọc lại trước khi tiếp tục" })).toBeEnabled());
    expect(screen.getByRole("combobox", { name: "Cơ sở" })).toBeDisabled();
    expect(saveCatalog).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Đọc lại trước khi tiếp tục" }));
    await waitFor(() => expect(name()).toHaveValue("Property p1"));
    expect(screen.queryByRole("button", { name: "Đọc lại trước khi tiếp tục" })).toBeNull();
    expect(saveCatalog).toHaveBeenCalledTimes(1);
  });
  it("F4 Continue keeps the draft; Save then switch persists it before changing owners", async () => {
    await open(); await changeName("Keep and save");
    await switchOwner("Cơ sở", "p2", "Tiếp tục sửa");
    expect(name()).toHaveValue("Keep and save");
    await switchOwner("Cơ sở", "p2", "Lưu rồi chuyển");
    await waitFor(() => expect(name()).toHaveValue("Property p2"));
    expect(server.get(key("p1", null))!.name).toBe("Keep and save");
    await switchOwner("Cơ sở", "p1");
    await waitFor(() => expect(name()).toHaveValue("Keep and save"));
    expect(save()).toBeDisabled();
  });
  it("refuses new writes during sign-out and drops a delayed readback after permission loss unmounts the editor", async () => {
    await open(); await changeName("Draft");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const logout = deferred<{ kind: "unconfirmed"; message: string }>();
    vi.mocked(staffLogout).mockReturnValue(logout.promise);
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    fireEvent.click(screen.getByRole("button", { name: "Đang lưu…" })); expect(saveCatalog).not.toHaveBeenCalled();
    await act(async () => logout.resolve({ kind: "unconfirmed", message: "Sign-out not confirmed" }));
    const read = deferred<WebsiteResult<CatalogEditor>>();
    vi.mocked(getCatalog).mockReturnValueOnce(read.promise);
    vi.mocked(saveCatalog).mockResolvedValueOnce(ok({ ...editor(), name: "Draft", version: 2 }));
    await userEvent.click(save());
    expect(name()).toBeDisabled();
    // A session change tears down the real gate while the former request is in flight.
    cleanup();
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: WITHOUT_PERMISSION });
    render(<WebsiteAccessGate returnTo="/products"><CatalogWorkspace /></WebsiteAccessGate>);
    await screen.findByTestId("website-no-permission");
    await act(async () => read.resolve(ok({ ...editor(), name: "Late response", version: 2 })));
    expect(screen.queryByTestId("catalog-workspace")).toBeNull();
    expect(saveCatalog).toHaveBeenCalledTimes(1);
  });
});
