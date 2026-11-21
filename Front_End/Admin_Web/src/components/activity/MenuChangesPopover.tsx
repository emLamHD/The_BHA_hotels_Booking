"use client";

/**
 * BHA-ADMIN-BADGE-001-PR05 (ADR 0011 §B): the unseen list behind a sidebar badge. READ ONLY: opening it, choosing a menu or Property, retrying and following its link never say "seen".
 *
 * One menu (and, for Promotions, one Property) is loaded at a time — the one chosen — never all of a parent's children and never merged into one feed. Which menus and Properties can be
 * chosen is only what the CURRENT summary allows. The request is keyed by identity, menu and Property: when any of them changes (another Staff member, a lost permission, another pick) the
 * old rows are gone in that same render and an answer that arrives late is dropped (and its request aborted). The list shows what the API sends in its order, with the API's totals:
 * `unseenEvents` is the total, each group's `events` its own number, `hasMore` the "50+"; nothing is summed from the groups on screen. Titles are rendered as text.
 *
 * BHA-ADMIN-BADGE-001-PR13 (decision D1): the Calendar's list is the one place with a button. ONLY a group whose server `presence` is `Removed` (a cancelled block or reservation) has «Đánh dấu đã xem»; it
 * sends that group's own `entityId` and `observedWatermark` (this list's snapshot, never the list's `snapshotWatermark`/`lastSeenWatermark`) for the Property being listed, through the shared provider
 * (one call per object at a time). An `OnBoard` group is acknowledged by opening its bar on the board. Nothing is optimistic: the group goes only when the server says it is no longer unread AND its
 * cursor reached the watermark this group showed (a late or older answer can never hide a newer group), and the list is then read again; on a failure the group stays and the same button retries; a
 * "still unread" answer reads the list again and keeps what is still unread. An answer that arrives after the popover closed, or for another Staff/Property/menu, paints nothing.
 */

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ADMIN_MENU, type AdminMenuKey } from "@/lib/adminMenus";
import { activityTitle, actorLabel, allowedMenus, allowedProperties, formatActivityTime, resolveScope } from "@/lib/adminActivity";
import { fetchMenuChanges, type CalendarEntityKind, type MenuChanges, type UnseenGroup } from "@/lib/api/menuUnseen";
import { useCalendarSeen, useMenuUnseen, useUnseenScope } from "@/components/website/NewsletterBadgeProvider";
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

/**
 * One read of the unseen list per LOAD. Every change of identity, menu, Property or retry starts a new life, also when it comes back to a value chosen before (A → B → A): what an earlier
 * life loaded (groups, total, an error) belongs to that life and is never shown in this one, so the view is "loading" from the render the change happens in. A late answer of an earlier life
 * is dropped before it can show anything or report a 401/403 to the session, whether or not the transport honoured the abort.
 */
function useChanges(identity: string, menu: string | undefined, propertyId: string | undefined, reportAuth: (kind: "unauthenticated" | "denied") => void) {
  const [attempt, setAttempt] = useState(0);
  /** A re-read of the SAME scope (after an acknowledgement): the rows on screen stay until the new answer replaces them, instead of going back to "loading". */
  const [reloads, setReloads] = useState(0);
  const key = menu ? `${identity}|${menu}|${propertyId ?? ""}|${attempt}` : "";
  const [track, setTrack] = useState({ key, life: 0 });
  if (track.key !== key) setTrack({ key, life: track.life + 1 });
  const life = track.key === key ? track.life : track.life + 1;
  const [done, setDone] = useState<{ life: number; view: View<MenuChanges> } | null>(null);
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
      setDone({ life, view: toView(result) });
      if (result.kind === "unauthenticated" || result.kind === "denied") report.current(result.kind);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [life, menu, propertyId, reloads]);
  const view: View<MenuChanges> = done && done.life === life ? done.view : { state: "loading" };
  return { view, retry: () => setAttempt((count) => count + 1), reload: () => setReloads((count) => count + 1) };
}

const CALENDAR_KINDS: readonly string[] = ["reservation-unit", "room-block"];
/** The one object (and watermark) of a group the Calendar's button may acknowledge; `null` for every other group. Only the server's `Removed` presence qualifies. */
function removedTarget(group: UnseenGroup): { entityKind: CalendarEntityKind; entityId: string; observedWatermark: string } | null {
  if (group.presence !== "Removed" || !group.entityId || !group.observedWatermark || !CALENDAR_KINDS.includes(group.entityKind)) return null;
  return { entityKind: group.entityKind as CalendarEntityKind, entityId: group.entityId, observedWatermark: group.observedWatermark };
}
const groupKey = (group: UnseenGroup) => `${group.entityKind}|${group.entityId ?? ""}|${group.observedWatermark ?? ""}`;

/**
 * What the acknowledgements of ONE VIEW of a scope have done (PR-13-C1): groups to hide, calls on the wire, calls that failed. `view` is a number that changes every time the scope changes, so
 * A → B → A is two different views of A: nothing of the first (a pending call, an error, a hidden group) is carried into the second, and an answer that belongs to the first is dropped.
 */
