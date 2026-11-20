"use client";

/**
 * BHA-ADMIN-BADGE-001-PR05 (ADR 0011 §B): the unseen list behind a sidebar badge. READ ONLY: opening it, choosing a menu or Property, retrying and following its link never say "seen".
 *
 * One menu (and, for Promotions, one Property) is loaded at a time — the one chosen — never all of a parent's children and never merged into one feed. Which menus and Properties can be
 * chosen is only what the CURRENT summary allows. The request is keyed by identity, menu and Property: when any of them changes (another Staff member, a lost permission, another pick) the
 * old rows are gone in that same render and an answer that arrives late is dropped (and its request aborted). The list shows what the API sends in its order, with the API's totals:
 * `unseenEvents` is the total, each group's `events` its own number, `hasMore` the "50+"; nothing is summed from the groups on screen. Titles are rendered as text.
 */

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ADMIN_MENU, type AdminMenuKey } from "@/lib/adminMenus";
import { actorLabel, allowedMenus, allowedProperties, formatActivityTime, resolveScope } from "@/lib/adminActivity";
import { fetchMenuChanges, type MenuChanges } from "@/lib/api/menuUnseen";
import { useMenuUnseen, useUnseenScope } from "@/components/website/NewsletterBadgeProvider";
import { GONE_MESSAGE, toView, type View } from "./activityRequest";

export interface PopoverTarget {
  /** The menus this badge stands for (a parent's children, or one menu). */
  menus: readonly AdminMenuKey[];
  /** The one the clicked badge belongs to. */
  initial: AdminMenuKey;
  /** The button that opened it: focus goes back to it on Escape. */
  anchor: HTMLElement;
  /** The identity it was opened for: for any other it is never shown. */
  identity: string;
}

export const historyHref = (menu: string, propertyId?: string) => `/activity?menu=${encodeURIComponent(menu)}${propertyId ? `&propertyId=${encodeURIComponent(propertyId)}` : ""}`;

