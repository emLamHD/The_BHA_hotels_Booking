import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, ok } from "@/components/website/websiteTestUtils";
import type { StaffSession } from "@/lib/api/staff";
import type { PromotionBody, PromotionEditor, PromotionSummary } from "@/lib/api/promotions";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api/staff", async (original) => ({ ...(await original<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/promotions", async (original) => ({
  ...(await original<typeof import("@/lib/api/promotions")>()),
  listPromotions: vi.fn(), getPromotion: vi.fn(), getPromotionRoomTypes: vi.fn(), createPromotion: vi.fn(), savePromotion: vi.fn(), setPromotionStatus: vi.fn(), uploadPromotionCover: vi.fn(),
}));
import PromotionsScreen from "./PromotionsScreen";
import { fetchStaffSession } from "@/lib/api/staff";
import { createPromotion, getPromotion, getPromotionRoomTypes, listPromotions, savePromotion, setPromotionStatus, uploadPromotionCover } from "@/lib/api/promotions";

const MANAGER: StaffSession = {
  staffAccountId: "11111111-1111-1111-1111-111111111111", email: "manager@example.com", permissions: [],
  memberships: [{ propertyId: "p1", propertyName: "The BHA Riverside", timeZone: "Asia/Ho_Chi_Minh", role: "Manager" }, { propertyId: "p2", propertyName: "Frontdesk Only", timeZone: "Asia/Ho_Chi_Minh", role: "FrontDesk" }],
};
const FRONT_DESK: StaffSession = { ...MANAGER, memberships: [{ propertyId: "p1", propertyName: "The BHA Riverside", timeZone: "Asia/Ho_Chi_Minh", role: "FrontDesk" }] };

function editor(patch: Partial<PromotionEditor> = {}): PromotionEditor {
  return {
    id: "pr1", propertyId: "p1", slug: "dat-som", status: "Draft", kind: "Percent", value: 15, currencyCode: null, allRoomTypes: true, roomTypeIds: [],
    bookingFrom: null, bookingTo: null, stayFrom: null, stayTo: null, minNights: 2, title: "Đặt sớm", summary: "Giảm 15% khi đặt sớm", body: ["Điều kiện một."],
    coverMediaId: null, coverAltText: null, showOnHomepage: false, sortOrder: 0, displayFrom: null, displayTo: null, publicNow: false,
    translations: { en: { title: null, summary: null, coverAltText: null, body: [] } },
    languages: [{ code: "vi", displayName: "Tiếng Việt", isSource: true }, { code: "en", displayName: "English", isSource: false }],
    version: 1, createdAtUtc: "2026-10-20T00:00:00Z", updatedAtUtc: "2026-10-20T00:00:00Z", updatedByStaffId: "s1", ...patch,
  };
}
const summary = (e: PromotionEditor): PromotionSummary => ({
  id: e.id, propertyId: e.propertyId, slug: e.slug, title: e.title, summary: e.summary, status: e.status, kind: e.kind, value: e.value, currencyCode: e.currencyCode,
  allRoomTypes: e.allRoomTypes, roomTypeCount: e.roomTypeIds.length, showOnHomepage: e.showOnHomepage, sortOrder: e.sortOrder, bookingFrom: e.bookingFrom, bookingTo: e.bookingTo,
  stayFrom: e.stayFrom, stayTo: e.stayTo, displayFrom: e.displayFrom, displayTo: e.displayTo, minNights: e.minNights, publicNow: e.publicNow, coverMediaId: e.coverMediaId,
  version: e.version, updatedAtUtc: e.updatedAtUtc,
});

