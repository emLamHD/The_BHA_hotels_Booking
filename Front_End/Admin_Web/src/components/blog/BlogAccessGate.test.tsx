/**
 * BHA-BLOG-001-CP03: who gets into the Blog pages (display only; the server decides again on every request). A Blog-only account is let in without the
 * website-settings permission, and gets nothing else of the website from that; an account with only the website permission or only a Property role is not.
 */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSession } from "@/lib/api/staff";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));

import BlogAccessGate, { useBlogRights } from "./BlogAccessGate";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import { BOTH, EDITOR, PUBLISHER, session } from "./blogTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";

const mockedMe = vi.mocked(fetchStaffSession);

function Rights() {
  const rights = useBlogRights();
  return <div data-testid="rights">{JSON.stringify(rights)}</div>;
}

beforeEach(() => {
  replace.mockReset();
  mockedMe.mockReset();
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const as = (s: StaffSession) => mockedMe.mockResolvedValue({ kind: "authenticated", session: s });

describe("the Blog gate", () => {
  it.each([
    ["edit only", EDITOR, { access: true, edit: true, publish: false }],
    ["publish only", PUBLISHER, { access: true, edit: false, publish: true }],
    ["both", BOTH, { access: true, edit: true, publish: true }],
  ])("lets %s in and says what they may do", async (_name, who, rights) => {
    as(who);
    render(<BlogAccessGate returnTo="/website/blog/posts"><Rights /></BlogAccessGate>);
    expect(JSON.parse((await screen.findByTestId("rights")).textContent!)).toEqual(rights);
  });

  it.each([
    ["no permission at all", session([])],
    ["only the website-settings permission", session(["WebsiteSettingsManage"])],
    ["a Property Manager role", { ...session([]), memberships: [{ propertyId: "p", propertyName: "P", timeZone: "UTC", role: "Manager" as const }] }],
  ])("keeps out %s, with the reason and no page", async (_name, who) => {
    as(who);
    render(<BlogAccessGate returnTo="/website/blog/posts"><Rights /></BlogAccessGate>);
    expect(await screen.findByTestId("website-no-permission")).toHaveTextContent(/không có quyền với Blog/);
    expect(screen.queryByTestId("rights")).toBeNull();
  });

  it("does not turn a Blog permission into the website-settings page", async () => {
    as(BOTH);
    render(<WebsiteAccessGate returnTo="/website/hero"><div data-testid="hero">hero</div></WebsiteAccessGate>);
    expect(await screen.findByTestId("website-no-permission")).toBeInTheDocument();
    expect(screen.queryByTestId("hero")).toBeNull();
  });

  it("sends nobody to the Blog page without a session; sign-in comes back to the page asked for", async () => {
    mockedMe.mockResolvedValue({ kind: "unauthenticated" });
    render(<BlogAccessGate returnTo="/website/blog/categories"><Rights /></BlogAccessGate>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/signin?returnTo=%2Fwebsite%2Fblog%2Fcategories"));
    expect(screen.queryByTestId("rights")).toBeNull();
  });
});
