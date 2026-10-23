/**
 * BHA-BLOG-001-CP03-C6 (F3): a click on the picture is turned into a point of the PICTURE. jsdom has no layout, so these tests only fix the arithmetic - the
 * rectangle a click is measured against, clamping, and what happens before the picture is there. That the frame really is as big as the picture in a
 * flex column is checked in a real browser (the C6 geometry script), because a mocked rectangle cannot show the layout bug.
 */
import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
let imageAnswer: "ready" | "never" = "ready";
vi.mock("@/lib/api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/blog")>()),
  fetchStaffImage: vi.fn(() => (imageAnswer === "ready" ? Promise.resolve({ kind: "ok", data: new Blob(["x"], { type: "image/png" }) }) : new Promise(() => {}))),
}));

import FocalPicker from "./FocalPicker";
import { EDITOR, renderInBlogGate } from "./blogTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

beforeEach(() => {
  // jsdom has no PointerEvent: without one `fireEvent.pointerDown` drops clientX / clientY.
  (window as { PointerEvent?: unknown }).PointerEvent ??= class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  };
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: EDITOR });
  imageAnswer = "ready";
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const M = "11111111-1111-4111-8111-111111111111";

async function open(onChange = vi.fn()) {
  renderInBlogGate(<FocalPicker mediaId={M} x={0.5} y={0.5} onChange={onChange} />);
  await screen.findByTestId("focal-picker");
  return onChange;
}
const frame = () => screen.getByRole("slider");
const lastPoint = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)!.slice(0, 2);

describe("the focal point is measured against the picture", () => {
  it("not against the frame around it: a frame wider than, or offset from, the picture does not move the point", async () => {
    const onChange = await open();
    const image = await screen.findByTestId("focal-image");
    // A frame that is the whole dialog column (400 wide, 1 px border) with a 200 x 100 picture inside it at (151, 51).
    frame().getBoundingClientRect = () => rect(0, 50, 400, 102);
    image.getBoundingClientRect = () => rect(151, 51, 200, 100);
    fireEvent.pointerDown(frame(), { clientX: 151, clientY: 51, pointerId: 1 }); // the picture's top-left corner
    expect(lastPoint(onChange)).toEqual([0, 0]);
    fireEvent.pointerDown(frame(), { clientX: 351, clientY: 151, pointerId: 1 }); // bottom-right
    expect(lastPoint(onChange)).toEqual([1, 1]);
    fireEvent.pointerDown(frame(), { clientX: 251, clientY: 101, pointerId: 1 }); // centre
    expect(lastPoint(onChange)).toEqual([0.5, 0.5]);
    fireEvent.pointerDown(frame(), { clientX: 201, clientY: 76, pointerId: 1 }); // a quarter in
    expect(lastPoint(onChange)).toEqual([0.25, 0.25]);
  });

  it("a click or drag outside the picture lands on its nearest edge, never outside 0..1", async () => {
    const onChange = await open();
    const image = await screen.findByTestId("focal-image");
    frame().getBoundingClientRect = () => rect(0, 50, 400, 102);
    image.getBoundingClientRect = () => rect(151, 51, 200, 100);
    fireEvent.pointerDown(frame(), { clientX: 20, clientY: 500, pointerId: 1 });
    expect(lastPoint(onChange)).toEqual([0, 1]);
    fireEvent.pointerMove(frame(), { clientX: 9999, clientY: -40, pointerId: 1, buttons: 1 });
    expect(lastPoint(onChange)).toEqual([1, 0]);
  });

  it("a move without the button down changes nothing (drag behaviour kept)", async () => {
    const onChange = await open();
    const image = await screen.findByTestId("focal-image");
    image.getBoundingClientRect = () => rect(0, 0, 200, 100);
    fireEvent.pointerMove(frame(), { clientX: 50, clientY: 50, pointerId: 1, buttons: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("before the picture is there the frame itself is the reference, and a frame with no size is ignored", async () => {
    imageAnswer = "never";
    const onChange = await open();
    expect(screen.queryByTestId("focal-image")).toBeNull();
    frame().getBoundingClientRect = () => rect(10, 10, 100, 50);
    fireEvent.pointerDown(frame(), { clientX: 60, clientY: 35, pointerId: 1 });
    expect(lastPoint(onChange)).toEqual([0.5, 0.5]);
    onChange.mockClear();
    frame().getBoundingClientRect = () => rect(0, 0, 0, 0);
    fireEvent.pointerDown(frame(), { clientX: 5, clientY: 5, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the browser's own drag of the picture is cancelled, so a pointer drag is not interrupted by it", async () => {
    await open();
    const image = await screen.findByTestId("focal-image");
    expect(fireEvent.dragStart(image)).toBe(false); // false: default prevented
  });

  it("the arrow keys still move the point by 0.01, and by 0.1 with Shift", async () => {
    const onChange = await open();
    await waitFor(() => expect(screen.getByTestId("focal-image")).toBeInTheDocument());
    fireEvent.keyDown(frame(), { key: "ArrowRight" });
    expect(lastPoint(onChange)).toEqual([0.51, 0.5]);
    fireEvent.keyDown(frame(), { key: "ArrowUp", shiftKey: true });
    expect(lastPoint(onChange)).toEqual([0.5, 0.4]);
  });
});
