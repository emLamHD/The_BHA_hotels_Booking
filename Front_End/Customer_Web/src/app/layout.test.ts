import React from "react";
import { describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => () => null);
vi.mock("next/font/google", () => ({ Be_Vietnam_Pro: () => ({ className: "be", variable: "--font-header" }), Poppins: () => ({ className: "poppins" }) }));
vi.mock("@/lib/i18n/server", async () => (await import("@/lib/i18n/testkit")).serverModuleMock());
vi.mock("@/lib/menus/server", () => ({ getMenuSnapshot: async () => null }));
vi.mock("./(client-components)/(Header)/SiteHeader", () => ({ default: stub }));
vi.mock("./ClientCommons", () => ({ default: stub }));
vi.mock("@/components/Footer", () => ({ default: stub }));
vi.mock("@/components/FooterNav", () => ({ default: stub }));
vi.mock("./BookingHoldProvider", () => ({ BookingHoldProvider: stub }));
vi.mock("./CustomerSessionProvider", () => ({ CustomerSessionProvider: stub }));
vi.mock("@/components/HoldReceiptRedirector", () => ({ default: stub }));
vi.mock("@/components/StaySearchProvider", () => ({ StaySearchProvider: stub }));
vi.mock("@/components/FloatingContactActions", () => ({ default: stub }));
import RootLayout from "./layout";
import BlogLocaleSync from "@/components/blog/BlogLocaleSync";
import { I18nProvider } from "@/lib/i18n/I18nProvider";

/** Every element of `type` in the tree the layout returns (its children are props, not yet rendered). */
function find(node: unknown, type: unknown, found: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, type, found));
  else if (React.isValidElement(node)) {
    if (node.type === type) found.push(node);
    find((node.props as { children?: unknown }).children, type, found);
  }
  return found;
}

describe("the root layout", () => {
  it("keeps the Blog language observer mounted for the whole session: once, below the I18n provider, around the pages", async () => {
    const tree = await RootLayout({ children: React.createElement("main", { id: "page" }), params: {} });
    const provider = find(tree, I18nProvider);
    expect(provider).toHaveLength(1);
    expect(find(provider[0], BlogLocaleSync)).toHaveLength(1);
    expect(find(tree, BlogLocaleSync)).toHaveLength(1);
  });
});
