import React, { FC } from "react";
import Link from "next/link";
import type { Route } from "next";
import Logo from "@/shared/Logo";
import MenuBar from "@/shared/MenuBar";
import AvatarDropdown from "./AvatarDropdown";
import HeroSearchForm2MobileFactory from "../(HeroSearchForm2Mobile)/HeroSearchForm2MobileFactory";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";
import { RIVERSIDE_NAV } from "@/lib/riversideHomeContent";

export interface MainNav2Props {
  className?: string;
}

const NAV_LINK_CLASS =
  "inline-flex items-center rounded-full px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white";

/**
 * CUST-WEB-001-CP08a: logo, the Riverside navigation (every entry leads somewhere that works), the compact
 * search under `lg`, and the account entry. The template's multi-service dropdowns, templates menu, language,
 * notifications and "List your property" are not rendered.
 */
const MainNav2: FC<MainNav2Props> = ({ className = "" }) => {
  return (
    <div className={`MainNav2 relative z-10 ${className}`}>
      <div className="px-4 h-20 lg:container flex justify-between">
        <div className="hidden md:flex justify-start flex-1 space-x-3 sm:space-x-8 lg:space-x-10">
          <Logo className="w-24 self-center" />
          <div className="hidden lg:block self-center h-10 border-l border-neutral-300 dark:border-neutral-500"></div>
          <nav aria-label="Điều hướng chính" className="hidden lg:flex self-center items-center space-x-1">
            {RIVERSIDE_NAV.map((item) =>
              item.section ? (
                <ShowcaseNavLink key={item.id} section={item.section} className={NAV_LINK_CLASS}>
                  {item.name}
                </ShowcaseNavLink>
              ) : (
                <Link key={item.id} href={item.href as Route} className={NAV_LINK_CLASS}>
                  {item.name}
                </Link>
              )
            )}
          </nav>
        </div>

        <div className="self-center lg:hidden flex-[3] max-w-lg !mx-auto md:px-3">
          <HeroSearchForm2MobileFactory />
        </div>

        {/* CUST-WEB-001-CP02: the right-hand cluster below is hidden under md, so the account entry has its own. */}
        <div className="flex md:hidden flex-shrink-0 self-center ml-1 text-neutral-700 dark:text-neutral-100">
          <AvatarDropdown panelClassName="right-0" />
        </div>

        <div className="hidden md:flex flex-shrink-0 justify-end flex-1 lg:flex-none text-neutral-700 dark:text-neutral-100">
          <div className="hidden lg:flex space-x-1">
            <AvatarDropdown />
          </div>
          <div className="flex space-x-2 lg:hidden">
            <AvatarDropdown />
            <MenuBar />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainNav2;
