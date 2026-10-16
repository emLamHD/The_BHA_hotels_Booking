"use client";

import React from "react";
import { Disclosure } from "@headlessui/react";
import { ChevronDownIcon, GlobeAltIcon } from "@heroicons/react/24/solid";
import ButtonClose from "@/shared/ButtonClose";
import Logo from "@/shared/Logo";
import SwitchDarkMode from "@/shared/SwitchDarkMode";
import { MenuLink } from "@/app/(client-components)/(Header)/MenuNav";
import type { MenuNode } from "@/lib/menus/menu";
import { useMenu } from "@/lib/menus/MenuProvider";
import { LangCurrencyTabs } from "@/app/(client-components)/(Header)/LangDropdown";
import { RIVERSIDE_ADDRESS, RIVERSIDE_NAME } from "@/lib/riversideHomeContent";
import { HEADER_FONT, NAV_SUB_TEXT } from "@/shared/headerTypography";

import { useT } from "@/lib/i18n/I18nProvider";
export interface NavMobileProps {
  onClickClose?: () => void;
}

const ITEM_CLASS =
  "flex flex-1 items-center rounded-lg px-4 py-3 text-base font-medium text-neutral-900 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white dark:hover:bg-neutral-800";
const CHILD_CLASS = `flex flex-1 items-center rounded-lg px-4 py-2.5 ${NAV_SUB_TEXT} text-neutral-800 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-200 dark:hover:bg-neutral-800`;
const TOGGLE_CLASS =
  "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-300 dark:hover:bg-neutral-800";

/**
 * CUST-WEB-001-CP08a-C2 / CUST-WEB-HEADER-001-CP04: the small-screen menu, drawn from the same tree as the desktop header
 * (`lib/menus`: the Admin's tree, the main row first and then the secondary group): each entry is a link, and an entry with
 * children has its own button that expands them (the link and the expander are separate, so neither one
 * hides the other from the keyboard). Every link closes the menu. The panel scrolls, closes with Esc or a
 * click outside (the Dialog around it), and carries the light/dark button and the Language/Currency preview
 * that the compact header does not have room for. The template's social placeholders and "Get Template"
 * button are not part of it.
 */
const NavMobile: React.FC<NavMobileProps> = ({ onClickClose }) => {
  const t = useT();
  const menu = useMenu().menu;
  const roots = [...(menu?.primary ?? []), ...(menu?.secondary ?? [])];
  const renderNode = (item: MenuNode, depth: number): React.ReactNode => {
    const cls = depth === 0 ? ITEM_CLASS : CHILD_CLASS;
    if (item.children.length === 0) {
      return (
        <li key={item.id}>
          <MenuLink node={item} className={cls} onClick={onClickClose} />
        </li>
      );
    }
    // A `#` entry has no page of its own: its whole row is the expander (as its panel is on the desktop).
    const toggleOnly = item.href === "#";
    return (
      <Disclosure as="li" key={item.id}>
        {({ open }) => (
          <>
            <div className="flex items-center">
              {toggleOnly ? (
                <Disclosure.Button aria-label={t(open ? "customer.menu.collapse" : "customer.menu.expand", { name: item.label })} className={`${cls} justify-between text-left`}>
                  <span className="min-w-0 break-words">{item.label}</span>
                  <ChevronDownIcon className={`h-5 w-5 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                </Disclosure.Button>
              ) : (
                <>
                  <MenuLink node={item} className={cls} onClick={onClickClose} />
                  <Disclosure.Button aria-label={t(open ? "customer.menu.collapse" : "customer.menu.expand", { name: item.label })} className={TOGGLE_CLASS}>
                    <ChevronDownIcon className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                  </Disclosure.Button>
                </>
              )}
            </div>
            <Disclosure.Panel as="ul" className="space-y-0.5 pb-1 pl-5">
              {item.children.map((child) => renderNode(child, depth + 1))}
            </Disclosure.Panel>
          </>
        )}
      </Disclosure>
    );
  };

  return (
    <div
      style={{ height: "100dvh" }}
      className={`relative h-screen w-full overflow-y-auto overscroll-contain bg-white py-2 shadow-lg ring-1 transition transform divide-y-2 divide-neutral-100 dark:bg-neutral-900 dark:ring-neutral-700 dark:divide-neutral-800 ${HEADER_FONT}`}
    >
      <div className="px-5 py-6">
        <div className="flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-1">
            <SwitchDarkMode className="bg-neutral-100 dark:bg-neutral-800" />
            <ButtonClose onClick={onClickClose} />
          </div>
        </div>
        <p className="mt-5 text-sm text-neutral-700 dark:text-neutral-300">
          {t("customer.shared.navigation.navMobile.servicedApartmentsAtBookDirect", { RIVERSIDENAME: RIVERSIDE_NAME, RIVERSIDEADDRESS: RIVERSIDE_ADDRESS })}</p>
      </div>
      {roots.length > 0 && (
        <nav aria-label={t("customer.shared.navigation.navMobile.menu")} className="px-2 py-4">
          <ul className="flex flex-col space-y-1">{roots.map((item) => renderNode(item, 0))}</ul>
        </nav>
      )}
      <div className="px-2 py-4">
        <Disclosure>
          {({ open }) => (
            <>
              <Disclosure.Button className="flex w-full items-center rounded-lg px-4 py-3 text-left text-base font-medium text-neutral-900 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white dark:hover:bg-neutral-800">
                <GlobeAltIcon className="mr-3 h-5 w-5 text-neutral-500" aria-hidden="true" />
                <span className="flex-1">{t("customer.shared.navigation.navMobile.languageAndCurrency")}</span>
                <ChevronDownIcon className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
              </Disclosure.Button>
              <Disclosure.Panel className="px-2 pb-4 pt-2">
                <LangCurrencyTabs />
              </Disclosure.Panel>
            </>
          )}
        </Disclosure>
      </div>
    </div>
  );
};

export default NavMobile;
