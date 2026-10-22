/**
 * BHA-BLOG-001-CP03: the upload queue (design §9.6). One at a time; "sent" is not "stored"; a failure keeps its siblings; nothing is resent by itself;
 * a lost answer or a duplicate id is read back and compared by SHA-256 before it is believed; "send again" keeps the picture's id.
 */
import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlogMedia, UploadOutcome } from "@/lib/api/blog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/api/blog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/blog")>()), uploadMedia: vi.fn(), getMedia: vi.fn() }));

import { useUploadQueue, type UploadItem } from "./useUploadQueue";
import { EDITOR, deferred, ok, renderInBlogGate } from "./blogTestUtils";
import { getMedia, uploadMedia } from "@/lib/api/blog";
import { fetchStaffSession } from "@/lib/api/staff";

const upload = vi.mocked(uploadMedia);
const lookup = vi.mocked(getMedia);

interface Call { file: File; id: string; progress: (sent: number, total: number) => void; settle: (outcome: UploadOutcome) => void; abort: ReturnType<typeof vi.fn> }
const calls: Call[] = [];
/** When true, abort() asks the request to stop but does NOT settle it: the request is "still unwinding" until the test settles it. */
let holdAbort = false;

const media = (id: string, sha: string | null): BlogMedia => ({
  id, contentType: "image/png", byteSize: 10, width: 800, height: 600, createdAtUtc: "2026-10-21T08:00:00Z", displayName: "x", originalFileName: "x.png", description: "", credit: "", sourceUrl: "",
  licence: "", focalX: 0.5, focalY: 0.5, version: 1, pipeline: "current", originalSha256: sha, updatedAtUtc: "2026-10-21T08:00:00Z", variants: [], usage: { revisions: 0, inPublished: 0, inDrafts: 0 },
});

let queue: ReturnType<typeof useUploadQueue> | null = null;
const uploaded = vi.fn();
const hash = vi.fn(async (file: Blob) => `sha-of-${(file as File).name}`);

function Probe() {
  const q = useUploadQueue({ onUploaded: uploaded, hash });
  React.useEffect(() => { queue = q; });
  return <ul>{q.items.map((i: UploadItem) => <li key={i.key} data-testid="item" data-status={i.status} data-name={i.file.name}>{i.file.name}:{i.status}:{i.message ?? ""}</li>)}</ul>;
}

