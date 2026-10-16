"use client";

import { Popover, Transition } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import type { Route } from "next";
import React, { Fragment, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

/** The click that follows a hover-open within this time is the same gesture, not a request to close. */
const HOVER_CLICK_GRACE_MS = 600;
function keepHoverOpen(event: React.MouseEvent, open: boolean, state: { at: number; programmatic: boolean }) {
  if (state.programmatic || !open || Date.now() - state.at > HOVER_CLICK_GRACE_MS) return;
  event.preventDefault();
  event.stopPropagation();
}

const PANEL_LINK = `block rounded-md px-3 py-2 ${NAV_SUB_TEXT} break-words text-neutral-600 hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-200`;

function NavEntry({ node }: { node: MenuNode }) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // A list that opened under the pointer must not be closed by the click that follows the same movement.
  const hoverOpened = useRef({ at: 0, programmatic: false });
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
            if (wide || open) return;
            hoverOpened.current = { at: Date.now(), programmatic: true };
            buttonRef.current?.click();
            hoverOpened.current.programmatic = false;
          }}
          onMouseLeave={() => {
            if (!wide && open) close();
          }}
        >
          {toggleOnly ? (
            <Popover.Button ref={buttonRef} title={node.label} onClickCapture={(event: React.MouseEvent) => keepHoverOpen(event, open, hoverOpened.current)} className={`${NAV_MAIN_ITEM} max-w-[11rem] min-w-0`}>
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
                onClickCapture={(event: React.MouseEvent) => keepHoverOpen(event, open, hoverOpened.current)}
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

const MORE_WIDTH = 84;
const GAP = 4;

/**
 * How many of the main row's entries fit in `available` pixels, given their natural widths; when not all fit, room is kept for the
 * "more" button. At least one entry is always shown.
 */
export function fitCount(widths: readonly number[], available: number): number {
  const total = widths.reduce((sum, width) => sum + width + GAP, 0);
  if (total <= available) return widths.length;
  let used = MORE_WIDTH;
  let count = 0;
  for (const width of widths) {
    if (used + width + GAP > available) break;
    used += width + GAP;
    count++;
  }
  return Math.max(1, count);
}

/** The main row on the left of the header. Entries that do not fit move into a "more" list, so a long or large menu never pushes the controls off the screen. */
export function PrimaryNav() {
  const t = useT();
  const nodes = useMenu().menu?.primary ?? [];
  const nav = useRef<HTMLElement>(null);
  const key = nodes.map((node) => `${node.id}:${node.label}`).join("|");
  // First render of a menu: every entry is shown so its natural width can be measured; after that the row fits itself to its width.
  const [fit, setFit] = useState<{ key: string; widths: number[]; shown: number } | null>(null);
  const measuring = fit?.key !== key;

  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    if (measuring) {
      const widths = Array.from(el.querySelectorAll<HTMLElement>(":scope > [data-nav-entry]")).map((child) => child.offsetWidth);
      setFit({ key, widths, shown: fitCount(widths, el.clientWidth) });
      return;
    }
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFit((previous) => (previous ? { ...previous, shown: fitCount(previous.widths, el.clientWidth) } : previous)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [key, measuring]);

  if (nodes.length === 0) return null;
  const visible = measuring || !fit ? nodes.length : Math.min(fit.shown, nodes.length);
  const overflow = nodes.slice(visible);
  return (
    <nav aria-label={t("customer.header.nav.primary")} ref={nav} className="hidden min-w-0 flex-1 flex-nowrap items-center [overflow-x:clip] lg:flex" style={{ columnGap: GAP }}>
      {nodes.map((node, index) => (
        <div key={node.id} data-nav-entry className={`flex flex-shrink-0 ${index < visible ? "" : "hidden"}`}>
          <NavEntry node={node} />
        </div>
      ))}
      {overflow.length > 0 && <MoreMenu nodes={overflow} />}
    </nav>
  );
}

function MoreMenu({ nodes }: { nodes: MenuNode[] }) {
  const t = useT();
  return (
    <Popover className="relative flex flex-shrink-0 items-center">
      {({ close }) => (
        <>
          <Popover.Button className={NAV_MAIN_ITEM} aria-label={t("customer.header.menu.menu")}>
            <span>···</span>
          </Popover.Button>
          <Popover.Panel className="absolute left-0 top-full z-20 max-h-[70vh] w-72 overflow-y-auto pt-2">
            <ul className="grid space-y-1 rounded-lg bg-white py-4 text-sm shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-neutral-900 dark:ring-white dark:ring-opacity-10">
              {nodes.map((node) => (
                <li key={node.id} className="px-2">
                  <MenuTreeItem node={node} close={close} />
                </li>
              ))}
            </ul>
          </Popover.Panel>
        </>
      )}
    </Popover>
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
