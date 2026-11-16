/**
 * BHA-NEWSLETTER-001: the Newsletter screen against a mocked Admin API client — loading, empty, error with retry,
 * newest-first rows with the "Chưa xác minh email" status, and that the search and the paging are the server's (the
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
const item = (email: string, receivedAtUtc = "2026-11-16T04:00:00+00:00") => ({ id: `id-${email}`, email, receivedAtUtc, source: "homepage", status: "PendingVerification" });
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
    expect(within(row).getByText("Chưa xác minh email")).toBeTruthy();
    expect(within(row).getByText("Trang chủ")).toBeTruthy();
    expect(screen.getByTestId("newsletter-count").textContent).toContain("2 đăng ký");
    expect(list).toHaveBeenCalledWith({ search: "", page: 1, pageSize: 20 }, expect.anything());
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
    expect(list).toHaveBeenLastCalledWith({ search: "nobody", page: 1, pageSize: 20 }, expect.anything());
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
    expect(list).toHaveBeenLastCalledWith({ search: "", page: 2, pageSize: 20 }, expect.anything());
  });
});

describe("parseNewsletterSubscriptionPage", () => {
  it("accepts the API's shape and rejects anything else", () => {
    expect(parseNewsletterSubscriptionPage({ items: [item("a@example.com")], page: 1, pageSize: 20, total: 1 })?.items[0].email).toBe("a@example.com");
    expect(parseNewsletterSubscriptionPage({ items: [{ email: "a@example.com" }], page: 1, pageSize: 20, total: 1 })).toBeNull();
    expect(parseNewsletterSubscriptionPage({ items: [], page: "1", pageSize: 20, total: 0 })).toBeNull();
    expect(parseNewsletterSubscriptionPage(null)).toBeNull();
  });
});
