/**
 * CUST-WEB-HERO-001-CP01: the Banner trang chủ screen against a mocked Admin API client — the draft is local until Save; one Save sends
 * the whole hero once with the loaded revision; an uploaded picture is not in the slideshow until a Save names it; a stale revision keeps
 * the draft; a lost answer — of a Save or of an upload — is never retried; the preview draws the draft in the Customer's font.
 */
import React from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  fetchStaffSession: vi.fn(),
  staffLogout: vi.fn(),
}));
vi.mock("@/lib/api/website", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/website")>()),
  getHero: vi.fn(),
  saveHero: vi.fn(),
  uploadHeroImage: vi.fn(),
}));

import HeroPanel from "./HeroPanel";
import { ALLOWED, btn, deferred, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession, staffLogout } from "@/lib/api/staff";
import { getHero, saveHero, uploadHeroImage, type HeroMedia, type HeroSlide, type MenuLocale, type WebsiteHero } from "@/lib/api/website";

const read = vi.mocked(getHero);
const save = vi.mocked(saveHero);
const send = vi.mocked(uploadHeroImage);

const LOCALES: MenuLocale[] = [
  { code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, isActive: true, isContentSource: true },
  { code: "en", displayName: "English", nativeName: "English", isDefault: false, isActive: true, isContentSource: false },
  { code: "fr", displayName: "French", nativeName: "Français", isDefault: false, isActive: true, isContentSource: false },
];
const media = (id: string, over: Partial<HeroMedia> = {}): HeroMedia => ({
  id, kind: "seed", url: `/api/admin/v1/website/hero/media/${id}`, seedFile: `hero-${id}.webp`, contentType: "image/webp", byteSize: 90_000, width: 1920, height: 900, createdAtUtc: "2026-10-16T00:00:00+00:00", ...over,
});
const slide = (id: string): HeroSlide => ({
  id: `s-${id}`, mediaId: id, focalPosition: "40% 50%", alt: { vi: `Ảnh ${id}`, en: `Photo ${id}`, fr: null }, caption: { vi: `Chú thích ${id}`, en: `Caption ${id}`, fr: null },
});
const MEDIA = [media("a"), media("b"), media("c"), media("d")];
const hero = (over: Partial<WebsiteHero> = {}): WebsiteHero => ({
  revision: "rev-1", version: 1, updatedAtUtc: "2026-10-17T01:00:00+00:00", locales: LOCALES, fontKey: "default", autoplayEnabled: true, intervalSeconds: 6,
  texts: {
    title: { vi: "The BHA — Đà Nẵng", en: "The BHA — Da Nang", fr: null }, description: { vi: "Đặt phòng trực tiếp", en: "Book direct", fr: null },
    primaryAction: { vi: "Tìm phòng", en: "Find a room", fr: null }, secondaryAction: { vi: "Xem Riverside", en: "View Riverside", fr: null },
  },
  slides: [slide("a"), slide("b"), slide("c"), slide("d")], media: MEDIA, ...over,
});
const refused = (status: number, code: string, field: string | null = null) => ({ kind: "refused" as const, status, code, field, detail: "x" });

