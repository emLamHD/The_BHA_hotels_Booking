/**
 * BHA-NEWSLETTER-003-C3: a version conflict is a CERTAIN refusal (nothing was applied), and the dialog that got it holds a row it now knows is stale. The only way on is to read the
 * list again; a successful read closes that dialog and the row is opened again from the fresh list, so the next write carries the version the server has. A read that fails or is
 * replaced, or a dialog closed before the read, changes nothing: the stale row stays locked and nothing is sent with the old version.
 */
import React from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

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
const conflict = () => ({ kind: "refused" as const, status: 409, code: "newsletter-version-conflict", field: null, detail: "stale" }) as never;
const mutations = () => [create, update, invite, unsubscribe, archive, restore, remove].reduce((sum, mock) => sum + mock.mock.calls.length, 0);

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const mock of [list, create, update, invite, unsubscribe, archive, restore, remove]) mock.mockReset();
});
afterEach(cleanup);

const open = async (rows: NewsletterSubscription[]) => {
  list.mockResolvedValue(ok(page(rows)) as never);
  renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
  await screen.findByTestId(`newsletter-row-${rows[0].email}`);
};

type Kind = "unsubscribe" | "archive" | "restore" | "delete";
type Send = Mock<(id: string, expectedVersion: number) => Promise<unknown>>;
const CONFIRMS: Array<[Kind, Send, Partial<NewsletterSubscription>]> = [
  ["unsubscribe", unsubscribe as unknown as Send, {}],
  ["archive", archive as unknown as Send, {}],
  ["restore", restore as unknown as Send, { archivedAtUtc: "2026-11-17T00:00:00+00:00" }],
  ["delete", remove as unknown as Send, {}],
];

describe("edit", () => {
  it("a conflict closes nothing by itself, sends nothing with the old version, and the read closes the dialog; reopened, the save carries the server's version", async () => {
    await open([row("a@example.com")]);                                                       // opened on version 4
    update.mockResolvedValueOnce(conflict());
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");

    const banner = await screen.findByTestId("newsletter-write-refused");
    expect(banner.textContent).toContain("đã thay đổi");
    expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull();                   // a certain refusal, not a lost answer
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith("id-a@example.com", { expectedVersion: 4, language: "en" });
    expect(isDisabled("newsletter-edit-submit")).toBe(true);                                  // the snapshot is known to be stale: no second send with it
    fireEvent.submit(screen.getByTestId("newsletter-edit-dialog").querySelector("form")!);
    expect(update).toHaveBeenCalledTimes(1);

    list.mockResolvedValueOnce(ok(page([row("a@example.com", { language: "fr", version: 5 })])) as never);       // someone else changed it: version 5
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull());
    expect(screen.getByTestId("newsletter-notice").textContent).toContain("mở lại");
    expect(update).toHaveBeenCalledTimes(1);                                                  // nothing was sent again by itself

    update.mockResolvedValueOnce(ok(row("a@example.com", { language: "en", version: 6 })) as never);
    await click("newsletter-edit-a@example.com");
    expect(((await screen.findByTestId("newsletter-language")) as HTMLSelectElement).value).toBe("fr");     // the server's value, not the old snapshot
    await userEvent.selectOptions(screen.getByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith("id-a@example.com", { expectedVersion: 5, language: "en" });
  });
});

