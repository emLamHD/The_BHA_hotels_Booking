"use client";

/**
 * BHA-ADMIN-BADGE-001-PR05 (ADR 0011 §B): the activity history, for any signed-in Staff member (it has no website-permission gate: which menus and Properties it can show is exactly what the
 * shell's summary allows, and the API re-checks every request). It reads only: nothing here says "seen". LocalGate (or a bad mode setting) shows the gate's message and sends nothing, also for a
 * direct URL.
 *
 * One menu (and, for Promotions and Calendar, one Property) at a time, with an optional day range and Staff actor, newest first, exactly as the server orders it; "Tải thêm" sends the
 * `nextCursor` the last page returned and nothing else. The data is keyed by identity, menu, Property and filters: when any of them changes (another Staff member, a lost permission, another
 * pick) the rows and the cursor are gone in that same render, and an answer that arrives late (a first page or a "load more") is dropped and its request aborted. A 404 drops the scope's data and
 * says one general thing: it does not tell a scope that does not exist from one the Staff member may not read. 401/403 go to the shared session.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import WebsiteAccessGate, { type GateRule } from "@/components/website/WebsiteAccessGate";
import { useMenuUnseen, useUnseenScope } from "@/components/website/NewsletterBadgeProvider";
import { ADMIN_MENU } from "@/lib/adminMenus";
import { GUID, actorLabel, allowedMenus, allowedProperties, dayAfter, dayStart, formatActivityTime, isCalendarDay, resolveScope } from "@/lib/adminActivity";
import { fetchActivity, type ActivityItem, type ActivityPage } from "@/lib/api/menuUnseen";
import { GONE_MESSAGE, toView } from "./activityRequest";

const PAGE_SIZE = 50;

/** Any signed-in Staff member; the scopes come from the summary, never from a role. */
const ACTIVITY_RULE: GateRule = {
  isAllowed: () => true,
  noPermission: "Chưa có yêu cầu nào được gửi.",
  signInPrompt: "Hãy đăng nhập để xem lịch sử hoạt động.",
};

export default function ActivityScreen() {
  return (
    <WebsiteAccessGate returnTo="/activity" rule={ACTIVITY_RULE}>
      <ActivityRoute />
    </WebsiteAccessGate>
  );
}

/** A link to another menu or Property can keep this page mounted (same path, new query): the body starts again from the new query, with the filters back to empty. */
function ActivityRoute() {
  const params = useSearchParams();
  return <ActivityHistory key={params.toString()} start={{ menu: params.get("menu") ?? undefined, propertyId: params.get("propertyId") ?? undefined }} />;
}

interface Applied {
  from?: string;
  to?: string;
  actorStaffId?: string;
}

interface Loaded {
  key: string;
  rows: ActivityItem[];
  next: string | null;
  phase: "ready" | "gone" | "error";
  message?: string;
  more: "idle" | "loading" | "error";
  moreMessage?: string;
}

const FIELD = "h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90";
const LABEL = "flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400";