async function open() {
  renderInGate(<HeroPanel />, "/website/hero");
  await screen.findByTestId("hero-slides");
}
const press = (testId: string) => {
  const element = screen.getByTestId(testId);
  return userEvent.click(element.tagName === "BUTTON" ? element : within(element).getByRole("button"));
};
const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement;
const order = () => Array.from(screen.getByTestId("hero-slides").querySelectorAll("li[data-testid^='slide-']")).map((node) => node.getAttribute("data-testid")!.replace("slide-", ""));
const sentBody = (call = 0) => save.mock.calls[call][1];
const png = (name = "banner.png", type = "image/png", size = 1000) => new File([new Uint8Array(size)], name, { type });
const choosePicture = (file: File) => userEvent.upload(screen.getByTestId("hero-file-input"), file, { applyAccept: false });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  read.mockReset();
  save.mockReset();
  send.mockReset();
  read.mockResolvedValue(ok(hero()));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the list and the editor", () => {
  it("shows every slide with its thumbnail and caption, the saved state, and nothing to save", async () => {
    await open();
    expect(order()).toEqual(["s-a", "s-b", "s-c", "s-d"]);
    expect(screen.getAllByTestId("slide-thumb").map((image) => image.getAttribute("src"))).toContain("https://localhost:7145/api/admin/v1/website/hero/media/a");
    expect(within(screen.getByTestId("slide-s-b")).getByText("Chú thích b")).toBeInTheDocument();
    expect(screen.getByTestId("hero-state")).toHaveTextContent("Đã lưu — phiên bản 1");
    expect(btn("hero-save")).toBeDisabled();
    expect(btn("hero-cancel")).toBeDisabled();
    expect(field("field-interval").value).toBe("6");
    expect((screen.getByTestId("field-font") as HTMLSelectElement).value).toBe("default");
  });

  it("editing marks the screen unsaved with a summary, the preview follows at once, and Cancel brings the loaded hero back with no request", async () => {
    await open();
    await userEvent.clear(field("field-title"));
    await userEvent.type(field("field-title"), "Khách sạn mới");
    expect(screen.getByTestId("hero-state")).toHaveTextContent("Có thay đổi chưa lưu — sửa nội dung chữ");
    expect(screen.getByTestId("preview-title")).toHaveTextContent("Khách sạn mới");
    await userEvent.click(btn("hero-cancel"));
    expect(field("field-title").value).toBe("The BHA — Đà Nẵng");
    expect(screen.getByTestId("preview-title")).toHaveTextContent("The BHA — Đà Nẵng");
    expect(screen.getByTestId("hero-state")).toHaveTextContent("Đã lưu");
    expect(save).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("the preview is drawn in the chosen font — only the title and description — and shows the other language's text", async () => {
    await open();
    expect(screen.getByTestId("preview-title").style.fontFamily).toContain("Poppins");
    await userEvent.selectOptions(screen.getByTestId("field-font"), "system-serif");
    expect(screen.getByTestId("preview-title").style.fontFamily).toContain("serif");
    expect(screen.getByTestId("preview-description").style.fontFamily).toContain("serif");
    expect(screen.getByTestId("preview-primary").style.fontFamily).toBe("");
    expect(screen.getByTestId("preview-caption").style.fontFamily).toBe("");
    await userEvent.selectOptions(screen.getByTestId("field-font"), "be-vietnam-pro");
    expect(screen.getByTestId("preview-title").style.fontFamily).toContain("--font-header");
    await userEvent.selectOptions(screen.getByTestId("edit-locale"), "en");
    expect(field("field-title").value).toBe("The BHA — Da Nang");
    expect(screen.getByTestId("preview-title")).toHaveTextContent("The BHA — Da Nang");
    expect(screen.getByTestId("preview-primary")).toHaveTextContent("Find a room");
    await userEvent.selectOptions(screen.getByTestId("edit-locale"), "fr");           // French has no text yet: the visitor gets the default language's
    expect(field("field-title").value).toBe("");
    expect(screen.getByTestId("preview-title")).toHaveTextContent("The BHA — Đà Nẵng");
    expect(screen.getByTestId("hero-state")).toHaveTextContent("đổi font");
  });

  it("explains that the interval is the time between two slides, not the fade, and what switching autoplay off means", async () => {
    await open();
    expect(screen.getByText(/không phải độ dài hiệu ứng mờ dần/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Tự chuyển ảnh"));
    expect(screen.getByText(/khách chỉ chuyển ảnh bằng nút/)).toBeInTheDocument();
    expect(screen.getByTestId("preview-timing")).toHaveTextContent("Không tự chuyển");
    expect(field("field-interval").value).toBe("6");                                    // kept for when it is switched on again
  });
});

describe("slides: order, replace, remove, add", () => {
  it("moves a slide up and down and says where it cannot go", async () => {
    await open();
    await press("down-s-a");
    expect(order()).toEqual(["s-b", "s-a", "s-c", "s-d"]);
    await press("up-s-d");
    expect(order()).toEqual(["s-b", "s-a", "s-d", "s-c"]);
    expect(screen.getByTestId("up-s-b")).toBeDisabled();
    expect(screen.getByTestId("down-s-c")).toBeDisabled();
    expect(screen.getByTestId("hero-state")).toHaveTextContent("đổi thứ tự ảnh");
  });

  it("removes a slide, and refuses to remove the last one", async () => {
    read.mockResolvedValue(ok(hero({ slides: [slide("a"), slide("b")] })));
    await open();
    await press("remove-s-a");
    expect(order()).toEqual(["s-b"]);
    expect(screen.getByTestId("hero-state")).toHaveTextContent("xoá 1 ảnh");
    await press("remove-s-b");
    expect(screen.getByTestId("hero-move-note")).toHaveTextContent("ít nhất 1 ảnh");
    expect(order()).toEqual(["s-b"]);
  });

  it("adds a slide from the library of pictures already on the server: the required texts are empty and block Save until written", async () => {
    read.mockResolvedValue(ok(hero({ slides: [slide("a")], media: [...MEDIA, media("u1", { kind: "upload", seedFile: null })] })));
    await open();
    await press("add-library");
    expect(within(screen.getByTestId("media-picker")).getAllByRole("button", { name: /1920×900/ }).length).toBe(5);
    await userEvent.click(screen.getByTestId("pick-u1"));
    expect(order().length).toBe(2);
    expect(screen.queryByTestId("media-picker")).toBeNull();
    await press("hero-save");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("hero-blocking")).toHaveTextContent("Còn 2 chỗ");           // alt and caption in Vietnamese
    expect(screen.getAllByText("Nhập nội dung.").length).toBe(2);
    await userEvent.type(screen.getByTestId("slide-alt"), "Ảnh mới");
    await userEvent.type(screen.getByTestId("slide-caption"), "Chú thích mới");
    save.mockResolvedValueOnce(ok(hero({ revision: "rev-2", version: 2 })));
    await press("hero-save");
    expect(save).toHaveBeenCalledTimes(1);
    const added = sentBody().slides[1];
    expect(added).toMatchObject({ mediaId: "u1", focalPosition: "50% 50%", alt: { vi: "Ảnh mới", en: null, fr: null } });
  });

  it("will not take an eleventh slide", async () => {
    read.mockResolvedValue(ok(hero({ slides: Array.from({ length: 10 }, (_, index) => slide(String(index))) })));
    await open();
    expect(btn("add-upload")).toBeDisabled();
    expect(btn("add-library")).toBeDisabled();
    expect(screen.getByText("Ảnh banner (10/10)")).toBeInTheDocument();
  });
});

describe("upload: recorded at once, published only by a Save", () => {
  it("a chosen picture is sent once, becomes a new slide in the draft, and nothing is saved", async () => {
    const uploaded = media("u1", { kind: "upload", seedFile: null, contentType: "image/png", width: 1600, height: 900 });
    send.mockResolvedValueOnce(ok(uploaded));
    await open();
    await press("add-upload");
    await choosePicture(png());
    await waitFor(() => expect(order().length).toBe(5));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].name).toBe("banner.png");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("hero-state")).toHaveTextContent("thêm 1 ảnh");
    expect(screen.getByText(/1600×900/)).toBeInTheDocument();
    await press("add-library");                                                           // and it is in the library of this visit
    expect(within(screen.getByTestId("media-picker")).getByTestId("pick-u1")).toBeInTheDocument();
  });

  it("replaces a slide's picture and keeps the slide, its place and its texts", async () => {
    send.mockResolvedValueOnce(ok(media("u2", { kind: "upload", seedFile: null })));
    await open();
    await press("replace-upload-s-b");
    await choosePicture(png("new.webp", "image/webp"));
    await waitFor(() => expect(screen.getByTestId("hero-state")).toHaveTextContent("thay ảnh"));
    expect(order()).toEqual(["s-a", "s-b", "s-c", "s-d"]);
    save.mockResolvedValueOnce(ok(hero({ revision: "rev-2", version: 2 })));
    await press("hero-save");
    expect(sentBody().slides[1]).toMatchObject({ id: "s-b", mediaId: "u2", focalPosition: "50% 50%", alt: { vi: "Ảnh b" }, caption: { vi: "Chú thích b" } });
    expect(sentBody().slides.map((item: HeroSlide) => item.mediaId)).toEqual(["a", "u2", "c", "d"]);
  });

  it("checks type and size on the screen first, and sends nothing for a file that cannot work", async () => {
    await open();
    await press("add-upload");
    await choosePicture(png("a.svg", "image/svg+xml"));
    expect(screen.getByTestId("hero-upload-error")).toHaveTextContent("JPEG, PNG hoặc WebP");
    await choosePicture(png("big.png", "image/png", 10 * 1024 * 1024 + 1));
    expect(screen.getByTestId("hero-upload-error")).toHaveTextContent("lớn hơn 10 MB");
    expect(send).not.toHaveBeenCalled();
    expect(order().length).toBe(4);
  });

  it("a picture the server refuses adds no slide and says why", async () => {
    send.mockResolvedValueOnce(refused(400, "hero-image-corrupt", "file"));
    await open();
    await press("add-upload");
    await choosePicture(png());
    const status = await screen.findByTestId("hero-upload-status");
    expect(within(status).getByTestId("write-refused")).toHaveTextContent("hỏng hoặc chưa đủ dữ liệu");
    expect(order().length).toBe(4);
    expect(screen.getByTestId("hero-state")).toHaveTextContent("Đã lưu");
  });

  it("a lost answer to an upload is not retried: it locks the screen until the server has been read, then points at the library", async () => {
    send.mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ không trả lời." });
    await open();
    await press("add-upload");
    await choosePicture(png());
    const status = await screen.findByTestId("hero-upload-status");
    expect(within(status).getByTestId("write-unverified")).toBeInTheDocument();
    expect(btn("add-upload")).toBeDisabled();
    expect(screen.getByTestId("up-s-b")).toBeDisabled();
    expect(send).toHaveBeenCalledTimes(1);
    read.mockResolvedValueOnce(ok(hero({ media: [media("u9", { kind: "upload", seedFile: null }), ...MEDIA] })));
    await userEvent.click(within(status).getByTestId("check-server"));
    await waitFor(() => expect(btn("add-upload")).toBeEnabled());
    expect(screen.getByTestId("server-note")).toHaveTextContent("5 ảnh trong thư viện");
    await press("add-library");
    expect(screen.getByTestId("pick-u9")).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("Save", () => {
  it("is refused on screen for an interval outside 3–60 or not a whole number, beside the field, and sends nothing", async () => {
    await open();
    for (const bad of ["2", "61", "0", "6.5", "abc", ""]) {
      await userEvent.clear(field("field-interval"));
      if (bad) await userEvent.type(field("field-interval"), bad);
      await press("hero-save");
      expect(await screen.findByText(/Nhập số giây nguyên từ 3 đến 60/)).toBeInTheDocument();
    }
    expect(save).not.toHaveBeenCalled();
    await userEvent.clear(field("field-interval"));
    await userEvent.type(field("field-interval"), "3");
    expect(screen.queryByText(/Nhập số giây nguyên/)).toBeNull();
  });

  it("sends the whole hero once with the loaded revision however many times Save is clicked, then shows the new state", async () => {
    const gate = deferred<ReturnType<typeof ok<WebsiteHero>>>();
    save.mockReturnValueOnce(gate.promise);
    await open();
    await userEvent.selectOptions(screen.getByTestId("field-font"), "system-sans");
    await userEvent.click(screen.getByLabelText("Tự chuyển ảnh"));
    await userEvent.clear(field("field-interval"));
    await userEvent.type(field("field-interval"), "12");
    await press("down-s-a");
    const button = btn("hero-save");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("write-pending")).toBeInTheDocument();
    expect(save.mock.calls[0][0]).toBe("rev-1");
    expect(sentBody()).toMatchObject({ fontKey: "system-sans", autoplayEnabled: false, intervalSeconds: 12 });
    expect(sentBody().slides.map((item: HeroSlide) => item.id)).toEqual(["s-b", "s-a", "s-c", "s-d"]);
    expect(sentBody().texts.title).toEqual({ vi: "The BHA — Đà Nẵng", en: "The BHA — Da Nang", fr: null });
    gate.resolve(ok(hero({ revision: "rev-2", version: 2, fontKey: "system-sans", autoplayEnabled: false, intervalSeconds: 12, slides: [slide("b"), slide("a"), slide("c"), slide("d")] })));
    expect(await screen.findByTestId("website-success")).toHaveTextContent("tối đa 15 giây");
    expect(screen.getByTestId("hero-state")).toHaveTextContent("phiên bản 2");
    expect(btn("hero-save")).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a server refusal naming a field selects that slide and language and shows the message beside the field", async () => {
    save.mockResolvedValueOnce(refused(400, "hero-text-invalid", "slides[1].caption.en"));
    await open();
    await userEvent.selectOptions(screen.getByTestId("field-font"), "system-serif");
    await press("hero-save");
    expect(await screen.findByTestId("slide-texts")).toBeInTheDocument();
    expect(within(screen.getByTestId("slide-s-b")).getByTestId("slide-texts")).toBeInTheDocument();
    expect((screen.getByTestId("slide-locale") as HTMLSelectElement).value).toBe("en");
    expect((screen.getByTestId("slide-caption") as HTMLInputElement).value).toBe("Caption b");
    expect(within(screen.getByTestId("slide-texts")).getByText(/Văn bản chỉ là chữ thường/)).toBeInTheDocument();
    expect(screen.getByTestId("hero-state")).toHaveTextContent("Có thay đổi chưa lưu");
  });

  it("the language selector is the operator's again after a refusal that moved it", async () => {
    save.mockResolvedValueOnce(refused(400, "hero-text-invalid", "texts.title.en"));
    await open();
    await userEvent.selectOptions(screen.getByTestId("field-font"), "system-serif");
    await press("hero-save");
    await waitFor(() => expect((screen.getByTestId("edit-locale") as HTMLSelectElement).value).toBe("en"));
    expect(field("field-title").value).toBe("The BHA — Da Nang");
    await userEvent.selectOptions(screen.getByTestId("edit-locale"), "vi");
    expect((screen.getByTestId("edit-locale") as HTMLSelectElement).value).toBe("vi");
    expect(field("field-title").value).toBe("The BHA — Đà Nẵng");
  });

  it("a stale revision keeps the draft; loading the latest keeps it too and says Save will replace the server's hero", async () => {
    save.mockResolvedValueOnce(refused(409, "stale-version"));
    await open();
    await userEvent.type(field("field-title"), "!");
    await press("hero-save");
    expect(await screen.findByTestId("write-refused")).toHaveTextContent("Chưa có gì được lưu");
    expect(field("field-title").value).toBe("The BHA — Đà Nẵng!");
    read.mockResolvedValueOnce(ok(hero({ revision: "rev-9", version: 9, fontKey: "system-serif" })));
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("Lưu sẽ thay cả banner trên máy chủ");
    expect(field("field-title").value).toBe("The BHA — Đà Nẵng!");
    expect((screen.getByTestId("field-font") as HTMLSelectElement).value).toBe("default");     // the draft's, not the server's
    save.mockResolvedValueOnce(ok(hero({ revision: "rev-10", version: 10 })));
    await press("hero-save");
    expect(save.mock.calls[1][0]).toBe("rev-9");
  });

  it("a lost answer is never retried: Save stays locked until the server has been read, and the read says whether it was saved", async () => {
    save.mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ không trả lời." });
    await open();
    await userEvent.type(field("field-title"), "!");
    await press("hero-save");
    expect(await screen.findByTestId("write-unverified")).toBeInTheDocument();
    expect(btn("hero-save")).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
    const savedTitle = { ...hero().texts.title, vi: "The BHA — Đà Nẵng!" };
    read.mockResolvedValueOnce(ok(hero({ revision: "rev-2", version: 2, texts: { ...hero().texts, title: savedTitle } })));
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("thay đổi đã được lưu, đúng một lần");
    expect(screen.getByTestId("hero-state")).toHaveTextContent("Đã lưu — phiên bản 2");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("if the server does not have what was sent, the draft is kept and nothing is claimed", async () => {
    save.mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ không trả lời." });
    await open();
    await userEvent.type(field("field-title"), "!");
    await press("hero-save");
    await screen.findByTestId("write-unverified");
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("chưa có thay đổi vừa gửi");
    expect(field("field-title").value).toBe("The BHA — Đà Nẵng!");
    expect(screen.getByTestId("hero-state")).toHaveTextContent("Có thay đổi chưa lưu");
  });
});

describe("leaving", () => {
  it("Sign out asks before it throws an unsaved draft away: no keeps the draft and the session, yes signs out", async () => {
    const logout = vi.mocked(staffLogout);
    logout.mockReset();
    logout.mockResolvedValue({ kind: "ok" } as never);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await open();
    await userEvent.type(field("field-title"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
    expect(field("field-title").value).toBe("The BHA — Đà Nẵng!");
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    confirm.mockRestore();
  });

  it("while a sign-out is pending nothing can be saved, uploaded or edited", async () => {
    const logout = vi.mocked(staffLogout);
    const gate = deferred<{ kind: "ok" }>();
    logout.mockReset();
    logout.mockReturnValue(gate.promise as never);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await open();
    await userEvent.type(field("field-title"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(btn("hero-save")).toBeDisabled();
    expect(btn("add-upload")).toBeDisabled();
    expect(screen.getByTestId("up-s-b")).toBeDisabled();
    expect(field("field-title")).toBeDisabled();
    await choosePicture(png());
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(btn("hero-save"));
    expect(save).not.toHaveBeenCalled();
    gate.resolve({ kind: "ok" });
    confirm.mockRestore();
  });

  it("a failed re-read does not throw the draft away", async () => {
    save.mockResolvedValueOnce(refused(409, "stale-version"));
    await open();
    await userEvent.type(field("field-title"), "!");
    await press("hero-save");
    read.mockResolvedValueOnce({ kind: "network", message: "Không kết nối được." });
    await userEvent.click(await screen.findByTestId("reload-latest"));
    expect(await screen.findByTestId("hero-read-error")).toBeInTheDocument();
    expect(field("field-title").value).toBe("The BHA — Đà Nẵng!");
  });
});
