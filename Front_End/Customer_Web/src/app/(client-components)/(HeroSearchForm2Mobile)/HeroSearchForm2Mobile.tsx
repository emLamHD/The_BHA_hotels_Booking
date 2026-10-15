"use client";

import React, { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { XMarkIcon } from "@heroicons/react/24/solid";
import ButtonSubmit from "./ButtonSubmit";
import { useTimeoutFn } from "react-use";
import StaySearchForm from "./(stay-search-form)/StaySearchForm";
import { useStaySearch } from "@/components/StaySearchProvider";
import { OPEN_SEARCH_EVENT, draftPatchFromListingQuery, summarizeDraft } from "@/lib/homepageSearch";
import { LISTING_STAY_PATH, parseStayListingQuery } from "@/lib/stayListingQuery";
import { initialStayDraft } from "@/lib/staySearch";

import { useApiMessage } from "@/lib/i18n/apiMessage";
import { useT } from "@/lib/i18n/I18nProvider";
import { Tpl } from "@/lib/i18n/Tpl";
/**
 * The compact search of every header under `lg` (and of the room page, where the app bar is hidden).
 * CUST-WEB-001-CP08a: it is the live Riverside search only — the template's Experiences/Cars/Flights tabs
 * are gone — and Search goes through the same decision as the home hero (`StaySearchProvider.submit`): a
 * valid draft closes the modal and goes to the canonical /listing-stay URL; an incomplete one keeps the
 * modal open and says what is missing. Opening it never navigates: on a results page it only copies that
 * page's valid Riverside search into the draft, which stays a draft until Search.
 */
const HeroSearchForm2Mobile = () => {
  const t = useT();
  const apiMessage = useApiMessage();
  const [showModal, setShowModal] = useState(false);
  const stay = useStaySearch();
  const problemRef = useRef<HTMLParagraphElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const problemId = stay?.problem?.id;
  const seenProblem = useRef(problemId);

  // FOR RESET ALL DATA WHEN CLICK CLEAR BUTTON
  const [showDialog, setShowDialog] = useState(false);
  let [, , resetIsShowingDialog] = useTimeoutFn(() => setShowDialog(true), 1);
  //
  function closeModal() {
    setShowModal(false);
  }

  const openModal = useCallback(() => {
    if (stay) {
      stay.clearProblem();
      if (window.location.pathname === LISTING_STAY_PATH) {
        const patch = draftPatchFromListingQuery(parseStayListingQuery(new URLSearchParams(window.location.search)));
        if (patch) stay.updateDraft(patch);
      }
    }
    setShowModal(true);
  }, [stay]);

  // The page's own "Tìm phòng" button asks for this search to open.
  useEffect(() => {
    // Above `lg` the hero's own form is on screen; this modal is the small-screen search only.
    const onRequest = () => {
      if (window.matchMedia("(max-width: 1023px)").matches) openModal();
    };
    window.addEventListener(OPEN_SEARCH_EVENT, onRequest);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onRequest);
  }, [openModal]);

  useEffect(() => {
    if (problemId && problemId !== seenProblem.current && showModal) problemRef.current?.focus();
    seenProblem.current = problemId;
  }, [problemId, showModal]);

  if (!stay) return null;
  const summary = summarizeDraft(stay.draft, t);

  const renderButtonOpenModal = () => {
    return (
      <button
        type="button"
        ref={triggerRef}
        onClick={openModal}
        aria-label={t("customer.common.findARoom")}
        className="relative flex items-center w-full border border-neutral-200 dark:border-neutral-6000 px-4 py-2 pr-11 rounded-full shadow-lg"
      >
        <MagnifyingGlassIcon className="flex-shrink-0 w-5 h-5" />

        <div className="ml-3 flex-1 text-left overflow-hidden">
          <span className="block font-medium text-sm line-clamp-1"><Tpl text={summary.title} quiet /></span>
          <span className="block mt-0.5 text-xs font-light text-neutral-500 dark:text-neutral-400 ">
            <span className="line-clamp-1"><Tpl text={summary.subtitle} quiet /></span>
          </span>
        </div>

        <span className="absolute right-2 top-1/2 transform -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full border border-neutral-200 dark:border-neutral-6000 dark:text-neutral-300">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            role="presentation"
            focusable="false"
            className="block w-4 h-4"
            fill="currentColor"
          >
            <path d="M5 8c1.306 0 2.418.835 2.83 2H14v2H7.829A3.001 3.001 0 1 1 5 8zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6-8a3 3 0 1 1-2.829 4H2V4h6.17A3.001 3.001 0 0 1 11 2zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"></path>
          </svg>
        </span>
      </button>
    );
  };

  return (
    <div className="HeroSearchForm2Mobile">
      {renderButtonOpenModal()}
      {/* When the modal has gone, the keyboard is back on the control that opened it. */}
      <Transition appear show={showModal} as={Fragment} afterLeave={() => {
          // The rest of the page is inert until the dialog has unmounted; focus the trigger just after that.
          window.setTimeout(() => triggerRef.current?.focus(), 30);
        }}>
        <Dialog
          as="div"
          className="HeroSearchFormMobile__Dialog relative z-max"
          onClose={closeModal}
        >
          <div className="fixed inset-0 bg-neutral-100 dark:bg-neutral-900">
            <div className="flex h-full">
              <Transition.Child
                as={Fragment}
                enter="ease-out transition-transform"
                enterFrom="opacity-0 translate-y-52"
                enterTo="opacity-100 translate-y-0"
                leave="ease-in transition-transform"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-52"
              >
                <Dialog.Panel className="relative h-full overflow-hidden flex-1 flex flex-col justify-between ">
                  {showDialog && (
                    <>
                      <div className="absolute left-4 top-4">
                        <button type="button" aria-label={t("customer.heroSearchForm2Mobile.heroSearchForm2Mobile.close")} onClick={closeModal}>
                          <XMarkIcon className="w-5 h-5 text-black dark:text-white" />
                        </button>
                      </div>

                      <Dialog.Title className="pt-12 text-center font-semibold text-base text-black dark:text-white">{t("customer.heroSearchForm2Mobile.heroSearchForm2Mobile.findARoomAtThe")}</Dialog.Title>
                      <div className="flex-1 pt-3 px-1.5 sm:px-4 flex overflow-hidden">
                        <div className="flex-1 overflow-y-auto hiddenScrollbar py-4">
                          <div className="transition-opacity animate-[myblur_0.4s_ease-in-out]">
                            <StaySearchForm live />
                          </div>
                        </div>
                      </div>
                      {stay.problem && (
                        <p
                          key={stay.problem.id}
                          ref={problemRef}
                          role="alert"
                          tabIndex={-1}
                          className="px-4 py-2 text-sm text-red-600 bg-white focus:outline-none dark:bg-neutral-900 dark:text-red-400"
                        >
                          {apiMessage(stay.problem.message)}
                        </p>
                      )}
                      <div className="px-4 py-3 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-700 flex justify-between">
                        <button
                          type="button"
                          className="underline font-semibold flex-shrink-0"
                          onClick={() => {
                            stay.updateDraft(initialStayDraft());
                            setShowDialog(false);
                            resetIsShowingDialog();
                          }}
                        >{t("customer.heroSearchForm2Mobile.heroSearchForm2Mobile.clearAll")}</button>
                        <ButtonSubmit
                          label={t("customer.common.findARoom")}
                          onClick={() => {
                            // An incomplete search keeps the modal open and says why; a valid one starts
                            // exactly one navigation and the modal closes.
                            const outcome = stay.submit();
                            if (outcome === "navigate" || outcome === "duplicate") closeModal();
                          }}
                        />
                      </div>
                    </>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
};

export default HeroSearchForm2Mobile;
