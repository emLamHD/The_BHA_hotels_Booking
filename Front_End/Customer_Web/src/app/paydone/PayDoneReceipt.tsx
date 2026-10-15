"use client";

import React, { FC, Fragment, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Dialog, Transition } from "@headlessui/react";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import StartRating from "@/components/StartRating";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { HOME_PAGE, receiptCloseFailureMessage, receiptCloseTarget } from "@/lib/customerAuthUi";
import { useStaySearch } from "@/components/StaySearchProvider";
import PriceBreakdown from "@/components/PriceBreakdown";
import { useApiMessage } from "@/lib/i18n/apiMessage";
import { useDateFormat } from "@/lib/i18n/dates";
import { useI18n } from "@/lib/i18n/I18nProvider";
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
  const { state, confirmHold, retryConfirmationExact, finishBooking } = useBookingHoldFlow();
  const { t, has, content } = useI18n();
  const dates = useDateFormat();
  const message = useApiMessage();
  const { identityChange } = useCustomerSession();
  const router = useRouter();
  const stay = useStaySearch();
  // CUST-WEB-001-CP02: the reservation the open "close the receipt" dialog is about (null: closed), captured
  // when it opened, so finishBooking refuses it if the receipt has changed since.
  const [closingReservationId, setClosingReservationId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
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
  const receiptId = receiptCloseTarget(state);

  const confirmClose = () => {
    const expected = closingReservationId;
    setClosingReservationId(null);
    if (!expected) return;
    // No HTTP: it only forgets the receipt in this tab. It is refused (and the receipt kept) if the receipt
    // changed since the dialog opened, or a login/logout is being verified.
    if (finishBooking(expected)) {
      router.push(HOME_PAGE);
    } else {
      setCloseError(receiptCloseFailureMessage(identityChange.phase));
    }
  };

  const renderRecovery = () => {
    const resumeHref = target ? (buildRoomDetailsHref(target) as Route) : null;
    const message =
      phase === "submitting"
        ? t("customer.receipt.recovery.submitting")
        : phase === "uncertain"
          ? t("customer.receipt.recovery.uncertain")
          : t("customer.receipt.recovery.none");
    return (
      <div role="status" aria-live="polite" className="w-full flex flex-col sm:rounded-2xl space-y-8 px-0 sm:p-6 xl:p-8">
        <h2 className="text-3xl lg:text-4xl font-semibold">{t("customer.receipt.recovery.title")}</h2>
        <p className="text-neutral-6000 dark:text-neutral-300">{message}</p>
        <div className="flex flex-wrap gap-3">
          {resumeHref && <ButtonPrimary href={resumeHref}>{t("customer.receipt.recovery.resume")}</ButtonPrimary>}
          <ButtonSecondary href="/#rooms">{t("customer.room.viewRooms")}</ButtonSecondary>
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
        <h2 className="text-3xl lg:text-4xl font-semibold">{confirmed ? t("customer.receipt.title.confirmed") : t("customer.receipt.title.held")}</h2>
        <p className="-mt-6 text-neutral-6000 dark:text-neutral-300" role="status" aria-live="polite">
          {confirmed ? t("customer.receipt.sub.confirmed") : t("customer.receipt.sub.held")}
        </p>

        <div className="border-b border-neutral-200 dark:border-neutral-700"></div>

        {/* ------------------------ */}
        <div className="space-y-6">
          <h3 className="text-2xl font-semibold">{t("customer.receipt.yourBooking")}</h3>
          <div className="flex flex-col sm:flex-row sm:items-center">
            <div className="flex-shrink-0 w-full sm:w-40">
              <div className="aspect-w-4 aspect-h-3 sm:aspect-h-4 rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                {cover?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover.url} alt={content("media", cover.id, "altText", cover.altText ?? roomType?.name ?? "")} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center p-3 text-center text-xs text-neutral-500">{t("customer.booking.offer.photoPending")}</div>
                )}
              </div>
            </div>
            <div className="pt-5 sm:pb-5 sm:px-5 space-y-3">
              <div>
                <span className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-1">{property ? content("property", property.id, "name", property.name ?? "The BHA") : "The BHA"}</span>
                <span className="text-base sm:text-lg font-medium mt-1 block">{roomType ? content("roomType", roomType.id, "name", roomType.name ?? t("customer.booking.offer.roomTypeFallback")) : t("customer.booking.offer.roomTypeFallback")}</span>
              </div>
              {roomType && (
                <span className="block text-sm text-neutral-500 dark:text-neutral-400">
                  {formatMaxOccupancy(roomType.maxOccupancy, t)} · {formatDesignedForOccupancy(roomType.baseOccupancy, t)}
                </span>
              )}
              <div className="w-10 border-b border-neutral-200 dark:border-neutral-700"></div>
              <span title={t("customer.stay.sampleRatingTitle")}>
                <StartRating sample="full" />
              </span>
            </div>
          </div>
          <div className="mt-6 border border-neutral-200 dark:border-neutral-700 rounded-3xl flex flex-col sm:flex-row divide-y sm:divide-x sm:divide-y-0 divide-neutral-200 dark:divide-neutral-700">
            <div className="flex-1 p-5 flex space-x-4">
              <CalendarIcon />
              <div className="flex flex-col">
                <span className="text-sm text-neutral-400">{t("customer.receipt.stayDates")}</span>
                <span className="mt-1.5 text-lg font-semibold">
                  {dates.stayDate(data.checkIn)} → {dates.stayDate(data.checkOut)}
                </span>
                {nights !== null && <span className="text-sm text-neutral-500">{t("customer.booking.nights", { nights })}</span>}
              </div>
            </div>
            <div className="flex-1 p-5 flex space-x-4">
              <GuestsIcon />
              <div className="flex flex-col">
                <span className="text-sm text-neutral-400">{t("customer.receipt.guests")}</span>
                <span className="mt-1.5 text-lg font-semibold">
                  {t("customer.booking.adults", { adults: data.adults })}{data.children > 0 ? `, ${t("customer.booking.children", { children: data.children })}` : ""}
                </span>
                <span className="text-sm text-neutral-500">{t("customer.booking.rooms", { rooms: data.rooms })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------ */}
        <div className="space-y-6">
          <h3 className="text-2xl font-semibold">{t("customer.receipt.details")}</h3>
          <div className="flex flex-col space-y-4">
            {confirmed ? (
              <>
                <Row label={t("customer.receipt.bookingCode")}>
                  <span className="font-mono text-sm">{reservation!.confirmationNumber}</span>
                </Row>
                <Row label={t("customer.receipt.status")}>{has(`customer.booking.reservation.status.${reservation!.status}`) ? t(`customer.booking.reservation.status.${reservation!.status}`) : reservation!.status}</Row>
                <Row label={t("customer.receipt.confirmedAt")}>{dates.instant(reservation!.confirmedAtUtc)}</Row>
              </>
            ) : (
              <>
                <Row label={t("customer.receipt.holdCode")}>
                  <span className="font-mono text-xs">{hold!.holdId}</span>
                </Row>
                <Row label={t("customer.receipt.holdStatus")}>{has(`customer.booking.hold.status.${hold!.status}`) ? t(`customer.booking.hold.status.${hold!.status}`) : hold!.status}</Row>
                <Row label={t("customer.receipt.expiresAt")}>{dates.instant(hold!.expiresAtUtc)}</Row>
              </>
            )}
            <div className="text-neutral-6000 dark:text-neutral-300">
              <PriceBreakdown
                rows={(data.nights ?? []).map((night) => ({
                  key: night.stayDate,
                  label: `${dates.stayDate(night.stayDate)} · ${t("customer.booking.rooms", { rooms: night.rooms })}`,
                  amount: night.nightTotal,
                  unitAmount: night.unitAmount,
                }))}
                totalAmount={data.totalAmount}
                currencyCode={data.currencyCode}
                totalLabel={t("customer.receipt.total")}
                rowClassName="flex justify-between gap-4 py-2 font-medium text-neutral-900 dark:text-neutral-100"
                totalClassName="flex items-center justify-between gap-4 pt-4"
                totalValueClassName="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
              />
            </div>
            <Row label={t("customer.receipt.payment")}>{t("customer.receipt.noOnlinePayment")}</Row>
          </div>
        </div>

        {/* ------------------------ */}
        {!confirmed && (
          <div className="space-y-4">
            {phase === "active-session" && (
              <ButtonPrimary type="button" onClick={confirmHold}>
                {t("customer.receipt.confirm")}
              </ButtonPrimary>
            )}
            {busy && (
              <>
                <div role="status" aria-live="polite" className="text-sm text-neutral-500 dark:text-neutral-400">
                  {t("customer.receipt.confirming")}
                </div>
                <ButtonPrimary type="button" loading>
                  {t("customer.receipt.confirm")}
                </ButtonPrimary>
              </>
            )}
            {phase === "confirm-known-error" && errorMessage && (
              <>
                <div role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {message(errorMessage)}
                </div>
                <ButtonSecondary type="button" onClick={retryConfirmationExact}>
                  {t("customer.receipt.retryConfirm")}
                </ButtonSecondary>
              </>
            )}
            {phase === "confirm-uncertain" && (
              <div role="alert" className="space-y-3 text-sm text-amber-600 dark:text-amber-400">
                <p>{t("customer.receipt.uncertain")}</p>
                <ButtonSecondary type="button" onClick={retryConfirmationExact}>
                  {t("customer.receipt.resend")}
                </ButtonSecondary>
              </div>
            )}
          </div>
        )}

        {closeError && (
          <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            {closeError}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {target && !confirmed && (
            <ButtonSecondary href={buildRoomDetailsHref(target) as Route}>{t("customer.receipt.backToRoom")}</ButtonSecondary>
          )}
          <ButtonPrimary href="/">{t("customer.receipt.moreProperties")}</ButtonPrimary>
          {receiptId && (
            <ButtonSecondary
              type="button"
              onClick={() => {
                setCloseError(null);
                setClosingReservationId(receiptId);
              }}
            >
              {t("customer.receipt.closeReceipt")}
            </ButtonSecondary>
          )}
        </div>
      </div>
    );
  };

  const renderCloseDialog = () => (
    <Transition appear show={closingReservationId !== null} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => setClosingReservationId(null)}>
        <Transition.Child
          as={Fragment}
          enter="duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 dark:bg-black/70" aria-hidden="true" />
        </Transition.Child>
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-800">
              <Dialog.Title className="text-xl font-semibold">{t("customer.receipt.closeQuestion")}</Dialog.Title>
              <Dialog.Description as="div" className="space-y-3 text-sm text-neutral-6000 dark:text-neutral-300">
                <p>
                  {reservation?.confirmationNumber
                    ? t("customer.receipt.closeWarnWithCode", { code: reservation.confirmationNumber })
                    : t("customer.receipt.closeWarn")}
                </p>
                <p>{t("customer.receipt.closeNote")}</p>
              </Dialog.Description>
              <div className="flex flex-wrap justify-end gap-3">
                <ButtonSecondary type="button" onClick={() => setClosingReservationId(null)}>
                  {t("customer.receipt.keepReceipt")}
                </ButtonSecondary>
                <ButtonPrimary type="button" onClick={confirmClose}>
                  {t("customer.receipt.closeReceipt")}
                </ButtonPrimary>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );

  return (
    <div className="nc-PayPage">
      <main className="container mt-11 mb-24 lg:mb-32">
        <div className="max-w-4xl mx-auto">{snapshot ? renderReceipt(snapshot) : renderRecovery()}</div>
      </main>
      {renderCloseDialog()}
    </div>
  );
};

export default PayDoneReceipt;
