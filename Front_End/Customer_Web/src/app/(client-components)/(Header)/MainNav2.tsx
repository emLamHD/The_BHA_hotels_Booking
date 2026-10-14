import React, { FC } from "react";
import Link from "next/link";
import type { Route } from "next";
import Logo from "@/shared/Logo";
import MenuBar from "@/shared/MenuBar";
import SwitchDarkMode from "@/shared/SwitchDarkMode";
import AvatarDropdown from "./AvatarDropdown";
import BlogNavDropdown from "./BlogNavDropdown";
import DropdownTravelers from "./DropdownTravelers";
import LangDropdown from "./LangDropdown";
import TemplatesDropdown from "./TemplatesDropdown";
import HeroSearchForm2MobileFactory from "../(HeroSearchForm2Mobile)/HeroSearchForm2MobileFactory";
import { PRIMARY_NAV } from "@/lib/riversideHomeContent";

export interface MainNav2Props {
  className?: string;
}

const NAV_LINK_CLASS =
  "inline-flex items-center rounded-full px-4 py-2 text-sm xl:text-base font-normal text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

/**
 * CUST-WEB-001-CP08a-C2: the Chisfis "Header 2" menu, one compact row at every width. Large screens: logo,
 * Riverside, Ưu đãi, Blog (with its categories) and the service menu on the left; the sample-templates menu,
 * Language/Currency, the light/dark button and the account entry on the right. Below `lg` the compact search
 * takes the middle and everything else (services, templates, language/currency, the menus above) lives in the
 * drawer behind the menu button; the light/dark button and the account entry stay in the row at every width,
 * so they are reachable on every page, the room page included; under `md` the app bar (FooterNav) carries the menu button. The template's "List your property" and
 * notifications are not rendered: there is no feature or data behind either.
 */
const MainNav2: FC<MainNav2Props> = ({ className = "" }) => {
  return (
    <div className={`MainNav2 relative z-10 ${className}`}>
      <div className="px-4 h-16 md:h-20 lg:container flex items-center justify-between gap-1 sm:gap-2">
        <div className="hidden md:flex items-center flex-shrink-0 space-x-3 lg:space-x-6 xl:space-x-8">
          <Logo className="w-28 lg:w-32 self-center" />
          <div className="hidden lg:block self-center h-10 border-l border-neutral-300 dark:border-neutral-500"></div>
          <nav aria-label="Điều hướng chính" className="hidden lg:flex items-center space-x-1">
            {PRIMARY_NAV.filter((item) => item.id !== "blog").map((item) => (
              <Link key={item.id} href={item.href as Route} className={NAV_LINK_CLASS}>
                {item.name}
              </Link>
            ))}
            <BlogNavDropdown />
            <DropdownTravelers />
          </nav>
        </div>

        {/* The compact search's two text lines must clamp to one line each (the pill's own `block` class cancels
            `line-clamp-1`, which a narrow row makes visible: a pill taller than the header). */}
        <div className="lg:hidden flex-1 min-w-0 max-w-lg mx-auto md:px-3 [&_.line-clamp-1]:![display:-webkit-box]">
          <HeroSearchForm2MobileFactory />
        </div>

        <div className="flex items-center flex-shrink-0 justify-end text-neutral-700 dark:text-neutral-100 lg:flex-1">
          <TemplatesDropdown />
          <LangDropdown className="hidden lg:flex" />
          <SwitchDarkMode />
          <AvatarDropdown panelClassName="right-0" />
          {/* Under md the app bar's "Menu" opens the same drawer; the room page, which has no app bar, does not need it. */}
          <div className="hidden md:block lg:hidden">
            <MenuBar className="p-2 rounded-lg text-neutral-700 dark:text-neutral-300" iconClassName="h-8 w-8" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainNav2;
