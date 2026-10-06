"use client";

import React, { FC, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ButtonSecondary from "@/shared/ButtonSecondary";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";
import { getProperties } from "@/lib/api/propertyService";
import { getRoomTypes } from "@/lib/api/roomTypeService";
import { PropertyDto, RoomTypeDto } from "@/lib/api/propertyTypes";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";
import {
  RoomIdentity,
  parseRoomDetailsQuery,
  resolveProperty,
  resolveRoomType,
} from "@/lib/roomDetailsRoute";
import RoomDetailsContent from "./RoomDetailsContent";

function describeError(error: unknown, what: string): string {
  if (error instanceof ApiConfigError) return `Dịch vụ ${what} chưa được cấu hình đúng.`;
  if (error instanceof ApiNetworkError) {
    return `Không kết nối được tới dịch vụ ${what}. Kiểm tra kết nối rồi thử lại.`;
  }
  if (error instanceof ApiHttpError) return error.problem.detail ?? error.problem.title;
  return `Đã có lỗi khi tải ${what}.`;
}

const Message: FC<{ role: "status" | "alert"; title: string; children?: ReactNode }> = ({ role, title, children }) => (
  <div role={role} className="mx-auto flex max-w-xl flex-col items-center space-y-4 py-24 text-center">
    <h1 className="text-2xl font-semibold">{title}</h1>
    <div className="space-y-4 text-neutral-600 dark:text-neutral-300">{children}</div>
  </div>
);

const BackToRooms: FC = () => (
  <ShowcaseNavLink
    section="rooms"
    className="inline-flex items-center justify-center rounded-full bg-primary-6000 px-6 py-3 font-medium text-neutral-50 hover:bg-primary-700"
  >
    Xem các loại phòng
  </ShowcaseNavLink>
);

/**
 * Reads and validates the room identity from the URL, then mounts the loader keyed by that identity,
 * so moving between two rooms on the same pathname remounts everything below: the old room's
 * requests are aborted by effect cleanup and its data can never appear under the new URL.
 */
const RoomDetailsRoot: FC = () => {
  const searchParams = useSearchParams();
  const parsed = parseRoomDetailsQuery(searchParams);

  if (parsed.kind === "missing") {
    return (
      <Message role="status" title="Chưa chọn phòng">
        <p>Hãy chọn một loại phòng ở trang chủ để xem chi tiết và đặt phòng.</p>
        <BackToRooms />
      </Message>
    );
  }
  if (parsed.kind === "invalid") {
    return (
      <Message role="alert" title="Liên kết phòng không hợp lệ">
        <p>Địa chỉ này không xác định được một loại phòng. Hãy mở lại từ danh sách phòng.</p>
        <BackToRooms />
      </Message>
    );
  }

  const { propertyId, roomTypeId } = parsed.ids;
  return <RoomDetailsLoader key={`${propertyId.toLowerCase()}:${roomTypeId.toLowerCase()}`} ids={parsed.ids} />;
};

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unknown-property" }
  | { kind: "unknown-room-type"; property: PropertyDto }
  | { kind: "ready"; property: PropertyDto; roomType: RoomTypeDto; roomTypes: RoomTypeDto[] };

const RoomDetailsLoader: FC<{ ids: RoomIdentity }> = ({ ids }) => {
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
      setLoaded({ kind: "error", message: describeError(error, "phòng") });
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
          Đang tải phòng…
        </div>
      );
    case "error":
      return (
        <Message role="alert" title="Chưa tải được phòng">
          <p>{loaded.message}</p>
          <ButtonSecondary onClick={load}>Thử lại</ButtonSecondary>
        </Message>
      );
    case "unknown-property":
      return (
        <Message role="alert" title="Không tìm thấy chỗ nghỉ">
          <p>Chỗ nghỉ trong liên kết này không có trong hệ thống đặt phòng.</p>
          <BackToRooms />
        </Message>
      );
    case "unknown-room-type":
      return (
        <Message role="alert" title="Không tìm thấy loại phòng">
          <p>Loại phòng này không thuộc {loaded.property.name ?? "chỗ nghỉ"} hoặc không còn mở đặt.</p>
          <BackToRooms />
        </Message>
      );
    case "ready":
      return <RoomDetailsContent property={loaded.property} roomType={loaded.roomType} roomTypes={loaded.roomTypes} />;
  }
};

export default RoomDetailsRoot;
