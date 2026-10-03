/**
 * PMS-ADMIN-AUTH-001-CP06 evidence groups 4, 5 and 11: the session state, and
 * answers that arrive too late to matter.
 */
import React, { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSessionResult, StaffLogoutOutcome } from "@/lib/api/staff";

vi.mock("@/lib/api/staff", () => ({ fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));

import { fetchStaffSession, staffLogout } from "@/lib/api/staff";
import { StaffSessionProvider, useStaffSession, type StaffRefreshResult } from "./StaffSession";

const mockedMe = vi.mocked(fetchStaffSession);
const mockedLogout = vi.mocked(staffLogout);

const session = (staffAccountId: string, role = "FrontDesk") => ({
  staffAccountId,
  email: `${staffAccountId}@example.com`,
  memberships: [{ propertyId: "prop-a", propertyName: "Property A", timeZone: "UTC", role }],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The provider's API as the probe last rendered it (captured after render). */
const probe: { api: ReturnType<typeof useStaffSession> | null } = { api: null };
function Probe() {
  const value = useStaffSession();
  useEffect(() => {
    probe.api = value;
  });
  const { state } = value;
  return (
    <p data-testid="state">
      {state.status}
      {state.status === "authenticated" ? `:${state.session.staffAccountId}:${state.session.memberships[0]?.role}` : ""}
      {state.status === "unauthenticated" ? `:${state.reason}` : ""}
    </p>
  );
}

const renderProvider = () =>
  render(
    <StaffSessionProvider>
      <Probe />
    </StaffSessionProvider>
  );

beforeEach(() => {
  mockedMe.mockReset();
  mockedLogout.mockReset();
});

describe("StaffSessionProvider", () => {
  it("is checking until me answers, then authenticated", async () => {
    const me = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(me.promise);
    renderProvider();
    expect(screen.getByTestId("state")).toHaveTextContent("checking");
    await act(async () => me.resolve({ kind: "authenticated", session: session("staff-1") }));
    expect(screen.getByTestId("state")).toHaveTextContent("authenticated:staff-1:FrontDesk");
  });

  it("treats only me 401 as signed out; an error stays an error until Retry", async () => {
    mockedMe.mockResolvedValueOnce({ kind: "error", message: "Could not reach the Admin API." });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("error"));
    mockedMe.mockResolvedValueOnce({ kind: "unauthenticated" });
    act(() => probe.api!.retry());
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("unauthenticated:none"));
  });

  it("a refresh updates roles in place; a refresh that finds no session is reported, not applied", async () => {
    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: session("staff-1", "Manager") });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("Manager"));
    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: session("staff-1", "FrontDesk") });
    let result: StaffRefreshResult | undefined;
    await act(async () => {
      result = await probe.api!.refresh();
    });
    expect(result).toBe("authenticated");
    expect(screen.getByTestId("state")).toHaveTextContent("authenticated:staff-1:FrontDesk");
    mockedMe.mockResolvedValueOnce({ kind: "unauthenticated" });
    await act(async () => {
      result = await probe.api!.refresh();
    });
    expect(result).toBe("unauthenticated");
    // The caller (the board) decides when to end the session, after its writes are settled.
    expect(screen.getByTestId("state")).toHaveTextContent("authenticated");
  });

  it("drops a refresh answer that arrives after the session was ended", async () => {
    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: session("staff-1") });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("authenticated"));
    const late = deferred<StaffSessionResult>();
    mockedMe.mockReturnValueOnce(late.promise);
    let refreshed: Promise<StaffRefreshResult> | undefined;
    act(() => {
      refreshed = probe.api!.refresh();
    });
    act(() => probe.api!.expire());
    await act(async () => late.resolve({ kind: "authenticated", session: session("staff-1") }));
    expect(await refreshed).toBe("superseded");
    expect(screen.getByTestId("state")).toHaveTextContent("unauthenticated:expired");
  });

  describe("CP06-C1: nothing supersedes a sign-out that is waiting for the server", () => {
    const signedIn = async (role = "Manager") => {
      mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: session("staff-1", role) });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent(`authenticated:staff-1:${role}`));
    };

    it.each([
      ["204", { kind: "logged-out" } as const],
      ["401", { kind: "session-ended" } as const],
    ])("signOut → refresh → logout %s ends the session; the refresh reads nothing", async (_status, confirmed) => {
      await signedIn();
      const logout = deferred<StaffLogoutOutcome>();
      mockedLogout.mockReturnValueOnce(logout.promise);
      mockedMe.mockResolvedValue({ kind: "authenticated", session: session("staff-1") });
      let signedOut: Promise<StaffLogoutOutcome> | undefined;
      let refreshed: Promise<StaffRefreshResult> | undefined;
      act(() => {
        signedOut = probe.api!.signOut();
      });
      act(() => {
        refreshed = probe.api!.refresh();
      });
      expect(mockedMe).toHaveBeenCalledTimes(1); // the initial check only
      await act(async () => logout.resolve(confirmed));
      expect((await signedOut)?.kind).toBe(confirmed.kind);
      expect(await refreshed).toBe("superseded");
      expect(screen.getByTestId("state")).toHaveTextContent("unauthenticated:signed-out");
      expect(mockedMe).toHaveBeenCalledTimes(1);
    });

    it("a me read already on the wire when sign-out starts never restores the session, even if the transport ignores abort", async () => {
      await signedIn();
      const late = deferred<StaffSessionResult>();
      mockedMe.mockReturnValueOnce(late.promise); // resolves whatever the abort signal says
      const logout = deferred<StaffLogoutOutcome>();
      mockedLogout.mockReturnValueOnce(logout.promise);
      let refreshed: Promise<StaffRefreshResult> | undefined;
      act(() => {
        refreshed = probe.api!.refresh();
      });
      act(() => {
        void probe.api!.signOut();
      });
      await act(async () => logout.resolve({ kind: "logged-out" }));
      await act(async () => late.resolve({ kind: "authenticated", session: session("staff-1") }));
      expect(await refreshed).toBe("superseded");
      expect(screen.getByTestId("state")).toHaveTextContent("unauthenticated:signed-out");
    });

    it("an unconfirmed sign-out runs the refresh asked for meanwhile once, after it, and reports back only when its roles apply", async () => {
      await signedIn("Manager");
      const logout = deferred<StaffLogoutOutcome>();
      mockedLogout.mockReturnValueOnce(logout.promise);
      const me = deferred<StaffSessionResult>();
      mockedMe.mockReturnValueOnce(me.promise);
      let signOutDone = false;
      let refreshed: Promise<StaffRefreshResult> | undefined;
      act(() => {
        void probe.api!.signOut().then(() => {
          signOutDone = true;
        });
      });
      act(() => {
        refreshed = probe.api!.refresh();
      });
      expect(mockedMe).toHaveBeenCalledTimes(1);
      await act(async () => logout.resolve({ kind: "unconfirmed", message: "not confirmed" }));
      // The re-read is on the wire now; until it answers, sign-out has not reported back
      // (the page keeps changes paused on the memberships it was told to check).
      expect(mockedMe).toHaveBeenCalledTimes(2);
      expect(signOutDone).toBe(false);
      expect(screen.getByTestId("state")).toHaveTextContent("authenticated:staff-1:Manager");
      await act(async () => me.resolve({ kind: "authenticated", session: session("staff-1", "FrontDesk") }));
      expect(await refreshed).toBe("authenticated");
      expect(signOutDone).toBe(true);
      expect(screen.getByTestId("state")).toHaveTextContent("authenticated:staff-1:FrontDesk");

      // Positive control: after it, a refresh reads me at once again.
      mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: session("staff-1", "Manager") });
      let again: StaffRefreshResult | undefined;
      await act(async () => {
        again = await probe.api!.refresh();
      });
      expect(again).toBe("authenticated");
      expect(mockedMe).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("state")).toHaveTextContent("authenticated:staff-1:Manager");
    });
  });

  it("signs out only on a confirmed outcome; an unconfirmed one leaves the session as it is", async () => {
    mockedMe.mockResolvedValueOnce({ kind: "authenticated", session: session("staff-1") });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("authenticated"));
    mockedLogout.mockResolvedValueOnce({ kind: "unconfirmed", message: "not confirmed" });
    let outcome: StaffLogoutOutcome | undefined;
    await act(async () => {
      outcome = await probe.api!.signOut();
    });
    expect(outcome?.kind).toBe("unconfirmed");
    expect(screen.getByTestId("state")).toHaveTextContent("authenticated");
    for (const confirmed of [{ kind: "logged-out" } as const, { kind: "session-ended" } as const]) {
      mockedLogout.mockResolvedValueOnce(confirmed);
      await act(async () => {
        await probe.api!.signOut();
      });
      expect(screen.getByTestId("state")).toHaveTextContent("unauthenticated:signed-out");
    }
  });
});
