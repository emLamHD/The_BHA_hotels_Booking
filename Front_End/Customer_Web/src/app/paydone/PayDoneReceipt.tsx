"use client";

import React, { FC, useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import StartRating from "@/components/StartRating";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { useStaySearch } from "@/components/StaySearchProvider";
import { formatCurrencyAmount } from "@/lib/api/availabilityPresentation";
import { calculateNights } from "@/lib/api/availabilityValidation";
import { selectGalleryImages } from "@/lib/api/mediaPresentation";
import { BookingHoldNightDto, ReservationNightDto } from "@/lib/api/bookingHoldTypes";
import { buildRoomDetailsHref, inProgressBookingTarget, resolveProperty, resolveRoomType } from "@/lib/roomDetailsRoute";
import { formatDesignedForOccupancy, formatMaxOccupancy } from "@/lib/api/roomTypePresentation";

interface Snapshot {
  propertyId: string;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  currencyCode: string | null;
  totalAmount: number;
  nights: (BookingHoldNightDto | ReservationNightDto)[] | null;
}

function formatUtcInstant(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString("vi-VN");
}

const CalendarIcon = () => (
  <svg className="w-8 h-8 text-neutral-300 dark:text-neutral-6000" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M9.33333 8.16667V3.5M18.6667 8.16667V3.5M8.16667 12.8333H19.8333M5.83333 24.5H22.1667C23.4553 24.5 24.5 23.4553 24.5 22.1667V8.16667C24.5 6.878 23.4553 5.83333 22.1667 5.83333H5.83333C4.54467 5.83333 3.5 6.878 3.5 8.16667V22.1667C3.5 23.4553 4.54467 24.5 5.83333 24.5Z"
      stroke="#D1D5DB"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const GuestsIcon = () => (
  <svg className="w-8 h-8 text-neutral-300 dark:text-neutral-6000" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M14 5.07987C14.8551 4.11105 16.1062 3.5 17.5 3.5C20.0773 3.5 22.1667 5.58934 22.1667 8.16667C22.1667 10.744 20.0773 12.8333 17.5 12.8333C16.1062 12.8333 14.8551 12.2223 14 11.2535M17.5 24.5H3.5V23.3333C3.5 19.4673 6.63401 16.3333 10.5 16.3333C14.366 16.3333 17.5 19.4673 17.5 23.3333V24.5ZM17.5 24.5H24.5V23.3333C24.5 19.4673 21.366 16.3333 17.5 16.3333C16.225 16.3333 15.0296 16.6742 14 17.2698M15.1667 8.16667C15.1667 10.744 13.0773 12.8333 10.5 12.8333C7.92267 12.8333 5.83333 10.744 5.83333 8.16667C5.83333 5.58934 7.92267 3.5 10.5 3.5C13.0773 3.5 15.1667 5.58934 15.1667 8.16667Z"
      stroke="#D1D5DB"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Row: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex text-neutral-6000 dark:text-neutral-300">
    <span className="flex-1">{label}</span>
    <span className="flex-1 font-medium text-neutral-900 dark:text-neutral-100">{children}</span>
  </div>
);

/**
 * The receipt page's content. It reads the booking only from the app-level hold flow (the provider that
 * lives above every page), so a reload or a direct visit, which empties that memory, shows a recovery
 * message instead of a receipt. Nothing is fetched with a guessed token and nothing is invented: the
 * names and picture come from the public catalog, every amount and date from the hold or Reservation
 * the booking system returned.
 */
const PayDoneReceipt: FC = () => {
  const { state, confirmHold, retryConfirmationExact } = useBookingHoldFlow();
  const stay = useStaySearch();
  useEffect(() => {
    stay?.ensureCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { phase, session, reservationResult, errorMessage } = state;
  const reservation = phase === "reservation-result" ? reservationResult?.reservation ?? null : null;
  const hold = !reservation && session && ["active-session", "confirming", "confirm-known-error", "confirm-uncertain"].includes(phase)
    ? session.hold
    : null;
  const snapshot: Snapshot | null = reservation ?? hold;
  const target = inProgressBookingTarget(state);

  const renderRecovery = () => {
    const resumeHref = target ? (buildRoomDetailsHref(target) as Route) : null;
    const message =
      phase === "submitting"
        ? "Đang tạo giữ chỗ cho bạn…"
        : phase === "uncertain"
          ? "Chưa xác định được giữ chỗ đã được tạo hay chưa. Hãy quay lại trang phòng để gửi lại đúng yêu cầu cũ — hệ thống sẽ không tạo giữ chỗ thứ hai."
          : "Không có đặt phòng nào đang thực hiện trong phiên này. Nếu bạn vừa tải lại trang hoặc mở thẳng địa chỉ này, thông tin giữ chỗ chỉ nằm trong bộ nhớ của tab nên đã mất — hãy chọn phòng và đặt lại.";
    return (
      <div role="status" aria-live="polite" className="w-full flex flex-col sm:rounded-2xl space-y-8 px-0 sm:p-6 xl:p-8">
        <h2 className="text-3xl lg:text-4xl font-semibold">Chưa có đặt phòng để hiển thị</h2>
        <p className="text-neutral-6000 dark:text-neutral-300">{message}</p>
        <div className="flex flex-wrap gap-3">
          {resumeHref && <ButtonPrimary href={resumeHref}>Quay lại phòng đang đặt</ButtonPrimary>}
          <ButtonSecondary href="/#rooms">Xem các loại phòng</ButtonSecondary>
        </div>
      </div>
    );
  };

  const renderReceipt = (data: Snapshot) => {
    const property = stay?.riverside ? resolveProperty([stay.riverside], data.propertyId) : undefined;
    const roomType = stay?.roomTypes ? resolveRoomType(stay.roomTypes, data) : undefined;
    const cover = roomType ? selectGalleryImages(roomType.media)[0] : undefined;
    const nights = calculateNights(data.checkIn, data.checkOut);
    const confirmed = !!reservation;
    const busy = phase === "confirming";

    return (
      <div className="w-full flex flex-col sm:rounded-2xl space-y-10 px-0 sm:p-6 xl:p-8">
        <h2 className="text-3xl lg:text-4xl font-semibold">{confirmed ? "Đặt phòng đã xác nhận 🎉" : "Đã giữ chỗ"}</h2>
        <p className="-mt-6 text-neutral-6000 dark:text-neutral-300" role="status" aria-live="polite">
          {confirmed
            ? "Hệ thống đặt phòng đã xác nhận đặt phòng của bạn. Chưa có thanh toán trực tuyến."
            : "Phòng đang được giữ cho bạn. Đây chưa phải đặt phòng đã xác nhận và chưa thanh toán — hãy bấm xác nhận bên dưới trước khi giữ chỗ hết hạn."}
        </p>

        <div className="border-b border-neutral-200 dark:border-neutral-700"></div>

        {/* ------------------------ */}
        <div className="space-y-6">
          <h3 className="text-2xl font-semibold">Đặt phòng của bạn</h3>
          <div className="flex flex-col sm:flex-row sm:items-center">
            <div className="flex-shrink-0 w-full sm:w-40">
              <div className="aspect-w-4 aspect-h-3 sm:aspect-h-4 rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                {cover?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover.url} alt={cover.altText ?? roomType?.name ?? ""} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center p-3 text-center text-xs text-neutral-500">Ảnh đang được cập nhật</div>
                )}
              </div>
            </div>
            <div className="pt-5 sm:pb-5 sm:px-5 space-y-3">
              <div>
                <span className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-1">{property?.name ?? "The BHA"}</span>
                <span className="text-base sm:text-lg font-medium mt-1 block">{roomType?.name ?? "Loại phòng"}</span>
              </div>
              {roomType && (
                <span className="block text-sm text-neutral-500 dark:text-neutral-400">
                  {formatMaxOccupancy(roomType.maxOccupancy)} · {formatDesignedForOccupancy(roomType.baseOccupancy)}
                </span>
              )}
              <div className="w-10 border-b border-neutral-200 dark:border-neutral-700"></div>
              <span title="Đánh giá mẫu (không phải đánh giá của khách)">
                <StartRating />
              </span>
            </div>
          </div>
          <div className="mt-6 border border-neutral-200 dark:border-neutral-700 rounded-3xl flex flex-col sm:flex-row divide-y sm:divide-x sm:divide-y-0 divide-neutral-200 dark:divide-neutral-700">
            <div className="flex-1 p-5 flex space-x-4">
              <CalendarIcon />
              <div className="flex flex-col">
                <span className="text-sm text-neutral-400">Ngày ở</span>
                <span className="mt-1.5 text-lg font-semibold">
                  {data.checkIn} → {data.checkOut}
                </span>
                {nights !== null && <span className="text-sm text-neutral-500">{nights} đêm</span>}
              </div>
            </div>
            <div className="flex-1 p-5 flex space-x-4">
              <GuestsIcon />
              <div className="flex flex-col">
                <span className="text-sm text-neutral-400">Khách</span>
                <span className="mt-1.5 text-lg font-semibold">
                  {data.adults} người lớn{data.children > 0 ? `, ${data.children} trẻ em` : ""}
                </span>
                <span className="text-sm text-neutral-500">{data.rooms} phòng</span>
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------ */}
        <div className="space-y-6">
          <h3 className="text-2xl font-semibold">Chi tiết</h3>
          <div className="flex flex-col space-y-4">
            {confirmed ? (
              <>
                <Row label="Mã đặt phòng">
                  <span className="font-mono text-sm">{reservation!.confirmationNumber}</span>
                </Row>
                <Row label="Trạng thái">{reservation!.status}</Row>
                <Row label="Xác nhận lúc">{formatUtcInstant(reservation!.confirmedAtUtc)}</Row>
              </>
            ) : (
              <>
                <Row label="Mã giữ chỗ">
                  <span className="font-mono text-xs">{hold!.holdId}</span>
                </Row>
                <Row label="Trạng thái giữ chỗ">{hold!.status}</Row>
                <Row label="Hết hạn lúc">{formatUtcInstant(hold!.expiresAtUtc)}</Row>
              </>
            )}
            {data.nights && data.nights.length > 0 && (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-neutral-6000 dark:text-neutral-300">
                {data.nights.map((night) => (
                  <div key={night.stayDate} className="flex justify-between gap-4 py-2">
                    <span>
                      {night.stayDate} · {night.rooms} phòng · {formatCurrencyAmount(night.unitAmount, data.currencyCode)}
                    </span>
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      {formatCurrencyAmount(night.nightTotal, data.currencyCode)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Row label="Tổng">{formatCurrencyAmount(data.totalAmount, data.currencyCode)}</Row>
            <Row label="Thanh toán">Chưa có thanh toán trực tuyến</Row>
          </div>
        </div>

        {/* ------------------------ */}
        {!confirmed && (
          <div className="space-y-4">
            {phase === "active-session" && (
              <ButtonPrimary type="button" onClick={confirmHold}>
                Xác nhận đặt phòng
              </ButtonPrimary>
            )}
            {busy && (
              <>
                <div role="status" aria-live="polite" className="text-sm text-neutral-500 dark:text-neutral-400">
                  Đang xác nhận đặt phòng của bạn…
                </div>
                <ButtonPrimary type="button" loading>
                  Xác nhận đặt phòng
                </ButtonPrimary>
              </>
            )}
            {phase === "confirm-known-error" && errorMessage && (
              <>
                <div role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {errorMessage}
                </div>
                <ButtonSecondary type="button" onClick={retryConfirmationExact}>
                  Thử xác nhận lại
                </ButtonSecondary>
              </>
            )}
            {phase === "confirm-uncertain" && (
              <div role="alert" className="space-y-3 text-sm text-amber-600 dark:text-amber-400">
                <p>
                  Chưa xác định được đặt phòng đã hoàn tất hay chưa — kết nối bị mất trước khi có phản hồi. Gửi lại sẽ xác
                  nhận đúng giữ chỗ này; hệ thống sẽ không tạo đặt phòng thứ hai.
                </p>
                <ButtonSecondary type="button" onClick={retryConfirmationExact}>
                  Gửi lại xác nhận
                </ButtonSecondary>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {target && !confirmed && (
            <ButtonSecondary href={buildRoomDetailsHref(target) as Route}>Về trang phòng</ButtonSecondary>
          )}
          <ButtonPrimary href="/">Xem thêm chỗ nghỉ</ButtonPrimary>
        </div>
      </div>
    );
  };

  return (
    <div className="nc-PayPage">
      <main className="container mt-11 mb-24 lg:mb-32">
        <div className="max-w-4xl mx-auto">{snapshot ? renderReceipt(snapshot) : renderRecovery()}</div>
      </main>
    </div>
  );
};

export default PayDoneReceipt;