const png = (name: string, size = 1000, type = "image/png") => new File([new Uint8Array(size)], name, { type });
const statuses = () => screen.queryAllByTestId("item").map((li) => `${li.getAttribute("data-name")}=${li.getAttribute("data-status")}`);
const add = (...files: File[]) => act(() => { queue!.add(files); });
const settle = async (index: number, outcome: UploadOutcome) => { await act(async () => { calls[index].settle(outcome); await Promise.resolve(); }); };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: EDITOR });
  calls.length = 0;
  holdAbort = false;
  queue = null;
  uploaded.mockReset();
  lookup.mockReset();
  upload.mockReset();
  upload.mockImplementation(((file: File, id: string, progress: Call["progress"]) => {
    const gate = deferred<UploadOutcome>();
    const abort = vi.fn(() => { if (!holdAbort) gate.resolve({ kind: "aborted" }); });
    calls.push({ file, id, progress, settle: gate.resolve, abort });
    return { done: gate.promise, abort };
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function start() {
  renderInBlogGate(<Probe />);
  await waitFor(() => expect(queue).not.toBeNull());
}

describe("sending", () => {
  it("sends one picture at a time, each under an id of its own", async () => {
    await start();
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(statuses()).toEqual(["a.png=sending", "b.png=waiting"]);
    await settle(0, { kind: "ok", media: media(calls[0].id, "sha-of-a.png") });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].id).not.toBe(calls[1].id);
    expect(statuses()).toEqual(["a.png=done", "b.png=sending"]);
  });

  it("does not call the picture stored when the bytes are all sent — only the answer does", async () => {
    await start();
    add(png("a.png", 2000));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => calls[0].progress(1000, 2000));
    expect(statuses()).toEqual(["a.png=sending"]);
    act(() => calls[0].progress(2000, 2000));
    expect(statuses()).toEqual(["a.png=processing"]);
    expect(uploaded).not.toHaveBeenCalled();
    await settle(0, { kind: "ok", media: media(calls[0].id, "x") });
    expect(statuses()).toEqual(["a.png=done"]);
    expect(uploaded).toHaveBeenCalledTimes(1);
  });

  it("keeps the siblings of a picture the server refused", async () => {
    await start();
    add(png("bad.png"), png("good.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, { kind: "refused", status: 400, code: "hero-image-corrupt", detail: "Ảnh hỏng." });
    await waitFor(() => expect(calls).toHaveLength(2));
    await settle(1, { kind: "ok", media: media(calls[1].id, "x") });
    expect(statuses()).toEqual(["bad.png=failed", "good.png=done"]);
  });

  it("refuses on the device what the server would refuse, and sends nothing for it", async () => {
    await start();
    add(png("note.txt", 10, "text/plain"), png("huge.png", 11 * 1024 * 1024), png("empty.png", 0));
    expect(statuses()).toEqual(["note.txt=failed", "huge.png=failed", "empty.png=failed"]);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("an answer that never came", () => {
  it("is unconfirmed, is not resent, and asks the server by the picture's id", async () => {
    await start();
    add(png("a.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, { kind: "unconfirmed", message: "Mất kết nối." });
    expect(statuses()).toEqual(["a.png=unconfirmed"]);
    await new Promise((r) => setTimeout(r, 30));
    expect(upload).toHaveBeenCalledTimes(1);

    lookup.mockResolvedValue({ kind: "refused", status: 404, code: "blog.not-found", field: "id", detail: "" } as never);
    await act(async () => { await queue!.reconcile(queue!.items[0].key); });
    expect(lookup).toHaveBeenCalledWith(calls[0].id);
    expect(queue!.items[0]).toMatchObject({ status: "unconfirmed", absentOnServer: true });
    expect(upload).toHaveBeenCalledTimes(1);

    // Only now may it be sent again — by the person, with the same id.
    act(() => queue!.resend(queue!.items[0].key));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].id).toBe(calls[0].id);
  });

  it("is done when the server has the picture and its SHA-256 is this file's", async () => {
    await start();
    add(png("a.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, { kind: "unconfirmed", message: "Hết giờ." });
    lookup.mockResolvedValue(ok(media(calls[0].id, "sha-of-a.png")) as never);
    await act(async () => { await queue!.reconcile(queue!.items[0].key); });
    expect(statuses()).toEqual(["a.png=done"]);
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("is not offered a re-send before the server has been asked", async () => {
    await start();
    add(png("a.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, { kind: "unconfirmed", message: "Mất kết nối." });
    act(() => queue!.resend(queue!.items[0].key));
    await new Promise((r) => setTimeout(r, 30));
    expect(upload).toHaveBeenCalledTimes(1);
  });
});

describe("a duplicate id", () => {
  it("is read back and believed only when the hash is the same file's", async () => {
    await start();
    add(png("a.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    lookup.mockResolvedValue(ok(media("any", "sha-of-a.png")) as never);
    await settle(0, { kind: "duplicate" });
    await waitFor(() => expect(statuses()).toEqual(["a.png=done"]));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("is a failure, not a success, when the id belongs to a different picture", async () => {
    await start();
    add(png("a.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    lookup.mockResolvedValue(ok(media("any", "sha-of-another.png")) as never);
    await settle(0, { kind: "duplicate" });
    await waitFor(() => expect(statuses()).toEqual(["a.png=failed"]));
    expect(uploaded).not.toHaveBeenCalled();
  });
});

describe("cancelling", () => {
  it("stops what is waiting and aborts the one on the wire — which is unconfirmed, not failed", async () => {
    await start();
    add(png("a.png"), png("b.png"), png("c.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => queue!.cancel());
    await waitFor(() => expect(statuses()[0]).toBe("a.png=unconfirmed"));
    expect(calls[0].abort).toHaveBeenCalled();
    expect(statuses().slice(1)).toEqual(["b.png=cancelled", "c.png=cancelled"]);
    await new Promise((r) => setTimeout(r, 30));
    expect(upload).toHaveBeenCalledTimes(1);
    // A cancelled one never sent may go again with its id; the aborted one must be looked up first.
    act(() => queue!.resend(queue!.items[1].key));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].file.name).toBe("b.png");
  });
});

/** Lets everything already queued run (promises, effects) without waiting for a clock. */
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

describe("C2 F3 — cancel, resend and the drain that is still unwinding", () => {
  it("a picture resent while the cancelled one is still unwinding is sent once, after it settles", async () => {
    holdAbort = true;
    await start();
    add(png("a.png"), png("b.png"), png("c.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => queue!.cancel());
    expect(calls[0].abort).toHaveBeenCalled();
    expect(statuses()).toEqual(["a.png=sending", "b.png=cancelled", "c.png=cancelled"]); // A is still on the wire: its abort has not settled
    const b = queue!.items[1];
    act(() => queue!.resend(b.key));
    expect(statuses()[1]).toBe("b.png=waiting");
    await flush();
    expect(upload).toHaveBeenCalledTimes(1); // only one request at a time: B waits for A to unwind

    await settle(0, { kind: "aborted" });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].file.name).toBe("b.png");
    expect(calls[1].id).toBe(b.id); // the same id
    await settle(1, { kind: "ok", media: media(calls[1].id, "sha-of-b.png") });
    await flush();
    expect(statuses()).toEqual(["a.png=unconfirmed", "b.png=done", "c.png=cancelled"]); // A: the server may have it; C: never asked for
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("several clicks on Resend send the picture once", async () => {
    holdAbort = true;
    await start();
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => queue!.cancel());
    const key = queue!.items[1].key;
    act(() => { queue!.resend(key); queue!.resend(key); queue!.resend(key); });
    await settle(0, { kind: "aborted" });
    await waitFor(() => expect(calls).toHaveLength(2));
    await settle(1, { kind: "ok", media: media(calls[1].id, "x") });
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("does not restart the other cancelled pictures", async () => {
    holdAbort = true;
    await start();
    add(png("a.png"), png("b.png"), png("c.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => queue!.cancel());
    act(() => queue!.resend(queue!.items[2].key)); // only C
    await settle(0, { kind: "aborted" });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].file.name).toBe("c.png");
    await settle(1, { kind: "ok", media: media(calls[1].id, "x") });
    await flush();
    expect(statuses()).toEqual(["a.png=unconfirmed", "b.png=cancelled", "c.png=done"]);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("a second cancel while the resent picture is on the wire stops it the same way", async () => {
    holdAbort = true;
    await start();
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => queue!.cancel());
    act(() => queue!.resend(queue!.items[1].key));
    await settle(0, { kind: "aborted" });
    await waitFor(() => expect(calls).toHaveLength(2));
    act(() => queue!.cancel());
    expect(calls[1].abort).toHaveBeenCalled();
    await settle(1, { kind: "aborted" });
    await flush();
    expect(statuses()).toEqual(["a.png=unconfirmed", "b.png=unconfirmed"]);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("when the cancelled picture fails instead of aborting, the resent one is still sent", async () => {
    holdAbort = true;
    await start();
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => queue!.cancel());
    act(() => queue!.resend(queue!.items[1].key));
    await settle(0, { kind: "refused", status: 400, code: "hero-image-corrupt", detail: "Ảnh hỏng." });
    await waitFor(() => expect(calls).toHaveLength(2));
    await settle(1, { kind: "ok", media: media(calls[1].id, "x") });
    await flush();
    expect(statuses()).toEqual(["a.png=failed", "b.png=done"]);
  });

  it("a resend after everything is idle is sent, and a picture that is done is never sent again", async () => {
    await start();
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, { kind: "ok", media: media(calls[0].id, "x") });
    await waitFor(() => expect(calls).toHaveLength(2));
    act(() => queue!.cancel());
    await flush();
    expect(statuses()).toEqual(["a.png=done", "b.png=unconfirmed"]);
    act(() => queue!.resend(queue!.items[0].key)); // A is done: nothing to send
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
