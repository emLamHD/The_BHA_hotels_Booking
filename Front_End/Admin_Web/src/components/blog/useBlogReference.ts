"use client";

/** BHA-BLOG-001-CP03: the two lists a Blog screen needs from outside the Blog — the website's active languages and its active Properties. */

import { useEffect, useState } from "react";
import { fetchActiveLanguages, type ActiveLanguage } from "@/lib/api/blog";
import { fetchActiveProperties } from "@/lib/api/client";
import type { PropertyOption } from "./BodyEditorContext";

export type Loaded<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

function useLoaded<T>(load: (signal: AbortSignal) => Promise<{ ok: true; data: T } | { ok: false; message: string }>, attempt: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok ? { status: "ready", data: result.data } : { status: "error", message: result.message });
    });
    return () => controller.abort();
    // `load` is a module function: only a new attempt reads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return state;
}

export function useActiveLanguages(attempt = 0): Loaded<ActiveLanguage[]> {
  return useLoaded(async (signal) => {
    const result = await fetchActiveLanguages(signal);
    return result.kind === "ok" ? { ok: true, data: result.data } : { ok: false, message: "message" in result ? result.message : "Không đọc được danh sách ngôn ngữ." };
  }, attempt);
}

export function useActiveProperties(attempt = 0): Loaded<PropertyOption[]> {
  return useLoaded(async (signal) => {
    const result = await fetchActiveProperties(signal);
    return result.ok ? { ok: true, data: result.data.map((p) => ({ id: p.id, name: p.name })) } : { ok: false, message: result.error.message };
  }, attempt);
}
