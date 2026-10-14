"use client";

import { Popover, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import type { Route } from "next";
import { Fragment, useRef } from "react";
import { BLOG_NAV_ITEMS } from "@/data/navigation";
import { BLOG_PATH } from "@/lib/riversideHomeContent";

const MAIN_LINK_CLASS =
  "inline-flex items-center rounded-l-full py-2 pl-4 pr-1 text-sm xl:text-base font-normal text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

/**
 * CUST-WEB-001-CP08a-C2: the "Blog" entry of the header. The name is a link to `/blog`; beside it a small button
 * opens the categories (a template-style dropdown that also opens on hover). The button is keyboard- and
 * screen-reader-operable (Enter/Space opens, Esc closes), which the template's hover-only menu is not.
 */
export default function BlogNavDropdown() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover className="BlogNavDropdown relative flex items-center">
      {({ open, close }) => (
        <div
          className="flex items-center"
          onMouseEnter={() => {
            if (!open) buttonRef.current?.click();
          }}
          onMouseLeave={() => {
            if (open) close();
          }}
        >
          <Link href={BLOG_PATH as Route} className={MAIN_LINK_CLASS} onClick={() => close()}>
            Blog
          </Link>
          <Popover.Button
            ref={buttonRef}
            aria-label="Mở danh mục Blog"
            className="inline-flex items-center rounded-r-full py-2 pl-1 pr-3 text-neutral-400 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-neutral-800"
          >
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? "-rotate-180" : ""}`} aria-hidden="true" />
          </Popover.Button>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-150"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel className="absolute left-0 top-full z-20 w-56 pt-2">
              <ul className="grid space-y-1 rounded-lg bg-white py-4 text-sm shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-neutral-900 dark:ring-white dark:ring-opacity-10">
                {BLOG_NAV_ITEMS.map((item) => (
                  <li key={item.id} className="px-2">
                    <Link
                      href={item.href as Route}
                      onClick={() => close()}
                      className="flex items-center rounded-md px-4 py-2 font-normal text-neutral-600 hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Popover.Panel>
          </Transition>
        </div>
      )}
    </Popover>
  );
}