let server: PromotionEditor;
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
  server = editor();
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: MANAGER });
  vi.mocked(getPromotionRoomTypes).mockResolvedValue(ok([{ id: "r1", code: "RIV-1BR", name: "Căn hộ một phòng ngủ", isActive: true }, { id: "r2", code: "RIV-2BR", name: "Căn hộ hai phòng ngủ", isActive: true }]));
  vi.mocked(listPromotions).mockImplementation(async () => ok([summary(server)]));
  vi.mocked(getPromotion).mockImplementation(async () => ok(structuredClone(server)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const press = async (testId: string) => userEvent.click((await screen.findByTestId(testId)).querySelector("button")!);

const open = async () => {
  render(<PromotionsScreen />);
  await press("promotion-open-dat-som");
  await screen.findByRole("form", { name: "Chỉnh sửa ưu đãi" });
};

describe("PromotionsScreen access", () => {
  it("sends nothing for an account that is not a Manager of any property", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: FRONT_DESK });

    render(<PromotionsScreen />);

    expect(await screen.findByTestId("website-no-permission")).toHaveTextContent("không phải Manager");
    expect(listPromotions).not.toHaveBeenCalled();
    expect(getPromotionRoomTypes).not.toHaveBeenCalled();
  });

  it("sends nothing without a signed-in session and goes to sign-in for this page", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "unauthenticated" });

    render(<PromotionsScreen />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/signin?returnTo=%2Fpromotions"));
    expect(listPromotions).not.toHaveBeenCalled();
  });

  it("works only on the properties the account manages", async () => {
    render(<PromotionsScreen />);

    await screen.findByTestId("promotion-list");
    expect(listPromotions).toHaveBeenCalledWith("p1", { status: "", q: "", homepage: "" }, expect.anything());
    expect(screen.queryByTestId("promotion-property")).toBeNull();   // a single managed property: nothing to choose
  });
});

describe("PromotionsScreen list", () => {
  it("shows the rule, the state and whether the card is on the website — three different things", async () => {
    server = editor({ status: "Active", showOnHomepage: true, publicNow: false });
    render(<PromotionsScreen />);

    const card = await screen.findByTestId("promotion-dat-som");

    expect(within(card).getByText("Giảm 15% mỗi đêm")).toBeInTheDocument();
    expect(within(card).getByTestId("promotion-status")).toHaveTextContent("Đang bật");
    expect(within(card).getByText("Chưa/không còn hiện")).toBeInTheDocument();
  });

  it("filters on the server by status, homepage placement and search", async () => {
    render(<PromotionsScreen />);
    await screen.findByTestId("promotion-list");

    await userEvent.selectOptions(screen.getByTestId("promotion-filter-status"), "Active");
    await userEvent.selectOptions(screen.getByTestId("promotion-filter-homepage"), "true");
    await userEvent.type(screen.getByTestId("promotion-filter-q"), "sớm");

    await waitFor(() => expect(listPromotions).toHaveBeenLastCalledWith("p1", { status: "Active", q: "sớm", homepage: "true" }, expect.anything()));
  });

  it("says when nothing matches and when the property has none", async () => {
    vi.mocked(listPromotions).mockResolvedValue(ok([]));
    render(<PromotionsScreen />);
    expect(await screen.findByTestId("promotion-empty")).toHaveTextContent("chưa có ưu đãi nào");

    await userEvent.type(screen.getByTestId("promotion-filter-q"), "zzz");
    await waitFor(() => expect(screen.getByTestId("promotion-empty")).toHaveTextContent("khớp bộ lọc"));
  });

  it("offers Retry when the list cannot be read", async () => {
    vi.mocked(listPromotions).mockResolvedValueOnce({ kind: "network", message: "Không kết nối được." });
    render(<PromotionsScreen />);

    expect(await screen.findByTestId("website-load-error")).toHaveTextContent("Không kết nối được.");
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByTestId("promotion-list")).toBeInTheDocument();
  });
});

