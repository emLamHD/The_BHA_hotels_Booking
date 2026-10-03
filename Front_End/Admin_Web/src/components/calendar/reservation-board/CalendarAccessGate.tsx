"use client";

/**
 * PMS-ADMIN-AUTH-001-CP06: what stands in front of the Reservation Board on
 * `/calendar`.
 *
 * - An invalid `NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE`: a configuration error,
 *   and nothing is sent.
 * - `LocalGate`: the board exactly as before CP06.
 * - `Staff`: no board — and no board or catalog request — until `GET /me` has
 *   confirmed a session. Without one the page goes to `/signin` (once; the sign-in
 *   page never sends anyone back on its own, so there is no loop). A check that
 *   failed is an error with Retry, never a signed-out state. The signed-in Staff
 *   member and Sign out are shown here; Sign out waits while a write of the
 *   board is still waiting for the server.
 *
 * CP06-C1: Sign out and the board's writes exclude each other, decided on two
 * refs at the moment each starts — never on state that has not re-rendered yet.
 * A write that is on the wire holds Sign out; a sign-out that is waiting for the
 * server pauses every write (controls and send-time checks), and the board
 * stays mounted until the sign-out is confirmed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReservationBoard from "./ReservationBoard";
import type { BoardAccess } from "./calendarAccess";
import { getAccessMode } from "@/lib/api/accessMode";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";

export default function CalendarAccessGate() {
  const mode = getAccessMode();
  if (!mode.ok) {
    return (
      <Panel role="alert" testId="calendar-config-error">
        {mode.message}
      </Panel>
    );
  }
  if (mode.mode === "LocalGate") return <ReservationBoard />;
  return (
    <StaffSessionProvider>
      <StaffCalendar />
    </StaffSessionProvider>
  );
}

function StaffCalendar() {
  const { state, refresh, retry, expire, signOut } = useStaffSession();
  const router = useRouter();
  // Reported by the board, synchronously, as each write goes on the wire and gets its answer.
  const [writing, setWriting] = useState(false);
  const writingRef = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  // CP06-C2: which sign-out last settled. The lock reopens in an effect, after the render that
  // carries the re-read roles — the board's own effects, which hand them to its handlers, run first.
  const signOutRunRef = useRef(0);
  const [settledRun, setSettledRun] = useState(0);
  useEffect(() => {
    if (settledRun === signOutRunRef.current) signingOutRef.current = false;
  }, [settledRun]);
  const [signOutMessage, setSignOutMessage] = useState<string | null>(null);

  const handleWriteActivity = useCallback((active: boolean) => {
    writingRef.current = active;
    setWriting(active);
  }, []);
  const isSigningOut = useCallback(() => signingOutRef.current, []);

  useEffect(() => {
    if (state.status === "unauthenticated") router.replace("/signin");
  }, [state.status, router]);

  const handleSignOut = useCallback(async () => {
    if (writingRef.current || signingOutRef.current) return;
    signingOutRef.current = true;
    const run = ++signOutRunRef.current;
    setSigningOut(true);
    setSignOutMessage(null);
    try {
      const outcome = await signOut();
      if (outcome.kind === "unconfirmed") setSignOutMessage(outcome.message);
    } finally {
      // Confirmed: the board is already gone. Unconfirmed: changes resume, on roles re-read if a denial asked
      // for it — the ref only once that render has committed (the effect above).
      setSigningOut(false);
      setSettledRun(run);
    }
  }, [signOut]);

  const memberships = state.status === "authenticated" ? state.session.memberships : null;
  const access = useMemo<BoardAccess | null>(
    () =>
      memberships === null
        ? null
        : {
            mode: "Staff",
            memberships,
            onSessionExpired: expire,
            refreshAccess: refresh,
            onWriteActivityChange: handleWriteActivity,
            signingOut,
            isSigningOut,
          },
    [memberships, expire, refresh, handleWriteActivity, signingOut, isSigningOut]
  );

  if (state.status === "checking") {
    return (
      <Panel role="status" testId="staff-session-checking">
        Checking your Staff session…
      </Panel>
    );
  }
  if (state.status === "error") {
    return (
      <Panel role="alert" testId="staff-session-error">
        <span>{state.message}</span>
        <button
          type="button"
          onClick={retry}
          className="ml-3 rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
        >
          Retry
        </button>
      </Panel>
    );
  }
  if (state.status === "unauthenticated" || access === null) {
    return (
      <Panel role="status" testId="staff-session-required">
        {state.status === "unauthenticated" && state.reason === "expired"
          ? "Your Staff session has ended. "
          : state.status === "unauthenticated" && state.reason === "signed-out"
            ? "You have signed out. "
            : ""}
        Sign in to use the Reservation Board.{" "}
        <Link href="/signin" className="font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400">
          Sign in
        </Link>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="staff-identity"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm dark:border-gray-800 dark:bg-white/[0.03]"
      >
        <span className="text-gray-700 dark:text-gray-200">
          Signed in as <span className="font-medium">{state.session.email}</span>
        </span>
        <div className="flex items-center gap-3">
          {signOutMessage && (
            <span role="alert" className="text-xs text-error-600 dark:text-error-400">
              {signOutMessage}
            </span>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            disabled={writing || signingOut}
            title={writing ? "A change is still waiting for the server; sign out when it has finished." : undefined}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
      <ReservationBoard key={state.session.staffAccountId} access={access} />
    </div>
  );
}

function Panel({
  children,
  role,
  testId,
}: {
  children: React.ReactNode;
  role: "alert" | "status";
  testId: string;
}) {
  return (
    <div
      role={role}
      data-testid={testId}
      className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-200"
    >
      {children}
    </div>
  );
}
