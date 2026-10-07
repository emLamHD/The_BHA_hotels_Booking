"use client";

/**
 * PMS-ADMIN-AUTH-001-CP06: Staff sign-in for the Reservation Board.
 *
 * One `POST /api/admin/v1/auth/login` per submit, never retried. The password
 * is sent exactly as typed — not trimmed, normalized, truncated or limited —
 * and lives only in this component's state, which is cleared once the attempt
 * is over and when the form goes away. Nothing is put in storage, the URL or
 * the console. A `200` only says the cookie was issued: the board is opened
 * only after `GET /me` confirms the session.
 *
 * In `LocalGate` mode there is no Staff sign-in; the page says so instead.
 */

import Label from "@/components/form/Label";
import { ChevronLeftIcon, EyeCloseIcon, EyeIcon } from "@/icons";
import { getAccessMode } from "@/lib/api/accessMode";
import { fetchStaffSession, staffLogin, type StaffLoginOutcome } from "@/lib/api/staff";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useId, useRef, useState } from "react";

const INPUT_CLASSES =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800";

export function describeLoginFailure(outcome: Exclude<StaffLoginOutcome, { kind: "signed-in" }>): string {
  switch (outcome.kind) {
    case "invalid-credentials":
      return "The email or password is not correct, or this account cannot sign in.";
    case "rate-limited":
      return "Too many sign-in attempts. Wait a minute, then try again.";
    case "invalid-request":
      return "Enter a valid email address and a password.";
    case "network":
      return "Could not reach the Admin API. Check your connection and try again.";
    case "config":
      return outcome.message;
    case "refused":
    default:
      return `The Admin API refused the sign-in request (HTTP ${outcome.kind === "refused" ? outcome.status : "?"}).`;
  }
}

export default function SignInForm() {
  const mode = getAccessMode();
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const outcome = await staffLogin(email.trim(), password);
      if (!mountedRef.current) return;
      if (outcome.kind !== "signed-in") {
        setError(describeLoginFailure(outcome));
        return;
      }
      const session = await fetchStaffSession();
      if (!mountedRef.current) return;
      if (session.kind === "authenticated") {
        router.push("/calendar");
        return;
      }
      setError(
        session.kind === "unauthenticated"
          ? "The sign-in was accepted, but no session could be confirmed. Check that this browser allows the Admin API's cookie, then try again."
          : session.message
      );
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) {
        // The attempt is over, whatever its result: the password does not stay in memory.
        setPassword("");
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="flex flex-col flex-1 lg:w-1/2 w-full">
      <div className="w-full max-w-md sm:pt-10 mx-auto mb-5">
        <Link
          href="/calendar"
          className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon />
          Back to the Reservation Board
        </Link>
      </div>
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div className="mb-5 sm:mb-8">
          <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
            Staff sign in
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Sign in with your Staff account to use the Reservation Board.
          </p>
        </div>

        {!mode.ok ? (
          <p role="alert" data-testid="signin-config-error" className="text-sm text-error-600 dark:text-error-400">
            {mode.message}
          </p>
        ) : mode.mode === "LocalGate" ? (
          <p role="status" data-testid="signin-local-gate" className="text-sm text-gray-600 dark:text-gray-300">
            This Admin build runs the Reservation Board in LocalGate mode, which has no Staff sign-in. Open the{" "}
            <Link href="/calendar" className="text-brand-500 hover:text-brand-600 dark:text-brand-400">
              Reservation Board
            </Link>{" "}
            directly.
          </p>
        ) : (
          <form onSubmit={handleSubmit} noValidate aria-describedby={error ? errorId : undefined}>
            <div className="space-y-6">
              <div>
                <Label htmlFor={emailId}>
                  Email <span className="text-error-500">*</span>
                </Label>
                <input
                  id={emailId}
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                  className={INPUT_CLASSES}
                />
              </div>
              <div>
                <Label htmlFor={passwordId}>
                  Password <span className="text-error-500">*</span>
                </Label>
                <div className="relative">
                  <input
                    id={passwordId}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={submitting}
                    className={INPUT_CLASSES}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute z-30 -translate-y-1/2 right-4 top-1/2"
                  >
                    {showPassword ? (
                      <EyeIcon className="fill-gray-500 dark:fill-gray-400" />
                    ) : (
                      <EyeCloseIcon className="fill-gray-500 dark:fill-gray-400" />
                    )}
                  </button>
                </div>
              </div>
              {error && (
                <p id={errorId} role="alert" data-testid="signin-error" className="text-sm text-error-600 dark:text-error-400">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting || email.trim() === "" || password === ""}
                className="inline-flex w-full items-center justify-center rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
