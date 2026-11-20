/**
 * BHA-NEWSLETTER-BADGE-001: the red counter beside "Đăng ký nhận tin" and the dot on its parent, in the expanded, collapsed and mobile sidebar. The count itself comes from the shell's
 * provider (tested there); here it is a number, so each state of the picture is exact.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({ count: 0, pathname: "/", sidebar: { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined } }));

vi.mock("next/navigation", () => ({ usePathname: () => ui.pathname }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ui.sidebar }));
vi.mock("@/components/website/NewsletterBadgeProvider", () => ({ useMenuUnseen: () => ({ newsletter: ui.count }) }));
vi.mock("./SidebarWidget", () => ({ default: () => null }));

import AppSidebar from "./AppSidebar";

const renderSidebar = () => render(<AppSidebar />);

beforeEach(() => {
  ui.count = 0;
  ui.pathname = "/";
  ui.sidebar = { isExpanded: true, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
});
afterEach(cleanup);

describe("the Newsletter badge", () => {
  it("at 0 nothing is shown, on the entry or on its parent", () => {
    renderSidebar();
    expect(screen.queryByTestId("menu-unseen-badge-newsletter")).toBeNull();
    expect(screen.queryByTestId("menu-unseen-dot-parent")).toBeNull();
  });

  it("1 to 99 show the number, with a label that says what it counts", () => {
    ui.count = 5;
    renderSidebar();
    const badge = screen.getByTestId("menu-unseen-badge-newsletter");
    expect(badge.textContent).toBe("5");
    expect(badge.getAttribute("aria-label")).toBe("5 đăng ký nhận tin mới chưa xem");
    cleanup();
    ui.count = 99;
    renderSidebar();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("99");
  });

  it("above 99 it shows 99+, and the label keeps the real number", () => {
    ui.count = 150;
    renderSidebar();
    const badge = screen.getByTestId("menu-unseen-badge-newsletter");
    expect(badge.textContent).toBe("99+");
    expect(badge.getAttribute("aria-label")).toBe("150 đăng ký nhận tin mới chưa xem");
  });

  it("is on 'Đăng ký nhận tin' only: not on the sender page entry, Blog or any other, and the template labels are untouched", () => {
    ui.count = 4;
    renderSidebar();
    expect(screen.getAllByTestId("menu-unseen-badge-newsletter")).toHaveLength(1);
    const entry = screen.getByText("Đăng ký nhận tin").closest("a")!;
    expect(entry.querySelector('[data-testid="menu-unseen-badge-newsletter"]')).not.toBeNull();
    const sender = screen.getByText("Cấu hình email gửi").closest("a")!;
    expect(sender.querySelector('[data-testid="menu-unseen-badge-newsletter"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b(new|pro)\b/);                             // the badge never turns into a template `new`/`pro` label
  });

  it("while the Website submenu is closed the parent shows a dot; opening it hides the dot and the entry carries the number", () => {
    ui.count = 2;
    renderSidebar();
    expect(screen.getByTestId("menu-unseen-dot-parent")).toBeTruthy();
    fireEvent.click(screen.getByText("Website").closest("button")!);
    expect(screen.queryByTestId("menu-unseen-dot-parent")).toBeNull();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("2");
    fireEvent.click(screen.getByText("Website").closest("button")!);                           // closed again: the dot is back
    expect(screen.getByTestId("menu-unseen-dot-parent")).toBeTruthy();
  });

  it("being on the Newsletter page opens the submenu by itself, which is not 'seen' (the badge stays)", () => {
    ui.count = 3;
    ui.pathname = "/website/newsletter";
    renderSidebar();
    expect(screen.queryByTestId("menu-unseen-dot-parent")).toBeNull();
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("3");
  });

  it("a collapsed sidebar shows only the dot, on the Website icon", () => {
    ui.count = 3;
    ui.sidebar = { isExpanded: false, isMobileOpen: false, isHovered: false, setIsHovered: () => undefined };
    renderSidebar();
    expect(screen.getByTestId("menu-unseen-dot-parent")).toBeTruthy();
    expect(screen.queryByTestId("menu-unseen-badge-newsletter")).toBeNull();                    // the submenu is not drawn while collapsed
    expect(screen.queryByText("Website")).toBeNull();
  });

  it("the mobile drawer shows the same entry, badge and dot", () => {
    ui.count = 120;
    ui.sidebar = { isExpanded: false, isMobileOpen: true, isHovered: false, setIsHovered: () => undefined };
    renderSidebar();
    expect(screen.getByTestId("menu-unseen-dot-parent")).toBeTruthy();
    fireEvent.click(screen.getByText("Website").closest("button")!);
    expect(screen.getByTestId("menu-unseen-badge-newsletter").textContent).toBe("99+");
  });
});