describe("PromotionsScreen create", () => {
  const fillMinimum = async () => {
    await press("promotion-create");
    await screen.findByRole("form", { name: "Tạo ưu đãi" });
    await userEvent.type(screen.getByTestId("promotion-title"), "Ưu đãi Đặt sớm");
    await userEvent.type(screen.getByTestId("promotion-summary"), "Giảm khi đặt sớm");
    await userEvent.type(screen.getByTestId("promotion-value"), "15");
  };

  it("suggests the slug from the title, then stops once it is typed by hand", async () => {
    render(<PromotionsScreen />);
    await press("promotion-create");
    await userEvent.type(screen.getByTestId("promotion-title"), "Ưu đãi Đặt sớm");
    expect(screen.getByTestId("promotion-slug")).toHaveValue("uu-dai-dat-som");

    await userEvent.clear(screen.getByTestId("promotion-slug"));
    await userEvent.type(screen.getByTestId("promotion-slug"), "tu-chon");
    await userEvent.type(screen.getByTestId("promotion-title"), " 2");
    expect(screen.getByTestId("promotion-slug")).toHaveValue("tu-chon");
  });

  it("refuses a free booking on the screen and sends nothing", async () => {
    render(<PromotionsScreen />);
    await fillMinimum();
    await userEvent.clear(screen.getByTestId("promotion-value"));
    await userEvent.type(screen.getByTestId("promotion-value"), "100");

    await press("promotion-save");

    expect(await screen.findByText(/chưa hỗ trợ đặt phòng miễn phí/)).toBeInTheDocument();
    expect(createPromotion).not.toHaveBeenCalled();
  });

  it("creates the promotion once with an operation id, then opens it as a draft", async () => {
    vi.mocked(createPromotion).mockImplementation(async () => ok(editor({ title: "Ưu đãi Đặt sớm", slug: "uu-dai-dat-som" })));
    render(<PromotionsScreen />);
    await fillMinimum();

    await press("promotion-save");

    await waitFor(() => expect(createPromotion).toHaveBeenCalledTimes(1));
    const [propertyId, body, operationId] = vi.mocked(createPromotion).mock.calls[0] as [string, PromotionBody, string];
    expect(propertyId).toBe("p1");
    expect(body).toMatchObject({ slug: "uu-dai-dat-som", title: "Ưu đãi Đặt sớm", kind: "Percent", value: 15, allRoomTypes: true, minNights: 1, showOnHomepage: false });
    expect(operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await screen.findByRole("form", { name: "Chỉnh sửa ưu đãi" })).toBeInTheDocument();
    expect(screen.getByTestId("editor-status")).toHaveTextContent("Nháp");
  });

  it("does not resend a create whose answer was lost: it checks the server, and a retry carries the same operation id", async () => {
    vi.mocked(createPromotion).mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ không trả lời." });
    render(<PromotionsScreen />);
    await fillMinimum();
    await press("promotion-save");

    expect(await screen.findByTestId("write-unverified")).toBeInTheDocument();
    expect(screen.getByTestId("promotion-save").querySelector("button")).toBeDisabled();   // no second click can send
    expect(createPromotion).toHaveBeenCalledTimes(1);

    vi.mocked(listPromotions).mockResolvedValueOnce(ok([]));   // the server holds nothing with this slug
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("không tạo trùng");

    vi.mocked(createPromotion).mockImplementation(async () => ok(editor({ slug: "uu-dai-dat-som" })));
    await press("promotion-save");
    await waitFor(() => expect(createPromotion).toHaveBeenCalledTimes(2));
    const first = vi.mocked(createPromotion).mock.calls[0];
    const second = vi.mocked(createPromotion).mock.calls[1];
    expect(second[2]).toBe(first[2]);   // the same operation id
    expect(second[1]).toEqual(first[1]);
  });

  it("opens the promotion the server already has when the lost create had in fact succeeded", async () => {
    vi.mocked(createPromotion).mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ không trả lời." });
    render(<PromotionsScreen />);
    await fillMinimum();
    await press("promotion-save");
    await screen.findByTestId("write-unverified");
    server = editor({ slug: "uu-dai-dat-som", title: "Ưu đãi Đặt sớm" });
    vi.mocked(listPromotions).mockResolvedValueOnce(ok([summary(server)]));

    await userEvent.click(screen.getByTestId("check-server"));

    expect(await screen.findByRole("form", { name: "Chỉnh sửa ưu đãi" })).toBeInTheDocument();
    expect(createPromotion).toHaveBeenCalledTimes(1);
  });

  it("shows a slug that is taken beside the form and keeps what was typed", async () => {
    vi.mocked(createPromotion).mockResolvedValueOnce({ kind: "refused", status: 409, code: "slug-taken", field: "slug", detail: "taken" });
    render(<PromotionsScreen />);
    await fillMinimum();

    await press("promotion-save");

    expect((await screen.findAllByText(/đã được một ưu đãi khác dùng/)).length).toBeGreaterThan(0);   // beside the slug and in the banner
    expect(screen.getByTestId("promotion-title")).toHaveValue("Ưu đãi Đặt sớm");
  });
});

