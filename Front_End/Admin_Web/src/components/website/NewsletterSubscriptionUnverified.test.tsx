/**
 * BHA-NEWSLETTER-003-C2 (F3): after a write whose outcome is unknown (timeout, 5xx, an unreadable success — the client reports all three as `unverified`) the screen
 * sends NOTHING more until the server has been read again successfully. The lock is in the write hook (a direct submit, Enter or a fast second click cannot get past it)
 * and in the screen (closing and reopening a dialog does not lift it). Only a successful read of the screen's own query lifts it; a failed or superseded read does not.
 */
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { useWriteAction } from "./useWebsiteData";
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
  type WebsiteResult,
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
const page = (items: NewsletterSubscription[]): NewsletterSubscriptionPage => ({ items, page: 1, pageSize: 20, total: items.length });
const click = async (testId: string) => userEvent.click(within(screen.getByTestId(testId)).getByRole("button"));
const isDisabled = (testId: string) => (within(screen.getByTestId(testId)).getByRole("button") as HTMLButtonElement).disabled;
const lost = (message = "Máy chủ Admin không trả lời.") => ({ kind: "unverified" as const, message }) as never;
const refused = (code: string, status = 409) => ({ kind: "refused" as const, status, code, field: null, detail: code }) as never;

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

/** Opens the dialog of one kind and sends its write once; every send of that kind answers "unknown". */
const startLost = async (kind: "add" | "edit" | "archive" | "invite") => {
  if (kind === "add") {
    create.mockResolvedValue(lost());
    await click("newsletter-add");
    await userEvent.type(await screen.findByTestId("newsletter-add-email"), "new@example.com");
    await click("newsletter-add-submit");
    return create;
  }
  if (kind === "edit") {
    update.mockResolvedValue(lost());
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    return update;
  }
  if (kind === "archive") {
    archive.mockResolvedValue(lost());
    await click("newsletter-archive-a@example.com");
    await click("newsletter-archive-confirm");
    return archive;
  }
  invite.mockResolvedValue(lost());
  await click("newsletter-invite-a@example.com");
  return invite;
};

const everyWriteControlIsLocked = () => {
  for (const id of ["newsletter-add", "newsletter-edit-a@example.com", "newsletter-invite-a@example.com", "newsletter-unsubscribe-a@example.com", "newsletter-archive-a@example.com", "newsletter-delete-a@example.com"]) {
    const control = screen.queryByTestId(id);
    if (control) expect(isDisabled(id), id).toBe(true);
  }
};

