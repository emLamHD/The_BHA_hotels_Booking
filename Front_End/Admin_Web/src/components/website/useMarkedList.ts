"use client";

/**
 * BHA-ADMIN-BADGE-001-PR07 (ADR 0011 §B, §D): the one way a Blog or Website screen turns a successful list read into "seen".
 *
 * `useMarkedList` is `useWebsiteList` plus the proof an acknowledgement needs: the watermark of the answer, and WHO started the read. The identity is captured when the read starts and
 * kept with the answer (a late answer of Staff A is still A's, whoever is signed in when it lands), and a different identity is a different read: it is in the dependencies, so the older
 * answer is superseded. A `mark` exists only while the data on screen is the answer for the query on screen: `ready`, not `pending` (so never data kept while a newer read is out, never a
 * failed or superseded read), carrying a canonical watermark, and `applies` (the screen still renders it: a page past the end that is about to be replaced does not). Nothing else says "seen":
 * not a write's answer, an editor's detail, a picker or the activity views, and the watermark is never taken from the summary GET.
 *
 * A missing or malformed watermark (an older backend) is simply no mark: the data renders as before.
 */

import { useEffect, useState } from "react";
import { useWebsiteList } from "./useWebsiteData";
import { useMenuSeen, useUnseenScope, type SeenMenu } from "./NewsletterBadgeProvider";
import { isWatermark, type WebsiteResult } from "@/lib/api/website";

export interface ReadMark {
  watermark: string;
  /** The Staff identity that started the read. */
  by: string;
  /** The answer it belongs to: a new answer with the same watermark is still a new chance to say it (an earlier call may have failed). */
  source: object;
}

export function useMarkedList<T extends object>(
  load: (signal: AbortSignal) => Promise<WebsiteResult<T>>,
  deps: ReadonlyArray<unknown>,
  markOf: (data: T) => string | undefined,
  applies: (data: T) => boolean = () => true,
) {
  const { identity } = useUnseenScope();
  const [readers] = useState(() => new WeakMap<object, string>());
  const list = useWebsiteList<T>(async (signal) => {
    const result = await load(signal);
    if (result.kind === "ok") readers.set(result.data, identity);
    return result;
  }, [identity, ...deps]);
  const data = list.state.status === "ready" ? list.state.data : null;
  const watermark = data ? markOf(data) : undefined;
  const by = data ? readers.get(data) : undefined;
  const mark: ReadMark | null =
    data !== null && !list.pending && by !== undefined && by !== "" && by === identity && isWatermark(watermark) && applies(data) ? { watermark, by, source: data } : null;
  return { ...list, mark };
}

/** Says "seen up to this mark" for a menu, once per answer. Nothing without a mark; nothing without a provider (LocalGate). */
export function useAckOnRead(menu: SeenMenu, mark: ReadMark | null) {
  const seen = useMenuSeen();
  const watermark = mark?.watermark;
  const by = mark?.by;
  const source = mark?.source;
  useEffect(() => {
    if (watermark && by && source) seen(menu, watermark, by);
  }, [seen, menu, watermark, by, source]);
}

/** The lower of two marks of the SAME stream and identity (a screen that shows two reads of one stream is only as seen as the older of them); `null` when they are not comparable. */
export function lowestMark(a: ReadMark, b: ReadMark): ReadMark | null {
  if (a.by !== b.by) return null;
  return BigInt(a.watermark) <= BigInt(b.watermark) ? a : b;
}
