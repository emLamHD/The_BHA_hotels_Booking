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
