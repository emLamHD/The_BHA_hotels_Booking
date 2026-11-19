/**
 * BHA-NEWSLETTER-001: the Newsletter screen against a mocked Admin API client — loading, empty, error with retry,
 * newest-first rows with the "Chờ xác minh" status, and that the search and the paging are the server's (the
 * screen asks again with the query and never filters what it received).
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
}));

import NewsletterSubscriptionsPanel from "./NewsletterSubscriptionsPanel";
import { ALLOWED, deferred, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { listNewsletterSubscriptions, parseNewsletterSubscriptionPage, type NewsletterSubscriptionPage } from "@/lib/api/website";

const list = vi.mocked(listNewsletterSubscriptions);
const item = (email: string, receivedAtUtc = "2026-11-16T04:00:00+00:00", verifiedAtUtc: string | null = null) => ({
  id: `id-${email}`, email, receivedAtUtc, source: "homepage", status: verifiedAtUtc ? "Verified" : "PendingVerification", verifiedAtUtc,
  language: "vi" as const, version: 1, unsubscribedAtUtc: null, archivedAtUtc: null, verificationMail: null as "Sent" | null,
});
const page = (items: ReturnType<typeof item>[], overrides: Partial<NewsletterSubscriptionPage> = {}): NewsletterSubscriptionPage => ({ items, page: 1, pageSize: 20, total: items.length, ...overrides });

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  list.mockReset();
});
afterEach(cleanup);

describe("NewsletterSubscriptionsPanel", () => {
  it("shows a loading state, then the rows with the unverified status", async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(pending.promise as never);
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    expect(await screen.findByTestId("website-loading")).toBeTruthy();
    pending.resolve(ok(page([item("a@example.com"), item("b@example.com")])));
    const row = await screen.findByTestId("newsletter-row-a@example.com");
    expect(within(row).getByText("Chờ xác minh")).toBeTruthy();
    expect(within(row).getByText("Trang chủ")).toBeTruthy();
    expect(screen.getByTestId("newsletter-count").textContent).toContain("2 đăng ký");
    expect(list).toHaveBeenCalledWith({ search: "", status: "", scope: "active", page: 1, pageSize: 20 }, expect.anything());
  });

  it("shows who confirmed and when (BHA-NEWSLETTER-002), and a dash for a pending address", async () => {
    // Both have a confirmation mail on record ("Đã gửi"), so the only dash on a row is the missing verification time.
    list.mockResolvedValue(ok(page([item("done@example.com", "2026-11-16T04:00:00+00:00", "2026-11-17T08:30:00+00:00"), item("wait@example.com")].map((row) => ({ ...row, verificationMail: "Sent" as const })))));
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    const verified = await screen.findByTestId("newsletter-row-done@example.com");
    expect(within(verified).getByText("Đã xác minh")).toBeTruthy();
    expect(within(verified).queryByText("—")).toBeNull();
    const pending = screen.getByTestId("newsletter-row-wait@example.com");
    expect(within(pending).getByText("Chờ xác minh")).toBeTruthy();
    expect(within(pending).getByText("—")).toBeTruthy();
  });

  it("shows the server's order as it is (newest first), without sorting again", async () => {
    list.mockResolvedValue(ok(page([item("z@example.com", "2026-11-16T05:00:00+00:00"), item("a@example.com", "2026-11-16T04:00:00+00:00")])));
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await screen.findByTestId("newsletter-table");
    const emails = screen.getAllByTestId(/^newsletter-row-/).map((row) => row.getAttribute("data-testid"));
    expect(emails).toEqual(["newsletter-row-z@example.com", "newsletter-row-a@example.com"]);
  });

  it("says when there is nobody yet, and when a search matches nobody", async () => {
    list.mockResolvedValue(ok(page([])));
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    expect((await screen.findByTestId("newsletter-empty")).textContent).toContain("Chưa có ai đăng ký");
    await userEvent.type(screen.getByTestId("newsletter-search"), "nobody");
    await userEvent.click(within(screen.getByTestId("newsletter-search-submit")).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("newsletter-empty").textContent).toContain("Không có đăng ký nào khớp"));
    expect(list).toHaveBeenLastCalledWith({ search: "nobody", status: "", scope: "active", page: 1, pageSize: 20 }, expect.anything());
  });

  it("shows an error with a retry that asks the server again", async () => {
    list.mockResolvedValueOnce({ kind: "error", message: "Máy chủ gặp lỗi." } as never);
    list.mockResolvedValueOnce(ok(page([item("a@example.com")])));
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    expect((await screen.findByTestId("website-load-error")).textContent).toContain("Máy chủ gặp lỗi.");
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByTestId("newsletter-row-a@example.com");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("pages through the server: the next page is a new request and the first page's rows are not kept", async () => {
    list.mockResolvedValueOnce(ok(page([item("p1@example.com")], { total: 41 })));
    list.mockResolvedValueOnce(ok(page([item("p2@example.com")], { total: 41, page: 2 })));
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await screen.findByTestId("newsletter-row-p1@example.com");
    expect(screen.getByTestId("newsletter-count").textContent).toContain("trang 1/3");
    await userEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByTestId("newsletter-row-p2@example.com");
    expect(screen.queryByTestId("newsletter-row-p1@example.com")).toBeNull();
    expect(list).toHaveBeenLastCalledWith({ search: "", status: "", scope: "active", page: 2, pageSize: 20 }, expect.anything());
  });
});

describe("NewsletterSubscriptionsPanel — a new query while the old answer is still on screen (BHA-NEWSLETTER-001-C2)", () => {
  const search = async (text: string) => {
    const field = screen.getByTestId("newsletter-search") as HTMLInputElement;
    await userEvent.clear(field);
    await userEvent.type(field, text);
    await userEvent.click(within(screen.getByTestId("newsletter-search-submit")).getByRole("button"));
  };
  const nextButton = () => screen.getByRole("button", { name: "Trang sau" }) as HTMLButtonElement;
  const previousButton = () => screen.getByRole("button", { name: "Trang trước" }) as HTMLButtonElement;

  it("locks the paging until the new search has answered, so the old page count cannot request page 2 of the new search", async () => {
    list.mockResolvedValueOnce(ok(page([item("p1@example.com")], { total: 41 })));
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await screen.findByTestId("newsletter-row-p1@example.com");
    expect(nextButton().disabled).toBe(false);

    const narrowed = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(narrowed.promise as never);
    await search("one");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ search: "one", status: "", scope: "active", page: 1, pageSize: 20 }, expect.anything()));
    expect(nextButton().disabled).toBe(true);
    expect(previousButton().disabled).toBe(true);
    await userEvent.click(nextButton());
    expect(list).toHaveBeenCalledTimes(2);

    narrowed.resolve(ok(page([item("one@example.com")], { total: 1 })));
    await screen.findByTestId("newsletter-row-one@example.com");
    expect(screen.queryByTestId("newsletter-row-p1@example.com")).toBeNull();
    expect(screen.getByTestId("newsletter-count").textContent).toContain("trang 1/1");
    expect(nextButton().disabled).toBe(true);
    expect(screen.queryByTestId("newsletter-empty")).toBeNull();
  });

  it("does not say \"no match\" for a query that has not answered, and does not let an older answer settle a newer query", async () => {
    list.mockResolvedValueOnce(ok(page([item("p1@example.com")], { total: 41 })));
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await screen.findByTestId("newsletter-row-p1@example.com");

    const first = deferred<ReturnType<typeof ok>>();
    const second = deferred<ReturnType<typeof ok>>();
    list.mockReturnValueOnce(first.promise as never).mockReturnValueOnce(second.promise as never);
    await search("first");
    await search("second");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ search: "second", status: "", scope: "active", page: 1, pageSize: 20 }, expect.anything()));

    first.resolve(ok(page([item("first@example.com")], { total: 1 })));
    await Promise.resolve();
    expect(screen.queryByTestId("newsletter-row-first@example.com")).toBeNull();
    expect(nextButton().disabled).toBe(true);

    second.resolve(ok(page([], { total: 0 })));
    expect((await screen.findByTestId("newsletter-empty")).textContent).toContain("Không có đăng ký nào khớp");
  });

  it("offers the way back to page 1 for a page past the end of a list that has entries, and says \"no match\" only when the total is 0", async () => {
    list.mockResolvedValueOnce(ok(page([item("p1@example.com")], { total: 41 })));
    list.mockResolvedValueOnce(ok(page([], { total: 1, page: 2 })));
    list.mockResolvedValueOnce(ok(page([item("p1@example.com")], { total: 1 })));
    renderInGate(<NewsletterSubscriptionsPanel />, "/website/newsletter");
    await screen.findByTestId("newsletter-row-p1@example.com");
    await userEvent.click(nextButton());

    const recovery = await screen.findByTestId("newsletter-out-of-range");
    expect(recovery.textContent).toContain("1");
    expect(screen.queryByTestId("newsletter-empty")).toBeNull();
    await userEvent.click(within(screen.getByTestId("newsletter-back-to-first")).getByRole("button"));
    await screen.findByTestId("newsletter-row-p1@example.com");
    expect(list).toHaveBeenLastCalledWith({ search: "", status: "", scope: "active", page: 1, pageSize: 20 }, expect.anything());
    expect(screen.queryByTestId("newsletter-out-of-range")).toBeNull();
  });
});

describe("parseNewsletterSubscriptionPage", () => {
  it("accepts the API's shape and rejects anything else", () => {
    expect(parseNewsletterSubscriptionPage({ items: [item("a@example.com")], page: 1, pageSize: 20, total: 1 })?.items[0].email).toBe("a@example.com");
    expect(parseNewsletterSubscriptionPage({ items: [{ email: "a@example.com" }], page: 1, pageSize: 20, total: 1 })).toBeNull();
    expect(parseNewsletterSubscriptionPage({ items: [], page: "1", pageSize: 20, total: 0 })).toBeNull();
    expect(parseNewsletterSubscriptionPage(null)).toBeNull();
    // The screen and the API ship together: a row without a version or a language (an API from before BHA-NEWSLETTER-003) is not a row.
    const old = { id: "x", email: "a@example.com", receivedAtUtc: "t", source: "homepage", status: "PendingVerification" };
    expect(parseNewsletterSubscriptionPage({ items: [old], page: 1, pageSize: 20, total: 1 })).toBeNull();
    const current = { ...old, language: "en", version: 3, verifiedAtUtc: null, unsubscribedAtUtc: null, archivedAtUtc: null, verificationMail: "Sent" };
    expect(parseNewsletterSubscriptionPage({ items: [current], page: 1, pageSize: 20, total: 1 })?.items[0]).toMatchObject({ language: "en", version: 3, verificationMail: "Sent", archivedAtUtc: null });
    expect(parseNewsletterSubscriptionPage({ items: [{ ...current, verifiedAtUtc: 5 }], page: 1, pageSize: 20, total: 1 })).toBeNull();
    expect(parseNewsletterSubscriptionPage({ items: [{ ...current, language: "de" }], page: 1, pageSize: 20, total: 1 })).toBeNull();
    expect(parseNewsletterSubscriptionPage({ items: [{ ...current, verificationMail: "Lost" }], page: 1, pageSize: 20, total: 1 })).toBeNull();
  });
});