describe("after a write whose outcome is unknown", () => {
  it.each(["add", "edit", "archive", "invite"] as const)("%s: nothing more is sent, however it is tried, and the screen asks to read the server", async (kind) => {
    await open();
    const write = await startLost(kind);
    expect(await screen.findByTestId("newsletter-write-unverified")).toBeTruthy();
    expect(write).toHaveBeenCalledTimes(1);

    // The way to the server again is the read, and the button for it is there.
    expect(screen.getByTestId("newsletter-reconcile")).toBeTruthy();
    if (kind === "add") {
      const form = screen.getByTestId("newsletter-add-dialog").querySelector("form")!;
      fireEvent.submit(form);                                                       // Enter, or a direct submit
      fireEvent.submit(form);
      await userEvent.type(screen.getByTestId("newsletter-add-email"), "{Enter}");
    } else if (kind === "edit") {
      fireEvent.submit(screen.getByTestId("newsletter-edit-dialog").querySelector("form")!);
      expect(isDisabled("newsletter-edit-submit")).toBe(true);
    } else if (kind === "archive") {
      expect(isDisabled("newsletter-archive-confirm")).toBe(true);
      await click("newsletter-archive-confirm");
    }
    await act(async () => { await Promise.resolve(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(create.mock.calls.length + update.mock.calls.length + archive.mock.calls.length + invite.mock.calls.length).toBe(1);
  });

  it("stays locked when the dialog is closed and opened again", async () => {
    await open();
    await startLost("edit");
    await screen.findByTestId("newsletter-write-unverified");
    await click("newsletter-edit-cancel");
    expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull();

    // The screen itself says it, and offers the read; nothing that writes can be opened.
    expect(screen.getByTestId("newsletter-write-unverified")).toBeTruthy();
    everyWriteControlIsLocked();
    await userEvent.click(within(screen.getByTestId("newsletter-row-a@example.com")).getByText("Sửa"));
    expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull();
    await userEvent.click(within(screen.getByTestId("newsletter-add")).getByRole("button"));
    expect(screen.queryByTestId("newsletter-add-dialog")).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("is not unlocked by a read that is still on its way, nor by one that failed; only a successful read lifts it", async () => {
    await open();
    await startLost("edit");
    await screen.findByTestId("newsletter-write-unverified");

    const slow = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(slow.promise as never);
    await userEvent.click(screen.getByTestId("newsletter-reconcile"));
    expect(isDisabled("newsletter-edit-submit")).toBe(true);
    fireEvent.submit(screen.getByTestId("newsletter-edit-dialog").querySelector("form")!);
    expect(update).toHaveBeenCalledTimes(1);

    slow.resolve({ kind: "network", message: "Không kết nối được máy chủ." } as never);
    expect(await screen.findByTestId("newsletter-reconcile-failed")).toBeTruthy();
    expect(screen.getByTestId("newsletter-write-unverified")).toBeTruthy();
    fireEvent.submit(screen.getByTestId("newsletter-edit-dialog").querySelector("form")!);
    expect(update).toHaveBeenCalledTimes(1);

    // The way back is still there, and a successful read lifts the lock.
    list.mockResolvedValueOnce(ok(page([row("a@example.com", { language: "en", version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-reconcile"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull());
    expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull();           // the dialog held the old row: it is closed, not reused
    expect(isDisabled("newsletter-add")).toBe(false);
  });

  it("is not unlocked by a read that a newer request replaced", async () => {
    await open();
    await startLost("archive");
    await screen.findByTestId("newsletter-write-unverified");

    const first = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    const second = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(first.promise as never).mockReturnValueOnce(second.promise as never);
    await userEvent.click(screen.getByTestId("newsletter-reconcile"));
    await userEvent.selectOptions(screen.getByTestId("newsletter-status-filter"), "Verified");    // a newer read of the list takes over
    first.resolve(ok(page([row("a@example.com")])) as never);
    second.resolve(ok(page([])) as never);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    await screen.findByTestId("newsletter-empty");
    expect(screen.getByTestId("newsletter-write-unverified")).toBeTruthy();
    expect(isDisabled("newsletter-add")).toBe(true);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("after the read, the row comes from the server: its version is the new one", async () => {
    await open();
    await startLost("edit");                                                        // the server in fact applied it: version 5, English
    await screen.findByTestId("newsletter-write-unverified");
    list.mockResolvedValueOnce(ok(page([row("a@example.com", { language: "en", version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-reconcile"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull());

    update.mockReset();
    update.mockResolvedValue(ok(row("a@example.com", { language: "fr", version: 6 })) as never);
    await click("newsletter-edit-a@example.com");
    expect(((await screen.findByTestId("newsletter-language")) as HTMLSelectElement).value).toBe("en");
    await userEvent.selectOptions(screen.getByTestId("newsletter-language"), "fr");
    await click("newsletter-edit-submit");
    await waitFor(() => expect(update).toHaveBeenCalledWith("id-a@example.com", { expectedVersion: 5, language: "fr" }));
  });

  it("keeps the search, the filters and the page, and does not claim a row that left the list was deleted", async () => {
    await open([row("a@example.com"), row("b@example.com")]);
    await userEvent.type(screen.getByTestId("newsletter-search"), "example");
    await click("newsletter-search-submit");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "example" }), expect.anything()));
    await startLost("edit");
    await screen.findByTestId("newsletter-write-unverified");

    list.mockClear();
    list.mockResolvedValueOnce(ok(page([row("b@example.com")])) as never);
    await userEvent.click(screen.getByTestId("newsletter-reconcile"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull());
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ search: "example", status: "", scope: "active", page: 1, pageSize: 20, sort: "recent-activity" }, expect.anything());
    expect((screen.getByTestId("newsletter-search") as HTMLInputElement).value).toBe("example");
    const notice = screen.getByTestId("newsletter-notice").textContent ?? "";
    expect(notice).toContain("bộ lọc");
    expect(notice).not.toMatch(/đã (bị )?xóa/i);
    expect(screen.queryByTestId("newsletter-row-a@example.com")).toBeNull();
  });
});

describe("a refusal that is certain does not lock", () => {
  it("a validation refusal lets Staff correct it and send again", async () => {
    await open();
    create.mockResolvedValueOnce(refused("newsletter-email-invalid", 400));
    await click("newsletter-add");
    await userEvent.type(await screen.findByTestId("newsletter-add-email"), "oops");
    await click("newsletter-add-submit");
    await screen.findByTestId("newsletter-write-refused");
    expect(isDisabled("newsletter-add-submit")).toBe(false);
    create.mockResolvedValueOnce(ok(row("fixed@example.com", { source: "admin" })) as never);
    await userEvent.clear(screen.getByTestId("newsletter-add-email"));
    await userEvent.type(screen.getByTestId("newsletter-add-email"), "fixed@example.com");
    await click("newsletter-add-submit");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull();
  });

  it("a version conflict is certain, not unknown: no hold on the screen, and the way on is to read the list again (C3)", async () => {
    await open();
    update.mockResolvedValueOnce(refused("newsletter-version-conflict"));
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-reload-latest");
    expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull();
    expect(isDisabled("newsletter-add")).toBe(false);                               // nothing else is held; only the stale row is
    list.mockResolvedValueOnce(ok(page([row("a@example.com", { language: "en", version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull());
    update.mockResolvedValueOnce(ok(row("a@example.com", { language: "fr", version: 6 })) as never);
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "fr");
    await click("newsletter-edit-submit");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith("id-a@example.com", { expectedVersion: 5, language: "fr" });
  });

  it("a write that answered with an error, not an unknown, does not lock either", async () => {
    await open();
    update.mockResolvedValueOnce({ kind: "error", message: "Máy chủ báo lỗi." } as never);
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-write-failed");
    expect(isDisabled("newsletter-edit-submit")).toBe(false);
  });
});

describe("the write hook", () => {
  const Probe = ({ onHook, hold = true }: { onHook: (hook: ReturnType<typeof useWriteAction>) => void; hold?: boolean }) => {
    const hook = useWriteAction(hold ? { holdWhenUnverified: true } : undefined);
    onHook(hook);
    return <span data-testid="phase">{hook.status.phase}{hook.held ? "-held" : ""}</span>;
  };

  it("refuses every run after an unknown outcome until it is released, and reset does not release it", async () => {
    const send = vi.fn(async () => ({ kind: "unverified", message: "lost" }) as never);
    let hook!: ReturnType<typeof useWriteAction>;
    renderInGate(<Probe onHook={(h) => { hook = h; }} />, "/website/newsletter");
    await screen.findByTestId("phase");

    await act(async () => { await hook.run(send); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("phase").textContent).toBe("unverified-held");
    let second: unknown = "not-called";
    await act(async () => { second = await hook.run(send); });
    expect(second).toBeNull();
    act(() => hook.reset());
    expect(screen.getByTestId("phase").textContent).toBe("unverified-held");
    await act(async () => { await Promise.all([hook.run(send), hook.run(send)]); });
    expect(send).toHaveBeenCalledTimes(1);

    act(() => hook.release());
    expect(screen.getByTestId("phase").textContent).toBe("idle");
    await act(async () => { await hook.run(async () => ok(1) as never); });
    expect(screen.getByTestId("phase").textContent).toBe("idle");
  });

  it("is unchanged for a caller that does not ask for the hold", async () => {
    const send = vi.fn(async () => ({ kind: "unverified", message: "lost" }) as never);
    let hook!: ReturnType<typeof useWriteAction>;
    renderInGate(<Probe hold={false} onHook={(h) => { hook = h; }} />, "/website/newsletter");
    await screen.findByTestId("phase");
    await act(async () => { await hook.run(send); });
    await act(async () => { await hook.run(send); });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
