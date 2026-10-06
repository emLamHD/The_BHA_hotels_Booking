"use client";

import React from "react";
import Link from "next/link";
import ButtonClose from "@/shared/ButtonClose";
import Logo from "@/shared/Logo";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";

export interface NavMobileProps {
  onClickClose?: () => void;
}

const ITEM_CLASS =
  "flex w-full px-4 py-2.5 font-medium uppercase tracking-wide text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's slide-in mobile menu with only links that work:
 * the home page, the room section and the service preview. No "Get Template" button, language
 * switcher or social links.
 */
const NavMobile: React.FC<NavMobileProps> = ({ onClickClose }) => {
  return (
    <div className="overflow-y-auto w-full h-screen py-2 transition transform shadow-lg ring-1 dark:ring-neutral-700 bg-white dark:bg-neutral-900 divide-y-2 divide-neutral-100 dark:divide-neutral-800">
      <div className="py-6 px-5">
        <Logo />
        <div className="flex flex-col mt-5 text-neutral-700 dark:text-neutral-300 text-sm">
          <span>Đặt phòng trực tiếp tại The BHA.</span>
        </div>
        <span className="absolute right-2 top-2 p-1">
          <ButtonClose onClick={onClickClose} />
        </span>
      </div>
      <ul className="flex flex-col py-6 px-2 space-y-1 text-neutral-900 dark:text-white">
        <li>
          <Link href="/" className={ITEM_CLASS} onClick={onClickClose}>
            Trang chủ
          </Link>
        </li>
        <li>
          <ShowcaseNavLink section="rooms" className={ITEM_CLASS} onNavigate={onClickClose}>
            Phòng nghỉ
          </ShowcaseNavLink>
        </li>
        <li>
          <ShowcaseNavLink section="services" className={ITEM_CLASS} onNavigate={onClickClose}>
            Dịch vụ
          </ShowcaseNavLink>
        </li>
      </ul>
    </div>
  );
};

export default NavMobile;