interface AckState {
  view: number;
  hidden: readonly string[];
  pending: readonly string[];
  failed: readonly string[];
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
  const { view, retry, reload } = useChanges(scope.identity, resolved?.menu, resolved?.propertyId, scope.reportAuth);
  const seenCalendarEntity = useCalendarSeen();
  const ackScope = `${scope.identity}|${resolved?.menu ?? ""}|${resolved?.propertyId ?? ""}`;
  // A new view starts in the very render the scope changes in (also when it comes back to an earlier value), like the list's own life.
  const [track, setTrack] = useState({ scope: ackScope, view: 0 });
  if (track.scope !== ackScope) setTrack({ scope: ackScope, view: track.view + 1 });
  const ackView = track.scope === ackScope ? track.view : track.view + 1;
  const [ackRaw, setAck] = useState<AckState>({ view: ackView, hidden: [], pending: [], failed: [] });
  const ack: AckState = ackRaw.view === ackView ? ackRaw : { view: ackView, hidden: [], pending: [], failed: [] };
  const live = useRef({ mounted: true, view: ackView });
  useEffect(() => {
    live.current.view = ackView;
  }, [ackView]);
  useEffect(() => {
    const state = live.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
    };
  }, []);
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

  const markSeen = async (group: UnseenGroup) => {
    const object = removedTarget(group);
    if (!object || resolved?.menu !== "calendar" || !resolved.propertyId) return;
    const item = groupKey(group);
    const forView = ackView;
    const forProperty = resolved.propertyId;
    const change = (update: (state: AckState) => Partial<AckState>) =>
      setAck((state) => {
        const base = state.view === forView ? state : { view: forView, hidden: [], pending: [], failed: [] };
        return { ...base, ...update(base) };
      });
    change((state) => ({ pending: [...state.pending, item], failed: state.failed.filter((other) => other !== item) }));
    const result = await seenCalendarEntity(scope.identity, { propertyId: forProperty, ...object });
    if (!live.current.mounted || live.current.view !== forView) return;        // closed, or another view now (even of the same scope): nothing of this belongs on screen
    const settle = (extra: (state: AckState) => Partial<AckState> = () => ({})) => change((state) => ({ pending: state.pending.filter((other) => other !== item), ...extra(state) }));
    if (result.kind === "dropped") return settle();
    if (result.kind === "failed") return settle((state) => ({ failed: [...state.failed, item] }));
    const cleared = !result.answer.unread && BigInt(result.answer.lastSeenWatermark) >= BigInt(object.observedWatermark);
    settle((state) => (cleared ? { hidden: [...state.hidden, item] } : {}));
    reload();                                                                   // the list is authoritative: fresh totals, and what is still unread stays
    panel.current?.focus();
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
                {view.data.groups.length > 0 && <> · {view.data.hasMore ? "50+" : view.data.groups.filter((group) => !ack.hidden.includes(groupKey(group))).length} nhóm</>}
              </p>
              {view.data.groups.filter((group) => !ack.hidden.includes(groupKey(group))).length === 0 ? (
                <p data-testid="unseen-popover-none" className="text-gray-600 dark:text-gray-400">Không có thay đổi nào chưa xem.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
                  {view.data.groups.filter((group) => !ack.hidden.includes(groupKey(group))).slice(0, 50).map((group) => (
                    <li key={`${group.entityKind}|${group.entityKey}|${group.latestWatermark}|${group.actors.map((actor) => actor.staffId ?? actor.kind).join(",")}`} data-testid="unseen-popover-group" className="flex flex-col gap-0.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="break-words font-medium text-gray-800 dark:text-white/90">{activityTitle(group.titleSnapshot, group.entityKind, group.itemCount)}</span>
                        <span data-testid="unseen-popover-group-events" className="shrink-0 rounded-full bg-gray-100 px-2 text-xs leading-5 text-gray-700 dark:bg-white/10 dark:text-gray-300">×{group.events}</span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {group.action} · {[...new Set(group.actors.map((actor) => actorLabel(actor.kind)))].join(", ")}
                        {group.itemCount > 1 ? ` · ${group.itemCount} mục` : ""} · {formatActivityTime(group.occurredAtUtc)}
                      </span>
                      {resolved.menu === "calendar" && removedTarget(group) && (
                        <div className="mt-1 flex flex-col items-start gap-1">
                          <button
                            type="button"
                            data-testid="unseen-popover-mark-seen"
                            aria-disabled={ack.pending.includes(groupKey(group)) || undefined}
                            onClick={() => { if (!ack.pending.includes(groupKey(group))) void markSeen(group); }}
                            className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 aria-disabled:cursor-wait aria-disabled:opacity-60 dark:border-gray-700 dark:text-gray-300"
                          >
                            Đánh dấu đã xem
                          </button>
                          {ack.failed.includes(groupKey(group)) && <span role="alert" data-testid="unseen-popover-mark-error" className="text-xs text-error-600 dark:text-error-400">Chưa đánh dấu được. Hãy bấm lại để thử lại.</span>}
                        </div>
                      )}
                      {resolved.menu === "calendar" && group.presence === "OnBoard" && (
                        <span data-testid="unseen-popover-onboard-hint" className="text-xs text-gray-500 dark:text-gray-400">Mở thanh này trên lịch để đánh dấu đã xem.</span>
                      )}
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
