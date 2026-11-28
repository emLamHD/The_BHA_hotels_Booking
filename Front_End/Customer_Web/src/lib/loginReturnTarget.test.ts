import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountMiniDom, type MiniDom } from "./reactDomTestkit";

// BHA-CHECKOUT-001-PR09-C8 P3. The real LoginForm mounted with react-dom/client: a visitor who came from the management page signs in and is sent back to that exact clean
// management address; anything else in `returnTo` leaves the existing behaviour (the account page, or the home page). Only the session provider and the command runner are
// replaced (the runner runs the sign-in the way the real one hands its result to `after`); the sign-in itself is a stub, not the API.
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/login" }));
vi.mock("next/link", () => ({ default: (props: { href: string; children?: React.ReactNode }) => React.createElement("a", { href: String(props.href) }, props.children) }));
let signInResult: unknown = { status: "settled", transport: "succeeded", session: "authenticated" };
const guardedLogin = vi.fn(async () => signInResult);
vi.mock("@/app/CustomerSessionProvider", () => ({
  useCustomerSession: () => ({ state: { status: "anonymous", customer: null }, identityChange: { phase: "idle" }, guardedLogin, guardedLogout: vi.fn() }),
}));
vi.mock("@/components/CustomerAuthNotice", () => ({
  AuthPresentationView: () => null,
  CustomerSessionNotice: () => null,
  useAuthCommand: () => ({
    run: (start: () => Promise<unknown>, after?: (result: unknown) => void) => { void start().then((result) => after?.(result)); return true; },
    reset: () => {},
    busy: false,
    working: false,
    pending: false,
    presentation: null,
  }),
}));

import { withI18n } from "@/lib/i18n/testkit";
import LoginForm from "../app/login/LoginForm";

const ID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
type Found = { nodeName: string; childNodes: Found[]; value: string; [key: string]: unknown };
const findAll = (node: Found, name: string, out: Found[] = []): Found[] => { if (node.nodeName === name) out.push(node); node.childNodes.forEach((child) => findAll(child, name, out)); return out; };
const props = (node: Found) => node[Object.keys(node).find((k) => k.startsWith("__reactProps$")) as string] as Record<string, (e: unknown) => void>;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let dom: MiniDom;
let search = "";
beforeEach(() => {
  router.push.mockReset();
  guardedLogin.mockClear();
  signInResult = { status: "settled", transport: "succeeded", session: "authenticated" };
  dom = mountMiniDom({ location: { get search() { return search; }, hash: "", pathname: "/login" } });
});
afterEach(() => dom.restore());

async function signIn(returnTo: string) {
  search = returnTo;
  dom.render(withI18n(React.createElement(LoginForm)));
  await vi.waitFor(() => expect(findAll(dom.container as unknown as Found, "FORM")).toHaveLength(1));
  const root = dom.container as unknown as Found;
  const inputs = findAll(root, "INPUT");
  inputs[0].value = "owner@example.test";
  inputs[1].value = "Correct-Horse-1";
  props(findAll(root, "FORM")[0]).onSubmit({ preventDefault() {} });
  await flush();
}

describe("where the login form returns to after sign-in (PR09-C8)", () => {
  it("from the management page: the clean canonical management address, and the message says so", async () => {
    await signIn(`?returnTo=/reservations/${ID}/manage`);
    expect(guardedLogin).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(`/reservations/${ID}/manage`);
    expect(dom.html()).toContain("Đang chuyển tới đặt phòng của bạn");
  });

  it("the account page and the home page keep their behaviour", async () => {
    await signIn("?returnTo=/account");
    expect(router.push).toHaveBeenLastCalledWith("/account");
    expect(dom.html()).toContain("Đang chuyển tới trang tài khoản");
  });

  it("no return target: the home page", async () => {
    await signIn("");
    expect(router.push).toHaveBeenLastCalledWith("/");
    expect(dom.html()).toContain("Đang chuyển về trang chủ");
  });

  it.each([
    `?returnTo=//evil.example/reservations/${ID}/manage`,
    `?returnTo=https://evil.example/reservations/${ID}/manage`,
    `?returnTo=/reservations/${ID}/manage?x=1`,
    `?returnTo=/reservations/${ID}/manage%23${"A".repeat(43)}`,
    `?returnTo=/reservations/${ID.toUpperCase()}/manage`,
    `?returnTo=/reservations/${ID}/manage/extra`,
    `?returnTo=/reservations/${ID}/manage&returnTo=/account`,
  ])("an invalid target (%s) is never used to navigate: the home page", async (query) => {
    await signIn(query);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith("/");
  });

  it("a sign-in that did not succeed (or whose me does not agree) goes nowhere", async () => {
    signInResult = { status: "settled", transport: "refused", session: "anonymous" };
    await signIn(`?returnTo=/reservations/${ID}/manage`);
    expect(router.push).not.toHaveBeenCalled();
    signInResult = { status: "settled", transport: "succeeded", session: "anonymous" };
    await signIn(`?returnTo=/reservations/${ID}/manage`);
    expect(router.push).not.toHaveBeenCalled();
  });
});
