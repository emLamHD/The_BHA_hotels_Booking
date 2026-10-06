import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MainNav2 from "@/app/(client-components)/(Header)/MainNav2";
import Footer from "./Footer";
import NavMobile from "@/shared/Navigation/NavMobile";
import StaySearchForm from "@/app/(client-components)/(HeroSearchForm)/(stay-search-form)/StaySearchForm";

// The logo imports a bundled image, which the node test environment has no loader for.
vi.mock("@/shared/Logo", () => ({
  default: () => React.createElement("a", { href: "/" }, "The BHA Riverside"),
}));

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the public header, footer, mobile menu and hero search lead only to
 * the home page and its sections — never to a template route the middleware answers with 404, and
 * never to account, login, notification, template-purchase or social controls.
 */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
const allowed = new Set(["/", "/#rooms", "/#services"]);

describe.each([
  ["header", () => React.createElement(MainNav2)],
  ["footer", () => React.createElement(Footer)],
  ["mobile menu", () => React.createElement(NavMobile)],
  ["hero stay search", () => React.createElement(StaySearchForm)],
])("%s", (_name, render) => {
  const html = renderToStaticMarkup(render());

  it("links only to the home page and its sections", () => {
    for (const href of hrefs(html)) expect(allowed.has(href)).toBe(true);
  });

  it("has no template-purchase, account, notification, language or social controls", () => {
    for (const forbidden of ["Get Template", "themeforest", "Sign up", "Log in", "List your property", "facebook", "twitter", "Installation", "Release Notes"]) {
      expect(html).not.toContain(forbidden);
    }
  });
});
