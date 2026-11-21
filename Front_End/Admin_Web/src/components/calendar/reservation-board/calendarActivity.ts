/**
 * BHA-ADMIN-BADGE-001-PR13 (ADR 0011 §D "Calendar read state"): how the board reads the PR-12 `activity` of a stay or an operational block, and what counts as "still unread" on screen.
 *
 * The board answer is a bare cast, so `activity` is read defensively: anything that is not `{ unread: boolean, watermark: decimal string }` is "no activity" — the bar renders as it always did
 * and nothing is acknowledged for it. A watermark is only ever compared as a BigInt after it matched the decimal pattern (a malformed one must never throw during a render).
 */

import type { CalendarEntityKind } from "@/lib/api/menuUnseen";
import type { ReservationBoardActivity } from "@/lib/api/types";

const WATERMARK = /^(0|[1-9][0-9]*)$/;

export function readActivity(raw: unknown): ReservationBoardActivity | null {
  if (raw === null || typeof raw !== "object") return null;
  const { unread, watermark } = raw as Record<string, unknown>;
  return typeof unread === "boolean" && typeof watermark === "string" && WATERMARK.test(watermark) ? { unread, watermark } : null;
}

/** What a response with `unread: false` told this Staff member about ONE object: its cursor, per Staff, Property, kind and id (never a segment). */
export type AckedMarks = Readonly<Record<string, string>>;

export const ackKey = (identity: string, propertyId: string, kind: CalendarEntityKind, id: string): string => `${identity}|${propertyId}|${kind}|${id}`;

/**
 * Unread on screen: the board said unread AND no acknowledged cursor of this Staff member has reached the watermark the board showed. An acknowledgement that arrives late (for watermark 1) can
 * therefore never clear a bar that a newer board read shows with watermark 2.
 */
export function isUnreadOnScreen(activity: unknown, acked: string | undefined): boolean {
  const read = readActivity(activity);
  if (!read || !read.unread) return false;
  return acked === undefined || BigInt(acked) < BigInt(read.watermark);
}

export const higherWatermark = (a: string | undefined, b: string): string => (a !== undefined && BigInt(a) >= BigInt(b) ? a : b);