/** One read of the unseen list per (identity, menu, Property); the view for any other key is "loading" from the render the key changes in. */
function useChanges(identity: string, menu: string | undefined, propertyId: string | undefined, reportAuth: (kind: "unauthenticated" | "denied") => void) {
  const [attempt, setAttempt] = useState(0);
  const key = menu ? `${identity}|${menu}|${propertyId ?? ""}|${attempt}` : "";
  const [done, setDone] = useState<{ key: string; view: View<MenuChanges> } | null>(null);
  const report = useRef(reportAuth);
  useEffect(() => {
    report.current = reportAuth;
  });
  useEffect(() => {
    if (!menu) return undefined;
    let live = true;
    const controller = new AbortController();
    void fetchMenuChanges(menu, propertyId, controller.signal).then((result) => {
      if (!live) return;
      setDone({ key, view: toView(result) });
      if (result.kind === "unauthenticated" || result.kind === "denied") report.current(result.kind);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [key, menu, propertyId]);
  const view: View<MenuChanges> = done && done.key === key ? done.view : { state: "loading" };
  return { view, retry: () => setAttempt((count) => count + 1) };
}

const FIELD = "h-9 w-full rounded-lg border border-gray-300 bg-transparent px-2 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90";

const EDGE = 8;

/**
 * Where the panel goes, and the tallest it may be. Both come from the same limit: the panel prefers 70% of the window; `top` follows the anchor but is moved up as far as that preferred
 * height needs, and `maxHeight` is whatever is left from `top` to the bottom padding. So the panel never reaches below the viewport, however long the list; what does not fit scrolls inside it
 * (the last group and the history link stay reachable).
 */
function placement(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(352, window.innerWidth - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(rect.right + EDGE, window.innerWidth - width - EDGE));
  const preferred = Math.min(window.innerHeight * 0.7, window.innerHeight - 2 * EDGE);
  const top = Math.max(EDGE, Math.min(rect.top, window.innerHeight - EDGE - preferred));
  return { left, top, width, maxHeight: Math.max(0, window.innerHeight - EDGE - top) };
}

export default function MenuChangesPopover({ target, onClose }: { target: PopoverTarget; onClose: (returnFocus: boolean) => void }) {
  const summary = useMenuUnseen();
  const scope = useUnseenScope();
  const menus = allowedMenus(summary, target.menus);
  const [pickedMenu, setPickedMenu] = useState<string>(target.initial);
  const [pickedProperty, setPickedProperty] = useState<string | undefined>(undefined);
  const resolved = resolveScope(summary, menus, pickedMenu, pickedProperty);
  const { view, retry } = useChanges(scope.identity, resolved?.menu, resolved?.propertyId, scope.reportAuth);
  const [box, setBox] = useState(() => placement(target.anchor));
  const panel = useRef<HTMLDivElement | null>(null);

  // The sidebar may still be moving when it opens (a collapsed one unfolds under the pointer) and the window may be resized: follow the button for the length of the transition, and on resize.
  useEffect(() => {
    let frame = 0;
    const started = performance.now();
    const place = () => {
      if (!target.anchor.isConnected) return;
      const next = placement(target.anchor);
      setBox((current) => (current.left === next.left && current.top === next.top && current.width === next.width && current.maxHeight === next.maxHeight ? current : next));
    };
    const follow = () => {
      place();
      if (performance.now() - started < 450) frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
    };
  }, [target.anchor]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!panel.current?.contains(node) && !target.anchor.contains(node)) onClose(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose, target.anchor]);

  /** A dialog keeps Tab inside itself. */
  const keepFocus = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>("select, a[href], button:not([disabled])")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const properties = resolved ? allowedProperties(summary, resolved.menu) : [];
  const nameOf = (id: string) => scope.propertyNames[id] ?? `Cơ sở ${id.slice(0, 8)}`;

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Thay đổi chưa xem"
      data-testid="unseen-popover"
      tabIndex={-1}
      onKeyDown={keepFocus}
      style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
      className="fixed z-[60] flex flex-col gap-3 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 text-sm shadow-theme-lg outline-none dark:border-gray-800 dark:bg-gray-900"
    >
      {!resolved ? (
        <p role="status" data-testid="unseen-popover-empty" className="text-gray-600 dark:text-gray-400">Không còn mục nào để xem.</p>
      ) : (
        <>
          {menus.length > 1 && (
            <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
              Menu
              <select data-testid="unseen-popover-menu" className={FIELD} value={resolved.menu} onChange={(event) => { setPickedMenu(event.target.value); setPickedProperty(undefined); }}>
                {menus.map((key) => (
                  <option key={key} value={key}>{ADMIN_MENU[key].label} ({summary[key]?.count ?? 0})</option>
                ))}
              </select>
            </label>
          )}
          {properties.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
              Cơ sở
              <select data-testid="unseen-popover-property" className={FIELD} value={resolved.propertyId} onChange={(event) => setPickedProperty(event.target.value)}>
                {properties.map((property) => (
                  <option key={property.propertyId} value={property.propertyId}>{nameOf(property.propertyId)} ({property.count})</option>
                ))}
              </select>
            </label>
          )}
          <h3 className="font-medium text-gray-800 dark:text-white/90">{ADMIN_MENU[resolved.menu].label}</h3>

          {view.state === "loading" && <p role="status" data-testid="unseen-popover-loading" className="text-gray-600 dark:text-gray-400">Đang tải…</p>}
          {view.state === "gone" && <p role="alert" data-testid="unseen-popover-gone" className="text-gray-700 dark:text-gray-300">{GONE_MESSAGE}</p>}
          {view.state === "error" && (
            <div role="alert" data-testid="unseen-popover-error" className="flex flex-col items-start gap-2 text-error-600 dark:text-error-400">
              <p>{view.message}</p>
              <button type="button" onClick={retry} className="rounded-lg border border-gray-300 px-3 py-1 text-gray-700 dark:border-gray-700 dark:text-gray-300">Thử lại</button>
            </div>
          )}
          {view.state === "ok" && (
            <>
              <p data-testid="unseen-popover-total" className="text-gray-700 dark:text-gray-300">
                <strong>{view.data.unseenEvents}</strong> thay đổi chưa xem
                {view.data.groups.length > 0 && <> · {view.data.hasMore ? "50+" : view.data.groups.length} nhóm</>}
              </p>
              {view.data.groups.length === 0 ? (
                <p data-testid="unseen-popover-none" className="text-gray-600 dark:text-gray-400">Không có thay đổi nào chưa xem.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
                  {view.data.groups.slice(0, 50).map((group) => (
                    <li key={`${group.entityKind}|${group.entityKey}|${group.latestWatermark}|${group.actors.map((actor) => actor.staffId ?? actor.kind).join(",")}`} data-testid="unseen-popover-group" className="flex flex-col gap-0.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="break-words font-medium text-gray-800 dark:text-white/90">{group.titleSnapshot || group.entityKind}</span>
                        <span data-testid="unseen-popover-group-events" className="shrink-0 rounded-full bg-gray-100 px-2 text-xs leading-5 text-gray-700 dark:bg-white/10 dark:text-gray-300">×{group.events}</span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {group.action} · {[...new Set(group.actors.map((actor) => actorLabel(actor.kind)))].join(", ")}
                        {group.itemCount > 1 ? ` · ${group.itemCount} mục` : ""} · {formatActivityTime(group.occurredAtUtc)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {view.data.hasMore && <p data-testid="unseen-popover-more" className="text-xs text-gray-600 dark:text-gray-400">Chỉ hiển thị 50 nhóm mới nhất (50+). Xem lịch sử để thấy đầy đủ.</p>}
            </>
          )}
          <Link data-testid="unseen-popover-history" href={historyHref(resolved.menu, resolved.propertyId)} onClick={() => onClose(false)} className="text-brand-500 hover:underline">Xem lịch sử hoạt động</Link>
        </>
      )}
    </div>,
    document.body,
  );
}
