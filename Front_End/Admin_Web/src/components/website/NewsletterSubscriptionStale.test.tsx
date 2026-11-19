/**
 * BHA-NEWSLETTER-003-C3: a version conflict is a CERTAIN refusal (nothing was applied), and the dialog that got it holds a row it now knows is stale. The only way on is to read the
 * list again; a successful read closes that dialog and the row is opened again from the fresh list, so the next write carries the version the server has. A read that fails or is
 * replaced, or a dialog closed before the read, changes nothing: the stale row stays locked and nothing is sent with the old version.
 */
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
const buttonOf = (testId: string) => {
  const node = screen.getByTestId(testId);
  return (node.tagName === "BUTTON" ? node : within(node).getByRole("button")) as HTMLButtonElement;   // ActionButton wraps its button; a banner link carries the id itself
};
const click = async (testId: string) => userEvent.click(buttonOf(testId));
const isDisabled = (testId: string) => buttonOf(testId).disabled;
const conflict = () => ({ kind: "refused" as const, status: 409, code: "newsletter-version-conflict", field: null, detail: "stale" }) as never;
const sleepTick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
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
    expect(list).toHaveBeenCalledWith({ search: "example", status: "", scope: "all", page: 1, pageSize: 20, sort: "recent-activity" }, expect.anything());
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

  it("a second stale row does not free the first one: both stay locked until one successful read", async () => {
    await open([row("a@example.com"), row("b@example.com")]);
    update.mockResolvedValue(conflict());
    for (const email of ["a@example.com", "b@example.com"]) {                                 // a@ conflicts and is closed unread; then b@ opens and conflicts too
      await click(`newsletter-edit-${email}`);
      await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
      await click("newsletter-edit-submit");
      await screen.findByTestId("newsletter-reload-latest");
      await click("newsletter-edit-cancel");
    }
    expect(update).toHaveBeenCalledTimes(2);
    for (const email of ["a@example.com", "b@example.com"]) expect(isDisabled(`newsletter-edit-${email}`), email).toBe(true);
    await userEvent.click(within(screen.getByTestId("newsletter-row-a@example.com")).getByText("Sửa"));
    expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull();
    expect(update).toHaveBeenCalledTimes(2);

    list.mockResolvedValueOnce(ok(page([row("a@example.com", { version: 5 }), row("b@example.com", { version: 7 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-stale-reload"));
    await waitFor(() => expect(isDisabled("newsletter-edit-a@example.com")).toBe(false));
    expect(isDisabled("newsletter-edit-b@example.com")).toBe(false);
  });

  it("a read pressed from the stale banner while a lost answer is still unknown keeps the unknown-outcome warning", async () => {
    await open([row("a@example.com"), row("b@example.com")]);
    update.mockResolvedValueOnce(conflict()).mockResolvedValueOnce({ kind: "unverified", message: "Máy chủ Admin không trả lời." } as never);
    await click("newsletter-edit-a@example.com");                                             // a@ conflicts, its dialog is closed unread
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-reload-latest");
    await click("newsletter-edit-cancel");
    await click("newsletter-edit-b@example.com");                                             // b@ then ends with an unknown outcome: the C2 hold
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-write-unverified");
    await click("newsletter-edit-cancel");
    expect(mutations()).toBe(2);

    list.mockResolvedValueOnce(ok(page([row("a@example.com", { version: 5 }), row("b@example.com", { version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-stale-reload"));
    await waitFor(() => expect(screen.getByTestId("newsletter-notice")).toBeTruthy());
    const notice = screen.getByTestId("newsletter-notice").textContent ?? "";
    expect(notice).toContain("chưa rõ kết quả");                                              // what the hold said is not lost to the conflict wording
    expect(notice).toContain("mở lại bản ghi");
    expect(mutations()).toBe(2);
    expect(isDisabled("newsletter-edit-a@example.com")).toBe(false);
  });

  it("another row cannot go stale while a read is in flight: it cannot be written then (C4 replaces the C3 case where it could)", async () => {
    await open([row("a@example.com"), row("b@example.com")]);
    update.mockResolvedValue(conflict());
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-reload-latest");
    const slow = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(slow.promise as never);
    await userEvent.click(screen.getByTestId("newsletter-reload-latest"));                    // the read of a@ is in flight
    await click("newsletter-edit-cancel");
    expect(isDisabled("newsletter-edit-b@example.com")).toBe(true);                           // b@ cannot be opened, so it cannot conflict while the read is out
    await userEvent.click(within(screen.getByTestId("newsletter-row-b@example.com")).getByText("Sửa"));
    expect(screen.queryByTestId("newsletter-edit-dialog")).toBeNull();

    slow.resolve(ok(page([row("a@example.com", { version: 5 }), row("b@example.com", { version: 4 })])) as never);
    await screen.findByTestId("newsletter-notice");
    expect(isDisabled("newsletter-edit-a@example.com")).toBe(false);
    expect(isDisabled("newsletter-edit-b@example.com")).toBe(false);
    expect(mutations()).toBe(1);
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

/**
 * BHA-NEWSLETTER-003-C4: a recovery read and a write never overlap. Once a read has started no write of this screen is sent until it ends; a read does not start while a write is on
 * the wire. The guard is a synchronous ref in the screen, so a callback taken from an earlier render, Enter, a direct submit or a second call in the same tick cannot get past it.
 * `propsOf` takes the handler React holds for a button BEFORE the other action starts, then calls it with no re-render in between.
 */
describe("a recovery read and a write do not overlap (C4)", () => {
  type Handlers = { onClick: () => void };
  const propsOf = (testId: string): Handlers => {
    const node = buttonOf(testId) as unknown as Record<string, unknown>;
    return node[Object.keys(node).find((key) => key.startsWith("__reactProps$"))!] as Handlers;
  };
  const queued = () => ok({ status: "queued", retryAfterSeconds: null }) as never;
  const lost = () => ({ kind: "unverified", message: "Máy chủ Admin không trả lời." }) as never;
  const fresh = () => ok(page([row("a@example.com", { version: 5 }), row("b@example.com", { version: 5 })])) as never;
  const INVITE_B = "newsletter-invite-b@example.com";
  const RELOAD = "newsletter-stale-reload";

  /** a@ got a version conflict and its dialog was closed unread: the stale banner is the way to the read. */
  const staleA = async (b: Partial<NewsletterSubscription> = {}) => {
    await open([row("a@example.com"), row("b@example.com", b)]);
    update.mockResolvedValueOnce(conflict());
    await click("newsletter-edit-a@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    await click("newsletter-edit-submit");
    await screen.findByTestId("newsletter-reload-latest");
    await click("newsletter-edit-cancel");
    await screen.findByTestId("newsletter-stale");
  };

  it("while the recovery read is out, another row's write sends nothing, and the buttons say so", async () => {
    await staleA();
    const heldCallback = propsOf(INVITE_B);                                                   // taken from the render before the read
    const slow = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(slow.promise as never);
    await userEvent.click(screen.getByTestId(RELOAD));
    expect(isDisabled(INVITE_B)).toBe(true);
    expect(isDisabled("newsletter-add")).toBe(true);
    expect(isDisabled("newsletter-edit-b@example.com")).toBe(true);

    invite.mockResolvedValue(lost());                                                          // if it got through, the answer would take the hold away again
    await act(async () => { heldCallback.onClick(); });
    expect(invite).not.toHaveBeenCalled();
    expect(mutations()).toBe(1);

    slow.resolve(fresh());
    await screen.findByTestId("newsletter-notice");
    expect(mutations()).toBe(1);                                                              // nothing was resent by itself
    expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull();
    invite.mockReset();
    invite.mockResolvedValueOnce(queued());
    await click(INVITE_B);                                                                    // writing works again once the read has ended
    await waitFor(() => expect(invite).toHaveBeenCalledTimes(1));
  });

  it("a recovery cannot start while a write is on the wire, and can once it has ended", async () => {
    await staleA();
    const heldReload = propsOf(RELOAD);
    const slowInvite = deferred<WebsiteResult<unknown>>();
    invite.mockReturnValueOnce(slowInvite.promise as never);
    await click(INVITE_B);
    const reads = list.mock.calls.length;
    expect(isDisabled(RELOAD)).toBe(true);
    await act(async () => { heldReload.onClick(); });
    expect(list.mock.calls.length).toBe(reads);                                               // no read started
    expect(screen.queryByText("Đang đọc lại…")).toBeNull();

    slowInvite.resolve(queued());
    await screen.findByTestId("newsletter-notice");
    await waitFor(() => expect(isDisabled(RELOAD)).toBe(false));
    list.mockResolvedValueOnce(fresh());
    await userEvent.click(screen.getByTestId(RELOAD));
    await waitFor(() => expect(screen.queryByTestId("newsletter-stale")).toBeNull());
    expect(isDisabled("newsletter-edit-a@example.com")).toBe(false);
  });

  it("in one tick, the write first: the read does not start", async () => {
    await staleA();
    const send = propsOf(INVITE_B);
    const read = propsOf(RELOAD);
    const slowInvite = deferred<WebsiteResult<unknown>>();
    invite.mockReturnValueOnce(slowInvite.promise as never);
    const reads = list.mock.calls.length;
    await act(async () => { send.onClick(); read.onClick(); });
    expect(invite).toHaveBeenCalledTimes(1);
    expect(list.mock.calls.length).toBe(reads);
    slowInvite.resolve(queued());
    await screen.findByTestId("newsletter-notice");
  });

  it("in one tick, the read first: the write is not sent", async () => {
    await staleA();
    const send = propsOf(INVITE_B);
    const read = propsOf(RELOAD);
    const slow = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(slow.promise as never);
    const reads = list.mock.calls.length;
    await act(async () => { read.onClick(); send.onClick(); });
    expect(list.mock.calls.length).toBe(reads + 1);
    expect(invite).not.toHaveBeenCalled();
    slow.resolve(fresh());
    await screen.findByTestId("newsletter-notice");
    expect(invite).not.toHaveBeenCalled();
  });

  it("a write that ended unknown keeps its hold through a failed recovery, and the next one restores it with both warnings", async () => {
    await staleA();
    invite.mockResolvedValueOnce(lost());
    await click(INVITE_B);
    await screen.findByTestId("newsletter-write-unverified");
    expect(mutations()).toBe(2);

    list.mockResolvedValueOnce({ kind: "network", message: "Không kết nối được máy chủ." } as never);
    await userEvent.click(screen.getByTestId(RELOAD));
    await screen.findByTestId("newsletter-stale-failed");
    expect(screen.getByTestId("newsletter-write-unverified")).toBeTruthy();                   // the hold is still there
    expect(isDisabled("newsletter-add")).toBe(true);
    expect(screen.getByTestId("newsletter-stale")).toBeTruthy();                              // the stale row is still locked (no table is shown after a failed read)
    expect(isDisabled(RELOAD)).toBe(false);                                                   // the way back is not lost
    expect(mutations()).toBe(2);

    list.mockResolvedValueOnce(fresh());
    await userEvent.click(screen.getByTestId(RELOAD));
    await screen.findByTestId("newsletter-notice");
    const notice = screen.getByTestId("newsletter-notice").textContent ?? "";
    expect(notice).toContain("chưa rõ kết quả");
    expect(notice).toContain("mở lại bản ghi");
    expect(isDisabled("newsletter-add")).toBe(false);
    expect(isDisabled("newsletter-edit-a@example.com")).toBe(false);
    expect(mutations()).toBe(2);
  });

  it("a recovery replaced by a newer read frees neither the hold nor the stale row", async () => {
    await staleA();
    invite.mockResolvedValueOnce(lost());
    await click(INVITE_B);
    await screen.findByTestId("newsletter-write-unverified");

    const first = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    const second = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(first.promise as never).mockReturnValueOnce(second.promise as never);
    await userEvent.click(screen.getByTestId(RELOAD));
    await userEvent.selectOptions(screen.getByTestId("newsletter-status-filter"), "Verified");   // a newer read takes over
    first.resolve(fresh());
    second.resolve(fresh());
    await screen.findByTestId("newsletter-stale-failed");
    expect(screen.getByTestId("newsletter-write-unverified")).toBeTruthy();
    expect(screen.getByTestId("newsletter-stale")).toBeTruthy();
    expect(isDisabled("newsletter-add")).toBe(true);
    expect(isDisabled(RELOAD)).toBe(false);
    expect(mutations()).toBe(2);
  });

  it("an unknown outcome is seen by a recovery that runs before React has rendered it", async () => {
    await staleA();
    const heldReload = propsOf(RELOAD);                                                       // taken from the render before the write
    const slowInvite = deferred<WebsiteResult<unknown>>();
    invite.mockReturnValueOnce(slowInvite.promise as never);
    await click(INVITE_B);
    list.mockResolvedValueOnce(fresh());
    await act(async () => {                                                                   // nothing is rendered until this scope ends
      slowInvite.resolve(lost());
      await new Promise((resolve) => setTimeout(resolve, 0));                                 // the write has ended unknown: the hook holds, no render yet
      heldReload.onClick();
    });
    await screen.findByTestId("newsletter-notice");
    const notice = screen.getByTestId("newsletter-notice").textContent ?? "";
    expect(notice).toContain("chưa rõ kết quả");                                              // the warning of the hold the read has just lifted
    expect(notice).toContain("mở lại bản ghi");
    expect(isDisabled("newsletter-add")).toBe(false);
    expect(mutations()).toBe(2);
  });

  describe.each(CONFIRMS)("a held handler of an open %s dialog", (kind, send, overrides) => {
    it("sends nothing once the recovery read is out", async () => {
      await staleA(overrides);
      const heldReload = propsOf(RELOAD);
      await click(`newsletter-${kind}-b@example.com`);
      const confirm = propsOf(`newsletter-${kind}-confirm`);
      const slow = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
      list.mockReturnValueOnce(slow.promise as never);
      const before = mutations();
      await act(async () => { heldReload.onClick(); confirm.onClick(); });
      expect(send).not.toHaveBeenCalled();
      expect(mutations()).toBe(before);
      slow.resolve(fresh());
      await screen.findByTestId("newsletter-notice");
      expect(mutations()).toBe(before);
    });
  });

  it("a held submit of an open edit dialog sends nothing once the recovery read is out", async () => {
    await staleA();
    const heldReload = propsOf(RELOAD);
    await click("newsletter-edit-b@example.com");
    await userEvent.selectOptions(await screen.findByTestId("newsletter-language"), "en");
    const form = screen.getByTestId("newsletter-edit-dialog").querySelector("form")!;
    const key = Object.keys(form).find((k) => k.startsWith("__reactProps$"))!;
    const submit = (form as unknown as Record<string, { onSubmit: (event: unknown) => void }>)[key].onSubmit;
    const slow = deferred<WebsiteResult<NewsletterSubscriptionPage>>();
    list.mockReturnValueOnce(slow.promise as never);
    const before = mutations();
    await act(async () => { heldReload.onClick(); submit({ preventDefault() {} }); });
    fireEvent.submit(form);                                                                   // and the real Enter path
    expect(update).toHaveBeenCalledTimes(1);                                                  // only a@'s conflict
    expect(mutations()).toBe(before);
    slow.resolve(fresh());
    await screen.findByTestId("newsletter-notice");
    expect(mutations()).toBe(before);
  });

  it("a read that throws does not leave the screen locked for good", async () => {
    await staleA();
    list.mockRejectedValueOnce(new Error("boom"));
    await userEvent.click(screen.getByTestId(RELOAD));
    await screen.findByTestId("newsletter-stale-failed");
    expect(isDisabled(RELOAD)).toBe(false);
    list.mockResolvedValueOnce(fresh());
    await userEvent.click(screen.getByTestId(RELOAD));
    await waitFor(() => expect(screen.queryByTestId("newsletter-stale")).toBeNull());
    expect(isDisabled(INVITE_B)).toBe(false);
  });
});

/**
 * BHA-NEWSLETTER-003-C5: an invitation carries the version of the row the Staff member sees. A version conflict is a certain refusal: no "invited" notice, the row is stale
 * (locked, read again through the C3 path), nothing is retried and a callback held from before cannot send with the old snapshot; after the read the new invitation carries the new version.
 */
describe("an invitation from a row that has changed (C5)", () => {
  const INVITE_A = "newsletter-invite-a@example.com";
  const queued = (version: number) => ok({ status: "queued", retryAfterSeconds: null, subscription: row("a@example.com", { version }) }) as never;

  it("sends the version on screen; a conflict is no 'invited' notice, locks the row, and retries nothing", async () => {
    await open([row("a@example.com"), row("b@example.com")]);                                  // a@ is shown at version 4
    invite.mockResolvedValueOnce(conflict());
    await click(INVITE_A);
    await screen.findByTestId("newsletter-write-refused");
    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenLastCalledWith("id-a@example.com", 4);
    expect(screen.queryByTestId("newsletter-notice")).toBeNull();                              // nothing says Staff invited anyone
    expect(screen.queryByTestId("newsletter-write-unverified")).toBeNull();                    // a certain refusal, not a lost answer
    expect(screen.getByTestId("newsletter-stale")).toBeTruthy();
    for (const id of [INVITE_A, "newsletter-edit-a@example.com", "newsletter-delete-a@example.com"]) expect(isDisabled(id), id).toBe(true);
    expect(isDisabled("newsletter-invite-b@example.com")).toBe(false);                         // other rows are untouched
    await sleepTick();
    expect(invite).toHaveBeenCalledTimes(1);
  });

  it("a callback held from before the conflict cannot send with the stale snapshot", async () => {
    await open([row("a@example.com")]);
    const held = (within(screen.getByTestId(INVITE_A)).getByRole("button") as unknown as Record<string, { onClick: () => void }>);
    const handler = held[Object.keys(held).find((key) => key.startsWith("__reactProps$"))!].onClick;
    invite.mockResolvedValueOnce(conflict());
    await click(INVITE_A);
    await screen.findByTestId("newsletter-stale");
    await act(async () => { handler(); });
    expect(invite).toHaveBeenCalledTimes(1);
  });

  it("after the read the row shows the new address and the new invitation carries the new version", async () => {
    await open([row("a@example.com")]);
    invite.mockResolvedValueOnce(conflict());
    await click(INVITE_A);
    await screen.findByTestId("newsletter-stale");
    list.mockResolvedValueOnce(ok(page([row("renamed@example.com", { id: "id-a@example.com", version: 5 })])) as never);   // Staff B renamed it: version 5
    await userEvent.click(screen.getByTestId("newsletter-stale-reload"));
    await waitFor(() => expect(screen.queryByTestId("newsletter-stale")).toBeNull());
    expect(screen.getByTestId("newsletter-notice").textContent).toContain("mở lại");
    expect(invite).toHaveBeenCalledTimes(1);                                                   // nothing was resent by itself
    expect(screen.queryByTestId(INVITE_A)).toBeNull();                                         // the address on screen is the new one

    invite.mockResolvedValueOnce(queued(5));
    await click("newsletter-invite-renamed@example.com");
    await waitFor(() => expect(invite).toHaveBeenCalledTimes(2));
    expect(invite).toHaveBeenLastCalledWith("id-a@example.com", 5);
    expect((await screen.findByTestId("newsletter-notice")).textContent).toContain("renamed@example.com");
  });

  it("a failed read keeps the row locked and the invitation unsent; the next read frees it", async () => {
    await open([row("a@example.com")]);
    invite.mockResolvedValueOnce(conflict());
    await click(INVITE_A);
    await screen.findByTestId("newsletter-stale");
    list.mockResolvedValueOnce({ kind: "network", message: "Không kết nối được máy chủ." } as never);
    await userEvent.click(screen.getByTestId("newsletter-stale-reload"));
    await screen.findByTestId("newsletter-stale-failed");
    expect(invite).toHaveBeenCalledTimes(1);
    list.mockResolvedValueOnce(ok(page([row("a@example.com", { version: 5 })])) as never);
    await userEvent.click(screen.getByTestId("newsletter-stale-reload"));
    await waitFor(() => expect(isDisabled(INVITE_A)).toBe(false));
    expect(invite).toHaveBeenCalledTimes(1);
  });
});
