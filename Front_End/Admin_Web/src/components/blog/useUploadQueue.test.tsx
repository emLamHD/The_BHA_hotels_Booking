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
import { useWebsiteHost, type WebsiteHost } from "@/components/website/WebsiteAccessGate";
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
  vi.mocked(fetchStaffSession).mockClear();
  calls.length = 0;
  holdAbort = false;
  queue = null;
  uploaded.mockReset();
  lookup.mockReset();
  lookup.mockResolvedValue({ kind: "error", status: 503, message: "offline" });
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


// ---------------------------------------------------------------------------------------------------------------------------------------------
// BHA-BLOG-001-CP03-C6 (F2): the queue belongs to the component that made it. When that component goes away - the person leaves the page - nothing
// that is waiting is sent any more and the one on the wire is aborted; what the aborted one meant to the server is still unknown (`unconfirmed`).
// The write slot belongs to the host, which stays: it is given back when the request ends, whenever that is.

let host: WebsiteHost | null = null;
function HostProbe() {
  const h = useWebsiteHost();
  React.useEffect(() => { host = h; });
  return null;
}
/** The page that owns the queue can be removed on its own, like a navigation inside the Admin app: the gate (the host) stays. */
function Shell({ strict = false }: { strict?: boolean }) {
  const [on, setOn] = React.useState(true);
  const page = on ? <Probe /> : null;
  return <><button type="button" data-testid="leave" onClick={() => setOn(false)} />{strict ? <React.StrictMode>{page}</React.StrictMode> : page}<HostProbe /></>;
}
async function startShell(strict = false) {
  host = null;
  renderInBlogGate(<Shell strict={strict} />);
  await waitFor(() => expect(queue).not.toBeNull());
  await waitFor(() => expect(host).not.toBeNull());
}
const leave = async () => { await act(async () => { screen.getByTestId("leave").click(); }); };
/** True when the host's single write slot is free (and takes it, so the caller gives it back). */
const slotIsFree = () => { let free = false; act(() => { free = host!.beginWrite(); if (free) host!.endWrite(); }); return free; };

describe("C6 F2 — leaving the page stops the queue", () => {
  it("the picture on the wire is aborted, the ones waiting are never sent, and the write slot stays held until the request has ended", async () => {
    holdAbort = true; // the abort is asked for, but the request has not ended yet
    await startShell();
    add(png("a.png"), png("b.png"), png("c.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await leave();
    expect(calls[0].abort).toHaveBeenCalledTimes(1);
    expect(slotIsFree()).toBe(false); // the request is still unwinding: the slot is still its own
    await settle(0, { kind: "aborted" });
    await flush();
    expect(upload).toHaveBeenCalledTimes(1); // b and c were never sent
    expect(slotIsFree()).toBe(true);
    expect(uploaded).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each<[string, UploadOutcome]>([
    ["is aborted", { kind: "aborted" }],
    ["ends with the picture stored (the answer came before the abort took hold)", { kind: "ok", media: media("x", "h") }],
    ["is refused", { kind: "refused", status: 400, code: null, detail: "no" }],
    ["is not confirmed", { kind: "unconfirmed", message: "lost" }],
    ["finds the id already there", { kind: "duplicate" }],
  ])("when the picture on the wire %s after the page is gone, the next one is still not sent and nothing is read or announced", async (_name, outcome) => {
    holdAbort = true;
    await startShell();
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await leave();
    await settle(0, outcome);
    await flush();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled(); // not even for a duplicate id: the page that would show the result is gone
    expect(uploaded).not.toHaveBeenCalled();
    expect(slotIsFree()).toBe(true);
  });

  it("does not delete or retry anything: the aborted picture is just left as the server has it", async () => {
    await startShell();
    add(png("a.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await leave();
    await flush();
    expect(calls[0].abort).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a handle that was taken from the old queue cannot start work after the page is gone", async () => {
    await startShell();
    const old = queue!;
    await leave();
    act(() => { old.add([png("late.png")]); });
    await flush();
    expect(upload).not.toHaveBeenCalled();
    act(() => old.resend("nothing"));
    await flush();
    expect(upload).not.toHaveBeenCalled();
  });

  it("a page opened afterwards starts empty and works; the old queue's late answer does not touch it", async () => {
    holdAbort = true;
    await startShell();
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await leave();
    cleanup();
    queue = null;
    uploaded.mockReset();
    await startShell(); // a new page, new queue
    expect(statuses()).toEqual([]);
    add(png("n.png"));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].file.name).toBe("n.png");
    await settle(0, { kind: "ok", media: media(calls[0].id, "h") }); // the old page's picture answers late
    await flush();
    expect(uploaded).not.toHaveBeenCalled();
    expect(statuses()).toEqual(["n.png=sending"]);
    expect(upload).toHaveBeenCalledTimes(2); // b was never sent
  });

  it("React's setup-cleanup-setup check (StrictMode) leaves the live queue working: pictures are sent one after another", async () => {
    await startShell(true);
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, { kind: "ok", media: media(calls[0].id, "sha-of-a.png") });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].file.name).toBe("b.png");
    expect(uploaded).toHaveBeenCalledTimes(1);
    await leave();
    await settle(1, { kind: "ok", media: media(calls[1].id, "sha-of-b.png") });
    await flush();
    expect(uploaded).toHaveBeenCalledTimes(1); // after leaving, nothing more is announced
  });

  it("C2 regression: cancel then resend on a page that is still there is unchanged", async () => {
    await startShell();
    add(png("a.png"), png("b.png"));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => queue!.cancel());
    await waitFor(() => expect(statuses()).toEqual(["a.png=unconfirmed", "b.png=cancelled"]));
    act(() => queue!.resend(queue!.items[1].key));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].file.name).toBe("b.png");
  });
});

