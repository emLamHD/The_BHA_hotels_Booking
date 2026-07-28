"use client";

import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import PropertyLiveCard from "@/components/PropertyLiveCard";
import { getProperties } from "@/lib/api/propertyService";
import { PropertyDto } from "@/lib/api/propertyTypes";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";

export interface SectionGridFeaturePropertyProps {
  className?: string;
  gridClass?: string;
  heading?: string;
  subHeading?: string;
}

type LoadStatus = "loading" | "success" | "error";

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

  return (
    <div className={`nc-SectionGridFeatureProperty relative ${className}`}>
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

      {status === "success" && properties.length > 0 && (
        <div
          className={`grid gap-6 md:gap-8 grid-cols-1 sm:grid-cols-1 xl:grid-cols-2 ${gridClass}`}
        >
          {properties.map((property) => (
            <PropertyLiveCard key={property.id} className="h-full" data={property} />
          ))}
        </div>
      )}
    </div>
  );
};

export default SectionGridFeatureProperty;
