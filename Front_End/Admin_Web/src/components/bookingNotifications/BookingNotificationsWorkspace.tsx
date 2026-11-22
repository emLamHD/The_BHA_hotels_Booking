"use client";

/**
 * BHA-CHECKOUT-001-PR04: "Email nhận đặt phòng". A Manager chooses which Staff of THEIR Property receive booking notifications, at which separate notification address, and a front-desk fallback.
 * Saving here changes a notification preference only: no account, password, role or membership, and no e-mail is sent. Every request is authorized on the server for a Manager of the chosen Property;
 * this screen only shows what that Manager may manage.
 *
 * Honest parts: "Chưa cấu hình" means no notification address (the login address is never used), a save carries the version it was made from (a stale one is refused and the draft kept), a lost answer is never
 * resent, and the roster is keyed by Property: switching Property remounts it, aborts the old read and refuses any answer that names another Property, so one Property's addresses never show under another.
 */

import React, { useId, useState } from "react";
import { useStaffSession } from "@/components/auth/StaffSession";
import { ActionButton, Banner, ErrorPanel, LoadingPanel, PageHeader, WriteFeedback } from "@/components/website/WebsiteUi";
import { type GateRule } from "@/components/website/WebsiteAccessGate";
import { useWebsiteList, useWriteAction } from "@/components/website/useWebsiteData";
import {
  readRecipientRoster, saveFallbackEmail, saveStaffEmail, setStaffEnabled,
  type Coverage, type RecipientFallback, type RecipientRoster, type RecipientStaff,
} from "@/lib/api/bookingNotifications";

/** The gate rule: a Manager of at least one Property. Display only: the server checks the role of the route's Property again. */
export const BOOKING_NOTIFICATION_RULE: GateRule = {
  isAllowed: (session) => session.memberships.some((m) => m.role === "Manager"),
  noPermission:
    "Tài khoản này không phải Manager của cơ sở nào nên không quản lý được email nhận đặt phòng. Quyền theo từng cơ sở (FrontDesk, Manager) do người vận hành cấp. Chưa có yêu cầu nào được gửi.",
  signInPrompt: "Hãy đăng nhập để quản lý email nhận đặt phòng.",
};

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800";
const FIELD_ERROR = "border-error-500 focus:border-error-300 focus:ring-error-500/20 dark:border-error-500";
const CARD = "rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]";
const BADGE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

export const COVERAGE_LABEL: Record<Coverage, string> = {
  Local: "Nhận qua email riêng của cơ sở",
  Chain: "Nhận qua email công việc do bộ phận vận hành khai báo",
  OptedOut: "Đã tắt nhận thông báo",
  NotConfigured: "Chưa cấu hình",
};
const COVERAGE_TONE: Record<Coverage, string> = {
  Local: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300",
  Chain: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  OptedOut: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
  NotConfigured: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200",
};
const ROLE_LABEL = { FrontDesk: "Lễ tân (FrontDesk)", Manager: "Quản lý (Manager)" } as const;

/** Display-side check only (the server validates again): one address, no blanks inside, no line break. */
export function checkEmailText(text: string): string | null {
  const value = text.trim();
  if (value === "") return null;
  return /^[^\s@,;<>()[\]\\:"]+@[^\s@,;<>()[\]\\:"]+\.[A-Za-z]{2,}$/.test(value) ? null : "Nhập đúng một địa chỉ email (không nhập danh sách, không xuống dòng).";
}

