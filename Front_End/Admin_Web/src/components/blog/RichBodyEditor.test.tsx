/**
 * BHA-BLOG-001-CP03: the real editor (TipTap in jsdom): a stored body opens and comes back out unchanged, an unknown block survives, a body of another
 * schema version is shown and not edited, and a toolbar command changes the body the screen is told about.
 */
import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/blog")>()), fetchStaffImage: vi.fn(() => Promise.resolve({ kind: "config", message: "no image in tests" })) }));

import RichBodyEditor, { type BodyState } from "./RichBodyEditor";
import type { BodyEditorServices } from "./BodyEditorContext";
import { EDITOR, renderInBlogGate } from "./blogTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";

// ProseMirror measures the page when it scrolls a selection into view; jsdom has no layout.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: EDITOR });
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const services = (over: Partial<BodyEditorServices> = {}): BodyEditorServices => ({ editable: true, properties: [{ id: "44444444-4444-4444-8444-444444444444", name: "Riverside" }], pickMedia: vi.fn(), ...over });

const BODY = {
  schemaVersion: 1,
  blocks: [
    { type: "heading", level: 2, text: "Giới thiệu" },
    { type: "paragraph", inlines: [{ text: "Đây là " }, { text: "đậm", bold: true }, { text: " và " }, { text: "liên kết", href: "/blog" }] },
    { type: "list", ordered: true, items: [[{ text: "Một" }], [{ text: "Hai", italic: true }]] },
    { type: "quote", inlines: [{ text: "Trích" }], cite: "Nguồn" },
    { type: "image", mediaId: M1, alt: "Biển", caption: "Mỹ Khê" },
    { type: "gallery", items: [{ mediaId: M1, alt: "a" }, { mediaId: M2, alt: "b", caption: "c" }] },
    { type: "toc" },
    { type: "propertyIntro", propertyId: "44444444-4444-4444-8444-444444444444" },
  ],
};

async function open(initialBody: unknown, over: Partial<BodyEditorServices> = {}) {
  const states: BodyState[] = [];
  renderInBlogGate(<RichBodyEditor initialBody={initialBody} services={services(over)} onChange={(s) => states.push(s)} />);
  await screen.findByTestId("body-editor").catch(() => null);
  return states;
}

describe("the real editor", () => {
  it("opens a stored body and reports exactly the same body, with no problem", async () => {
    const states = await open(BODY);
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    const last = states[states.length - 1];
    expect(last.problems).toEqual([]);
    expect(last.body).toEqual(BODY);
  });

  it("draws the atom blocks it edits in place", async () => {
    await open(BODY);
    expect(await screen.findByTestId("block-Ảnh")).toBeInTheDocument();
    expect(screen.getByTestId("block-Thư viện ảnh")).toBeInTheDocument();
    expect(screen.getByTestId("block-Mục lục")).toBeInTheDocument();
    expect(screen.getByLabelText("Cơ sở lưu trú")).toHaveValue("44444444-4444-4444-8444-444444444444");
    expect(screen.getAllByTestId("gallery-item")).toHaveLength(2);
  });

  it("keeps a block it does not understand and says so", async () => {
    const strange = { type: "video", url: "https://example.com/v" };
    const states = await open({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "Trước" }] }, strange] });
    expect(await screen.findByTestId("block-Khối chưa hỗ trợ")).toHaveTextContent("video");
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    expect(states[states.length - 1].body?.blocks[1]).toEqual(strange);
  });

  it("shows a body of another schema version as it is and does not make it editable", async () => {
    const states = await open({ schemaVersion: 2, blocks: [{ type: "new" }] });
    expect(await screen.findByTestId("body-locked")).toHaveTextContent(/phiên bản cấu trúc 2/);
    expect(screen.queryByTestId("body-editor")).toBeNull();
    expect(states).toEqual([]); // nothing to send but the stored body, which the screen keeps
  });

  it("offers no toolbar to someone who may not edit", async () => {
    await open(BODY, { editable: false });
    await screen.findByTestId("body-editor");
    expect(screen.queryByTestId("body-toolbar")).toBeNull();
    expect(screen.getByLabelText("Cơ sở lưu trú")).toBeDisabled();
  });

  it("adds a contents block from the toolbar and reports it", async () => {
    const states = await open({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "Một đoạn" }] }] });
    await screen.findByTestId("body-toolbar");
    await userEvent.click(screen.getByRole("button", { name: "Mục lục" }));
    await waitFor(() => expect(states[states.length - 1].body?.blocks.map((b) => b.type)).toEqual(["paragraph", "toc"]));
  });

  it("flags a text with angle brackets instead of rewriting it", async () => {
    const states = await open({ schemaVersion: 1, blocks: [{ type: "paragraph", inlines: [{ text: "a < b" }] }] });
    await waitFor(() => expect(states.length).toBeGreaterThan(0));
    const last = states[states.length - 1];
    expect(last.problems).toHaveLength(1);
    expect(last.body?.blocks[0]).toEqual({ type: "paragraph", inlines: [{ text: "a < b" }] });
  });
});