describe("PromotionsScreen edit", () => {
  it("saves with the version the editor was opened from", async () => {
    vi.mocked(savePromotion).mockImplementation(async (_p, _id, _v, body) => { server = editor({ title: body.title, version: 2 }); return ok(structuredClone(server)); });
    await open();

    await userEvent.clear(screen.getByTestId("promotion-title"));
    await userEvent.type(screen.getByTestId("promotion-title"), "Đặt sớm 2027");
    expect(screen.getByTestId("promotion-dirty")).toBeInTheDocument();
    await press("promotion-save");

    await waitFor(() => expect(savePromotion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(savePromotion).mock.calls[0].slice(0, 3)).toEqual(["p1", "pr1", 1]);
    expect(await screen.findByTestId("promotion-saved")).toBeInTheDocument();
    expect(screen.queryByTestId("promotion-dirty")).toBeNull();
  });

  it("keeps the draft and says so when another tab saved first, and a reload does not overwrite it", async () => {
    vi.mocked(savePromotion).mockResolvedValueOnce({ kind: "refused", status: 409, code: "stale-version", field: null, detail: "stale" });
    await open();
    await userEvent.clear(screen.getByTestId("promotion-title"));
    await userEvent.type(screen.getByTestId("promotion-title"), "Bản của tôi");
    await press("promotion-save");

    expect(await screen.findByTestId("write-refused")).toHaveTextContent("Dữ liệu đã thay đổi trên máy chủ");
    expect(screen.getByTestId("promotion-title")).toHaveValue("Bản của tôi");

    server = editor({ title: "Bản của tab khác", version: 2 });
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("phiên bản 2");
    expect(screen.getByTestId("promotion-title")).toHaveValue("Bản của tôi");   // the draft is still the user's

    vi.mocked(savePromotion).mockImplementation(async () => ok(editor({ title: "Bản của tôi", version: 3 })));
    await press("promotion-save");
    await waitFor(() => expect(savePromotion).toHaveBeenCalledTimes(2));
    expect(vi.mocked(savePromotion).mock.calls[1][2]).toBe(2);   // now an informed overwrite of version 2
  });

  it("reconciles a lost save by reading the server, never by resending", async () => {
    vi.mocked(savePromotion).mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ không trả lời." });
    await open();
    await userEvent.clear(screen.getByTestId("promotion-title"));
    await userEvent.type(screen.getByTestId("promotion-title"), "Đã lưu rồi");
    await press("promotion-save");
    await screen.findByTestId("write-unverified");
    server = editor({ title: "Đã lưu rồi", version: 2 });

    await userEvent.click(screen.getByTestId("check-server"));

    expect(await screen.findByTestId("promotion-saved")).toHaveTextContent("máy chủ đã có đúng nội dung");
    expect(savePromotion).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("promotion-dirty")).toBeNull();
  });

  it("turns the promotion on and off with the version, and never while a draft is unsaved", async () => {
    vi.mocked(setPromotionStatus).mockImplementation(async (_p, _id, _v, status) => { server = editor({ status, version: server.version + 1 }); return ok(structuredClone(server)); });
    await open();

    await userEvent.type(screen.getByTestId("promotion-title"), "!");
    expect(screen.getByTestId("promotion-activate").querySelector("button")).toBeDisabled();
    await userEvent.type(screen.getByTestId("promotion-title"), "{Backspace}");
    expect(screen.getByTestId("promotion-activate").querySelector("button")).toBeEnabled();

    await press("promotion-activate");
    await waitFor(() => expect(screen.getByTestId("editor-status")).toHaveTextContent("Đang bật"));
    expect(vi.mocked(setPromotionStatus).mock.calls[0]).toEqual(["p1", "pr1", 1, "Active"]);

    await press("promotion-disable");
    await waitFor(() => expect(screen.getByTestId("editor-status")).toHaveTextContent("Đã tắt"));
    expect(screen.getByTestId("promotion-saved")).toHaveTextContent("Booking đã giữ giá cũ");
  });

  it("makes hiding the card a placement choice, not a pricing one", async () => {
    server = editor({ status: "Active", showOnHomepage: true, coverMediaId: "m1", coverAltText: "Phòng", publicNow: true });
    await open();

    expect(screen.getByTestId("promotion-public-state")).toHaveTextContent("Thẻ đang hiện công khai");
    expect(screen.getByTestId("promotion-public-state")).toHaveTextContent("vẫn tính giá chừng nào còn Đang bật");
    expect(screen.getByText(/Không đổi giá và không bật\/tắt hiệu lực tính giá/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("promotion-show"));
    expect(screen.getByTestId("editor-status")).toHaveTextContent("Đang bật");   // the status is untouched by the placement checkbox
  });

  it("asks before leaving with a draft and keeps it when the answer is no", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await open();
    await userEvent.type(screen.getByTestId("promotion-title"), "x");

    await userEvent.click(screen.getByTestId("promotion-back"));

    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole("form", { name: "Chỉnh sửa ưu đãi" })).toBeInTheDocument();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByTestId("promotion-back"));
    expect(await screen.findByTestId("promotion-list")).toBeInTheDocument();
  });

  it("edits the room types and the three kinds of dates as the rule says", async () => {
    vi.mocked(savePromotion).mockImplementation(async (_p, _id, _v, body) => ok(editor({ roomTypeIds: body.roomTypeIds, allRoomTypes: body.allRoomTypes, version: 2 })));
    await open();

    await userEvent.click(screen.getByTestId("promotion-scope-some"));
    await userEvent.click(screen.getByTestId("promotion-room-RIV-2BR"));
    await userEvent.type(screen.getByTestId("promotion-booking-to"), "2026-12-31");
    await userEvent.type(screen.getByTestId("promotion-stay-from"), "2027-01-02");
    await userEvent.type(screen.getByTestId("promotion-stay-to"), "2027-01-10");
    await press("promotion-save");

    await waitFor(() => expect(savePromotion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(savePromotion).mock.calls[0][3]).toMatchObject({ allRoomTypes: false, roomTypeIds: ["r2"], bookingTo: "2026-12-31", stayFrom: "2027-01-02", stayTo: "2027-01-10", bookingFrom: null });
  });

  it("saves the English texts with the promotion and leaves a blank one to fall back to Vietnamese", async () => {
    vi.mocked(savePromotion).mockImplementation(async () => ok(editor({ version: 2 })));
    await open();

    await userEvent.type(screen.getByTestId("promotion-en-title"), "Early bird");
    await press("promotion-save");

    await waitFor(() => expect(savePromotion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(savePromotion).mock.calls[0][3].translations).toEqual({ en: { title: "Early bird", summary: null, coverAltText: null, body: [] } });
  });
});

