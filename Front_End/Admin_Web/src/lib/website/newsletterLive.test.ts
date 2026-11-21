/**
 * BHA-NEWSLETTER-LIVE-001: the connection manager against a controlled transport. A fake connection records every call, so what is asserted is the ORDER the library
 * would see (handlers before `start`), what happens to a failed first start, a 401/403 and a network failure, the back-off, and that `dispose` leaves nothing behind
 * in any phase: waiting for the factory, in the middle of a start, connected, or between two attempts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_READY_EVENT,
  LIVE_VERIFIED_EVENT,
  startNewsletterLive,
  type LiveConnectionLike,
  type LiveHandlers,
  type LiveStatus,
} from "./newsletterLive";

type Handler = (...args: unknown[]) => void;

class FakeConnection implements LiveConnectionLike {
  calls: string[] = [];
  handlers = new Map<string, Handler>();
  closeCallback: ((error?: Error) => void) | null = null;
  startResult: { resolve(): void; reject(error: unknown): void } | null = null;
  stopped = 0;
  constructor(private readonly onStart: (connection: FakeConnection) => Promise<void>) {}
  on(method: string, handler: Handler) {
    this.calls.push(`on:${method}`);
    this.handlers.set(method, handler);
  }
  off(method: string, handler: Handler) {
    this.calls.push(`off:${method}`);
    if (this.handlers.get(method) === handler) this.handlers.delete(method);
  }
  onclose(callback: (error?: Error) => void) {
    this.calls.push("onclose");
    this.closeCallback = callback;
  }
  start() {
    this.calls.push("start");
    return this.onStart(this);
  }
  stop() {
    this.calls.push("stop");
    this.stopped += 1;
    // Stopping during a start makes that start fail, as the real library does.
    this.startResult?.reject(new Error("The connection was stopped during negotiation."));
    return Promise.resolve();
  }
  emit(method: string, ...args: unknown[]) {
    this.handlers.get(method)?.(...args);
  }
}

const hold = (connection: FakeConnection) => new Promise<void>((resolve, reject) => { connection.startResult = { resolve, reject }; });
const httpError = (statusCode: number) => Object.assign(new Error(`Status code '${statusCode}'`), { statusCode });
/** What @microsoft/signalr 8 really throws from `start()` when the negotiate call is answered with an HTTP error: no `statusCode`, the status only in the text. */
const negotiateError = (statusCode: number) =>
  Object.assign(new Error(`Failed to complete negotiation with the server: Error: ${statusCode === 403 ? "Forbidden" : "Error"}: Status code '${statusCode}'`), { errorType: "FailedToNegotiateWithServerError" });
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

