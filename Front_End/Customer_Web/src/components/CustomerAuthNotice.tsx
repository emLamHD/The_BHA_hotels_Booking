"use client";

import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import {
  AuthCommand,
  AuthPresentation,
  AuthSubmissionOwner,
  AuthTone,
  AuthUiResult,
  createAuthSubmissionOwner,
  describeSessionNotice,
  isStalePresentation,
  presentIdentityCommandResult,
} from "@/lib/customerAuthUi";
import type { IdentityCommandResult } from "@/lib/customerIdentityChange";
import { buildRoomDetailsHref, inProgressBookingTarget } from "@/lib/roomDetailsRoute";

import { useT } from "@/lib/i18n/I18nProvider";
/**
 * CUST-WEB-001-CP02: the shared auth status UI. It only renders what `lib/customerAuthUi` decides from the
 * provider's state; the only way it reaches the API is a guarded command passed in by its caller.
 */

const TONE_CLASS: Record<AuthTone, string> = {
  success: "text-green-700 dark:text-green-400",
  error: "text-red-600 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-400",
  info: "text-neutral-600 dark:text-neutral-300",
};

const LINK_CLASS = "font-medium underline underline-offset-2";
const REFRESH_CLASS =
  "mt-2 inline-flex rounded-full border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700";

/** "Kiểm tra lại": a read of `me` only — it never repeats a login or logout. */
const RefreshButton: FC<{ onClick: () => void }> = ({ onClick }) => {
  const t = useT();
  return (
  <button type="button" onClick={onClick} className={REFRESH_CLASS}>{t("customer.customerAuthNotice.checkAgain")}</button>
);
};

/** What the provider says is going on with the session: checking, busy (booking locked) or needing a re-check. */
export const CustomerSessionNotice: FC<{ className?: string }> = ({ className = "" }) => {
  const { state, identityChange, refreshSession } = useCustomerSession();
  const t = useT();
  const notice = describeSessionNotice(state.status, identityChange.phase, t);
  if (!notice) return null;
  return (
    <div
      role={notice.kind === "unresolved" ? "alert" : "status"}
      aria-live="polite"
      className={`text-sm ${notice.kind === "unresolved" ? TONE_CLASS.warning : TONE_CLASS.info} ${className}`}
    >
      <p>{notice.message}</p>
      {notice.offerRefresh && <RefreshButton onClick={refreshSession} />}
    </div>
  );
};

/** The result of the last guarded command, as decided by `presentIdentityCommandResult`. */
export const AuthPresentationView: FC<{ presentation: AuthPresentation | null; className?: string }> = ({
  presentation,
  className = "",
}) => {
  const { refreshSession } = useCustomerSession();
  if (!presentation) return null;
  return (
    <div
      role={presentation.tone === "success" || presentation.tone === "info" ? "status" : "alert"}
      className={`text-sm ${TONE_CLASS[presentation.tone]} ${className}`}
    >
      <p>{presentation.message}</p>
      {presentation.link && (
        <p className="mt-1">
          <Link href={presentation.link.href as Route} className={LINK_CLASS}>
            {presentation.link.label}
          </Link>
        </p>
      )}
      {presentation.offerRefresh && <RefreshButton onClick={refreshSession} />}
    </div>
  );
};

export interface AuthCommandRunner {
  /** Starts a guarded command unless this component already has one running; false when it did not start. */
  run: (start: () => Promise<IdentityCommandResult>, after?: (result: AuthUiResult) => void) => boolean;
  /** This component started a command whose result it has not received yet. */
  pending: boolean;
  /** The auth request or its `me` recovery is under way (from the provider), or this component just started one. */
  busy: boolean;
  /** Show the spinner: a request or the recovery read is running (not a mere unresolved recovery). */
  working: boolean;
  presentation: AuthPresentation | null;
  /** Forget the last result (another command has started, so it no longer describes the page). */
  reset: () => void;
}

/**
 * One UI owner of a guarded command. The owner lives as long as the component that calls this hook stays
 * mounted — keep it above anything that is shown only for some `me` states, because the provider reports
 * `loading` during an attempt. A result is delivered only to a still-mounted owner, once; the password (or
 * anything else) is never kept here.
 */
export function useAuthCommand(command: AuthCommand): AuthCommandRunner {
  const { identityChange } = useCustomerSession();
  const { state: booking } = useBookingHoldFlow();
  const ownerRef = useRef<AuthSubmissionOwner | null>(null);
  const [outcome, setOutcome] = useState<AuthUiResult | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const owner = createAuthSubmissionOwner();
    ownerRef.current = owner;
    return () => {
      owner.dispose();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, []);

  const run = useCallback<AuthCommandRunner["run"]>((start, after) => {
    const owner = ownerRef.current;
    if (!owner) return false;
    const started = owner.run(start, (result) => {
      setPending(false);
      setOutcome(result);
      after?.(result);
    });
    if (started) {
      setPending(true);
      setOutcome(null);
    }
    return started;
  }, []);

  const t = useT();
  const target = inProgressBookingTarget(booking);
  const presentation =
    outcome && !isStalePresentation(outcome, identityChange.phase, booking.phase)
      ? presentIdentityCommandResult(command, outcome, { bookingHref: target ? buildRoomDetailsHref(target) : null }, t)
      : null;

  return {
    run,
    pending,
    reset: () => setOutcome(null),
    busy: pending || identityChange.phase !== "idle",
    working: pending || identityChange.phase === "transport" || identityChange.phase === "recovering",
    presentation,
  };
}
