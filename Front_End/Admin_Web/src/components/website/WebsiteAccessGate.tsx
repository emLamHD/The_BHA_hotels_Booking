"use client";

/**
 * CUST-WEB-HEADER-001-CP02: what stands in front of every website-settings page.
 *
 * - An invalid access-mode setting, or `LocalGate`: no sign-in exists there, so the page says so and sends nothing.
 * - `Staff`: no data request is made until `GET /me` has confirmed a session AND that session carries the site-wide
 *   `WebsiteSettingsManage` permission. Without a session the page goes to `/signin?returnTo=<this page>` (once);
 *   a failed check is an error with Retry, never a signed-out state; an account without the permission sees why
 *   and nothing else. This is a convenience: every request is authorized on the server again.
 * - It reuses `StaffSessionProvider` exactly as the Calendar gate does (mounted here, not app-wide).
 *
 * The host it provides is what keeps the screens honest: a write holds Sign out, a sign-out in progress refuses new
 * writes (both decided on refs at the moment each starts), a 403 re-reads `me` and — if the permission is gone or the
 * session ended — unmounts every form instead of continuing on the old permission, and a 401 ends the session.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAccessMode } from "@/lib/api/accessMode";
import { WEBSITE_SETTINGS_PERMISSION } from "@/lib/api/staff";
import { signInUrlFor } from "@/lib/website/returnTo";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";

export interface WebsiteHost {
  /** Claims the one write slot, synchronously. `false` while another write is on the wire or a sign-out is. */
  beginWrite: () => boolean;
  endWrite: () => void;
  signingOut: boolean;
  /** A 403: re-read `me`; the gate closes the page if the permission or the session is gone. */
  onDenied: () => Promise<void>;
  /** A 401: the session is gone. */
  onUnauthenticated: () => void;
  /** A message the gate shows above the page (for example a 403 that `me` did not explain). */
  notify: (message: string | null) => void;
  /** A screen with a draft tells the gate, so Sign out asks before it throws the draft away. */
  setUnsaved: (unsaved: boolean) => void;
}

const WebsiteHostContext = createContext<WebsiteHost | null>(null);

export function useWebsiteHost(): WebsiteHost {
  const host = useContext(WebsiteHostContext);
  if (!host) throw new Error("useWebsiteHost must be used inside WebsiteAccessGate.");
  return host;
}

export default function WebsiteAccessGate({ returnTo, children }: { returnTo: string; children: React.ReactNode }) {
  const mode = getAccessMode();
  if (!mode.ok) {
    return <Panel role="alert" testId="website-config-error">{mode.message}</Panel>;
  }
  if (mode.mode !== "Staff") {
    return (
      <Panel role="alert" testId="website-needs-staff-mode">
        Cài đặt website cần đăng nhập Staff, mà bản Admin này không dùng (chế độ LocalGate). Chưa có yêu cầu nào được gửi.
      </Panel>
    );
  }
  return (
    <StaffSessionProvider>
      <WebsiteBoundary returnTo={returnTo}>{children}</WebsiteBoundary>
    </StaffSessionProvider>
  );
}

function WebsiteBoundary({ returnTo, children }: { returnTo: string; children: React.ReactNode }) {
  const { state, refresh, retry, expire, signOut, failAccessCheck } = useStaffSession();
  const router = useRouter();
  const [writing, setWriting] = useState(false);
  const writingRef = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const unsavedRef = useRef(false);
  const setUnsaved = useCallback((unsaved: boolean) => {
    unsavedRef.current = unsaved;
  }, []);
  const [signOutMessage, setSignOutMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "unauthenticated") router.replace(signInUrlFor(returnTo));
  }, [state.status, router, returnTo]);

  const host = useMemo<WebsiteHost>(
    () => ({
      beginWrite: () => {
        if (writingRef.current || signingOutRef.current) return false;
        writingRef.current = true;
        setWriting(true);
        return true;
      },
      endWrite: () => {
        writingRef.current = false;
        setWriting(false);
      },
      signingOut,
      onDenied: async () => {
        // The permission may have been revoked, or the session ended: ask the server before doing anything else.
        const result = await refresh();
        if (result === "unauthenticated") expire();
        else if (result === "error") failAccessCheck();
        else if (result === "authenticated") {
          // The session is current. If it lost the permission the gate closes the page on this very render;
          // if it still has it, the 403 was something else (Origin, a proxy): say so rather than retry.
          setNotice("Máy chủ từ chối yêu cầu (403) dù quyền của bạn vẫn còn hiệu lực. Chưa có gì thay đổi; hãy tải lại trang rồi thử lại.");
        }
      },
      onUnauthenticated: expire,
      notify: setNotice,
      setUnsaved,
    }),
    [signingOut, refresh, expire, failAccessCheck, setUnsaved]
  );

  const handleSignOut = useCallback(async () => {
    if (writingRef.current || signingOutRef.current) return;
    if (unsavedRef.current && !window.confirm("Bạn có thay đổi chưa lưu trên màn hình này. Đăng xuất sẽ bỏ chúng. Vẫn đăng xuất?")) return;
    signingOutRef.current = true;
    setSigningOut(true);
    setSignOutMessage(null);
    try {
      const outcome = await signOut();
      if (outcome.kind === "unconfirmed") setSignOutMessage(outcome.message);
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  }, [signOut]);

  if (state.status === "checking") {
    return <Panel role="status" testId="staff-session-checking">Đang kiểm tra phiên đăng nhập Staff…</Panel>;
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
          Thử lại
        </button>
      </Panel>
    );
  }
  if (state.status === "unauthenticated") {
    return (
      <Panel role="status" testId="staff-session-required">
        {state.reason === "expired" ? "Phiên đăng nhập Staff của bạn đã kết thúc. " : state.reason === "signed-out" ? "Bạn đã đăng xuất. " : ""}
        Hãy đăng nhập để quản lý cài đặt website.{" "}
        <Link href={signInUrlFor(returnTo)} className="font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400">
          Đăng nhập
        </Link>
      </Panel>
    );
  }

  const allowed = (state.session.permissions ?? []).includes(WEBSITE_SETTINGS_PERMISSION);
  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="staff-identity"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm dark:border-gray-800 dark:bg-white/[0.03]"
      >
        <span className="text-gray-700 dark:text-gray-200">
          Đang đăng nhập với <span className="font-medium">{state.session.email}</span>
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
            title={writing ? "Một thay đổi vẫn đang chờ máy chủ; hãy đăng xuất sau khi nó xong." : undefined}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
          >
            {signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
          </button>
        </div>
      </div>
      {!allowed ? (
        <Panel role="alert" testId="website-no-permission">
          Tài khoản này không có quyền với cài đặt website. Quyền này do người vận hành cấp cho tài khoản Staff bằng dòng lệnh của Admin API và tách biệt với vai trò theo cơ sở lưu trú. Chưa có yêu cầu nào được gửi.
        </Panel>
      ) : (
        <WebsiteHostContext.Provider value={host}>
          {notice && (
            <div role="alert" data-testid="website-notice" className="flex items-start justify-between gap-3 rounded-2xl border border-warning-300 bg-warning-50 px-4 py-3 text-sm text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-200">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="text-xs font-medium underline">
                Đóng
              </button>
            </div>
          )}
          {/* A new Staff account is a new page: nothing of a previous session's forms carries over. */}
          <React.Fragment key={state.session.staffAccountId}>{children}</React.Fragment>
        </WebsiteHostContext.Provider>
      )}
    </div>
  );
}

function Panel({ children, role, testId }: { children: React.ReactNode; role: "alert" | "status"; testId: string }) {
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
