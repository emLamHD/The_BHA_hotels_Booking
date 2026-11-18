/**
 * BHA-NEWSLETTER-003: what Staff do on the subscriber screen — add, edit, invite, unsubscribe, archive, restore, delete — against a mocked Admin API client.
 * Each change is sent once with the version of the row it was opened on; a refusal or a lost answer keeps the dialog and says why; and after a change the SAME query
 * is read again (the typed search and the filters stay).
 */
import React from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
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
  listNewsletterSubscriptions: vi.fn(),
  createNewsletterSubscription: vi.fn(),
  updateNewsletterSubscription: vi.fn(),
  inviteNewsletterSubscription: vi.fn(),
  unsubscribeNewsletterSubscription: vi.fn(),
  archiveNewsletterSubscription: vi.fn(),
  restoreNewsletterSubscription: vi.fn(),
  deleteNewsletterSubscription: vi.fn(),
}));

import NewsletterSubscriptionsPanel from "./NewsletterSubscriptionsPanel";
import { ALLOWED, deferred, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import {
  archiveNewsletterSubscription,
  createNewsletterSubscription,
  deleteNewsletterSubscription,
  inviteNewsletterSubscription,
  listNewsletterSubscriptions,
  restoreNewsletterSubscription,
  unsubscribeNewsletterSubscription,
  updateNewsletterSubscription,
  type NewsletterSubscription,
  type NewsletterSubscriptionPage,
} from "@/lib/api/website";

const list = vi.mocked(listNewsletterSubscriptions);
const create = vi.mocked(createNewsletterSubscription);
const update = vi.mocked(updateNewsletterSubscription);
const invite = vi.mocked(inviteNewsletterSubscription);
const unsubscribe = vi.mocked(unsubscribeNewsletterSubscription);
const archive = vi.mocked(archiveNewsletterSubscription);
const restore = vi.mocked(restoreNewsletterSubscription);
const remove = vi.mocked(deleteNewsletterSubscription);

const row = (email: string, overrides: Partial<NewsletterSubscription> = {}): NewsletterSubscription => ({
  id: `id-${email}`, email, receivedAtUtc: "2026-11-16T04:00:00+00:00", source: "homepage", status: "PendingVerification", verifiedAtUtc: null,
  language: "vi", version: 4, unsubscribedAtUtc: null, archivedAtUtc: null, verificationMail: null, ...overrides,
});
const page = (items: NewsletterSubscription[], overrides: Partial<NewsletterSubscriptionPage> = {}): NewsletterSubscriptionPage => ({ items, page: 1, pageSize: 20, total: items.length, ...overrides });
const query = (overrides: Record<string, unknown> = {}) => ({ search: "", status: "", scope: "active", page: 1, pageSize: 20, ...overrides });
const click = async (testId: string) => userEvent.click(within(screen.getByTestId(testId)).getByRole("button"));
const refused = (code: string, status = 409, extra: Record<string, unknown> = {}) => ({ kind: "refused" as const, status, code, field: null, detail: code, ...extra });

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const mock of [list, create, update, invite, unsubscribe, archive, restore, remove]) mock.mockReset();
});
afterEach(cleanup);

const open = async (rows = [row("a@example.com")]) => {
  list.mockResolvedValue(ok(page(rows)) as never);
  renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
  await screen.findByTestId(`newsletter-row-${rows[0].email}`);
};

