/**
 * PMS-ADMIN-AUTH-001-CP06 evidence groups 1, 3 and 15: Staff sign-in.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

import SignInForm from "./SignInForm";

const SESSION = {
  staffAccountId: "11111111-1111-1111-1111-111111111111",
  email: "desk@example.com",
  memberships: [{ propertyId: "prop-a", propertyName: "Property A", timeZone: "Asia/Ho_Chi_Minh", role: "FrontDesk" }],
};

function json(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const emailInput = () => screen.getByLabelText(/Email/);
const passwordInput = () => screen.getByLabelText(/^Password/);
const submit = () => screen.getByRole("button", { name: "Sign in" });

beforeEach(() => {
  push.mockReset();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://localhost:7145");
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SignInForm (Staff mode)", () => {
  it("signs in with the password exactly as typed, confirms the session with me, then opens the board — and keeps nothing", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValueOnce(json(200, SESSION)).mockResolvedValueOnce(json(200, SESSION));
    vi.stubGlobal("fetch", fetchSpy);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const password = ` ${"Xy9!".repeat(40)} `; // 162 characters, spaces kept

    render(<SignInForm />);
    // The social, sign-up and "keep me logged in" template options are gone.
    expect(screen.queryByText(/Google|Sign Up|Keep me logged in/i)).not.toBeInTheDocument();
    expect(emailInput()).toHaveAttribute("autocomplete", "username");
    expect(passwordInput()).toHaveAttribute("autocomplete", "current-password");
    await user.type(emailInput(), " desk@example.com ");
    await user.type(passwordInput(), password);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/calendar"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [loginUrl, loginInit] = fetchSpy.mock.calls[0];
    expect(loginUrl).toBe("https://localhost:7145/api/admin/v1/auth/login");
    expect(JSON.parse(loginInit.body)).toEqual({ email: "desk@example.com", password });
    expect(fetchSpy.mock.calls[1][0]).toBe("https://localhost:7145/api/admin/v1/me");
    expect(setItem).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain("Xy9");
    await waitFor(() => expect(passwordInput()).toHaveValue(""));
  });

  it.each([
    [401, /email or password is not correct/],
    [429, /Too many sign-in attempts/],
  ])("shows one safe message for %i, clears the password and does not open the board", async (status, message) => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue(json(status, { title: "Authentication failed", detail: "server text" }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SignInForm />);
    await user.type(emailInput(), "desk@example.com");
    await user.type(passwordInput(), "Wrong!a1x");
    await user.click(submit());

    expect(await screen.findByTestId("signin-error")).toHaveTextContent(message);
    expect(screen.getByTestId("signin-error")).not.toHaveTextContent("server text");
    expect(passwordInput()).toHaveValue("");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("reports a network failure without retrying", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SignInForm />);
    await user.type(emailInput(), "desk@example.com");
    await user.type(passwordInput(), "Secret!a1x");
    await user.click(submit());
    expect(await screen.findByTestId("signin-error")).toHaveTextContent(/Could not reach the Admin API/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not open the board when me cannot confirm the session after a 200 login", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(200, SESSION)).mockResolvedValueOnce(json(401, {})));
    render(<SignInForm />);
    await user.type(emailInput(), "desk@example.com");
    await user.type(passwordInput(), "Secret!a1x");
    await user.click(submit());
    expect(await screen.findByTestId("signin-error")).toHaveTextContent(/no session could be confirmed/);
    expect(push).not.toHaveBeenCalled();
  });

  it("sends one request however often the form is submitted while one is pending; the eye button never submits", async () => {
    const user = userEvent.setup();
    const answer = deferred<Response>();
    const fetchSpy = vi.fn().mockReturnValueOnce(answer.promise).mockResolvedValue(json(200, SESSION));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SignInForm />);
    await user.type(emailInput(), "desk@example.com");
    await user.type(passwordInput(), "Secret!a1x");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(passwordInput()).toHaveAttribute("type", "text");
    await user.click(submit());
    await user.click(screen.getByRole("button", { name: "Signing in…" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    answer.resolve(json(401, {}));
    expect(await screen.findByTestId("signin-error")).toBeInTheDocument();
  });
});

describe("SignInForm in other modes", () => {
  it("LocalGate: no Staff sign-in form, and nothing is sent", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "LocalGate");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<SignInForm />);
    expect(screen.getByTestId("signin-local-gate")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an invalid mode: a configuration error, and nothing is sent", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<SignInForm />);
    expect(screen.getByTestId("signin-config-error")).toHaveTextContent(/must be exactly Staff or LocalGate/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
