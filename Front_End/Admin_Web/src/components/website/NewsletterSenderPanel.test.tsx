/**
 * BHA-NEWSLETTER-002: the "Cấu hình email gửi" screen and the OAuth callback page against a mocked Admin API client. The secret is
 * write-only, the browser is sent to Google only with an https address, a failed connection says why and keeps what was there, and
 * the callback forwards the code once and takes it out of the address.
 */
import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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
  getNewsletterSender: vi.fn(),
  saveNewsletterSenderProfile: vi.fn(),
  startNewsletterConnect: vi.fn(),
  completeNewsletterConnect: vi.fn(),
  disconnectNewsletterSender: vi.fn(),
}));

import NewsletterSenderPanel from "./NewsletterSenderPanel";
import NewsletterSenderCallback from "./NewsletterSenderCallback";
import { ALLOWED, btn, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import {
  completeNewsletterConnect, disconnectNewsletterSender, getNewsletterSender, parseNewsletterSender, saveNewsletterSenderProfile, startNewsletterConnect,
  type NewsletterSender,
} from "@/lib/api/website";

const get = vi.mocked(getNewsletterSender);
const start = vi.mocked(startNewsletterConnect);
const save = vi.mocked(saveNewsletterSenderProfile);
const complete = vi.mocked(completeNewsletterConnect);
const disconnect = vi.mocked(disconnectNewsletterSender);
const REDIRECT = "https://admin.example.test/website/newsletter/sender/callback";

const sender = (overrides: Partial<NewsletterSender> = {}): NewsletterSender => ({
  status: "NotConnected", clientId: null, hasClientSecret: false, connectedEmail: null, senderName: null, replyTo: null, connectedAtUtc: null,
  redirectUri: REDIRECT, scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"], customerOriginReady: true, version: 0, pendingRequests: 0, ...overrides,
});
const connected = (overrides: Partial<NewsletterSender> = {}) =>
  sender({ status: "Connected", clientId: "id.apps.googleusercontent.com", hasClientSecret: true, connectedEmail: "owner@gmail.test", connectedAtUtc: "2026-11-17T08:00:00+00:00", version: 2, ...overrides });
const refused = (code: string, field: string | null = null, status = 400) => ({ kind: "refused" as const, status, code, field, detail: "english detail" });

const assign = vi.fn();
beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const mock of [get, start, save, complete, disconnect]) mock.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign, pathname: "/website/newsletter/sender", search: "", hash: "" } });
});
afterEach(cleanup);

const open = async (value: NewsletterSender) => {
  get.mockResolvedValue(ok(value));
  renderInGate(<NewsletterSenderPanel />, "/website/newsletter/sender");
  await screen.findByTestId("sender-client-id");
};
const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement;

