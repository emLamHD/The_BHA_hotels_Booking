import React, { FC } from "react";
import Logo from "@/shared/Logo";
import MenuBar from "@/shared/MenuBar";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";

export interface MainNav2Props {
  className?: string;
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's MainNav2 frame (logo left, nav links, menu button on
 * small screens) reduced to what works. The demo switchers, template dropdowns, language/notification/
 * account controls and the "list your property" button are gone: none has a backend. Every link stays
 * on this page's document, so an in-progress hold and its guest token survive navigation.
 */
const MainNav2: FC<MainNav2Props> = ({ className = "" }) => {
  return (
    <div className={`MainNav2 relative z-10 ${className}`}>
      <div className="px-4 h-20 lg:container flex items-center justify-between">
        <div className="flex items-center space-x-6 lg:space-x-10">
          <Logo className="w-24 self-center" />
          <div className="hidden md:block self-center h-10 border-l border-neutral-300 dark:border-neutral-500"></div>
          <nav
            aria-label="Chính"
            className="hidden md:flex items-center space-x-6 text-sm font-medium text-neutral-700 dark:text-neutral-200"
          >
            <ShowcaseNavLink section="rooms" className="py-2 hover:text-primary-6000">
              Phòng nghỉ
            </ShowcaseNavLink>
            <ShowcaseNavLink section="services" className="py-2 hover:text-primary-6000">
              Dịch vụ
            </ShowcaseNavLink>
          </nav>
        </div>

        <div className="flex md:hidden">
          <MenuBar />
        </div>
      </div>
    </div>
  );
};

export default MainNav2;
