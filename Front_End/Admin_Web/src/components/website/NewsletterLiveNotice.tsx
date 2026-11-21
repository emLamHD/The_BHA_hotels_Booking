"use client";

/**
 * BHA-NEWSLETTER-LIVE-001: what the Newsletter screen shows about the live signal. Presentation only: the screen decides when a read is safe; these never read, send or move
 * focus. The toast is small and closable and goes away by itself; the banner stays until the changes are on screen or Staff chose to go and see them.
 * BHA-ADMIN-BADGE-001-PR14: the signal is the shared hint, which says that subscriptions changed (a verification, an addition, an edit or a delete) and nothing more, so the wording is neutral:
 * it never claims "a new subscription" or a number.
 */

import { useEffect } from "react";
import { Banner } from "./WebsiteUi";
import type { LiveStatus, LiveStopReason } from "@/lib/website/newsletterLive";

export const LIVE_TOAST_MS = 8000;

/** Why the banner is up: `behind` = on page 2+, so the rows Staff is reading are kept; `deferred` = something is in progress, so the read waits. */
export type LiveBannerKind = "new" | "gap" | "deferred";

export function LiveStatusLine({ status, stoppedFor, onRetry }: { status: LiveStatus; stoppedFor?: LiveStopReason; onRetry: () => void }) {
  const text =
    status === "connected"
      ? "Cập nhật trực tiếp: đang bật. Danh sách sắp theo hoạt động đăng ký hoặc xác minh mới nhất."
      : status === "connecting"
        ? "Đang kết nối cập nhật trực tiếp… Danh sách vẫn dùng được; sắp theo hoạt động đăng ký hoặc xác minh mới nhất."
        : status === "retrying"
          ? "Mất kết nối cập nhật trực tiếp, đang thử lại. Danh sách vẫn dùng được và chưa mất gì; sắp theo hoạt động đăng ký hoặc xác minh mới nhất."
          : stoppedFor === "denied"
            ? "Không nhận được cập nhật trực tiếp: máy chủ từ chối kết nối này."
            : stoppedFor === "config"
              ? "Không dùng được cập nhật trực tiếp với cấu hình Admin này."
              : "Cập nhật trực tiếp đã dừng.";
  return (
    <p data-testid="newsletter-live-status" data-status={status} className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${status === "connected" ? "bg-success-500" : status === "stopped" ? "bg-error-500" : "bg-warning-500"}`} />
      <span>{text}</span>
      {status !== "connected" && status !== "connecting" && (
        <button type="button" onClick={onRetry} data-testid="newsletter-live-retry" className="font-medium underline">
          Thử kết nối lại
        </button>
      )}
    </p>
  );
}

export function LiveBanner({ kind, onView, disabled }: { kind: LiveBannerKind; onView: () => void; disabled: boolean }) {
  return (
    <Banner tone="info" testId="newsletter-live-banner">
      <p data-testid="newsletter-live-banner-text">
        {kind === "deferred"
          ? "Danh sách sẽ được đọc lại khi bạn xong thao tác đang làm (có thể có thay đổi đăng ký); chưa có gì của bạn bị thay đổi."
          : kind === "gap"
            ? "Kết nối trực tiếp vừa được thiết lập lại nên có thể có thay đổi đăng ký. Trang bạn đang xem được giữ nguyên."
            : "Có thay đổi đăng ký. Trang bạn đang xem được giữ nguyên."}
      </p>
      {kind !== "deferred" && (
        <p className="mt-2">
          <button type="button" onClick={onView} disabled={disabled} data-testid="newsletter-live-view" className="font-medium underline disabled:opacity-50">
            Xem thay đổi
          </button>
        </p>
      )}
    </Banner>
  );
}

/** A polite status message at the corner: it does not take focus and it is not a dialog. `token` restarts the timer when another signal joins it. */
export function LiveToast({ token, onDismiss, onView, disabled = false }: { token: number; onDismiss: () => void; onView: (() => void) | null; disabled?: boolean }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, LIVE_TOAST_MS);
    return () => clearTimeout(timer);
  }, [token, onDismiss]);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="newsletter-live-toast"
      className="fixed bottom-4 right-4 z-40 flex max-w-sm items-start gap-3 rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-lg dark:border-brand-500/30 dark:bg-gray-900 dark:text-white/90"
    >
      <div className="min-w-0">
        <p className="font-medium" data-testid="newsletter-live-toast-text">Có thay đổi đăng ký</p>
        {onView && (
          <p className="mt-1">
            <button type="button" onClick={onView} disabled={disabled} data-testid="newsletter-live-toast-view" className="font-medium text-brand-600 underline disabled:opacity-50 dark:text-brand-400">
              Xem thay đổi
            </button>
          </p>
        )}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Đóng thông báo" data-testid="newsletter-live-toast-close" className="shrink-0 text-xs text-gray-500 underline">
        Đóng
      </button>
    </div>
  );
}