// C11 F2: deferred read replies control the real hook's operation ordering, without timers.
const notFound = { kind: "refused" as const, status: 404, code: "blog.not-found", field: "id", detail: "absent" };
type ReadResult = Awaited<ReturnType<typeof getMedia>>;
async function uncertain() {
  await startShell();
  add(png("a.png"));
  await settle(0, { kind: "unconfirmed", message: "lost" });
  lookup.mockResolvedValueOnce(notFound);
  await act(async () => queue!.reconcile(queue!.items[0].key));
  expect(queue!.items[0]).toMatchObject({ status: "unconfirmed", absentOnServer: true });
  return queue!.items[0].key;
}
function checkLater(key: string) {
  const reply = deferred<ReadResult>();
  lookup.mockReturnValueOnce(reply.promise);
  act(() => { void queue!.reconcile(key); });
  return reply;
}
const oldReplies: [string, () => ReadResult][] = [
  ["404", () => notFound],
  ["found matching", () => ok(media(calls[0].id, "sha-of-a.png"))],
  ["found different", () => ok(media(calls[0].id, "different"))],
  ["error", () => ({ kind: "error", status: 503, message: "offline" })],
  ["401", () => ({ kind: "unauthenticated" })],
  ["403", () => ({ kind: "denied" })],
];

