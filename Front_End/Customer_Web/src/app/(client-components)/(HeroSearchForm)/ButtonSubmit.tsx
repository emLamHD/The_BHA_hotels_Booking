import { PathName } from "@/routers/types";
import Link from "next/link";
import React, { FC } from "react";
import { Tpl, useQuietTpl } from "@/lib/i18n/Tpl";

interface Props {
  href?: PathName;
  /** CP02-C3: when given the control is a button that runs this (the live stay search), not a link. */
  onClick?: () => void;
  disabled?: boolean;
  /** CP08a: the accessible name and the small-screen caption; "Search" keeps every existing caller unchanged. */
  label?: string;
}

const BUTTON_CLASS =
  "h-14 md:h-16 w-full md:w-16 rounded-full bg-primary-6000 hover:bg-primary-700 flex items-center justify-center text-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6000 focus-visible:ring-offset-2";

const ButtonSubmit: FC<Props> = ({ href = "/listing-stay-map", onClick, disabled, label = "Search" }) => {
  const tp = useQuietTpl();
  const content = (
    <>
      <span className="mr-3 md:hidden"><Tpl text={label} quiet /></span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} aria-label={tp(label)} className={`${BUTTON_CLASS} disabled:opacity-60`}>
        {content}
      </button>
    );
  }

  return (
    <Link href={href} type="button" className={BUTTON_CLASS}>
      {content}
    </Link>
  );
};

export default ButtonSubmit;
