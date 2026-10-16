"use client";

import { Popover, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import type { Route } from "next";
import React, { Fragment, useRef, type ReactNode } from "react";
import { useT } from "@/lib/i18n/I18nProvider";
import { isExternalHref, type MenuNode } from "@/lib/menus/menu";
import { useMenu } from "@/lib/menus/MenuProvider";
import { NAV_MAIN_ITEM, NAV_MAIN_SPLIT_LEFT, NAV_SUB_TEXT } from "@/shared/headerTypography";

/**
 * CUST-WEB-HEADER-001-CP04: the desktop header navigation, drawn from the tree the Admin keeps (see `lib/menus`). One
 * recursive renderer for every entry — no entry is special: a leaf is a link; an entry with only leaves below it opens a list;
 * an entry with deeper levels opens a wide panel of columns. A link opens in a new tab only when the Admin said so (and an
 * external address always carries `rel="noopener noreferrer"`). Labels are plain text, escaped by React, truncated
 * (with the full text as the tooltip) rather than allowed to push the header's controls off the screen.
 */

export function MenuLink({ node, className, onClick, children }: { node: MenuNode; className?: string; onClick?: () => void; children?: ReactNode }) {
  const external = isExternalHref(node.href);
  const target = node.newTab ? "_blank" : undefined;
  const rel = node.newTab || external ? "noopener noreferrer" : undefined;
  const content = children ?? node.label;
  if (external || node.href.startsWith("#")) {
    return (
      <a href={node.href} target={target} rel={rel} className={className} onClick={onClick} title={node.label}>
        {content}
      </a>
    );
  }
  return (
    <Link href={node.href as Route} target={target} rel={rel} className={className} onClick={onClick} title={node.label}>
      {content}
    </Link>
  );
}

const PANEL_LINK = `block rounded-md px-3 py-2 ${NAV_SUB_TEXT} break-words text-neutral-600 hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-200`;

function NavEntry({ node }: { node: MenuNode }) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (node.children.length === 0) {
    return (
      <MenuLink node={node} className={`${NAV_MAIN_ITEM} max-w-[11rem] min-w-0`}>
        <span className="truncate">{node.label}</span>
      </MenuLink>
    );
  }

  const wide = node.children.some((child) => child.children.length > 0);
  const toggleOnly = node.href === "#";
  const expandLabel = t("customer.menu.expand", { name: node.label });
  return (
    <Popover className={`MenuEntry ${wide ? "flex" : "relative flex items-center"} min-w-0`}>
      {({ open, close }) => (
        <div
          className="flex min-w-0 items-center"
          onMouseEnter={() => {
            if (!wide && !open) buttonRef.current?.click();
          }}
          onMouseLeave={() => {
            if (!wide && open) close();
          }}
        >
          {toggleOnly ? (
            <Popover.Button ref={buttonRef} title={node.label} className={`${NAV_MAIN_ITEM} max-w-[11rem] min-w-0`}>
              <span className="truncate">{node.label}</span>
              <ChevronDownIcon className={`ml-1 h-4 w-4 flex-shrink-0 transition-transform ${open ? "-rotate-180" : ""}`} aria-hidden="true" />
            </Popover.Button>
          ) : (
            <>
              <MenuLink node={node} className={`${NAV_MAIN_SPLIT_LEFT} max-w-[10rem] min-w-0`} onClick={() => close()}>
                <span className="truncate">{node.label}</span>
              </MenuLink>
              <Popover.Button
                ref={buttonRef}
                aria-label={expandLabel}
                className="inline-flex items-center rounded-r-full py-2 pl-1 pr-3 text-neutral-400 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-neutral-800"
              >
                <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? "-rotate-180" : ""}`} aria-hidden="true" />
              </Popover.Button>
            </>
          )}
          <Transition
            as={Fragment}
            enter="transition ease-out duration-150"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            {wide ? (
              <Popover.Panel className="absolute inset-x-0 top-full z-20 w-full">
                <div className="bg-white shadow-lg dark:bg-neutral-900">
                  <div className="container max-h-[70vh] overflow-y-auto border-t border-slate-200 py-8 dark:border-slate-700">
                    <div className="grid gap-6 text-sm xl:gap-8" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))" }}>
                      {node.children.map((column) => (
                        <div key={column.id} className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-neutral-200">
                            <MenuLink node={column} onClick={() => close()} className="break-words hover:underline" />
                          </p>
                          <ul className="mt-4 grid space-y-3">
                            {column.children.map((item) => (
                              <MenuTreeItem key={item.id} node={item} close={close} />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Popover.Panel>
            ) : (
              <Popover.Panel className="absolute left-0 top-full z-20 w-60 pt-2">
                <ul className="grid space-y-1 rounded-lg bg-white py-4 text-sm shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-neutral-900 dark:ring-white dark:ring-opacity-10">
                  {node.children.map((child) => (
                    <li key={child.id} className="px-2">
                      <MenuLink node={child} onClick={() => close()} className={PANEL_LINK} />
                    </li>
                  ))}
                </ul>
              </Popover.Panel>
            )}
          </Transition>
        </div>
      )}
    </Popover>
  );
}

/** A link of a wide panel and, indented, what is below it (the deepest level the Admin allows is the fourth). */
function MenuTreeItem({ node, close }: { node: MenuNode; close: () => void }) {
  return (
    <li className="min-w-0">
      <MenuLink node={node} onClick={() => close()} className="break-words font-normal text-slate-600 hover:text-black dark:text-slate-400 dark:hover:text-white" />
      {node.children.length > 0 && (
        <ul className="ml-3 mt-2 space-y-2 border-l border-slate-200 pl-3 dark:border-slate-700">
          {node.children.map((child) => (
            <MenuTreeItem key={child.id} node={child} close={close} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The main row on the left of the header. */
export function PrimaryNav() {
  const t = useT();
  const nodes = useMenu().menu?.primary ?? [];
  if (nodes.length === 0) return null;
  return (
    <nav aria-label={t("customer.header.nav.primary")} className="hidden min-w-0 items-center space-x-1 lg:flex">
      {nodes.map((node) => (
        <NavEntry key={node.id} node={node} />
      ))}
    </nav>
  );
}

/** The secondary group on the right of the header (beside the language and account controls). */
export function SecondaryNav() {
  const nodes = useMenu().menu?.secondary ?? [];
  if (nodes.length === 0) return null;
  return (
    <div className="hidden min-w-0 items-center self-center lg:flex">
      {nodes.map((node) => (
        <NavEntry key={node.id} node={node} />
      ))}
    </div>
  );
}
