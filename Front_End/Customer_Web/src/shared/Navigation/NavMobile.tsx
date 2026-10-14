"use client";

import React from "react";
import Link from "next/link";
import type { Route } from "next";
import ButtonClose from "@/shared/ButtonClose";
import Logo from "@/shared/Logo";
import SwitchDarkMode from "@/shared/SwitchDarkMode";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";
import { RIVERSIDE_NAV, RIVERSIDE_ADDRESS, RIVERSIDE_NAME, SiteNavItem } from "@/lib/riversideHomeContent";

export interface NavMobileProps {
  data?: readonly SiteNavItem[];
  onClickClose?: () => void;
}

const ITEM_CLASS =
  "flex w-full px-4 py-3 font-medium text-base rounded-lg text-neutral-900 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/**
 * CUST-WEB-001-CP08a: the small-screen menu (the app bar's "Menu"). The same entries as the desktop
 * navigation, each one a real destination; section links never load a new document (that would lose a hold
 * in progress) and every link closes the menu. The template's multi-service tree, social placeholders,
 * language list and "Get Template" button are not part of it.
 */
const NavMobile: React.FC<NavMobileProps> = ({ data = RIVERSIDE_NAV, onClickClose }) => {
  return (
    <div className="overflow-y-auto w-full h-screen py-2 transition transform shadow-lg ring-1 dark:ring-neutral-700 bg-white dark:bg-neutral-900 divide-y-2 divide-neutral-100 dark:divide-neutral-800">
      <div className="py-6 px-5">
        <Logo />
        <div className="flex flex-col mt-5 text-neutral-700 dark:text-neutral-300 text-sm">
          <span>
            {RIVERSIDE_NAME} — căn hộ lưu trú tại {RIVERSIDE_ADDRESS}. Đặt phòng trực tiếp ngay trên trang.
          </span>
          <div className="flex justify-end items-center mt-4">
            <SwitchDarkMode className="bg-neutral-100 dark:bg-neutral-800" />
          </div>
        </div>
        <span className="absolute right-2 top-2 p-1">
          <ButtonClose onClick={onClickClose} />
        </span>
      </div>
      <nav aria-label="Menu" className="py-6 px-2">
        <ul className="flex flex-col space-y-1">
          {data.map((item) => (
            <li key={item.id}>
              {item.section ? (
                <ShowcaseNavLink section={item.section} className={ITEM_CLASS} onNavigate={onClickClose}>
                  {item.name}
                </ShowcaseNavLink>
              ) : (
                <Link href={item.href as Route} className={ITEM_CLASS} onClick={onClickClose}>
                  {item.name}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
};

export default NavMobile;
