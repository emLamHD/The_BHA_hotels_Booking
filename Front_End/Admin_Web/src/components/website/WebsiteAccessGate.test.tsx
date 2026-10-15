/**
 * CUST-WEB-HEADER-001-CP02: what stands in front of every website page — configuration, the session check, the permission
 * (display only; the server decides), the redirect with a safe returnTo, the exclusion of Sign out and writes, and what a
 * 403 or a 401 does to a page that was already open.
 */
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSessionResult } from "@/lib/api/staff";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  fetchStaffSession: vi.fn(),
  staffLogout: vi.fn(),
}));

import WebsiteAccessGate, { useWebsiteHost, type WebsiteHost } from "./WebsiteAccessGate";
import { ALLOWED, WITHOUT_PERMISSION, deferred } from "./websiteTestUtils";
import { fetchStaffSession, staffLogout } from "@/lib/api/staff";

const mockedMe = vi.mocked(fetchStaffSession);
const mockedLogout = vi.mocked(staffLogout);

let host: WebsiteHost | null = null;
let mounts = 0;
function Probe() {
  const current = useWebsiteHost();
  React.useEffect(() => {
    host = current; // after every render, so the tests always call the latest handlers
  });
  React.useEffect(() => {
    mounts += 1;
    return () => {
      mounts -= 1;
    };
  }, []);
  return <div data-testid="page">the page</div>;
}

beforeEach(() => {
  replace.mockReset();
  mockedMe.mockReset();
  mockedLogout.mockReset();
  host = null;
  mounts = 0;
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const authenticated = (session = ALLOWED): StaffSessionResult => ({ kind: "authenticated", session });

describe("configuration", () => {
  it.each([
    ["an invalid mode", "Staf", /must be exactly Staff or LocalGate/, "website-config-error"],
    ["LocalGate", "LocalGate", /cần đăng nhập Staff/, "website-needs-staff-mode"],
  ])("%s shows a panel and asks nobody anything", (_label, value, message, testId) => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", value);
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    expect(screen.getByTestId(testId)).toHaveTextContent(message);
    expect(mockedMe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("page")).toBeNull();
  });

  it("with the variable unset (the default) it is the Staff gate", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", undefined);
    mockedMe.mockResolvedValue({ kind: "unauthenticated" });
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(mockedMe).toHaveBeenCalledTimes(1);
  });
});

describe("the session and the permission", () => {
  it("shows nothing of the page until me has confirmed a session that holds the permission", async () => {
    const me = deferred<StaffSessionResult>();
    mockedMe.mockReturnValue(me.promise);
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    expect(screen.getByTestId("staff-session-checking")).toBeInTheDocument();
    expect(screen.queryByTestId("page")).toBeNull();
    await act(async () => me.resolve(authenticated()));
    expect(screen.getByTestId("page")).toBeInTheDocument();
    expect(screen.getByTestId("staff-identity")).toHaveTextContent("Đang đăng nhập với site@example.com");
  });

  it.each([
    ["/website/languages", "/signin?returnTo=%2Fwebsite%2Flanguages"],
    ["/website/translations", "/signin?returnTo=%2Fwebsite%2Ftranslations"],
    ["/website/currencies", "/signin?returnTo=%2Fwebsite%2Fcurrencies"],
  ])("without a session %s goes to the sign-in page that comes back to it, once", async (returnTo, target) => {
    mockedMe.mockResolvedValue({ kind: "unauthenticated" });
    render(<WebsiteAccessGate returnTo={returnTo}><Probe /></WebsiteAccessGate>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(target));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("staff-session-required")).toBeInTheDocument();
    expect(screen.queryByTestId("page")).toBeNull();
  });

  it("a check that failed is an error with Retry — never signed out, never a redirect", async () => {
    mockedMe.mockResolvedValueOnce({ kind: "error", message: "The Admin API is unreachable." });
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    expect(await screen.findByTestId("staff-session-error")).toHaveTextContent("unreachable");
    expect(replace).not.toHaveBeenCalled();
    mockedMe.mockResolvedValueOnce(authenticated());
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByTestId("page")).toBeInTheDocument();
  });

  it.each([
    ["no permissions field", { ...ALLOWED, permissions: undefined }],
    ["an empty list", WITHOUT_PERMISSION],
    ["only an unknown permission", { ...ALLOWED, permissions: ["SomethingElse"] }],
  ])("an account with %s sees why, and the page is never mounted", async (_label, session) => {
    mockedMe.mockResolvedValue(authenticated(session));
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    expect(await screen.findByTestId("website-no-permission")).toHaveTextContent(/không có quyền với cài đặt website/);
    expect(screen.queryByTestId("page")).toBeNull();
    expect(mounts).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("a Property role grants nothing: a Manager membership without the permission is refused", async () => {
    mockedMe.mockResolvedValue(authenticated({ ...ALLOWED, permissions: [], memberships: [{ propertyId: "p", propertyName: "P", timeZone: "UTC", role: "Manager" }] }));
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    expect(await screen.findByTestId("website-no-permission")).toBeInTheDocument();
  });
});

