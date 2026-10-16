import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuSnapshot } from "./menu";
import { createMenuPoller, MENU_POLL_MS } from "./poller";

const menu = (revision: string): MenuSnapshot => ({ revision, locale: "vi", generatedAt: Date.now(), primary: [], secondary: [] });

function harness(over: { visible?: () => boolean; fetchMenu?: (signal: AbortSignal) => Promise<MenuSnapshot | null> } = {}) {
  const log = { fetches: 0, menus: [] as string[], stale: [] as boolean[], signals: [] as AbortSignal[] };
  const poller = createMenuPoller({
    intervalMs: 10_000,
    isVisible: over.visible ?? (() => true),
    fetchMenu:
      over.fetchMenu ??
      (async (signal) => {
        log.fetches++;
        log.signals.push(signal);
        return menu(`r${log.fetches}`);
      }),
    onMenu: (m) => log.menus.push(m.revision),
    onStale: (flag) => log.stale.push(flag),
  });
  return { poller, log };
}

describe("the menu's freshness loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks once per interval — one loop however many components read the menu — and stops completely", async () => {
    const { poller, log } = harness();
    poller.start();
    poller.start(); // a second start is not a second loop
    await vi.advanceTimersByTimeAsync(35_000);
    expect(log.fetches).toBe(3);
    poller.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log.fetches).toBe(3);
  });

  it("the default interval keeps a changed menu visible well inside the 15 seconds the Admin promises", () => {
    expect(MENU_POLL_MS).toBeLessThanOrEqual(10_000);
  });

  it("asks for nothing while the tab is hidden, and checks at once when it is asked to once visible", async () => {
    let visible = false;
    const { poller, log } = harness({ visible: () => visible });
    poller.start();
    await vi.advanceTimersByTimeAsync(30_000);
    poller.checkNow();
    expect(log.fetches).toBe(0);
    visible = true;
    poller.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.fetches).toBe(1);
    poller.stop();
  });

  it("never overlaps two checks: a check asked for while one is running is dropped", async () => {
    let release: (m: MenuSnapshot) => void = () => undefined;
    let started = 0;
    const { poller, log } = harness({
      fetchMenu: () => {
        started++;
        return new Promise<MenuSnapshot | null>((resolve) => (release = resolve));
      },
    });
    poller.start();
    poller.checkNow();
    poller.checkNow();
    await vi.advanceTimersByTimeAsync(15_000); // the timer fires while the first is still pending
    expect(started).toBe(1);
    release(menu("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(log.menus).toEqual(["late"]);
    poller.stop();
  });

  it("a failure keeps what is on screen (only flags it stale) and the next success clears the flag", async () => {
    let fail = true;
    const { poller, log } = harness({
      fetchMenu: async () => {
        if (fail) throw new Error("HTTP 500");
        return menu("ok");
      },
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log.menus).toEqual([]);
    expect(log.stale).toEqual([true]);
    fail = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log.menus).toEqual(["ok"]);
    expect(log.stale).toEqual([true, false]);
    poller.stop();
  });

  it("a body that is not a menu is a failure, not an empty menu", async () => {
    const { poller, log } = harness({ fetchMenu: async () => null });
    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log.menus).toEqual([]);
    expect(log.stale).toEqual([true]);
    poller.stop();
  });

  it("stopping aborts the request in flight and its late answer is ignored", async () => {
    let release: (m: MenuSnapshot) => void = () => undefined;
    let signal: AbortSignal | undefined;
    const { poller, log } = harness({
      fetchMenu: (s) => {
        signal = s;
        return new Promise<MenuSnapshot | null>((resolve) => (release = resolve));
      },
    });
    poller.start();
    poller.checkNow();
    poller.stop();
    expect(signal?.aborted).toBe(true);
    release(menu("after-stop"));
    await vi.advanceTimersByTimeAsync(0);
    expect(log.menus).toEqual([]);
    expect(log.stale).toEqual([]);
  });
});