function ActivityHistory({ start }: { start: { menu?: string; propertyId?: string } }) {
  const summary = useMenuUnseen();
  const scope = useUnseenScope();
  const menus = allowedMenus(summary);
  const [wanted, setWanted] = useState<{ menu?: string; propertyId?: string }>(start);
  const [filters, setFilters] = useState({ from: "", to: "", actor: "" });
  const [attempt, setAttempt] = useState(0);
  const resolved = resolveScope(summary, menus, wanted.menu, wanted.propertyId);

  const problems = {
    from: filters.from !== "" && !isCalendarDay(filters.from) ? "Ngày bắt đầu không hợp lệ." : null,
    to: filters.to !== "" && !isCalendarDay(filters.to) ? "Ngày kết thúc không hợp lệ." : null,
    range: filters.from !== "" && filters.to !== "" && isCalendarDay(filters.from) && isCalendarDay(filters.to) && filters.from > filters.to ? "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc." : null,
    actor: filters.actor.trim() !== "" && !GUID.test(filters.actor.trim()) ? "Mã Staff phải là một GUID, ví dụ 11111111-1111-1111-1111-111111111111." : null,
  };
  const invalid = Object.values(problems).some(Boolean);
  const applied = useMemo<Applied | null>(
    () => (invalid ? null : { from: filters.from ? dayStart(filters.from) : undefined, to: filters.to ? dayAfter(filters.to) : undefined, actorStaffId: filters.actor.trim() || undefined }),
    [invalid, filters.from, filters.to, filters.actor],
  );

  const key = resolved && applied ? JSON.stringify([scope.identity, resolved.menu, resolved.propertyId ?? null, applied, attempt]) : "";
  const [state, setState] = useState<Loaded | null>(null);
  const keyRef = useRef(key);
  const moreBusy = useRef(false);
  const moreController = useRef<AbortController | null>(null);
  const report = useRef(scope.reportAuth);
  useEffect(() => {
    keyRef.current = key;
    report.current = scope.reportAuth;
  });

  useEffect(() => {
    if (!resolved || !applied) return undefined;
    let live = true;
    const controller = new AbortController();
    void fetchActivity({ menu: resolved.menu, propertyId: resolved.propertyId, ...applied, limit: PAGE_SIZE }, controller.signal).then((result) => {
      if (!live) return;
      const first = toView<ActivityPage>(result);
      if (result.kind === "unauthenticated" || result.kind === "denied") report.current(result.kind);
      if (first.state === "ok") setState({ key, rows: first.data.items, next: first.data.nextCursor, phase: "ready", more: "idle" });
      else if (first.state === "gone") setState({ key, rows: [], next: null, phase: "gone", more: "idle" });
      else if (first.state === "error") setState({ key, rows: [], next: null, phase: "error", message: first.message, more: "idle" });
    });
    return () => {
      live = false;
      controller.abort();
      moreController.current?.abort();
      moreBusy.current = false;
    };
    // `resolved` and `applied` are derived from what `key` already names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const view = state && state.key === key ? state : null;

  const loadMore = useCallback(() => {
    if (!resolved || !applied || !view || view.phase !== "ready" || !view.next || moreBusy.current) return;
    const forKey = key;
    const cursor = view.next;
    moreBusy.current = true;
    const controller = new AbortController();
    moreController.current = controller;
    setState((current) => (current && current.key === forKey ? { ...current, more: "loading" } : current));
    void fetchActivity({ menu: resolved.menu, propertyId: resolved.propertyId, ...applied, limit: PAGE_SIZE, cursor }, controller.signal).then((result) => {
      if (controller.signal.aborted || keyRef.current !== forKey) return;         // another scope, filter or identity owns the screen now
      moreBusy.current = false;
      const next = toView<ActivityPage>(result);
      if (result.kind === "unauthenticated" || result.kind === "denied") report.current(result.kind);
      setState((current) => {
        if (!current || current.key !== forKey) return current;
        if (next.state === "ok") {
          const seen = new Set(current.rows.map((row) => row.sequence));
          return { ...current, rows: [...current.rows, ...next.data.items.filter((row) => !seen.has(row.sequence))], next: next.data.nextCursor, more: "idle" };
        }
        if (next.state === "gone") return { key: forKey, rows: [], next: null, phase: "gone", more: "idle" };
        return { ...current, more: "error", moreMessage: next.state === "error" ? next.message : undefined };
      });
    });
  }, [resolved, applied, view, key]);

  const properties = resolved ? allowedProperties(summary, resolved.menu) : [];
  const nameOf = (id: string) => scope.propertyNames[id] ?? `Cơ sở ${id.slice(0, 8)}`;

  if (!scope.ready) return <p role="status" data-testid="activity-loading" className="text-sm text-gray-600 dark:text-gray-400">Đang tải danh sách mục được xem…</p>;
  if (!resolved) return <p role="status" data-testid="activity-no-scope" className="text-sm text-gray-600 dark:text-gray-400">Tài khoản này chưa có mục nào để xem lịch sử.</p>;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <form className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={(event) => event.preventDefault()} aria-label="Bộ lọc lịch sử hoạt động">
        <label className={LABEL}>
          Menu
          <select data-testid="activity-menu" className={FIELD} value={resolved.menu} onChange={(event) => setWanted({ menu: event.target.value })}>
            {menus.map((menu) => (
              <option key={menu} value={menu}>{ADMIN_MENU[menu].label}</option>
            ))}
          </select>
        </label>
        {properties.length > 0 && (
          <label className={LABEL}>
            Cơ sở
            <select data-testid="activity-property" className={FIELD} value={resolved.propertyId} onChange={(event) => setWanted({ menu: resolved.menu, propertyId: event.target.value })}>
              {properties.map((property) => (
                <option key={property.propertyId} value={property.propertyId}>{nameOf(property.propertyId)}</option>
              ))}
            </select>
          </label>
        )}
        <label className={LABEL}>
          Từ ngày
          <input data-testid="activity-from" type="date" className={FIELD} value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label className={LABEL}>
          Đến ngày (gồm cả ngày này)
          <input data-testid="activity-to" type="date" className={FIELD} value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
        </label>
        <label className={LABEL}>
          Mã Staff thực hiện
          <input data-testid="activity-actor" type="text" inputMode="text" autoComplete="off" spellCheck={false} placeholder="GUID" className={FIELD} value={filters.actor} onChange={(event) => setFilters((current) => ({ ...current, actor: event.target.value }))} />
        </label>
      </form>
      {Object.values(problems).filter(Boolean).map((message) => (
        <p key={message} role="alert" data-testid="activity-filter-problem" className="text-sm text-error-600 dark:text-error-400">{message}</p>
      ))}
      <p className="text-xs text-gray-500 dark:text-gray-400">Giờ hiển thị theo múi giờ Việt Nam (UTC+7). Chỉ xem: mở lịch sử không đánh dấu đã xem.</p>

      {applied && !view && <p role="status" data-testid="activity-rows-loading" className="text-sm text-gray-600 dark:text-gray-400">Đang tải…</p>}
      {view?.phase === "gone" && <p role="alert" data-testid="activity-gone" className="text-sm text-gray-700 dark:text-gray-300">{GONE_MESSAGE}</p>}
      {view?.phase === "error" && (
        <div role="alert" data-testid="activity-error" className="flex flex-col items-start gap-2 text-sm text-error-600 dark:text-error-400">
          <p>{view.message}</p>
          <button type="button" onClick={() => setAttempt((count) => count + 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 dark:border-gray-700 dark:text-gray-300">Thử lại</button>
        </div>
      )}
      {view?.phase === "ready" && view.rows.length === 0 && <p data-testid="activity-empty" className="text-sm text-gray-600 dark:text-gray-400">Chưa có hoạt động nào khớp bộ lọc.</p>}
      {view?.phase === "ready" && view.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table data-testid="activity-table" className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Lịch sử hoạt động của {ADMIN_MENU[resolved.menu].label}, mới nhất trước</caption>
            <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Thời gian</th>
                <th scope="col" className="py-2 pr-3 font-medium">Người thực hiện</th>
                <th scope="col" className="py-2 pr-3 font-medium">Hành động</th>
                <th scope="col" className="py-2 pr-3 font-medium">Đối tượng</th>
                <th scope="col" className="py-2 font-medium">Số mục</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {view.rows.map((row) => (
                <tr key={row.sequence} data-testid="activity-row">
                  <td className="whitespace-nowrap py-2 pr-3 text-gray-600 dark:text-gray-400">{formatActivityTime(row.occurredAtUtc)}</td>
                  <td className="py-2 pr-3 text-gray-800 dark:text-white/90">
                    {actorLabel(row.actorKind)}
                    {row.actorStaffId && <span className="block break-all text-xs text-gray-500 dark:text-gray-400">{row.actorStaffId}</span>}
                  </td>
                  <td className="py-2 pr-3 text-gray-800 dark:text-white/90">{row.action}</td>
                  <td className="break-words py-2 pr-3 text-gray-800 dark:text-white/90">{row.titleSnapshot || row.entityKind}</td>
                  <td className="py-2 text-gray-600 dark:text-gray-400">{row.itemCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view?.phase === "ready" && view.more === "error" && <p role="alert" data-testid="activity-more-error" className="text-sm text-error-600 dark:text-error-400">{view.moreMessage}</p>}
      {view?.phase === "ready" && view.next && (
        <button type="button" data-testid="activity-more" disabled={view.more === "loading"} onClick={loadMore} className="self-start rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">
          {view.more === "loading" ? "Đang tải…" : view.more === "error" ? "Thử tải thêm lại" : "Tải thêm"}
        </button>
      )}
    </section>
  );
}