describe("C11 F2 — older reconciliation never overwrites newer work", () => {
  it.each(oldReplies)("late %s during resend cannot change state, busy, callbacks or slot ownership", async (_name, reply) => {
    const key = await uncertain();
    const old = checkLater(key);
    act(() => queue!.resend(key));
    expect(calls).toHaveLength(2);
    act(() => calls[1].progress(300, 1000));
    await act(async () => old.resolve(reply()));
    expect(queue!.items[0]).toMatchObject({ id: calls[0].id, status: "sending", sent: 300, absentOnServer: false, message: null });
    expect(queue!.busy).toBe(true);
    expect(slotIsFree()).toBe(false);
    expect(uploaded).not.toHaveBeenCalled();
    expect(calls[1].abort).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchStaffSession)).toHaveBeenCalledTimes(1);
    await settle(1, { kind: "ok", media: media(calls[1].id, "sha-of-a.png") });
    expect(queue!.busy).toBe(false);
    expect(slotIsFree()).toBe(true);
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.id)).toEqual([calls[0].id, calls[0].id]);
  });

  it.each(["success", "error"])("send %s stays authoritative when the old 404 arrives after it", async (outcome) => {
    const key = await uncertain();
    const old = checkLater(key);
    act(() => queue!.resend(key));
    await settle(1, outcome === "success" ? { kind: "ok", media: media(calls[1].id, "sha-of-a.png") } : { kind: "unconfirmed", message: "new send lost" });
    const before = queue!.items[0];
    await act(async () => old.resolve(notFound));
    expect(queue!.items[0]).toEqual(before);
    expect(queue!.items[0].absentOnServer).toBe(false);
    expect(queue!.busy).toBe(false);
    expect(slotIsFree()).toBe(true);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it.each(["found", "error"])("two checks resolve in reverse: newer %s wins over old 404", async (answer) => {
    const key = await uncertain();
    const old = checkLater(key);
    const newer = checkLater(key);
    await act(async () => newer.resolve(answer === "found" ? ok(media(calls[0].id, "sha-of-a.png")) : { kind: "error", status: 503, message: "offline" }));
    const before = queue!.items[0];
    await act(async () => old.resolve(notFound));
    expect(queue!.items[0]).toEqual(before);
    expect(uploaded).toHaveBeenCalledTimes(answer === "found" ? 1 : 0);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("a matching hash finishing after resend cannot announce success", async () => {
    const key = await uncertain();
    const hashing = deferred<string>();
    hash.mockReturnValueOnce(hashing.promise);
    lookup.mockResolvedValueOnce(ok(media(calls[0].id, "sha-of-a.png")));
    act(() => { void queue!.reconcile(key); });
    await act(async () => { await Promise.resolve(); });
    act(() => queue!.resend(key));
    await act(async () => hashing.resolve("sha-of-a.png"));
    expect(queue!.items[0].status).toBe("sending");
    expect(queue!.busy).toBe(true);
    expect(uploaded).not.toHaveBeenCalled();
    expect(slotIsFree()).toBe(false);
  });

  it("cancel leaves an unrelated check alive; dismiss and unmount invalidate their own checks", async () => {
    const key = await uncertain();
    const old = checkLater(key);
    add(png("b.png"));
    act(() => queue!.cancel());
    await settle(1, { kind: "aborted" });
    await act(async () => old.resolve(notFound));
    expect(queue!.items[0]).toMatchObject({ status: "unconfirmed", absentOnServer: true });
    expect(queue!.items[1].status).toBe("unconfirmed");
    expect(uploaded).not.toHaveBeenCalled();
    const hidden = checkLater(key);
    act(() => queue!.dismiss(key));
    await act(async () => hidden.resolve(ok(media(calls[0].id, "sha-of-a.png"))));
    expect(queue!.items).toHaveLength(1);
    expect(uploaded).not.toHaveBeenCalled();
    const oldQueue = queue!;
    const gone = checkLater(queue!.items[0].key);
    await leave();
    act(() => { void oldQueue.reconcile(oldQueue.items[0].key); });
    expect(lookup).toHaveBeenCalledTimes(4); // no request after unmount
    cleanup(); queue = null;
    await startShell();
    add(png("new.png"));
    await act(async () => gone.resolve(notFound));
    expect(statuses()).toEqual(["new.png=sending"]);
    expect(queue!.busy).toBe(true);
    expect(slotIsFree()).toBe(false);
    expect(uploaded).not.toHaveBeenCalled();
    expect(calls[2].abort).not.toHaveBeenCalled();
  });

  it("a send does not invalidate another item's check, and following items still drain", async () => {
    const key = await uncertain();
    const old = checkLater(key);
    add(png("b.png"), png("c.png"));
    await act(async () => old.resolve(ok(media(calls[0].id, "sha-of-a.png"))));
    expect(statuses()).toEqual(["a.png=done", "b.png=sending", "c.png=waiting"]);
    expect(queue!.busy).toBe(true);
    expect(slotIsFree()).toBe(false);
    await settle(1, { kind: "refused", status: 400, code: null, detail: "bad b" });
    expect(calls).toHaveLength(3);
    await settle(2, { kind: "ok", media: media(calls[2].id, "sha-of-c.png") });
    expect(statuses()).toEqual(["a.png=done", "b.png=failed", "c.png=done"]);
    expect(queue!.busy).toBe(false);
    expect(slotIsFree()).toBe(true);
    expect(uploaded).toHaveBeenCalledTimes(2);
    expect(calls.every((call) => call.abort.mock.calls.length === 0)).toBe(true);
  });
});


describe("C11 operation boundary guards", () => {
  it("an old 404 before a failed resend cannot permit another retry; following items still drain", async () => {
    const key = await uncertain();
    const old = checkLater(key);
    act(() => queue!.resend(key));
    add(png("next.png"));
    await act(async () => old.resolve(notFound));
    act(() => { void queue!.reconcile(key); queue!.resend(key); queue!.dismiss(key); });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(queue!.items[0].status).toBe("sending");
    expect(queue!.busy).toBe(true);
    await settle(1, { kind: "unconfirmed", message: "resend lost" });
    expect(calls).toHaveLength(3);
    expect(queue!.items[0]).toMatchObject({ status: "unconfirmed", absentOnServer: false, message: "resend lost" });
    act(() => queue!.resend(key));
    await settle(2, { kind: "ok", media: media(calls[2].id, "sha-of-next.png") });
    expect(calls).toHaveLength(3);
    expect(queue!.busy).toBe(false);
    expect(slotIsFree()).toBe(true);
  });

  it.each([false, true])("a hash error is handled only for its current operation (superseded=%s)", async (superseded) => {
    const key = await uncertain();
    let reject!: (error: Error) => void;
    const failedHash = new Promise<string>((_resolve, fail) => { reject = fail; });
    hash.mockReturnValueOnce(failedHash);
    lookup.mockResolvedValueOnce(ok(media(calls[0].id, "sha-of-a.png")));
    let checking!: Promise<void>;
    let rejected: unknown;
    act(() => { checking = queue!.reconcile(key).catch((error) => { rejected = error; }); });
    await act(async () => { await Promise.resolve(); });
    if (superseded) act(() => queue!.resend(key));
    const before = queue!.items[0];
    await act(async () => { reject(new Error("cannot hash")); await checking; });
    expect(rejected).toBeUndefined();
    if (superseded) {
      expect(queue!.items[0]).toEqual(before);
      expect(queue!.busy).toBe(true);
      expect(slotIsFree()).toBe(false);
    } else {
      expect(queue!.items[0].status).toBe("unconfirmed");
      expect(queue!.items[0].message).toContain("Chưa kiểm tra được");
    }
    expect(uploaded).not.toHaveBeenCalled();
  });
});