function setup(starts: Array<(connection: FakeConnection) => Promise<void>> = [() => Promise.resolve()], target: { ok: true; url: string } | { ok: false; message: string } = { ok: true, url: "https://api.test/hub" }) {
  const connections: FakeConnection[] = [];
  let index = 0;
  const statuses: Array<[LiveStatus, string | undefined]> = [];
  const handlers = {
    onReady: vi.fn(),
    onSignal: vi.fn(),
    onStatus: vi.fn((status: LiveStatus, reason?: string) => { statuses.push([status, reason]); }),
    onUnauthenticated: vi.fn(),
    onDenied: vi.fn(),
  } satisfies LiveHandlers;
  const factory = vi.fn(async () => {
    const start = starts[Math.min(index, starts.length - 1)];
    index += 1;
    const connection = new FakeConnection(start);
    connections.push(connection);
    return connection;
  });
  const controller = startNewsletterLive({ target, handlers, factory, backoffMs: [100, 200, 500] });
  return { controller, connections, handlers, factory, statuses };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("starting", () => {
  it("registers every handler before it starts, then reports connected", async () => {
    const { connections, handlers, statuses } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(connections).toHaveLength(1);
    expect(connections[0].calls).toEqual([`on:${LIVE_VERIFIED_EVENT}`, `on:${LIVE_READY_EVENT}`, "onclose", "start"]);
    expect(statuses.map(([status]) => status)).toEqual(["connecting", "connected"]);
    expect(handlers.onUnauthenticated).not.toHaveBeenCalled();
  });

  it("hands over a well-formed signal and the ready message, and ignores anything else", async () => {
    const { connections, handlers } = setup();
    await vi.advanceTimersByTimeAsync(0);
    connections[0].emit(LIVE_VERIFIED_EVENT, { eventId: "e1", occurredAtUtc: "2026-11-19T01:00:00Z" });
    connections[0].emit(LIVE_VERIFIED_EVENT, { occurredAtUtc: "x" });
    connections[0].emit(LIVE_VERIFIED_EVENT, "not an object");
    connections[0].emit(LIVE_VERIFIED_EVENT);
    connections[0].emit(LIVE_READY_EVENT);
    expect(handlers.onSignal).toHaveBeenCalledTimes(1);
    expect(handlers.onSignal).toHaveBeenCalledWith({ eventId: "e1", occurredAtUtc: "2026-11-19T01:00:00Z" });
    expect(handlers.onReady).toHaveBeenCalledTimes(1);
  });

  it("another Hub's message names and message check (the shared activity hint): it listens to those only, with no event id needed, and detaches them on dispose", async () => {
    const connections: FakeConnection[] = [];
    const handlers = { onReady: vi.fn(), onSignal: vi.fn(), onStatus: vi.fn(), onUnauthenticated: vi.fn(), onDenied: vi.fn() } satisfies LiveHandlers;
    const controller = startNewsletterLive({
      target: { ok: true, url: "https://api.test/hub" },
      handlers,
      events: { signal: "menuActivity", ready: "menuActivityReady", isSignal: (value) => typeof value === "object" && value !== null && "menuKey" in value },
      factory: async () => {
        const connection = new FakeConnection(() => Promise.resolve());
        connections.push(connection);
        return connection;
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(connections[0].calls).toEqual(["on:menuActivity", "on:menuActivityReady", "onclose", "start"]);
    connections[0].emit(LIVE_VERIFIED_EVENT, { eventId: "e1" });                       // the Newsletter Hub's message is not this Hub's
    connections[0].emit("menuActivity", { menuKey: "calendar", propertyId: "p-1" });
    connections[0].emit("menuActivity", "noise");
    connections[0].emit("menuActivityReady");
    expect(handlers.onSignal).toHaveBeenCalledTimes(1);
    // BHA-ADMIN-BADGE-001-PR14: what the hint names is handed over (the menu and the Property) and nothing else; a hint without a Property carries none.
    expect(handlers.onSignal).toHaveBeenCalledWith({ eventId: "", occurredAtUtc: "", menuKey: "calendar", propertyId: "p-1" });
    connections[0].emit("menuActivity", { menuKey: "newsletter", title: "x@example.com", count: 9 });
    expect(handlers.onSignal).toHaveBeenLastCalledWith({ eventId: "", occurredAtUtc: "", menuKey: "newsletter" });
    expect(handlers.onReady).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(connections[0].calls).toContain("off:menuActivity");
    expect(connections[0].calls).toContain("off:menuActivityReady");
  });

  it("without an address (not Staff mode, no API URL) it stays stopped and builds nothing", async () => {
    const { factory, statuses, controller } = setup([() => Promise.resolve()], { ok: false, message: "no url" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(factory).not.toHaveBeenCalled();
    expect(statuses).toEqual([["stopped", "config"]]);
    controller.dispose();
  });
});

describe("failures", () => {
  it("retries a failed FIRST start with a back-off, and goes on until it connects (a network failure is never a sign-out)", async () => {
    const fail = () => Promise.reject(new TypeError("Failed to fetch"));
    const { connections, handlers, statuses } = setup([fail, fail, () => Promise.resolve()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(connections).toHaveLength(1);
    expect(statuses.at(-1)).toEqual(["retrying", undefined]);

    await vi.advanceTimersByTimeAsync(99);
    expect(connections).toHaveLength(1);                                                   // first delay is 100 ms
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(connections).toHaveLength(2);                                                   // second delay is 200 ms
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(3);
    expect(statuses.at(-1)).toEqual(["connected", undefined]);
    expect(handlers.onUnauthenticated).not.toHaveBeenCalled();
    expect(handlers.onDenied).not.toHaveBeenCalled();
    // The failed attempts left nothing listening.
    expect(connections[0].handlers.size).toBe(0);
    expect(connections[1].handlers.size).toBe(0);
    expect(connections[2].handlers.size).toBe(2);
  });

  it("the last back-off repeats and a success starts the back-off over", async () => {
    const fail = () => Promise.reject(new Error("down"));
    const { connections } = setup([fail, fail, fail, fail, () => Promise.resolve()]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(500);
    expect(connections).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(499);
    expect(connections).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(5);
    connections[4].closeCallback?.();                                                      // lost after a success: back to the first delay
    await vi.advanceTimersByTimeAsync(99);
    expect(connections).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(6);
  });

  it("a 401 on the negotiate call stops the retries and tells the caller once; a 403 does the same with its own reason", async () => {
    const unauthorized = setup([() => Promise.reject(httpError(401))]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(unauthorized.connections).toHaveLength(1);
    expect(unauthorized.handlers.onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(unauthorized.handlers.onDenied).not.toHaveBeenCalled();
    expect(unauthorized.statuses.at(-1)).toEqual(["stopped", "unauthenticated"]);

    const forbidden = setup([() => Promise.reject(httpError(403))]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(forbidden.connections).toHaveLength(1);
    expect(forbidden.handlers.onDenied).toHaveBeenCalledTimes(1);
    expect(forbidden.handlers.onUnauthenticated).not.toHaveBeenCalled();
    expect(forbidden.statuses.at(-1)).toEqual(["stopped", "denied"]);
  });

  it("the library's own negotiate failure (status only in its text) is read the same way: 401 and 403 stop, 500 and a lost network retry", async () => {
    const unauthorized = setup([() => Promise.reject(negotiateError(401))]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(unauthorized.handlers.onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(unauthorized.connections).toHaveLength(1);
    expect(unauthorized.statuses.at(-1)).toEqual(["stopped", "unauthenticated"]);

    const forbidden = setup([() => Promise.reject(negotiateError(403))]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(forbidden.handlers.onDenied).toHaveBeenCalledTimes(1);
    expect(forbidden.connections).toHaveLength(1);
    expect(forbidden.statuses.at(-1)).toEqual(["stopped", "denied"]);

    for (const failure of [negotiateError(500), new Error("Failed to complete negotiation with the server: TypeError: Failed to fetch")]) {
      const retried = setup([() => Promise.reject(failure), () => Promise.resolve()]);
      await vi.advanceTimersByTimeAsync(100);
      expect(retried.connections).toHaveLength(2);
      expect(retried.handlers.onUnauthenticated).not.toHaveBeenCalled();
      expect(retried.handlers.onDenied).not.toHaveBeenCalled();
    }
  });

  it("other HTTP errors (500, 502, 404) only retry", async () => {
    for (const code of [500, 502, 404]) {
      const { connections, handlers } = setup([() => Promise.reject(httpError(code)), () => Promise.resolve()]);
      await vi.advanceTimersByTimeAsync(100);
      expect(connections).toHaveLength(2);
      expect(handlers.onUnauthenticated).not.toHaveBeenCalled();
      expect(handlers.onDenied).not.toHaveBeenCalled();
    }
  });

  it("retryNow is the way out of a stop, and does nothing while an attempt is on its way", async () => {
    const { controller, connections, handlers } = setup([() => Promise.reject(httpError(403)), () => Promise.resolve()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.onDenied).toHaveBeenCalledTimes(1);
    controller.retryNow();
    controller.retryNow();                                                                  // the second finds an attempt already running
    await vi.advanceTimersByTimeAsync(0);
    expect(connections).toHaveLength(2);
    expect(connections[1].calls).toContain("start");
  });

  it("a factory that fails is retried like a start that fails", async () => {
    const connections: FakeConnection[] = [];
    let calls = 0;
    const factory = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("chunk failed to load");
      const connection = new FakeConnection(() => Promise.resolve());
      connections.push(connection);
      return connection;
    });
    const handlers = { onReady: vi.fn(), onSignal: vi.fn(), onStatus: vi.fn(), onUnauthenticated: vi.fn(), onDenied: vi.fn() };
    startNewsletterLive({ target: { ok: true, url: "https://api.test/hub" }, handlers, factory, backoffMs: [100] });
    await vi.advanceTimersByTimeAsync(100);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(connections).toHaveLength(1);
    expect(handlers.onStatus).toHaveBeenLastCalledWith("connected");
  });
});

describe("reconnecting", () => {
  it("a lost connection is replaced by a new one after the first delay; the old one is detached and stopped, and the ready message of the new one is delivered", async () => {
    const { connections, handlers, statuses } = setup();
    await vi.advanceTimersByTimeAsync(0);
    connections[0].closeCallback?.(new Error("socket closed"));
    expect(statuses.at(-1)).toEqual(["retrying", undefined]);
    expect(connections[0].handlers.size).toBe(0);
    expect(connections[0].stopped).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(connections).toHaveLength(2);
    expect(statuses.at(-1)).toEqual(["connected", undefined]);
    connections[1].emit(LIVE_READY_EVENT);
    expect(handlers.onReady).toHaveBeenCalledTimes(1);
    // A late event of the old connection reaches nobody.
    connections[0].emit(LIVE_VERIFIED_EVENT, { eventId: "late", occurredAtUtc: "" });
    expect(handlers.onSignal).not.toHaveBeenCalled();
  });

  it("a 401 while reconnecting stops the loop (the permission or session went away while the screen was open)", async () => {
    const { connections, handlers } = setup([() => Promise.resolve(), () => Promise.reject(httpError(401))]);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].closeCallback?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(handlers.onUnauthenticated).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connections).toHaveLength(2);
  });
});

describe("dispose", () => {
  it("while connected: removes the handlers, stops the connection, and a late close schedules nothing", async () => {
    const { controller, connections, factory } = setup();
    await vi.advanceTimersByTimeAsync(0);
    controller.dispose();
    expect(connections[0].handlers.size).toBe(0);
    expect(connections[0].stopped).toBe(1);
    connections[0].closeCallback?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("in the middle of a start: the connection is stopped, the rejected start is swallowed and nothing is retried (Strict Mode)", async () => {
    const { controller, connections, handlers, factory } = setup([hold]);
    await vi.advanceTimersByTimeAsync(0);
    expect(connections[0].calls.at(-1)).toBe("start");
    controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connections[0].stopped).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(handlers.onUnauthenticated).not.toHaveBeenCalled();
    expect(handlers.onDenied).not.toHaveBeenCalled();
    expect(connections[0].handlers.size).toBe(0);
  });

  it("while the factory is still loading: the connection it then builds is released before it starts", async () => {
    let release!: (connection: FakeConnection) => void;
    const slow = new Promise<FakeConnection>((resolve) => { release = resolve; });
    const handlers = { onReady: vi.fn(), onSignal: vi.fn(), onStatus: vi.fn(), onUnauthenticated: vi.fn(), onDenied: vi.fn() };
    const controller = startNewsletterLive({ target: { ok: true, url: "https://api.test/hub" }, handlers, factory: () => slow });
    controller.dispose();
    const late = new FakeConnection(() => Promise.resolve());
    release(late);
    await flush();
    expect(late.calls).not.toContain("start");
    expect(late.handlers.size).toBe(0);
    expect(late.stopped).toBe(1);
  });

  it("between two attempts: the waiting timer is cancelled", async () => {
    const { controller, factory } = setup([() => Promise.reject(new Error("down")), () => Promise.resolve()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("start, dispose, start again (React Strict Mode): exactly one live connection with its handlers, the first one fully released", async () => {
    const first = setup([hold]);
    await vi.advanceTimersByTimeAsync(0);
    first.controller.dispose();
    const second = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.connections[0].handlers.size).toBe(0);
    expect(second.connections).toHaveLength(1);
    expect(second.connections[0].handlers.size).toBe(2);
    expect(second.handlers.onStatus).toHaveBeenLastCalledWith("connected");
    expect(first.handlers.onStatus).not.toHaveBeenCalledWith("connected");
  });
});
