/**
 * BHA-NEWSLETTER-001-C2: `useWebsiteList` says whether the data it holds answers the load that is in flight. It keeps the
 * previous data while loading (every screen relies on that), so `pending` is the only way for a screen to tell the two apart.
 */
import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  fetchStaffSession: vi.fn(),
  staffLogout: vi.fn(),
}));

import { useWebsiteList } from "./useWebsiteData";
import WebsiteAccessGate from "./WebsiteAccessGate";
import { ALLOWED, deferred, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import type { WebsiteResult } from "@/lib/api/website";

const loads: Array<ReturnType<typeof deferred<WebsiteResult<string>>>> = [];
const load = vi.fn(() => {
  const next = deferred<WebsiteResult<string>>();
  loads.push(next);
  return next.promise;
});

const renders: Array<{ dep: number; pending: boolean }> = [];
function Probe({ dep }: { dep: number }) {
  const list = useWebsiteList(load, [dep]);
  renders.push({ dep, pending: list.pending });
  return (
    <p data-testid="probe">
      {list.state.status}|{list.state.status === "ready" ? list.state.data : ""}|{String(list.pending)}
    </p>
  );
}
const gated = (dep: number) => <WebsiteAccessGate returnTo="/website/languages"><Probe dep={dep} /></WebsiteAccessGate>;
const probe = () => screen.getByTestId("probe").textContent;
/** The load starts in an effect, after the probe is in the DOM: wait for the n-th call before answering it. */
const started = (n: number) => waitFor(() => expect(load).toHaveBeenCalledTimes(n));

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  loads.length = 0;
  renders.length = 0;
  load.mockClear();
});
afterEach(cleanup);

describe("useWebsiteList.pending", () => {
  it("is true until the load in flight has answered, and keeps the previous data meanwhile", async () => {
    const view = renderInGate(<Probe dep={1} />);
    await screen.findByTestId("probe");
    await started(1);
    expect(probe()).toBe("loading||true");
    await act(async () => loads[0].resolve(ok("one")));
    expect(probe()).toBe("ready|one|false");

    view.rerender(gated(2));
    await started(2);
    expect(probe()).toBe("ready|one|true");
    await act(async () => loads[1].resolve(ok("two")));
    expect(probe()).toBe("ready|two|false");
  });

  it("is already true in the first render with new deps, before the effect that starts the load has run", async () => {
    const view = renderInGate(<Probe dep={1} />);
    await screen.findByTestId("probe");
    await started(1);
    await act(async () => loads[0].resolve(ok("one")));
    renders.length = 0;
    view.rerender(gated(2));
    expect(renders[0]).toEqual({ dep: 2, pending: true });
  });

  it("is not settled by an answer that belongs to an older load", async () => {
    const view = renderInGate(<Probe dep={1} />);
    await screen.findByTestId("probe");
    await started(1);
    await act(async () => loads[0].resolve(ok("one")));
    view.rerender(gated(2));
    await started(2);
    view.rerender(gated(3));
    await started(3);

    await act(async () => loads[1].resolve(ok("stale")));
    expect(probe()).toBe("ready|one|true");
    await act(async () => loads[2].resolve(ok("three")));
    expect(probe()).toBe("ready|three|false");
  });

  it("is false after a failure", async () => {
    renderInGate(<Probe dep={1} />);
    await screen.findByTestId("probe");
    await started(1);
    await act(async () => loads[0].resolve({ kind: "error", message: "boom" } as never));
    expect(probe()).toBe("error||false");
  });
});
