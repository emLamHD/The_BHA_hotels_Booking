"use client";

import React, { FC, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ButtonSecondary from "@/shared/ButtonSecondary";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";
import { getProperties } from "@/lib/api/propertyService";
import { getRoomTypes } from "@/lib/api/roomTypeService";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { apiErrorKey } from "@/lib/api/errorMessages";
import { useApiMessage } from "@/lib/i18n/apiMessage";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { isRequestCancelledError } from "@/lib/api/httpClient";
import {
  RoomIdentity,
  parseRoomDetailsQuery,
  resolveProperty,
  resolveRoomType,
} from "@/lib/roomDetailsRoute";
import { parseSearchQuery } from "@/lib/staySearch";
import type { AvailabilityDraft } from "@/lib/api/availabilityValidation";
import RoomDetailsContent from "./RoomDetailsContent";


const Message: FC<{ role: "status" | "alert"; title: string; children?: ReactNode }> = ({ role, title, children }) => (
  <div role={role} className="mx-auto flex max-w-xl flex-col items-center space-y-4 py-24 text-center">
    <h1 className="text-2xl font-semibold">{title}</h1>
    <div className="space-y-4 text-neutral-600 dark:text-neutral-300">{children}</div>
  </div>
);

const BackToRooms: FC = () => {
  const { t } = useI18n();
  return (
  <ShowcaseNavLink
    section="rooms"
    className="inline-flex items-center justify-center rounded-full bg-primary-6000 px-6 py-3 font-medium text-neutral-50 hover:bg-primary-700"
  >
    {t("customer.room.viewRooms")}
  </ShowcaseNavLink>
  );
};

/**
 * Reads and validates the room identity from the URL, then mounts the loader keyed by that identity,
 * so moving between two rooms on the same pathname remounts everything below: the old room's
 * requests are aborted by effect cleanup and its data can never appear under the new URL.
 */
const RoomDetailsRoot: FC = () => {
  const searchParams = useSearchParams();
  const { t, content } = useI18n();
  const apiMessage = useApiMessage();
  const parsed = parseRoomDetailsQuery(searchParams);

  if (parsed.kind === "missing") {
    return (
      <Message role="status" title={t("customer.room.notChosen.title")}>
        <p>{t("customer.room.notChosen.body")}</p>
        <BackToRooms />
      </Message>
    );
  }
  if (parsed.kind === "invalid") {
    return (
      <Message role="alert" title={t("customer.room.invalidLink.title")}>
        <p>{t("customer.room.invalidLink.body")}</p>
        <BackToRooms />
      </Message>
    );
  }

  const { propertyId, roomTypeId } = parsed.ids;
  // A search that came with the URL (the home page's) is used only when it is complete and valid.
  const searchDraft = parseSearchQuery(searchParams);
  return (
    <RoomDetailsLoader
      key={`${propertyId.toLowerCase()}:${roomTypeId.toLowerCase()}`}
      ids={parsed.ids}
      searchDraft={searchDraft}
    />
  );
};

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unknown-property" }
  | { kind: "unknown-room-type"; property: PropertyDto }
  | { kind: "ready"; property: PropertyDto; roomType: RoomTypeDto; roomTypes: RoomTypeDto[] };

const RoomDetailsLoader: FC<{ ids: RoomIdentity; searchDraft: AvailabilityDraft | null }> = ({ ids, searchDraft }) => {
  const { t, content } = useI18n();
  const apiMessage = useApiMessage();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const request = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoaded({ kind: "loading" });

    (async () => {
      const properties = await getProperties({ signal: controller.signal });
      if (controller.signal.aborted) return;
      const property = resolveProperty(properties, ids.propertyId);
      if (!property) {
        setLoaded({ kind: "unknown-property" });
        return;
      }
      const roomTypes = await getRoomTypes(property.id, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const roomType = resolveRoomType(roomTypes, ids);
      setLoaded(roomType ? { kind: "ready", property, roomType, roomTypes } : { kind: "unknown-room-type", property });
    })().catch((error) => {
      if (isRequestCancelledError(error) || controller.signal.aborted) return;
      setLoaded({ kind: "error", message: apiErrorKey(error, "customer.room.loadError.generic") });
    });
  }, [ids]);

  useEffect(() => {
    load();
    return () => request.current?.abort();
  }, [load]);

  switch (loaded.kind) {
    case "loading":
      return (
        <div role="status" aria-live="polite" className="py-24 text-center text-neutral-500 dark:text-neutral-400">
          {t("customer.room.loading")}
        </div>
      );
    case "error":
      return (
        <Message role="alert" title={t("customer.room.loadError.title")}>
          <p>{apiMessage(loaded.message)}</p>
          <ButtonSecondary onClick={load}>{t("customer.common.retry")}</ButtonSecondary>
        </Message>
      );
    case "unknown-property":
      return (
        <Message role="alert" title={t("customer.room.unknownProperty.title")}>
          <p>{t("customer.room.unknownProperty.body")}</p>
          <BackToRooms />
        </Message>
      );
    case "unknown-room-type":
      return (
        <Message role="alert" title={t("customer.room.unknownRoomType.title")}>
          <p>{t("customer.room.unknownRoomType.body", { property: content("property", loaded.property.id, "name", loaded.property.name ?? t("customer.room.propertyFallback")) })}</p>
          <BackToRooms />
        </Message>
      );
    case "ready":
      return (
        <RoomDetailsContent
          property={loaded.property}
          roomType={loaded.roomType}
          roomTypes={loaded.roomTypes}
          searchDraft={searchDraft}
        />
      );
  }
};

export default RoomDetailsRoot;