export default function BookingNotificationsWorkspace() {
  const { state } = useStaffSession();
  const memberships = state.status === "authenticated" ? state.session.memberships.filter((m) => m.role === "Manager") : [];
  const [propertyId, setPropertyId] = useState<string>(memberships[0]?.propertyId ?? "");
  const selected = memberships.find((m) => m.propertyId === propertyId) ?? memberships[0];
  const selectId = useId();
  if (!selected) return null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Email nhận đặt phòng">
        Chọn nhân viên của cơ sở sẽ nhận thông báo đặt phòng và email nhận thông báo của họ. Email này tách biệt với tài khoản đăng nhập: không dùng email đăng nhập để gửi thông báo. Lưu ở đây không đổi tài khoản, mật khẩu hay quyền, và không gửi email nào.
      </PageHeader>
      {memberships.length > 1 && (
        <div className={CARD}>
          <label htmlFor={selectId} className="flex max-w-sm flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
            Cơ sở
            <select id={selectId} data-testid="booking-notification-property" className={FIELD} value={selected.propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {memberships.map((m) => (
                <option key={m.propertyId} value={m.propertyId}>{m.propertyName}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {/* The key remounts the roster (and aborts its read) on a Property switch, so state and a late answer of the previous Property can never reach this one. */}
      <Roster key={selected.propertyId} propertyId={selected.propertyId} propertyName={selected.propertyName} />
    </div>
  );
}

function Roster({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const { state, reload } = useWebsiteList((signal) => readRecipientRoster(propertyId, signal), [propertyId]);
  if (state.status === "loading") return <LoadingPanel what="danh sách người nhận" />;
  if (state.status === "error") return <ErrorPanel message={state.message} onRetry={() => void reload()} />;
  // An answer that does not name this Property is never shown.
  if (state.data.propertyId !== propertyId) return <ErrorPanel message="Máy chủ trả về dữ liệu của cơ sở khác nên không hiển thị." onRetry={() => void reload()} />;
  return <RosterBody roster={state.data} propertyId={propertyId} propertyName={propertyName} reload={reload} />;
}

function RosterBody({ roster, propertyId, propertyName, reload }: { roster: RecipientRoster; propertyId: string; propertyName: string; reload: () => Promise<unknown> }) {
  const covered = roster.staff.some((s) => s.coverage === "Local" || s.coverage === "Chain");
  return (
    <>
      <div className={CARD} data-testid="booking-notification-roster" data-property={propertyId}>
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Nhân viên của {propertyName}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Chỉ nhân viên đang hoạt động có vai trò Lễ tân hoặc Quản lý tại cơ sở này. Một người chỉ nhận thông báo khi có email nhận thông báo và đang bật.
        </p>
        {!covered && (
          <Banner tone="warning" testId="booking-notification-uncovered">
            {roster.fallback.email ? "Chưa ai nhận thông báo đặt phòng: hệ thống sẽ dùng email dự phòng của cơ sở." : "Chưa ai nhận thông báo đặt phòng và cơ sở chưa có email dự phòng."}
          </Banner>
        )}
        {roster.staff.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-300" data-testid="booking-notification-empty">Cơ sở này chưa có nhân viên Lễ tân hoặc Quản lý nào đang hoạt động.</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-gray-200 dark:divide-gray-800">
            {roster.staff.map((row) => (
              <StaffRow key={`${row.staffAccountId}:${row.version}`} row={row} propertyId={propertyId} reload={reload} />
            ))}
          </ul>
        )}
      </div>
      <FallbackCard key={`fallback:${roster.fallback.version}`} fallback={roster.fallback} propertyId={propertyId} reload={reload} />
    </>
  );
}

function StaffRow({ row, propertyId, reload }: { row: RecipientStaff; propertyId: string; reload: () => Promise<unknown> }) {
  const write = useWriteAction();
  const id = useId();
  const [draft, setDraft] = useState(row.notificationEmail ?? "");
  const [showError, setShowError] = useState(false);
  const localError = showError ? checkEmailText(draft) : null;
  const refusedEmail = write.status.phase === "refused" && write.status.failure.field === "email" && write.status.failure.code === "validation";
  const error = localError ?? (refusedEmail ? "Máy chủ không nhận địa chỉ này: chỉ nhập đúng một địa chỉ email hợp lệ." : null);
  const working = write.status.phase === "pending";
  const dirty = draft.trim().toLowerCase() !== (row.notificationEmail ?? "");

  const save = async (email: string | null) => {
    if (email !== null && checkEmailText(email) !== null) {
      setShowError(true);
      return;
    }
    const result = await write.run(() => saveStaffEmail(propertyId, row.staffAccountId, row.version, email));
    if (result?.kind === "ok") await reload();
  };
  const toggle = async (enabled: boolean) => {
    const result = await write.run(() => setStaffEnabled(propertyId, row.staffAccountId, row.version, enabled));
    if (result?.kind === "ok") await reload();
  };

  return (
    <li className="flex flex-col gap-3 py-4" data-testid="booking-notification-row" data-staff={row.staffAccountId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-800 dark:text-white/90" data-testid="booking-notification-account">{row.accountLabel}</span>
        <span className={`${BADGE} bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200`}>{ROLE_LABEL[row.role]}</span>
        <span className={`${BADGE} ${COVERAGE_TONE[row.coverage]}`} data-testid="booking-notification-coverage">{COVERAGE_LABEL[row.coverage]}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">(nhận diện tài khoản; email đăng nhập không được dùng để nhận thông báo)</span>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">Email nhận thông báo</label>
          <input
            id={id}
            data-testid="booking-notification-email"
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setShowError(false); }}
            disabled={working}
            maxLength={254}
            placeholder="Chưa cấu hình"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            className={`${FIELD} ${error ? FIELD_ERROR : ""}`}
          />
          {error && <p className="mt-1.5 text-xs text-error-500" data-testid="booking-notification-email-error">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton testId="booking-notification-save" disabled={working || !dirty || draft.trim() === ""} onClick={() => void save(draft.trim())}>Lưu email</ActionButton>
          <ActionButton testId="booking-notification-clear" variant="outline" disabled={working || row.notificationEmail === null} onClick={() => void save(null)}>Xoá email</ActionButton>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" data-testid="booking-notification-enabled" checked={row.isEnabled} disabled={working} onChange={(e) => void toggle(e.target.checked)} />
            Nhận thông báo
          </label>
        </div>
      </div>
      <WriteFeedback status={write.status} working={working} serverNote={null} onReloadLatest={() => void reload()} onCheckServer={() => void reload().then(() => write.release())} fieldErrorOf={(field) => field === "email"} />
    </li>
  );
}

function FallbackCard({ fallback, propertyId, reload }: { fallback: RecipientFallback; propertyId: string; reload: () => Promise<unknown> }) {
  const write = useWriteAction();
  const id = useId();
  const [draft, setDraft] = useState(fallback.email ?? "");
  const [showError, setShowError] = useState(false);
  const localError = showError ? checkEmailText(draft) : null;
  const refusedEmail = write.status.phase === "refused" && write.status.failure.field === "email" && write.status.failure.code === "validation";
  const error = localError ?? (refusedEmail ? "Máy chủ không nhận địa chỉ này: chỉ nhập đúng một địa chỉ email hợp lệ." : null);
  const working = write.status.phase === "pending";
  const dirty = draft.trim().toLowerCase() !== (fallback.email ?? "");

  const save = async (email: string | null) => {
    if (email !== null && checkEmailText(email) !== null) {
      setShowError(true);
      return;
    }
    const result = await write.run(() => saveFallbackEmail(propertyId, fallback.version, email));
    if (result?.kind === "ok") await reload();
  };

  return (
    <div className={CARD} data-testid="booking-notification-fallback">
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Email dự phòng của lễ tân</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Chỉ được dùng khi không có nhân viên nào ở trên đủ điều kiện nhận. Đây là địa chỉ của cơ sở, không phải tài khoản nhân viên và không cấp quyền gì.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">Email dự phòng</label>
          <input
            id={id}
            data-testid="booking-notification-fallback-email"
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setShowError(false); }}
            disabled={working}
            maxLength={254}
            placeholder="Chưa cấu hình"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            className={`${FIELD} ${error ? FIELD_ERROR : ""}`}
          />
          {error && <p className="mt-1.5 text-xs text-error-500" data-testid="booking-notification-fallback-error">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton testId="booking-notification-fallback-save" disabled={working || !dirty || draft.trim() === ""} onClick={() => void save(draft.trim())}>Lưu email dự phòng</ActionButton>
          <ActionButton testId="booking-notification-fallback-clear" variant="outline" disabled={working || fallback.email === null} onClick={() => void save(null)}>Xoá</ActionButton>
        </div>
      </div>
      <WriteFeedback status={write.status} working={working} serverNote={null} onReloadLatest={() => void reload()} onCheckServer={() => void reload().then(() => write.release())} fieldErrorOf={(field) => field === "email"} />
    </div>
  );
}
