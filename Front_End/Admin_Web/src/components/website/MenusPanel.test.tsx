/**
 * CUST-WEB-HEADER-001-CP04: the Menu screen against a mocked Admin API client — the draft is local until Save; one Save sends
 * the whole tree once with the loaded revision; a stale revision keeps the draft; a lost answer is never retried and is
 * confirmed by comparing the stored tree with what was sent; the editor cannot build a cycle, a fifth level or delete a branch silently.
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
  getMenu: vi.fn(),
  saveMenu: vi.fn(),
}));

import MenusPanel from "./MenusPanel";
import { ALLOWED, btn, deferred, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { getMenu, saveMenu, type MenuItem, type MenuLocale, type WebsiteMenu } from "@/lib/api/website";
import { canonical } from "@/lib/website/menuModel";

const read = vi.mocked(getMenu);
const save = vi.mocked(saveMenu);

const LOCALES: MenuLocale[] = [
  { code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, isActive: true, isContentSource: true },
  { code: "en", displayName: "English", nativeName: "English", isDefault: false, isActive: true, isContentSource: false },
  { code: "fr", displayName: "French", nativeName: "Français", isDefault: false, isActive: true, isContentSource: false },
];

const item = (id: string, parentId: string | null, vi: string, over: Partial<MenuItem> = {}): MenuItem => ({
  id, parentId, placement: parentId === null ? "primary" : null, isEnabled: true, href: `/${id}`, openInNewTab: false, labels: { vi, en: `${vi} EN`, fr: `${vi} FR` }, ...over,
});

/** Riverside, Blog (Tất cả, Tin), FAQ · secondary: Mẫu */
const ITEMS = canonical([
  item("riverside", null, "Riverside"),
  item("blog", null, "Blog"),
  item("blog-all", "blog", "Tất cả"),
  item("blog-news", "blog", "Tin"),
  item("faq", null, "FAQ"),
  item("tpl", null, "Mẫu", { placement: "secondary" }),
]);

const menu = (items: MenuItem[] = ITEMS, over: Partial<WebsiteMenu> = {}): WebsiteMenu => ({
  revision: "rev-1", version: 1, updatedAtUtc: "2026-10-16T01:00:00+00:00", locales: LOCALES, items, ...over,
});
const refused = (status: number, code: string, field: string | null = null) => ({ kind: "refused" as const, status, code, field, detail: "x" });

async function open() {
  renderInGate(<MenusPanel />, "/website/menus");
  await screen.findByTestId("menu-tree");
}
const select = (id: string) => userEvent.click(screen.getByTestId(`select-${id}`));
/** `ActionButton` puts its test id on a wrapping span; the position buttons carry it themselves. */
const press = (testId: string) => {
  const element = screen.getByTestId(testId);
  return userEvent.click(element.tagName === "BUTTON" ? element : within(element).getByRole("button"));
};
const href = () => screen.getByTestId("field-href") as HTMLInputElement;
const sentItems = (call = 0) => save.mock.calls[call][1];

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  read.mockReset();
  save.mockReset();
  read.mockResolvedValue(ok(menu()));
});
afterEach(cleanup);

