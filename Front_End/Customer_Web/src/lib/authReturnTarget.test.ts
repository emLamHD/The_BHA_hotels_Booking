import { describe, expect, it } from "vitest";
import { LOGIN_FOR_ACCOUNT_HREF, resolveAuthReturnTarget } from "./authReturnTarget";

describe("where /login returns to after sign-in", () => {
  it("the account page's own link returns to the account page", () => {
    expect(LOGIN_FOR_ACCOUNT_HREF).toBe("/login?returnTo=/account");
    expect(resolveAuthReturnTarget("?returnTo=/account")).toBe("/account");
    expect(resolveAuthReturnTarget("returnTo=/account")).toBe("/account");
    expect(resolveAuthReturnTarget("?returnTo=%2Faccount")).toBe("/account");
    expect(resolveAuthReturnTarget("?utm=x&returnTo=/account")).toBe("/account");
  });

  it("a direct visit to /login goes to the home page", () => {
    expect(resolveAuthReturnTarget("")).toBe("/");
    expect(resolveAuthReturnTarget("?")).toBe("/");
    expect(resolveAuthReturnTarget("?returnTo=")).toBe("/");
    expect(resolveAuthReturnTarget("?other=/account")).toBe("/");
  });

  it.each([
    "?returnTo=/account&returnTo=/account",
    "?returnTo=/account&returnTo=/",
    "?returnTo=/account/",
    "?returnTo=/account/extra",
    "?returnTo=/Account",
    "?returnTo=/account%20",
    "?returnTo=/account?x=1",
    "?returnTo=account",
    "?returnTo=https://evil.example/account",
    "?returnTo=//evil.example",
    "?returnTo=%2F%2Fevil.example",
    "?returnTo=/%2Fevil.example",
    "?returnTo=%252Faccount",
    "?returnTo=/\\evil.example",
    "?returnTo=javascript:alert(1)",
    "?returnTo=/checkout",
    "?returnTo=/paydone",
    "?returnTo=/login",
    "?returnTo=%",
    "?returnTo[]=/account",
  ])("%s falls back to the home page", (search) => {
    expect(resolveAuthReturnTarget(search)).toBe("/");
  });
});
