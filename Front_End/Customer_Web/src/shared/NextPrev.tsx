"use client";

import React, { FC } from "react";
import twFocusClass from "@/utils/twFocusClass";

import { useT } from "@/lib/i18n/I18nProvider";
export interface NextPrevProps {
  className?: string;
  currentPage?: number;
  totalPage?: number;
  btnClassName?: string;
  onClickNext?: () => void;
  onClickPrev?: () => void;
  onlyNext?: boolean;
  onlyPrev?: boolean;
}

const NextPrev: FC<NextPrevProps> = ({
  className = "",
  onClickNext = () => {},
  onClickPrev = () => {},
  btnClassName = "w-10 h-10",
  onlyNext = false,
  onlyPrev = false,
}) => {
  const t = useT();
  return (
    <div
      className={`nc-NextPrev relative flex items-center text-neutral-900 dark:text-neutral-300 ${className}`}
      data-nc-id="NextPrev"
      data-glide-el="controls"
    >
      {!onlyNext && (
        <button
          className={`${btnClassName} ${
            !onlyPrev ? "mr-[6px]" : ""
          } bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-6000 dark:hover:border-neutral-500 rounded-full flex items-center justify-center hover:border-neutral-300 ${twFocusClass()}`}
          onClick={onClickPrev}
          title={t("customer.shared.nextPrev.prev")}
          data-glide-dir="<"
        >
          <i className="las la-angle-left"></i>
        </button>
      )}
      {!onlyPrev && (
        <button
          className={`${btnClassName} bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-6000 dark:hover:border-neutral-500 rounded-full flex items-center justify-center hover:border-neutral-300 ${twFocusClass()}`}
          onClick={onClickNext}
          title={t("customer.shared.nextPrev.next")}
          data-glide-dir=">"
        >
          <i className="las la-angle-right"></i>
        </button>
      )}
    </div>
  );
};

export default NextPrev;