describe("the tree and the editor", () => {
  it("shows both groups with their entries, sub-entries indented, and a flag for a label that is missing in a language", async () => {
    read.mockResolvedValue(ok(menu(ITEMS.map((entry) => (entry.id === "faq" ? { ...entry, labels: { vi: "FAQ", en: null, fr: null } } : entry)))));
    await open();
    const primary = screen.getByTestId("group-primary");
    expect(within(primary).getByText("Riverside")).toBeInTheDocument();
    expect(within(screen.getByTestId("node-blog")).getByText("Tất cả")).toBeInTheDocument();
    expect(within(screen.getByTestId("group-secondary")).getByText("Mẫu")).toBeInTheDocument();
    expect(within(screen.getByTestId("select-faq")).getByText("Thiếu nhãn en, fr")).toBeInTheDocument();
    expect(screen.getByTestId("menu-state")).toHaveTextContent("Đã lưu — phiên bản 1");
    expect(btn("menu-save")).toBeDisabled();
    expect(btn("menu-cancel")).toBeDisabled();
  });

  it("an emptied menu says so in each group and still lets the operator add an entry", async () => {
    read.mockResolvedValue(ok(menu([])));
    await open();
    expect(screen.getByTestId("empty-primary")).toBeInTheDocument();
    expect(screen.getByTestId("empty-secondary")).toBeInTheDocument();
    await userEvent.click(btn("add-root-primary"));
    expect(within(screen.getByTestId("group-primary")).getByText("Mục mới")).toBeInTheDocument();
  });

  it("editing marks the screen as unsaved with a count, and Cancel brings the loaded menu back without any request", async () => {
    await open();
    await select("faq");
    await userEvent.clear(screen.getByTestId("label-vi"));
    await userEvent.type(screen.getByTestId("label-vi"), "Hỏi đáp");
    expect(screen.getByTestId("menu-state")).toHaveTextContent("Có thay đổi chưa lưu — thêm 0, sửa 1, xoá 0");
    expect(within(screen.getByTestId("select-faq")).getByText("Hỏi đáp")).toBeInTheDocument();
    await userEvent.click(btn("menu-cancel"));
    expect(within(screen.getByTestId("select-faq")).getByText("FAQ")).toBeInTheDocument();
    expect(screen.getByTestId("menu-state")).toHaveTextContent("Đã lưu");
    expect(save).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("position: buttons, never a state the server would refuse", () => {
  it("moves an entry up and down, in and out, and to the other group, with its sub-entries", async () => {
    await open();
    await select("blog");
    await press("move-up");
    const rootsOrder = () => within(screen.getByTestId("group-primary")).getAllByTestId(/^select-/).map((node) => node.getAttribute("data-testid")!.replace("select-", ""));
    expect(rootsOrder()).toEqual(["blog", "blog-all", "blog-news", "riverside", "faq"]);
    expect(screen.getByTestId("move-in")).toBeDisabled();             // blog is first: nothing above it to go into
    expect(screen.getByTestId("move-up")).toBeDisabled();
    await select("faq");
    await press("move-in");                                           // FAQ becomes the last child of Riverside
    expect(within(screen.getByTestId("node-riverside")).getByTestId("select-faq")).toBeInTheDocument();
    await press("move-out");
    expect(within(screen.getByTestId("group-primary")).getByTestId("node-faq")).toBeInTheDocument();
    await press("move-group");
    expect(within(screen.getByTestId("group-secondary")).getByTestId("select-faq")).toBeInTheDocument();
  });

  it("refuses a fifth level instead of building it", async () => {
    const deep = canonical([
      item("a", null, "A"), item("b", "a", "B"), item("c", "b", "C"), item("d", "c", "D"),   // a > b > c > d: four levels
      item("c2", "b", "C2"), item("c21", "c2", "C21"),                                        // c2 (with a child) beside c
    ]);
    read.mockResolvedValue(ok(menu(deep)));
    await open();
    await select("d");
    expect(screen.getByTestId("add-child")).toBeDisabled();          // level 4: no sub-entry under it
    await select("c2");
    await press("move-in");                                           // under c it would be level 4, its child level 5
    expect(screen.getByTestId("menu-move-note")).toHaveTextContent("tối đa 4 cấp");
    expect(within(screen.getByTestId("node-b")).getByTestId("select-c2")).toBeInTheDocument();
    expect(within(screen.getByTestId("node-c")).queryByTestId("select-c2")).toBeNull();
  });

  it("an entry that still has sub-entries is not deleted; the message says how many; a leaf is", async () => {
    await open();
    await select("blog");
    await press("remove-item");
    expect(screen.getByTestId("menu-move-note")).toHaveTextContent("2 mục con");
    expect(screen.getByTestId("select-blog")).toBeInTheDocument();
    expect(screen.getByTestId("select-blog-news")).toBeInTheDocument();
    await select("blog-news");
    await press("remove-item");
    expect(screen.queryByTestId("select-blog-news")).toBeNull();
    expect(screen.getByTestId("menu-state")).toHaveTextContent("xoá 1");
  });
});

describe("Save", () => {
  it("is refused on screen for a bad link or a missing required label, with the reason beside the field, and sends nothing", async () => {
    await open();
    await select("faq");
    await userEvent.clear(href());
    await userEvent.type(href(), "javascript:alert(1)");
    await press("menu-save");
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText(/Dùng đường dẫn bắt đầu bằng \//)).toBeInTheDocument();
    expect(screen.getByTestId("menu-blocking")).toHaveTextContent("Còn 1 mục");
    await userEvent.clear(screen.getByTestId("label-vi"));
    expect(screen.getByText(/Nhập nhãn vi/)).toBeInTheDocument();
  });

  it("sends the whole tree once with the loaded revision, however many times Save is clicked, then shows the new state", async () => {
    const gate = deferred<ReturnType<typeof ok<WebsiteMenu>>>();
    save.mockReturnValueOnce(gate.promise);
    await open();
    await select("faq");
    await userEvent.clear(href());
    await userEvent.type(href(), "/faq?ref=menu");
    const button = btn("menu-save");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("write-pending")).toBeInTheDocument();
    expect(save.mock.calls[0][0]).toBe("rev-1");
    expect(sentItems().map((entry) => entry.id)).toEqual(ITEMS.map((entry) => entry.id));
    expect(sentItems().find((entry) => entry.id === "faq")?.href).toBe("/faq?ref=menu");

    const saved = menu(ITEMS.map((entry) => (entry.id === "faq" ? { ...entry, href: "/faq?ref=menu" } : entry)), { revision: "rev-2", version: 2 });
    gate.resolve(ok(saved));
    expect(await screen.findByTestId("website-success")).toHaveTextContent("Đã lưu");
    expect(screen.getByTestId("menu-state")).toHaveTextContent("phiên bản 2");
    expect(btn("menu-save")).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a server refusal that names a field selects that entry and shows the reason beside the field; the draft is untouched", async () => {
    save.mockResolvedValueOnce(refused(400, "menu-url-invalid", "items[4].href"));
    await open();
    await select("riverside");
    await userEvent.clear(href());
    await userEvent.type(href(), "/ok");
    await select("faq");
    await userEvent.clear(href());
    await userEvent.type(href(), "/ok-too");
    await press("menu-save");
    await screen.findByTestId("write-refused");
    expect(screen.getByTestId("select-faq")).toHaveAttribute("aria-current", "true");
    expect(href().value).toBe("/ok-too");
    expect(screen.getByTestId("menu-state")).toHaveTextContent("Có thay đổi chưa lưu");
  });
});

describe("two editors: a stale revision keeps the draft", () => {
  it("shows the refusal, keeps what was typed, loads the latest on request and then saves on top of it with the new revision", async () => {
    save.mockResolvedValueOnce(refused(409, "stale-version"));
    await open();
    await select("faq");
    await userEvent.clear(screen.getByTestId("label-vi"));
    await userEvent.type(screen.getByTestId("label-vi"), "Hỏi đáp");
    await press("menu-save");
    expect(await screen.findByTestId("write-refused")).toHaveTextContent("Chưa có gì được lưu");
    expect((screen.getByTestId("label-vi") as HTMLInputElement).value).toBe("Hỏi đáp");

    read.mockResolvedValueOnce(ok(menu(ITEMS, { revision: "rev-9", version: 9 })));
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("Bản nháp của bạn được giữ nguyên");
    expect((screen.getByTestId("label-vi") as HTMLInputElement).value).toBe("Hỏi đáp");

    save.mockResolvedValueOnce(ok(menu(ITEMS, { revision: "rev-10", version: 10 })));
    await press("menu-save");
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toBe("rev-9");
  });
});

describe("a lost answer is never retried and is checked against the server", () => {
  const lost = { kind: "unverified" as const, message: "Máy chủ Admin không trả lời, nên thay đổi có thể đã hoặc chưa được lưu." };

  async function editAndLose() {
    save.mockResolvedValueOnce(lost);
    await open();
    await select("faq");
    await userEvent.clear(href());
    await userEvent.type(href(), "/faq?x=1");
    await press("menu-save");
    await screen.findByTestId("write-unverified");
  }

  it("blocks sending again; when the server did store it, says so and does not save a second time", async () => {
    await editAndLose();
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("website-success")).toBeNull();
    expect(btn("menu-save")).toBeDisabled();

    const stored = ITEMS.map((entry) => (entry.id === "faq" ? { ...entry, href: "/faq?x=1" } : entry));
    read.mockResolvedValueOnce(ok(menu(stored, { revision: "rev-2", version: 2 })));
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("đúng một lần");
    expect(screen.getByTestId("menu-state")).toHaveTextContent("Đã lưu — phiên bản 2");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("when the server does not have it, keeps the draft and sends nothing by itself", async () => {
    await editAndLose();
    read.mockResolvedValueOnce(ok(menu()));
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("chưa có thay đổi vừa gửi");
    expect(href().value).toBe("/faq?x=1");
    expect(screen.getByTestId("menu-state")).toHaveTextContent("Có thay đổi chưa lưu");
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("the preview and the leave guard", () => {
  it("previews what a visitor sees in the chosen language: disabled entries and their branch are gone, a missing label falls back", async () => {
    read.mockResolvedValue(ok(menu(ITEMS.map((entry) => (entry.id === "faq" ? { ...entry, labels: { vi: "FAQ", en: null, fr: null } } : entry)))));
    await open();
    await select("blog");
    await userEvent.click(screen.getByLabelText("Hiển thị trên website"));
    const preview = within(screen.getByTestId("preview-primary"));
    expect(preview.queryByText("Blog")).toBeNull();
    expect(preview.queryByText("Tất cả")).toBeNull();
    await userEvent.selectOptions(screen.getByTestId("preview-locale"), "en");
    expect(preview.getByText("Riverside EN")).toBeInTheDocument();
    expect(preview.getByText("FAQ")).toBeInTheDocument();          // no en label: the default language's text
  });

  it("asks before following a link while there are unsaved changes, and not otherwise", async () => {
    const link = document.createElement("a");
    link.href = "/calendar";
    link.textContent = "Calendar";
    document.body.appendChild(link);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const jsdomNavigation = vi.spyOn(console, "error").mockImplementation(() => undefined);   // jsdom cannot navigate and says so
    await open();
    expect(fireEvent.click(link)).toBe(true);                       // nothing to lose yet: the click goes through
    expect(confirm).not.toHaveBeenCalled();
    await select("faq");
    await userEvent.type(screen.getByTestId("label-vi"), "!");
    expect(fireEvent.click(link)).toBe(false);                      // the operator said no: the click is cancelled
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    expect(fireEvent.click(link)).toBe(true);                       // the operator said yes
    expect(confirm).toHaveBeenCalledTimes(2);
    link.remove();
    confirm.mockRestore();
    jsdomNavigation.mockRestore();
  });

  it("a failed re-read does not throw the draft away", async () => {
    save.mockResolvedValueOnce(refused(409, "stale-version"));
    await open();
    await select("faq");
    await userEvent.type(screen.getByTestId("label-vi"), "!");
    await press("menu-save");
    read.mockResolvedValueOnce({ kind: "network", message: "Không kết nối được." });
    await userEvent.click(await screen.findByTestId("reload-latest"));
    expect(await screen.findByTestId("menus-read-error")).toBeInTheDocument();
    expect((screen.getByTestId("label-vi") as HTMLInputElement).value).toBe("FAQ!");
  });
});