describe("Sign out and writes exclude each other", () => {
  it("a write on the wire holds Sign out, and one write at a time", async () => {
    mockedMe.mockResolvedValue(authenticated());
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    await screen.findByTestId("page");
    const signOut = screen.getByRole("button", { name: "Đăng xuất" });
    expect(signOut).toBeEnabled();

    let first = false;
    let second = true;
    act(() => {
      first = host!.beginWrite();
      second = host!.beginWrite();
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(signOut).toBeDisabled();
    await userEvent.click(signOut);
    expect(mockedLogout).not.toHaveBeenCalled();
    act(() => host!.endWrite());
    expect(signOut).toBeEnabled();
  });

  it("a sign-out waiting for the server refuses new writes; an unconfirmed one lets them resume", async () => {
    mockedMe.mockResolvedValue(authenticated());
    const logout = deferred<{ kind: "unconfirmed"; message: string }>();
    mockedLogout.mockReturnValue(logout.promise);
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    await screen.findByTestId("page");
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    expect(screen.getByRole("button", { name: "Đang đăng xuất…" })).toBeDisabled();
    expect(host!.signingOut).toBe(true);
    let started = true;
    act(() => {
      started = host!.beginWrite();
    });
    expect(started).toBe(false);
    await act(async () => logout.resolve({ kind: "unconfirmed", message: "Sign-out could not be confirmed. Your session may still be active." }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be confirmed");
    act(() => {
      started = host!.beginWrite();
    });
    expect(started).toBe(true);
  });

  it("a confirmed sign-out unmounts the page and goes back to the sign-in page", async () => {
    mockedMe.mockResolvedValue(authenticated());
    mockedLogout.mockResolvedValue({ kind: "logged-out" });
    render(<WebsiteAccessGate returnTo="/website/currencies"><Probe /></WebsiteAccessGate>);
    await screen.findByTestId("page");
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    await waitFor(() => expect(screen.queryByTestId("page")).toBeNull());
    expect(mounts).toBe(0);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin?returnTo=%2Fwebsite%2Fcurrencies"));
  });
});

describe("a 403 or a 401 on a page that is open", () => {
  it("403: me is read again; if the permission is gone the page closes instead of continuing on the old permission", async () => {
    mockedMe.mockResolvedValueOnce(authenticated());
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    await screen.findByTestId("page");
    mockedMe.mockResolvedValueOnce(authenticated(WITHOUT_PERMISSION));
    await act(async () => {
      await host!.onDenied();
    });
    expect(await screen.findByTestId("website-no-permission")).toBeInTheDocument();
    expect(screen.queryByTestId("page")).toBeNull();
    expect(mockedMe).toHaveBeenCalledTimes(2);
  });

  it("403 while the permission is still there: nothing continues silently — a notice says the request was refused", async () => {
    mockedMe.mockResolvedValue(authenticated());
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    await screen.findByTestId("page");
    await act(async () => {
      await host!.onDenied();
    });
    expect(screen.getByTestId("website-notice")).toHaveTextContent(/từ chối yêu cầu \(403\)/);
    expect(screen.getByTestId("page")).toBeInTheDocument();
  });

  it("403 when the session itself has ended: back to the sign-in page", async () => {
    mockedMe.mockResolvedValueOnce(authenticated());
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    await screen.findByTestId("page");
    mockedMe.mockResolvedValueOnce({ kind: "unauthenticated" });
    await act(async () => {
      await host!.onDenied();
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin?returnTo=%2Fwebsite%2Flanguages"));
    expect(screen.queryByTestId("page")).toBeNull();
  });

  it("403 when me cannot be read: access closes as an error with Retry, never left open", async () => {
    mockedMe.mockResolvedValueOnce(authenticated());
    render(<WebsiteAccessGate returnTo="/website/languages"><Probe /></WebsiteAccessGate>);
    await screen.findByTestId("page");
    mockedMe.mockResolvedValueOnce({ kind: "error", message: "The Admin API did not answer." });
    await act(async () => {
      await host!.onDenied();
    });
    expect(await screen.findByTestId("staff-session-error")).toBeInTheDocument();
    expect(screen.queryByTestId("page")).toBeNull();
  });

  it("401: the session ended, the page closes and the person is sent to sign in", async () => {
    mockedMe.mockResolvedValue(authenticated());
    render(<WebsiteAccessGate returnTo="/website/translations"><Probe /></WebsiteAccessGate>);
    await screen.findByTestId("page");
    act(() => host!.onUnauthenticated());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin?returnTo=%2Fwebsite%2Ftranslations"));
    expect(screen.queryByTestId("page")).toBeNull();
    expect(screen.getByTestId("staff-session-required")).toHaveTextContent("Phiên đăng nhập Staff của bạn đã kết thúc");
  });
});