describe("NewsletterSenderPanel", () => {
  it("not connected: says the form is V1, shows the Redirect URI and the scopes, and offers Kết nối Gmail", async () => {
    await open(sender());
    expect(screen.getByTestId("sender-status-none").textContent).toContain("Chưa kết nối");
    expect(screen.getByTestId("sender-redirect-uri").textContent).toBe(REDIRECT);
    expect(screen.getByTestId("sender-connect").textContent).toBe("Kết nối Gmail");
    expect(screen.getByTestId("sender-testing-note").textContent).toContain("7 ngày");
    expect(screen.queryByTestId("sender-disconnect")).toBeNull();
    expect(document.body.textContent).toContain("gmail.send");
  });

  it("the secret field is write-only: a password input, never filled from the server, and the placeholder only says one is stored", async () => {
    await open(connected());
    const secret = field("sender-client-secret");
    expect(secret.type).toBe("password");
    expect(secret.value).toBe("");
    expect(secret.placeholder).toContain("Đã lưu");
    expect(screen.getByTestId("sender-connect").textContent).toBe("Đổi tài khoản");
    expect(screen.getByTestId("sender-status-connected").textContent).toContain("owner@gmail.test");
  });

  it("connect sends the Client ID and a typed secret once, then sends the browser to Google (https only) and forgets the secret", async () => {
    await open(sender());
    start.mockResolvedValue(ok({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }));
    fireEvent.change(field("sender-client-id"), { target: { value: " id.apps.googleusercontent.com " } });
    fireEvent.change(field("sender-client-secret"), { target: { value: "GOCSPX-secret" } });
    await userEvent.click(btn("sender-connect"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ clientId: "id.apps.googleusercontent.com", clientSecret: "GOCSPX-secret", switchAccount: false });
    expect(field("sender-client-secret").value).toBe("");
  });

  it("an empty secret keeps the stored one (null), and 'Đổi tài khoản' asks Google to choose an account", async () => {
    await open(connected());
    start.mockResolvedValue(ok({ authorizationUrl: "https://accounts.google.com/auth" }));
    await userEvent.click(btn("sender-connect"));
    await waitFor(() => expect(start).toHaveBeenCalledWith({ clientId: "id.apps.googleusercontent.com", clientSecret: null, switchAccount: true }));
  });

  it("never follows an address that is not https", async () => {
    await open(sender({ clientId: "id", hasClientSecret: true }));
    start.mockResolvedValue(ok({ authorizationUrl: "javascript:alert(1)" }));
    await userEvent.click(btn("sender-connect"));
    expect(await screen.findByTestId("sender-notice")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("a refusal is explained in words and nothing is sent to Google", async () => {
    await open(sender());
    start.mockResolvedValue(refused("newsletter-sender-client-secret-required", "clientSecret"));
    fireEvent.change(field("sender-client-id"), { target: { value: "id" } });
    await userEvent.click(btn("sender-connect"));
    expect(await screen.findByText(/Hãy nhập Client Secret/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("needs reconnect: warns, counts the mails that wait, and offers Kết nối lại", async () => {
    await open(connected({ status: "NeedsReconnect", pendingRequests: 3 }));
    expect(screen.getByTestId("sender-status-reconnect").textContent).toContain("Cần kết nối lại");
    expect(screen.getByTestId("sender-status-reconnect").textContent).toContain("3 email đang chờ");
    expect(screen.getByTestId("sender-connect").textContent).toBe("Kết nối lại Gmail");
  });

  it("warns when the Customer address for the link is missing, and when there is no Redirect URI the connect button is off", async () => {
    await open(sender({ customerOriginReady: false, redirectUri: null }));
    expect(screen.getByTestId("sender-origin-missing")).toBeTruthy();
    fireEvent.change(field("sender-client-id"), { target: { value: "id" } });
    expect((btn("sender-connect") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disconnect asks first, then sends once and shows V1 again", async () => {
    await open(connected());
    disconnect.mockResolvedValue(ok(sender({ status: "NotConnected", connectedEmail: "owner@gmail.test" })));
    await userEvent.click(btn("sender-disconnect"));
    expect(disconnect).not.toHaveBeenCalled();
    await userEvent.click(btn("sender-disconnect-confirm"));
    await screen.findByTestId("sender-status-none");
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sender-status-none").textContent).toContain("owner@gmail.test");
  });

  it("saves the name and Reply-To with the version it loaded; a version conflict says nothing was saved", async () => {
    await open(connected());
    save.mockResolvedValueOnce(refused("newsletter-sender-version-conflict", null, 409));
    fireEvent.change(field("sender-name"), { target: { value: "The BHA" } });
    fireEvent.change(field("sender-reply-to"), { target: { value: "letan@thebha.vn" } });
    await userEvent.click(btn("sender-save-profile"));
    expect(save).toHaveBeenCalledWith({ expectedVersion: 2, senderName: "The BHA", replyTo: "letan@thebha.vn" });
    expect(await screen.findByText(/Chưa có gì được lưu/)).toBeTruthy();

    save.mockResolvedValueOnce(ok(connected({ senderName: "The BHA", replyTo: "letan@thebha.vn", version: 3 })));
    get.mockResolvedValue(ok(connected({ version: 3 })));
    await userEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe("parseNewsletterSender", () => {
  it("reads metadata and refuses a record that is not one", () => {
    expect(parseNewsletterSender(connected())?.connectedEmail).toBe("owner@gmail.test");
    expect(parseNewsletterSender({ ...connected(), status: "Weird" })).toBeNull();
    expect(parseNewsletterSender({ ...connected(), scopes: "x" })).toBeNull();
    expect(parseNewsletterSender({ ...connected(), version: "2" })).toBeNull();
    expect(parseNewsletterSender(null)).toBeNull();
  });

  it("has no place for a secret or a token: an extra field is not carried", () => {
    const parsed = parseNewsletterSender({ ...connected(), clientSecret: "GOCSPX-x", refreshToken: "r" }) as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("clientSecret");
    expect(parsed).not.toHaveProperty("refreshToken");
  });
});

describe("NewsletterSenderCallback", () => {
  const arrive = (search: string) => {
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign, pathname: "/website/newsletter/sender/callback", search, hash: "" } });
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
    renderInGate(<NewsletterSenderCallback />, "/website/newsletter/sender");
    return replace;
  };

  it("forwards state and code once in a body, removes them from the address bar, and says which account is connected", async () => {
    complete.mockResolvedValue(ok(connected()));
    const replace = arrive("?state=" + "S".repeat(43) + "&code=4%2F0AbC");
    expect(await screen.findByTestId("callback-connected")).toBeTruthy();
    expect(screen.getByTestId("callback-connected").textContent).toContain("owner@gmail.test");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({ state: "S".repeat(43), code: "4/0AbC", error: null });
    expect(replace).toHaveBeenCalledWith(null, "", "/website/newsletter/sender/callback");
    expect(screen.getByTestId("callback-back").getAttribute("href")).toBe("/website/newsletter/sender");
  });

  it("a cancelled consent is reported and the existing connection is not touched", async () => {
    complete.mockResolvedValue(refused("newsletter-connect-cancelled"));
    arrive("?state=" + "a".repeat(43) + "&error=access_denied");
    expect((await screen.findByTestId("callback-failed")).textContent).toContain("huỷ cấp quyền");
    expect(complete).toHaveBeenCalledWith({ state: "a".repeat(43), code: null, error: "access_denied" });
  });

  it("an address with no state or no code sends nothing", async () => {
    arrive("?code=abc");
    expect((await screen.findByTestId("callback-failed")).textContent).toContain("Phiên kết nối");
    expect(complete).not.toHaveBeenCalled();
  });

  it("explains a refusal with the words of its code", async () => {
    complete.mockResolvedValue(refused("newsletter-connect-scope-missing"));
    arrive("?state=" + "a".repeat(43) + "&code=x");
    expect((await screen.findByTestId("callback-failed")).textContent).toContain("gmail.send");
  });
});