describe("PromotionsScreen cover picture", () => {
  const png = () => new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" });

  it("uploads on choosing, shows it and asks for an alt text before the card can be saved", async () => {
    vi.mocked(uploadPromotionCover).mockResolvedValue(ok({ id: "m9", contentType: "image/png", width: 800, height: 600 }));
    await open();

    await userEvent.upload(screen.getByTestId("promotion-cover-input"), png());

    expect(await screen.findByTestId("promotion-cover-preview")).toHaveAttribute("src", expect.stringContaining("/promotions/media/m9"));
    await press("promotion-save");
    expect(await screen.findByText(/Nhập mô tả ảnh \(alt text\)/)).toBeInTheDocument();
    expect(savePromotion).not.toHaveBeenCalled();
  });

  it("refuses a file that is not an image, or too large, without a request", async () => {
    await open();

    await userEvent.upload(screen.getByTestId("promotion-cover-input"), new File(["x"], "a.gif", { type: "image/gif" }), { applyAccept: false });
    expect(await screen.findByTestId("promotion-cover-error")).toHaveTextContent("JPEG, PNG hoặc WebP");
    await userEvent.upload(screen.getByTestId("promotion-cover-input"), new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
    expect(await screen.findByTestId("promotion-cover-error")).toHaveTextContent("10 MB");
    expect(uploadPromotionCover).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the picture is too small", async () => {
    vi.mocked(uploadPromotionCover).mockResolvedValue({ kind: "refused", status: 400, code: "promotion-image-too-small", field: "file", detail: "small" });
    await open();

    await userEvent.upload(screen.getByTestId("promotion-cover-input"), png());

    expect(await screen.findByTestId("promotion-cover-error")).toHaveTextContent("600×400");
  });

  it("does not let the upload slot be taken twice", async () => {
    const slow = deferred<Awaited<ReturnType<typeof uploadPromotionCover>>>();
    vi.mocked(uploadPromotionCover).mockReturnValue(slow.promise);
    await open();

    await userEvent.upload(screen.getByTestId("promotion-cover-input"), png());
    expect(screen.getByTestId("promotion-cover-input")).toBeDisabled();
    slow.resolve(ok({ id: "m1", contentType: "image/png", width: 800, height: 600 }));
    await waitFor(() => expect(screen.getByTestId("promotion-cover-input")).toBeEnabled());
    expect(uploadPromotionCover).toHaveBeenCalledTimes(1);
  });
});