describe("add", () => {
  it("adds one address once, says it is pending and that nothing was sent, and reads the list again", async () => {
    await open();
    create.mockResolvedValue(ok(row("new@example.com", { source: "admin" })) as never);
    await click("newsletter-add");
    const dialog = await screen.findByTestId("newsletter-add-dialog");
    expect(dialog.textContent).toContain("Chờ xác minh");
    expect(dialog.textContent).toContain("chưa có thư nào được gửi");
    expect((screen.getByTestId("newsletter-add-submit").querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByTestId("newsletter-add-email"), " new@example.com ");
    await userEvent.selectOptions(screen.getByTestId("newsletter-language"), "fr");
    await click("newsletter-add-submit");

    await waitFor(() => expect(screen.queryByTestId("newsletter-add-dialog")).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ email: "new@example.com", language: "fr" });
    expect(screen.getByTestId("newsletter-notice").textContent).toContain("new@example.com");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when the address is empty, and shows a refusal without closing the dialog", async () => {
    await open();
    create.mockResolvedValue(refused("newsletter-email-invalid", 400) as never);
    await click("newsletter-add");
    await userEvent.type(await screen.findByTestId("newsletter-add-email"), "not-an-email");
    await click("newsletter-add-submit");
    expect((await screen.findByTestId("newsletter-write-refused")).textContent).toContain("Địa chỉ email không hợp lệ");
    expect(screen.getByTestId("newsletter-add-dialog")).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("leads Staff to the existing row when the address is a duplicate, hidden or not", async () => {
    await open();
    create.mockResolvedValue(refused("newsletter-subscription-duplicate", 409, { existingId: "id-dup", existingArchived: true }) as never);
    await click("newsletter-add");
    await userEvent.type(await screen.findByTestId("newsletter-add-email"), "Dup@Example.com");
    await click("newsletter-add-submit");
    const link = await screen.findByTestId("newsletter-open-existing");
    expect(screen.getByTestId("newsletter-write-refused").textContent).toContain("đã có trong danh sách");
    list.mockResolvedValue(ok(page([row("dup@example.com", { archivedAtUtc: "2026-11-17T00:00:00+00:00" })])) as never);
    await userEvent.click(link);

    await screen.findByTestId("newsletter-row-dup@example.com");
    expect(screen.queryByTestId("newsletter-add-dialog")).toBeNull();
    expect(list).toHaveBeenLastCalledWith(query({ search: "dup@example.com", scope: "all" }), expect.anything());
    expect((screen.getByTestId("newsletter-search") as HTMLInputElement).value).toBe("dup@example.com");
  });
});

describe("edit", () => {
  it("sends only what changed with the version the row was opened on", async () => {
    await open([row("a@example.com", { status: "Verified", verifiedAtUtc: "2026-11-17T08:00:00+00:00" })]);
    update.mockResolvedValue(ok(row("a@example.com", { language: "en", version: 5 })) as never);
    await click("newsletter-edit-a@example.com");
    expect((await screen.findByTestId("newsletter-edit-dialog")).textContent).toContain("Sửa đăng ký");
    expect((screen.getByTestId("newsletter-edit-submit").querySelector("button") as HTMLButtonElement).disabled).toBe(true);        // nothing changed yet
    await userEvent.selectOptions(screen.getByTestId("newsletter-language"), "en");
    expect(screen.queryByTestId("newsletter-edit-email-warning")).toBeNull();
    await click("newsletter-edit-submit");

    await waitFor(() => expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("id-a@example.com", { expectedVersion: 4, language: "en" });
  });

  it("warns that a new address returns to pending and voids the old links, and sends the new address", async () => {
    await open([row("a@example.com", { status: "Verified", verifiedAtUtc: "2026-11-17T08:00:00+00:00" })]);
    update.mockResolvedValue(ok(row("b@example.com", { version: 5 })) as never);
    await click("newsletter-edit-a@example.com");
    const field = await screen.findByTestId("newsletter-edit-email");
    await userEvent.clear(field);
    await userEvent.type(field, "B@example.com");
    const warning = screen.getByTestId("newsletter-edit-email-warning");
    expect(warning.textContent).toContain("Chờ xác minh");
    expect(warning.textContent).toContain("vô hiệu mọi liên kết");
    expect(warning.textContent).toContain("hủy các thư đang chờ");
    await click("newsletter-edit-submit");
    await waitFor(() => expect(update).toHaveBeenCalledWith("id-a@example.com", { expectedVersion: 4, email: "B@example.com" }));
  });

  it("keeps the dialog and offers the latest list when the row changed meanwhile, and never sends again by itself", async () => {
    await open();
    update.mockResolvedValue(refused("newsletter-version-conflict") as never);
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "fr");
    await click("newsletter-edit-submit");

    expect((await screen.findByTestId("newsletter-write-refused")).textContent).toContain("đã thay đổi");
    expect(screen.getByTestId("newsletter-edit-dialog")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("says an unanswered write may or may not have been applied, and does not resend it", async () => {
    await open();
    update.mockResolvedValue({ kind: "unverified", message: "Máy chủ Admin không trả lời." } as never);
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    const lost = await screen.findByTestId("newsletter-write-unverified");
    expect(lost.textContent).toContain("không trả lời");
    expect(lost.textContent).toContain("không tự gửi lại");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("sends once however fast the button is pressed", async () => {
    await open();
    const pending = deferred<ReturnType<typeof ok>>();
    update.mockReturnValue(pending.promise as never);
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    const save = within(screen.getByTestId("newsletter-edit-submit")).getByRole("button");
    await userEvent.click(save);
    await userEvent.click(save);
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("newsletter-write-pending")).toBeTruthy();
    pending.resolve(ok(row("a@example.com", { language: "en", version: 5 })));
    await waitFor(() => expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull());
  });
});

describe("invite", () => {
  it("is offered only for a pending, visible address", async () => {
    await open([
      row("pending@example.com"),
      row("verified@example.com", { status: "Verified", verifiedAtUtc: "2026-11-17T08:00:00+00:00" }),
      row("stopped@example.com", { status: "Unsubscribed", unsubscribedAtUtc: "2026-11-17T08:00:00+00:00" }),
      row("hidden@example.com", { archivedAtUtc: "2026-11-17T08:00:00+00:00" }),
    ]);
    expect(screen.queryByTestId("newsletter-invite-pending@example.com")).not.toBeNull();
    for (const email of ["verified@example.com", "stopped@example.com", "hidden@example.com"]) expect(screen.queryByTestId(`newsletter-invite-${email}`)).toBeNull();
    // A stopped address cannot be stopped again; a hidden one is restored, not archived again.
    expect(screen.queryByTestId("newsletter-unsubscribe-stopped@example.com")).toBeNull();
    expect(screen.queryByTestId("newsletter-restore-hidden@example.com")).not.toBeNull();
    expect(screen.queryByTestId("newsletter-archive-hidden@example.com")).toBeNull();
  });

  it.each([
    [{ status: "queued", retryAfterSeconds: null }, "Đã xếp lời mời xác minh"],
    [{ status: "cooldown", retryAfterSeconds: 240 }, "thử lại sau khoảng 240 giây"],
    [{ status: "not-connected", retryAfterSeconds: null }, "Chưa kết nối Gmail"],
  ])("tells Staff what really happened: %j", async (answer, text) => {
    await open();
    invite.mockResolvedValue(ok({ ...answer, subscription: row("a@example.com") }) as never);
    await click("newsletter-invite-a@example.com");
    expect((await screen.findByTestId("newsletter-notice")).textContent).toContain(text);
    expect(invite).toHaveBeenCalledWith("id-a@example.com", 4);              // the version of the row on screen
    expect(invite).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("shows why an invitation was refused", async () => {
    await open();
    invite.mockResolvedValue(refused("newsletter-invite-not-pending") as never);
    await click("newsletter-invite-a@example.com");
    expect((await screen.findByTestId("newsletter-write-refused")).textContent).toContain("đang chờ xác minh");
  });
});

describe("unsubscribe, archive, restore and delete", () => {
  it.each([
    ["unsubscribe", unsubscribe, "Ngừng nhận", "không nhận email của The BHA", "Đã ngừng gửi cho"],
    ["archive", archive, "Lưu trữ", "ẩn khỏi danh sách mặc định", "Đã lưu trữ"],
    ["delete", remove, "Xóa", "Không thể hoàn tác", "Đã xóa vĩnh viễn"],
  ] as const)("%s names the address and the consequence, then sends once with the row's version", async (action, mock, _label, consequence, done) => {
    await open();
    mock.mockResolvedValue(ok(undefined) as never);
    await click(`newsletter-${action}-a@example.com`);
    const dialog = await screen.findByTestId(`newsletter-${action}-dialog`);
    expect(dialog.textContent).toContain("a@example.com");
    expect(dialog.textContent).toContain(consequence);
    expect(mock).not.toHaveBeenCalled();                    // opening the dialog changes nothing
    await click(`newsletter-${action}-confirm`);
    await waitFor(() => expect(screen.queryByTestId(`newsletter-${action}-dialog`)).toBeNull());
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith("id-a@example.com", 4);
    expect(screen.getByTestId("newsletter-notice").textContent).toContain(done);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("restores a hidden row", async () => {
    await open([row("a@example.com", { archivedAtUtc: "2026-11-17T08:00:00+00:00" })]);
    restore.mockResolvedValue(ok(undefined) as never);
    expect(within(screen.getByTestId("newsletter-row-a@example.com")).getByText("Đã lưu trữ")).toBeTruthy();
    await click("newsletter-restore-a@example.com");
    expect((await screen.findByTestId("newsletter-restore-dialog")).textContent).toContain("không được gửi lại");
    await click("newsletter-restore-confirm");
    await waitFor(() => expect(restore).toHaveBeenCalledWith("id-a@example.com", 4));
  });

  it("cancel closes a dialog without sending", async () => {
    await open();
    await click("newsletter-delete-a@example.com");
    await click("newsletter-delete-cancel");
    await waitFor(() => expect(screen.queryByTestId("newsletter-delete-dialog")).toBeNull());
    expect(remove).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("a delete of a row that is already gone is a refusal, not a silent success, and the dialog stays", async () => {
    await open();
    remove.mockResolvedValue(refused("newsletter-subscription-not-found", 404) as never);
    await click("newsletter-delete-a@example.com");
    await click("newsletter-delete-confirm");
    expect((await screen.findByTestId("newsletter-write-refused")).textContent).toContain("không còn tồn tại");
    expect(screen.getByTestId("newsletter-delete-dialog")).toBeTruthy();
  });

  it("a stale version on delete keeps the dialog and sends nothing again", async () => {
    await open();
    remove.mockResolvedValue(refused("newsletter-version-conflict") as never);
    await click("newsletter-delete-a@example.com");
    await click("newsletter-delete-confirm");
    expect((await screen.findByTestId("newsletter-write-refused")).textContent).toContain("đã thay đổi");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("the query survives a change", () => {
  it("keeps the typed search, the filters and the page when a row is changed", async () => {
    list.mockResolvedValue(ok(page([row("p2@example.com")], { total: 41, page: 2 })) as never);
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await screen.findByTestId("newsletter-row-p2@example.com");
    await userEvent.selectOptions(screen.getByTestId("newsletter-status-filter"), "PendingVerification");
    await userEvent.selectOptions(screen.getByTestId("newsletter-scope-filter"), "all");
    await userEvent.type(screen.getByTestId("newsletter-search"), "p2");
    await userEvent.click(within(screen.getByTestId("newsletter-search-submit")).getByRole("button"));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(query({ search: "p2", status: "PendingVerification", scope: "all" }), expect.anything()));
    await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(query({ search: "p2", status: "PendingVerification", scope: "all", page: 2 }), expect.anything()));

    archive.mockResolvedValue(ok(undefined) as never);
    await click("newsletter-archive-p2@example.com");
    await click("newsletter-archive-confirm");
    await waitFor(() => expect(screen.queryByTestId("newsletter-archive-dialog")).toBeNull());
    await waitFor(() => expect(list.mock.calls.filter((call) => call[0].page === 2).length).toBeGreaterThanOrEqual(2));
    expect(list).toHaveBeenLastCalledWith(query({ search: "p2", status: "PendingVerification", scope: "all", page: 2 }), expect.anything());
    expect((screen.getByTestId("newsletter-search") as HTMLInputElement).value).toBe("p2");
  });

  it("a filter change asks the server and goes back to page 1", async () => {
    list.mockResolvedValue(ok(page([row("a@example.com")], { total: 41 })) as never);
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await screen.findByTestId("newsletter-row-a@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(query({ page: 2 }), expect.anything()));
    await userEvent.selectOptions(screen.getByTestId("newsletter-scope-filter"), "archived");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(query({ scope: "archived", page: 1 }), expect.anything()));
  });

  it("after a delete that empties the last page, the existing way back to page 1 is offered", async () => {
    list.mockResolvedValueOnce(ok(page([row("only@example.com")], { total: 21, page: 2 })) as never);
    list.mockResolvedValue(ok(page([], { total: 20, page: 2 })) as never);
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await screen.findByTestId("newsletter-row-only@example.com");
    remove.mockResolvedValue(ok(undefined) as never);
    await click("newsletter-delete-only@example.com");
    await click("newsletter-delete-confirm");
    expect(await screen.findByTestId("newsletter-out-of-range")).toBeTruthy();
    expect(screen.getByTestId("newsletter-notice").textContent).toContain("Đã xóa vĩnh viễn");
  });
});