describe.each(CONFIRMS)("%s", (kind, send, overrides) => {
  it("a conflict locks the confirmation, the read closes it, and the reopened one sends the server's version", async () => {
    await open([row("a@example.com", overrides)]);
    send.mockResolvedValueOnce(conflict());
    await click(`newsletter-${kind}-a@example.com`);
    await click(`newsletter-${kind}-confirm`);
    await screen.findByTestId("newsletter-write-refused");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith("id-a@example.com", 4);
    expect(isDisabled(`newsletter-${kind}-confirm`)).toBe(true);
    await click(`newsletter-${kind}-confirm`);
    expect(send).toHaveBeenCalledTimes(1);

    list.mockResolvedValueOnce(ok(page([row("a@example.com", { ...overrides, version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));
    await waitFor(() => expect(screen.queryByTestId(`newsletter-${kind}-dialog`)).toBeNull());
    expect(send).toHaveBeenCalledTimes(1);

    send.mockResolvedValueOnce(ok(row("a@example.com")) as never);
    await click(`newsletter-${kind}-a@example.com`);
    await click(`newsletter-${kind}-confirm`);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith("id-a@example.com", 5);
  });
});

describe("while the list is read again", () => {
  const conflictOnEdit = async () => {
    await open([row("a@example.com")]);
    update.mockResolvedValue(conflict());
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-reload-latest");
  };

  it("nothing is sent during the read or after it failed, and trying again can still succeed", async () => {
    await conflictOnEdit();
    const slow = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(slow.promise as never);
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));
    expect(isDisabled("newsletter-edit-submit")).toBe(true);
    fireEvent.submit(screen.getByTestId("newsletter-edit-dialog").querySelector("form")!);
    expect(mutations()).toBe(1);

    slow.resolve({ kind: "network", message: "Không kết nối được máy chủ." } as never);
    expect(await screen.findByTestId("newsletter-reload-failed")).toBeTruthy();
    expect(screen.getByTestId("newsletter-edit-dialog")).toBeTruthy();                        // a failed read recovers nothing
    expect(isDisabled("newsletter-edit-submit")).toBe(true);
    fireEvent.submit(screen.getByTestId("newsletter-edit-dialog").querySelector("form")!);
    expect(mutations()).toBe(1);

    list.mockResolvedValueOnce(ok(page([row("a@example.com", { version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));                    // the way back is still there
    await waitFor(() => expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull());
    expect(mutations()).toBe(1);
  });

  it("a read replaced by a newer one is not a recovery: the dialog stays and stays locked", async () => {
    await conflictOnEdit();
    const first = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    const second = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(first.promise as never).mockReturnValueOnce(second.promise as never);
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));
    await userEvent.selectOptions(screen.getByTestId("newsletter-status-filter"), "Verified");   // a newer read of the list takes over
    first.resolve(ok(page([row("a@example.com", { version: 5 })])) as never);
    second.resolve(ok(page([row("a@example.com", { version: 5 })])) as never);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    await screen.findByTestId("newsletter-reload-failed");
    expect(screen.getByTestId("newsletter-edit-dialog")).toBeTruthy();
    expect(isDisabled("newsletter-edit-submit")).toBe(true);
    expect(mutations()).toBe(1);
  });

  it("the search, the filters and the page are the ones that are read again", async () => {
    await open([row("a@example.com"), row("b@example.com")]);
    await userEvent.type(screen.getByTestId("newsletter-search"), "example");
    await click("newsletter-search-submit");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "example" }), expect.anything()));
    await userEvent.selectOptions(screen.getByTestId("newsletter-scope-filter"), "all");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "all" }), expect.anything()));
    update.mockResolvedValueOnce(conflict());
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-reload-latest");

    list.mockClear();
    list.mockResolvedValueOnce(ok(page([row("a@example.com", { version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull());
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ search: "example", status: "", scope: "all", page: 1, pageSize: 20 }, expect.anything());
    expect((screen.getByTestId("newsletter-search") as HTMLInputElement).value).toBe("example");
    expect((screen.getByTestId("newsletter-scope-filter") as HTMLSelectElement).value).toBe("all");
  });
});

describe("after the read", () => {
  it("a row that is no longer in the filter has no action left, and nothing says it was deleted", async () => {
    await open([row("a@example.com"), row("b@example.com")]);
    unsubscribe.mockResolvedValueOnce(conflict());
    await click("newsletter-unsubscribe-a@example.com");
    await click("newsletter-unsubscribe-confirm");
    await screen.findByTestId("newsletter-reload-latest");

    list.mockResolvedValueOnce(ok(page([row("b@example.com")])) as never);                    // a@ now fails the filter (or is gone: the screen cannot tell)
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-unsubscribe-dialog")).toBeNull());
    expect(screen.queryByTestId("newsletter-row-a@example.com")).toBeNull();
    expect(screen.queryByTestId("newsletter-unsubscribe-a@example.com")).toBeNull();
    expect(screen.getByTestId("newsletter-notice").textContent).not.toMatch(/đã (bị )?xóa/i);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(isDisabled("newsletter-edit-b@example.com")).toBe(false);                         // the other rows are untouched
  });

  it("a dialog closed before the read does not let the stale row be used again until the list has been read", async () => {
    await open([row("a@example.com"), row("b@example.com")]);
    update.mockResolvedValue(conflict());
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-reload-latest");
    await click("newsletter-edit-cancel");
    expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull();

    // The table still holds a@ as it was (version 4): its actions are locked and the screen offers the read; the other row is free.
    for (const id of ["newsletter-edit-a@example.com", "newsletter-invite-a@example.com", "newsletter-unsubscribe-a@example.com", "newsletter-archive-a@example.com", "newsletter-delete-a@example.com"]) {
      expect(isDisabled(id), id).toBe(true);
    }
    expect(isDisabled("newsletter-edit-b@example.com")).toBe(false);
    await userEvent.click(within(screen.getByTestId("newsletter-row-a@example.com")).getByText("Sửa"));
    expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);

    list.mockResolvedValueOnce(ok(page([row("a@example.com", { version: 5 }), row("b@example.com")])) as never);
    await userEvent.click(screen.getByTestId("newsletter-stale-reload"));
    await waitFor(() => expect(isDisabled("newsletter-edit-a@example.com")).toBe(false));

    update.mockReset();
    update.mockResolvedValueOnce(ok(row("a@example.com", { language: "en", version: 6 })) as never);
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await waitFor(() => expect(update).toHaveBeenCalledWith("id-a@example.com", { expectedVersion: 5, language: "en" }));
  });

  it("the C2 hold after a lost answer still works beside it", async () => {
    await open([row("a@example.com")]);
    update.mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ Admin không trả lời." } as never);
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-write-unverified");
    expect(screen.queryByTestId("newsletter-reload-latest")).toBeNull();                      // not a conflict: the other way back
    fireEvent.submit(screen.getByTestId("newsletter-edit-dialog").querySelector("form")!);
    expect(update).toHaveBeenCalledTimes(1);
    list.mockResolvedValueOnce(ok(page([row("a@example.com", { language: "en", version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-reconcile"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull());
  });
});
