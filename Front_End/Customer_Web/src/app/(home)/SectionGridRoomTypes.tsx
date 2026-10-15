"use client";

import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import RoomTypeLiveCard from "@/components/RoomTypeLiveCard";
import { getRoomTypes } from "@/lib/api/roomTypeService";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { apiErrorKey } from "@/lib/api/errorMessages";
import { isRequestCancelledError } from "@/lib/api/httpClient";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { useApiMessage } from "@/lib/i18n/apiMessage";
type LoadStatus = "loading" | "success" | "error";

/** The pack key of the message for a failed load; the section translates it when it renders. */
function describeError(error: unknown): string {
  return apiErrorKey(error, "customer.home.sectionGridRoomTypes.loadError");
}

interface PropertyRoomTypesProps {
  propertyId: string;
  propertyName: string;
}

/**
 * Owns one Property's RoomType read lifecycle. Keyed by propertyId in the
 * parent so an added/removed Property remounts (aborting/starting requests
 * via normal effect cleanup) instead of needing a manual stale-set check.
 */
const PropertyRoomTypes: FC<PropertyRoomTypesProps> = ({
  propertyId,
  propertyName,
}) => {
  const { t, content } = useI18n();
  const apiMessage = useApiMessage();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [roomTypes, setRoomTypes] = useState<RoomTypeDto[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const loadRoomTypes = useCallback(() => {
    // Cancel any in-flight request before starting a new one so a slow,
    // superseded response can never overwrite a newer result.
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    setStatus("loading");
    setErrorMessage(null);

    getRoomTypes(propertyId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) {
          return;
        }
        setRoomTypes(data);
        setStatus("success");
      })
      .catch((error) => {
        if (isRequestCancelledError(error) || controller.signal.aborted) {
          return;
        }
        setErrorMessage(describeError(error));
        setStatus("error");
      });
  }, [propertyId]);

  useEffect(() => {
    loadRoomTypes();
    return () => {
      activeRequest.current?.abort();
    };
  }, [loadRoomTypes]);

  return (
    <div className="nc-PropertyRoomTypes">
      <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50 mb-6">{t("customer.home.sectionGridRoomTypes.roomTypesAt", { propertyName })}
      </h3>

      {status === "loading" && (
        <div
          role="status"
          aria-live="polite"
          className="py-10 text-center text-neutral-500 dark:text-neutral-400"
        >{t("customer.home.sectionGridRoomTypes.loadingRoomTypes")}</div>
      )}

      {status === "error" && (
        <div
          role="alert"
          className="py-10 flex flex-col items-center text-center space-y-4"
        >
          <p className="text-neutral-600 dark:text-neutral-300">
            {propertyName}: {errorMessage ? apiMessage(errorMessage) : null}
          </p>
          <ButtonSecondary onClick={loadRoomTypes}>{t("customer.common.retry")}</ButtonSecondary>
        </div>
      )}

      {status === "success" && roomTypes.length === 0 && (
        <div
          role="status"
          className="py-10 text-center text-neutral-500 dark:text-neutral-400"
        >{t("customer.home.sectionGridRoomTypes.noRoomTypesAreAvailable", { propertyName })}</div>
      )}

      {status === "success" && roomTypes.length > 0 && (
        <div className="grid gap-6 md:gap-8 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {roomTypes.map((roomType) => (
            <RoomTypeLiveCard key={roomType.id} data={roomType} />
          ))}
        </div>
      )}
    </div>
  );
};

export interface SectionGridRoomTypesProps {
  className?: string;
  properties: PropertyDto[];
}

/**
 * Renders one RoomType catalog per live Property already loaded by
 * SectionGridFeatureProperty. Does not issue its own GET /api/v1/properties
 * request; it only reads the propertyId/name it is given.
 */
const SectionGridRoomTypes: FC<SectionGridRoomTypesProps> = ({
  className = "",
  properties,
}) => {
  const { t, content } = useI18n();
  const apiMessage = useApiMessage();
  if (properties.length === 0) {
    return null;
  }

  return (
    <div className={`nc-SectionGridRoomTypes relative ${className}`}>
      <Heading desc={t("customer.home.sectionGridRoomTypes.realRoomTypesFromThe")}>{t("customer.home.sectionGridRoomTypes.roomTypes")}</Heading>

      <div className="space-y-16">
        {properties.map((property) => (
          <PropertyRoomTypes
            key={property.id}
            propertyId={property.id}
            propertyName={content("property", property.id, "name", property.name ?? t("customer.search.propertyFallback"))}
          />
        ))}
      </div>
    </div>
  );
};

export default SectionGridRoomTypes;
