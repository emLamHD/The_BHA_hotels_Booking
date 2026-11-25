"use client";

import React, { FC, Fragment, useRef } from "react";
import { Dialog, Transition } from "@headlessui/react";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { useI18n } from "@/lib/i18n/I18nProvider";

export interface BookingMethodDialogProps {
  open: boolean;
  /** Dismissed (Esc, backdrop, Close): nothing is selected. */
  onClose: () => void;
  /** The guest chose "pay at the property". Called once; the dialog is closing. */
  onChooseDirect: () => void;
  /** Runs after the closing transition ended and focus went back (a following panel may then take focus). */
  onClosed?: () => void;
}

/**
 * BHA-CHECKOUT-001-PR08: the two-way choice shown when "Book" is pressed for a property whose Direct booking is on.
 * Headless UI's Dialog supplies the focus trap, Escape and focus return to the button that opened it. "Pay or leave a
 * deposit" is visible but unavailable in PR08: it is focusable (so keyboard and screen-reader users find it), announces
 * itself as disabled and does nothing.
 */
const BookingMethodDialog: FC<BookingMethodDialogProps> = ({ open, onClose, onChooseDirect, onClosed }) => {
  const { t } = useI18n();
  const directRef = useRef<HTMLButtonElement>(null);

  return (
    <Transition appear show={open} as={Fragment} afterLeave={onClosed}>
      <Dialog as="div" className="relative z-50" onClose={onClose} initialFocus={directRef}>
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
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
          <Transition.Child
            as={Fragment}
            enter="duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel
              data-testid="booking-method-dialog"
              className="w-full max-w-2xl space-y-5 rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-800"
            >
              <Dialog.Title className="text-xl font-semibold">{t("customer.direct.dialog.title")}</Dialog.Title>
              <Dialog.Description className="text-sm text-neutral-6000 dark:text-neutral-300">
                {t("customer.direct.dialog.description")}
              </Dialog.Description>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <button
                  ref={directRef}
                  type="button"
                  data-testid="choose-pay-at-property"
                  onClick={onChooseDirect}
                  className="flex h-full flex-col items-start gap-2 rounded-2xl border border-neutral-200 p-4 text-left hover:border-primary-6000 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6000 dark:border-neutral-700"
                >
                  <span className="text-base font-semibold">{t("customer.direct.dialog.payAtProperty.title")}</span>
                  <span className="text-sm text-neutral-6000 dark:text-neutral-300">{t("customer.direct.dialog.payAtProperty.body")}</span>
                </button>
                <button
                  type="button"
                  data-testid="choose-online-unavailable"
                  aria-disabled="true"
                  aria-describedby="booking-method-online-unavailable"
                  onClick={(event) => event.preventDefault()}
                  className="flex h-full cursor-not-allowed flex-col items-start gap-2 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-left text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
                >
                  <span className="text-base font-semibold">{t("customer.direct.dialog.online.title")}</span>
                  <span className="text-sm">{t("customer.direct.dialog.online.body")}</span>
                  <span
                    id="booking-method-online-unavailable"
                    className="rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                  >
                    {t("customer.direct.dialog.online.unavailable")}
                  </span>
                </button>
              </div>
              <div className="flex justify-end">
                <ButtonSecondary type="button" onClick={onClose}>
                  {t("shared.common.close")}
                </ButtonSecondary>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
};

export default BookingMethodDialog;
