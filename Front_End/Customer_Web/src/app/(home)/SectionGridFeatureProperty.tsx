"use client";

import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import PropertyLiveCard from "@/components/PropertyLiveCard";
import SectionGridRoomTypes from "./SectionGridRoomTypes";
import SectionAvailabilitySearch from "./SectionAvailabilitySearch";
import { getProperties } from "@/lib/api/propertyService";
import { PropertyDto } from "@/lib/api/propertyTypes";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";
import { SHOWCASE_SECTION_NAVIGATION_EVENT } from "@/lib/routePolicy";
import { createAnchorAlignment } from "@/lib/anchorAlignment";

export interface SectionGridFeaturePropertyProps {
  className?: string;
  gridClass?: string;
  heading?: string;
  subHeading?: string;
}

type LoadStatus = "loading" | "success" | "error";

const ALIGNED_SECTIONS = new Set(["catalog", "room-types", "booking"]);
const USER_TAKEOVER_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;
const ALIGNMENT_WINDOW_MS = 5000;

function describeError(error: unknown): string {
  if (error instanceof ApiConfigError) {
    return "The property service is not configured correctly.";
  }
  if (error instanceof ApiNetworkError) {
    return "We couldn't reach the property service. Check your connection and try again.";
  }
  if (error instanceof ApiHttpError) {
    return error.problem.detail ?? error.problem.title;
  }
  return "Something went wrong while loading properties.";
}

const SectionGridFeatureProperty: FC<SectionGridFeaturePropertyProps> = ({
  className = "",
  gridClass = "",
  heading = "Featured properties",
  subHeading = "Real properties from The BHA Hotels catalog",
}) => {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const loadProperties = useCallback(() => {
    // Cancel any in-flight request before starting a new one so a slow,
    // superseded response can never overwrite a newer result.
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    setStatus("loading");
    setErrorMessage(null);

    getProperties({ signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) {
          return;
        }
        setProperties(data);
        setStatus("success");
      })
      .catch((error) => {
        if (isRequestCancelledError(error) || controller.signal.aborted) {
          return;
        }
        setErrorMessage(describeError(error));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    loadProperties();
    return () => {
      activeRequest.current?.abort();
    };
  }, [loadProperties]);

  const ready = status === "success" && properties.length > 0;

  // C3: keep a section the visitor jumped to in view while content above it
  // settles (browsers without native scroll anchoring). The lifecycle lives in
  // createAnchorAlignment; this effect deliberately has no dependency on
  // `ready` or any data: loading content is not a navigation intent, so it can
  // neither start alignment nor revive one the visitor already cancelled.
  const sectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = sectionRef.current;
    if (!container) return;
    const alignment = createAnchorAlignment<HTMLElement>({
      container,
      sections: ALIGNED_SECTIONS,
      navigationEvent: SHOWCASE_SECTION_NAVIGATION_EVENT,
      takeoverEvents: USER_TAKEOVER_EVENTS,
      windowMs: ALIGNMENT_WINDOW_MS,
      environment: {
        window,
        getElementById: (id) => document.getElementById(id),
        createObserver: (onResize) => new ResizeObserver(onResize),
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
    });
    return () => alignment.dispose();
  }, []);

  return (
    <div ref={sectionRef} id="catalog" className={`nc-SectionGridFeatureProperty relative scroll-mt-28 ${className}`}>
      <Heading desc={subHeading}>{heading}</Heading>

      {status === "loading" && (
        <div
          role="status"
          aria-live="polite"
          className="py-16 text-center text-neutral-500 dark:text-neutral-400"
        >
          Loading properties…
        </div>
      )}

      {status === "error" && (
        <div
          role="alert"
          className="py-16 flex flex-col items-center text-center space-y-4"
        >
          <p className="text-neutral-600 dark:text-neutral-300">{errorMessage}</p>
          <ButtonSecondary onClick={loadProperties}>Retry</ButtonSecondary>
        </div>
      )}

      {status === "success" && properties.length === 0 && (
        <div
          role="status"
          className="py-16 text-center text-neutral-500 dark:text-neutral-400"
        >
          No properties are available right now.
        </div>
      )}

      {ready && (
        <div
          className={`grid gap-6 md:gap-8 grid-cols-1 sm:grid-cols-1 xl:grid-cols-2 ${gridClass}`}
        >
          {properties.map((property) => (
            <PropertyLiveCard key={property.id} className="h-full" data={property} />
          ))}
        </div>
      )}

      {/* CP01-C1 (F2): both anchors exist in every state, so a header or hero
          link clicked while the catalog is loading lands here; the real
          sections replace the notes once properties arrive. */}
      <div id="room-types" className="mt-16 scroll-mt-28">
        {ready ? (
          <SectionGridRoomTypes properties={properties} />
        ) : (
          <PendingNote status={status} what="Loại phòng" />
        )}
      </div>

      <div id="booking" className="mt-16 scroll-mt-28">
        {ready ? (
          <SectionAvailabilitySearch properties={properties} />
        ) : (
          <PendingNote status={status} what="Tìm phòng trống" />
        )}
      </div>
    </div>
  );
};

/** What the room-type and booking areas say until the catalog is usable. */
const PendingNote: FC<{ status: LoadStatus; what: string }> = ({ status, what }) => (
  <div role="status" className="rounded-2xl border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
    <p className="mb-1 font-medium text-neutral-700 dark:text-neutral-200">{what}</p>
    {status === "loading"
      ? "Đang tải danh sách chỗ nghỉ — phần này sẽ hiện ngay khi tải xong."
      : status === "error"
        ? "Chưa tải được danh sách chỗ nghỉ. Bấm Retry ở mục Chỗ nghỉ phía trên để thử lại."
        : "Hiện chưa có chỗ nghỉ nào để đặt."}
  </div>
);

export default SectionGridFeatureProperty;
