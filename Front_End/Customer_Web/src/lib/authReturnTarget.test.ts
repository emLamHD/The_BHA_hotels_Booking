import { describe, expect, it } from "vitest";
import { LOGIN_FOR_ACCOUNT_HREF, loginForReservationHref, resolveAuthReturnTarget } from "./authReturnTarget";

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

// BHA-CHECKOUT-001-PR09-C8 P3: the canonical management page of one reservation is the only other destination.
const RID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
const MANAGE = `/reservations/${RID}/manage`;

describe("the management page as a return target (PR09-C8)", () => {
  it("is built from the canonical reservation id alone and resolves back to exactly that path", () => {
    const href = loginForReservationHref(RID);
    expect(href).toBe(`/login?returnTo=${MANAGE}`);
    expect(resolveAuthReturnTarget(`?returnTo=${MANAGE}`)).toBe(MANAGE);
    expect(resolveAuthReturnTarget(`returnTo=${MANAGE}`)).toBe(MANAGE);
    expect(resolveAuthReturnTarget(`?returnTo=${encodeURIComponent(MANAGE)}`)).toBe(MANAGE);
    expect(resolveAuthReturnTarget(`?utm=x&returnTo=${MANAGE}`)).toBe(MANAGE);
    expect(href).not.toMatch(/[#]|token|secret/i);
  });

  it("builds nothing for an id that is not canonical (upper case, short, with a path, a query or a fragment)", () => {
    for (const bad of [RID.toUpperCase(), RID.slice(1), `${RID}/x`, `${RID}?a=1`, `${RID}#abc`, "", "../account", RID.replace(/-/g, "")]) {
      expect(loginForReservationHref(bad), bad).toBeNull();
    }
  });

  it("keeps the account page and the home fallback", () => {
    expect(resolveAuthReturnTarget("?returnTo=/account")).toBe("/account");
    expect(resolveAuthReturnTarget("")).toBe("/");
  });

  it.each([
    `?returnTo=${MANAGE}&returnTo=${MANAGE}`,
    `?returnTo=${MANAGE}&returnTo=/account`,
    `?returnTo=${MANAGE}/`,
    `?returnTo=${MANAGE}/extra`,
    `?returnTo=${MANAGE}?x=1`,
    `?returnTo=${MANAGE}%3Fx%3D1`,
    `?returnTo=${MANAGE}#${"A".repeat(43)}`,
    `?returnTo=${MANAGE}%23${"A".repeat(43)}`,
    `?returnTo=/reservations/${RID.toUpperCase()}/manage`,
    `?returnTo=/reservations/${RID.slice(1)}/manage`,
    `?returnTo=/reservations/${RID.replace(/-/g, "")}/manage`,
    `?returnTo=/reservations/${RID}/manage/extra`,
    `?returnTo=/reservations/${RID}`,
    `?returnTo=/reservations//manage`,
    `?returnTo=/reservations/../account/manage`,
    `?returnTo=https://evil.example${MANAGE}`,
    `?returnTo=//evil.example${MANAGE}`,
    `?returnTo=%2F%2Fevil.example${MANAGE}`,
    `?returnTo=/${MANAGE}`,
    `?returnTo=${encodeURIComponent(encodeURIComponent(MANAGE))}`,
    `?returnTo=${MANAGE}%20`,
    `?returnTo=${MANAGE}%0A`,
    `?returnTo=/reservations/${RID}/Manage`,
    `?returnTo=\\reservations\\${RID}\\manage`,
  ])("%s falls back to the home page", (search) => {
    expect(resolveAuthReturnTarget(search)).toBe("/");
  });
});
