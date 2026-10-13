"use client";

import {
  HeartIcon,
  MagnifyingGlassIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import React, { useEffect, useRef } from "react";
import { PathName } from "@/routers/types";
import MenuBar from "@/shared/MenuBar";
import isInViewport from "@/utils/isInViewport";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { describeAuthEntry } from "@/lib/customerAuthUi";

let WIN_PREV_POSITION = 0;
if (typeof window !== "undefined") {
  WIN_PREV_POSITION = window.pageYOffset;
}

interface NavItem {
  name: string;
  link?: PathName;
  icon: any;
  /** The Customer auth entry: labelled and marked from the session provider, not fixed here. */
  auth?: boolean;
}

const NAV: NavItem[] = [
  {
    name: "Explore",
    link: "/",
    icon: MagnifyingGlassIcon,
  },
  {
    name: "Wishlists",
    link: "/account-savelists",
    icon: HeartIcon,
  },
  {
    name: "Đăng nhập",
    link: "/login",
    icon: UserCircleIcon,
    auth: true,
  },
  {
    name: "Menu",
    icon: MenuBar,
  },
];

const FooterNav = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const { state, identityChange } = useCustomerSession();
  const authEntry = describeAuthEntry(
    state.status,
    identityChange.phase,
    state.status === "authenticated" ? state.customer.email : null
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("scroll", handleEvent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEvent = () => {
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(showHideHeaderMenu);
    }
  };

  const showHideHeaderMenu = () => {
    // if (typeof window === "undefined" || window?.innerWidth >= 768) {
    //   return null;
    // }

    let currentScrollPos = window.pageYOffset;
    if (!containerRef.current) return;

    // SHOW _ HIDE MAIN MENU
    if (currentScrollPos > WIN_PREV_POSITION) {
      if (
        isInViewport(containerRef.current) &&
        currentScrollPos - WIN_PREV_POSITION < 80
      ) {
        return;
      }

      containerRef.current.classList.add("FooterNav--hide");
    } else {
      if (
        !isInViewport(containerRef.current) &&
        WIN_PREV_POSITION - currentScrollPos < 80
      ) {
        return;
      }
      containerRef.current.classList.remove("FooterNav--hide");
    }

    WIN_PREV_POSITION = currentScrollPos;
  };

  const renderItem = (rawItem: NavItem, index: number) => {
    // CUST-WEB-001-CP02: the auth entry's label follows the verified session; its destination is always /login.
    const item: NavItem = rawItem.auth ? { ...rawItem, name: authEntry.label } : rawItem;
    const isActive = pathname === item.link;

    return item.link ? (
      <Link
        key={index}
        href={item.link}
        aria-label={item.auth ? authEntry.ariaLabel : undefined}
        className={`flex flex-col items-center justify-between text-neutral-500 dark:text-neutral-300/90 ${
          isActive ? "text-neutral-900 dark:text-neutral-100" : ""
        }`}
      >
        <span className="relative">
          <item.icon className={`w-6 h-6 ${isActive ? "text-red-600" : ""}`} />
          {item.auth && authEntry.indicator !== "none" && (
            <span
              aria-hidden="true"
              className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-neutral-800 ${
                authEntry.indicator === "busy" ? "bg-primary-500 animate-pulse" : "bg-amber-500"
              }`}
            />
          )}
        </span>
        <span
          className={`text-[11px] leading-none mt-1 ${
            isActive ? "text-red-600" : ""
          }`}
        >
          {item.name}
        </span>
      </Link>
    ) : (
      <div
        key={index}
        className={`flex flex-col items-center justify-between text-neutral-500 dark:text-neutral-300/90 ${
          isActive ? "text-neutral-900 dark:text-neutral-100" : ""
        }`}
      >
        <item.icon iconClassName="w-6 h-6" className={``} />
        <span className="text-[11px] leading-none mt-1">{item.name}</span>
      </div>
    );
  };

  // CP02-C3: the room page has its own sticky booking bar at the bottom; the app bar would cover it.
  if (pathname?.startsWith("/listing-stay-detail")) return null;

  return (
    <div
      ref={containerRef}
      className="FooterNav block md:!hidden p-2 bg-white dark:bg-neutral-800 fixed top-auto bottom-0 inset-x-0 z-30 border-t border-neutral-300 dark:border-neutral-700 
      transition-transform duration-300 ease-in-out"
    >
      <div className="w-full max-w-lg flex justify-around mx-auto text-sm text-center ">
        {/* MENU */}
        {NAV.map(renderItem)}
      </div>
    </div>
  );
};

export default FooterNav;
