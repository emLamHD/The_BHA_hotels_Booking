"use client";

/**
 * BHA-BLOG-001-CP03: a picture read through the Staff session. The bytes are fetched with the cookie into a Blob and shown from an object URL that
 * is revoked when the picture changes or the component goes away — a draft's picture is never behind a public address, and no picture is kept in
 * browser storage.
 */

import React, { useEffect, useRef, useState } from "react";
import { fetchStaffImage } from "@/lib/api/blog";
import { useWebsiteHost } from "@/components/website/WebsiteAccessGate";

export type StaffImageState = { status: "empty" } | { status: "loading" } | { status: "ready"; url: string } | { status: "failed" };

export function useStaffImage(path: string | null): StaffImageState {
  const host = useWebsiteHost();
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  });
  const [state, setState] = useState<{ path: string | null; value: StaffImageState }>({ path: null, value: { status: "empty" } });

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetchStaffImage(path, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.kind === "ok") {
        objectUrl = URL.createObjectURL(result.data);
        setState({ path, value: { status: "ready", url: objectUrl } });
        return;
      }
      if (result.kind === "unauthenticated") hostRef.current.onUnauthenticated();
      else if (result.kind === "denied") void hostRef.current.onDenied();
      setState({ path, value: { status: "failed" } });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!path) return { status: "empty" };
  // A path that has just changed shows "loading" rather than the previous picture.
  return state.path === path ? state.value : { status: "loading" };
}

export function StaffImage({ path, alt, className, testId }: { path: string | null; alt: string; className?: string; testId?: string }) {
  const image = useStaffImage(path);
  if (image.status === "ready") {
    // eslint-disable-next-line @next/next/no-img-element -- a Blob URL: next/image cannot optimise it
    return <img src={image.url} alt={alt} className={className} data-testid={testId} />;
  }
  return (
    <div
      role={image.status === "failed" ? "img" : undefined}
      aria-label={image.status === "failed" ? `Không tải được ảnh: ${alt}` : undefined}
      data-testid={testId ? `${testId}-${image.status}` : undefined}
      className={`flex items-center justify-center bg-gray-100 text-xs text-gray-400 dark:bg-white/5 ${className ?? ""}`}
    >
      {image.status === "loading" ? "Đang tải…" : image.status === "failed" ? "Lỗi ảnh" : ""}
    </div>
  );
}
