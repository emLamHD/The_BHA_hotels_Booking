"use client";

/**
 * CUST-WEB-HEADER-001-CP02: the small shared pieces of the three website screens, built on the TailAdmin modal,
 * button, badge, label and checkbox: a page header, status banners, controlled fields with their own error text,
 * a dialog shell that cannot be closed while a write is on the wire, and the one block that tells the operator what
 * a refused or unanswered write means.
 */

import React, { useId } from "react";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import Label from "@/components/form/Label";
import type { WebsiteFailure } from "@/lib/api/website";
import type { WriteStatus } from "./useWebsiteData";

const INPUT_CLASSES =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800";
const INPUT_ERROR_CLASSES =
  "border-error-500 focus:border-error-300 focus:ring-error-500/20 dark:border-error-500 dark:focus:border-error-800";

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? iso : when.toLocaleString();
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">{title}</h1>
      {children && <p className="max-w-3xl text-sm text-gray-500 dark:text-gray-400">{children}</p>}
    </div>
  );
}

export type Tone = "success" | "error" | "warning" | "info";

const TONES: Record<Tone, string> = {
  success: "border-success-300 bg-success-50 text-success-800 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-200",
  error: "border-error-300 bg-error-50 text-error-800 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-200",
  warning: "border-warning-300 bg-warning-50 text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-200",
  info: "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-200",
};

export function Banner({
  tone,
  children,
  testId,
  onDismiss,
}: {
  tone: Tone;
  children: React.ReactNode;
  testId?: string;
  onDismiss?: () => void;
}) {
  return (
    <div role={tone === "error" || tone === "warning" ? "alert" : "status"} data-testid={testId} className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${TONES[tone]}`}>
      <div className="min-w-0">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs font-medium underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  maxLength,
  placeholder,
  inputMode,
  testId,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  inputMode?: "text" | "decimal" | "numeric";
  testId?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        data-testid={testId}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={inputMode}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? note : undefined}
        className={`${INPUT_CLASSES} ${error ? INPUT_ERROR_CLASSES : ""}`}
      />
      {(error || hint) && (
        <p id={note} className={`mt-1.5 text-xs ${error ? "text-error-500" : "text-gray-500 dark:text-gray-400"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  maxLength,
  testId,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
  maxLength?: number;
  testId?: string;
  rows?: number;
}) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        data-testid={testId}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? note : undefined}
        className={`w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:focus:border-brand-800 ${error ? INPUT_ERROR_CLASSES : ""}`}
      />
      {(error || hint) && (
        <p id={note} className={`mt-1.5 text-xs ${error ? "text-error-500" : "text-gray-500 dark:text-gray-400"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** A dialog that cannot be dismissed (Escape, backdrop, close button) while `busy`: a write on the wire is never abandoned by closing it. */
export function DialogShell({
  title,
  onClose,
  busy,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: React.ReactNode;
  testId: string;
}) {
  const titleId = useId();
  return (
    <Modal isOpen onClose={() => (busy ? undefined : onClose())} showCloseButton={!busy} className="max-w-[560px] p-6 lg:p-8">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testId} className="flex flex-col gap-4">
        <h2 id={titleId} className="pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h2>
        {children}
      </div>
    </Modal>
  );
}

export function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center justify-end gap-3">{children}</div>;
}

/** A button that does not submit anything by itself (the TailAdmin Button has no `type`, so a form would submit on it). */
export function ActionButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  testId,
  size = "sm",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline";
  testId?: string;
  size?: "sm" | "md";
  /** `button` unless it is the form's Save: a Cancel / Remove inside a form must never submit it. */
  type?: "button" | "submit";
}) {
  return (
    <span data-testid={testId} className="inline-flex">
      <Button size={size} variant={variant} type={type} onClick={onClick} disabled={disabled} className={size === "sm" ? "!px-3 !py-2" : ""}>
        {children}
      </Button>
    </span>
  );
}

/**
 * What a write that did not simply succeed means for the form that sent it, and what to do next. A refusal
 * (400, 404, 409) means the server did NOT apply it; `stale-version` keeps the draft and offers the latest values;
 * an unanswered write is unverified and blocks sending again until the server has been read.
 */
export function WriteFeedback({
  status,
  onReloadLatest,
  onCheckServer,
  working,
  serverNote,
  fieldErrorOf,
}: {
  status: WriteStatus;
  onReloadLatest?: () => void;
  onCheckServer?: () => void;
  working: boolean;
  serverNote: string | null;
  /** Called with a refusal that names a field, so the form can show it beside that field. */
  fieldErrorOf?: (field: string | null) => boolean;
}) {
  const refused = status.phase === "refused" ? status.failure : null;
  const showHere = refused !== null && !(fieldErrorOf && refused.field !== null && fieldErrorOf(refused.field) && refused.code === "validation");
  return (
    <>
      {status.phase === "pending" && (
        <Banner tone="info" testId="write-pending">
          Saving… waiting for the server.
        </Banner>
      )}
      {refused && showHere && (
        <Banner tone="error" testId="write-refused">
          <p className="font-medium">
            {refused.code === "stale-version"
              ? "This changed on the server since you opened it. Nothing was saved."
              : refused.status === 404
                ? "It no longer exists on the server. Nothing was saved."
                : "The server did not apply this change."}
          </p>
          <p className="mt-1">{refused.detail}</p>
          {refused.code === "stale-version" && onReloadLatest && (
            <p className="mt-2">
              Your draft is kept.{" "}
              <button type="button" onClick={onReloadLatest} disabled={working} className="font-medium underline disabled:opacity-50" data-testid="reload-latest">
                Reload the latest values
              </button>{" "}
              to compare, then save again if you still want your change.
            </p>
          )}
        </Banner>
      )}
      {status.phase === "failed" && (
        <Banner tone="error" testId="write-failed">
          {status.message} Nothing was saved.
        </Banner>
      )}
      {status.phase === "unverified" && (
        <Banner tone="warning" testId="write-unverified">
          <p className="font-medium">The result is not confirmed.</p>
          <p className="mt-1">{status.message}</p>
          <p className="mt-2">
            Nothing is sent again automatically. Read the server first
            {onCheckServer && (
              <>
                :{" "}
                <button type="button" onClick={onCheckServer} disabled={working} className="font-medium underline disabled:opacity-50" data-testid="check-server">
                  Check the server
                </button>
              </>
            )}
            .
          </p>
        </Banner>
      )}
      {serverNote && (
        <Banner tone="info" testId="server-note">
          {serverNote}
        </Banner>
      )}
    </>
  );
}

export function LoadingPanel({ what }: { what: string }) {
  return (
    <div role="status" data-testid="website-loading" className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
      Loading {what}…
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" data-testid="website-load-error" className="rounded-2xl border border-error-300 bg-error-50 px-4 py-6 text-sm text-error-800 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-200">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="ml-3 rounded-lg border border-error-300 px-3 py-1 text-sm font-medium hover:bg-error-100 dark:border-error-500/40 dark:hover:bg-white/5">
        Retry
      </button>
    </div>
  );
}

export function describeRefusal(failure: WebsiteFailure | null): string | null {
  return failure && failure.kind === "refused" ? failure.detail : null;
}

export const TABLE_CLASSES = {
  wrap: "overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]",
  table: "min-w-full text-left text-sm",
  head: "border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400",
  headCell: "px-4 py-3 font-medium",
  row: "border-b border-gray-100 last:border-0 dark:border-gray-800",
  cell: "px-4 py-3 align-top text-gray-700 dark:text-gray-200",
};
