"use client";

import { Popover, Transition } from "@headlessui/react";
import {
  ArrowRightOnRectangleIcon,
  CalendarDaysIcon,
  HeartIcon,
  MoonIcon,
  UserCircleIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { Fragment, useRef } from "react";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import Avatar from "@/shared/Avatar";
import SwitchDarkMode2 from "@/shared/SwitchDarkMode2";
import Link from "next/link";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { AuthPresentationView, CustomerSessionNotice, useAuthCommand } from "@/components/CustomerAuthNotice";
import { describeAuthEntry } from "@/lib/customerAuthUi";
import { ACCOUNT_PATH } from "@/lib/riversideHomeContent";

import { useT } from "@/lib/i18n/I18nProvider";
interface Props {
  className?: string;
  /** Where the panel hangs from the button. The far-right instance of a narrow header passes `right-0`. */
  panelClassName?: string;
}

const ITEM_CLASS =
  "flex w-full items-center p-2 -m-3 text-left transition duration-150 ease-in-out rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus-visible:ring focus-visible:ring-orange-500 focus-visible:ring-opacity-50";
const ICON_CLASS = "flex items-center justify-center flex-shrink-0 text-neutral-500 dark:text-neutral-300";

/**
 * CUST-WEB-001-CP02: the account entry of every header. What it shows comes from the Customer session
 * provider's `me` state — an email only while authenticated, a neutral icon otherwise — and its only auth
 * action is `guardedLogout`. The logout owner lives here, not in the panel, so closing the menu (or Esc)
 * never abandons or repeats a request that is already running.
 *
 * CUST-WEB-001-CP08a-C2: the template's profile menu for everyone — neutral avatar, "Tài khoản", "Tài khoản của
 * tôi" (always `/account`: the page itself sends a verified-anonymous visitor to sign in and back), the entries
 * that have no feature behind them marked as such, the theme switch and, only for a signed-in Customer, logout.
 * When logout removes the focused button, focus stays on the account button, so Esc still closes the menu.
 */
export default function AvatarDropdown({ className = "", panelClassName = "-right-10 sm:right-0" }: Props) {
  const t = useT();
  const { state, identityChange, guardedLogout } = useCustomerSession();
  const logout = useAuthCommand("logout");
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const email = state.status === "authenticated" ? state.customer.email : null;
  const entry = describeAuthEntry(state.status, identityChange.phase, email);

  return (
    <>
      {/* CP04: keyed by the route so a navigation the page itself makes (/account -> /login once a logout is
          verified) does not leave the menu open over the new page; the logout owner above is unaffected. */}
      <Popover key={pathname} className={`AvatarDropdown relative flex ${className}`}>
        {({ close }) => (
          <>
            <Popover.Button
              ref={triggerRef}
              aria-label={entry.ariaLabel}
              className={`relative self-center w-10 h-10 sm:w-12 sm:h-12 rounded-full text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 flex items-center justify-center`}
            >
              {email ? (
                <Avatar imgUrl="" userName={email} sizeClass="w-8 h-8 sm:w-9 sm:h-9" />
              ) : (
                <UserCircleIcon className="w-8 h-8 sm:w-9 sm:h-9" aria-hidden="true" />
              )}
              {entry.indicator !== "none" && (
                <span
                  aria-hidden="true"
                  className={`absolute top-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-neutral-900 ${
                    entry.indicator === "busy" ? "bg-primary-500 animate-pulse" : "bg-amber-500"
                  }`}
                />
              )}
            </Popover.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-200"
              enterFrom="opacity-0 translate-y-1"
              enterTo="opacity-100 translate-y-0"
              leave="transition ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 translate-y-1"
            >
              <Popover.Panel className={`absolute z-10 w-screen max-w-[260px] px-4 top-full sm:px-0 ${panelClassName}`}>
                <div className="overflow-hidden rounded-3xl shadow-lg ring-1 ring-black ring-opacity-5">
                  <div className="relative grid grid-cols-1 gap-6 bg-white dark:bg-neutral-800 py-7 px-6">
                    <div className="flex items-center space-x-3">
                      {email ? (
                        <Avatar imgUrl="" userName={email} sizeClass="w-12 h-12" />
                      ) : (
                        <UserCircleIcon className="h-12 w-12 flex-shrink-0 text-neutral-400" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-grow">
                        <h4 className="font-semibold">
                          {email || state.status === "anonymous" ? "Tài khoản" : "Phiên đăng nhập"}
                        </h4>
                        {email ? (
                          <p className="text-xs mt-0.5 break-all" title={email}>
                            {email}
                          </p>
                        ) : (
                          state.status === "anonymous" && (
                            <p className="text-xs mt-0.5">{t("customer.header.avatarDropdown.youAreNotSignedIn")}</p>
                          )
                        )}
                      </div>
                    </div>

                    <CustomerSessionNotice />
                    <AuthPresentationView presentation={logout.presentation} />

                    <div className="w-full border-b border-neutral-200 dark:border-neutral-700" />

                    {!email && identityChange.phase === "idle" && (
                      <Link href={"/login" as Route} className={ITEM_CLASS} onClick={() => close()}>
                        <div className={ICON_CLASS}>
                          <UserCircleIcon className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium ">{t("customer.header.avatarDropdown.signIn")}</p>
                        </div>
                      </Link>
                    )}

                    {!email && identityChange.phase === "idle" && (
                      <Link href={"/signup" as Route} className={ITEM_CLASS} onClick={() => close()}>
                        <div className={ICON_CLASS}>
                          <UserPlusIcon className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium ">{t("customer.common.createAccount")}</p>
                        </div>
                      </Link>
                    )}

                    <Link href={ACCOUNT_PATH as Route} className={ITEM_CLASS} onClick={() => close()}>
                      <div className={ICON_CLASS}>
                        <UserCircleIcon className="h-6 w-6" aria-hidden="true" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium ">{t("customer.header.avatarDropdown.myAccount")}</p>
                      </div>
                    </Link>

                    <div aria-disabled="true" className="flex w-full items-center p-2 -m-3 opacity-60">
                      <div className={ICON_CLASS}>
                        <CalendarDaysIcon className="h-6 w-6" aria-hidden="true" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium ">{t("customer.header.avatarDropdown.myBookings")}</p>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customer.header.avatarDropdown.notAvailableYet")}</p>
                      </div>
                    </div>

                    <Link href={"/account-savelists" as Route} className={ITEM_CLASS} onClick={() => close()}>
                      <div className={ICON_CLASS}>
                        <HeartIcon className="h-6 w-6" aria-hidden="true" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium ">{t("customer.header.avatarDropdown.wishlist")}</p>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customer.header.avatarDropdown.notAvailableYet")}</p>
                      </div>
                    </Link>

                    <div className="flex items-center justify-between p-2 -m-3 transition duration-150 ease-in-out rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus-visible:ring focus-visible:ring-orange-500 focus-visible:ring-opacity-50">
                      <div className="flex items-center">
                        <div className={ICON_CLASS}>
                          <MoonIcon className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium " aria-hidden="true">
                            {t("customer.common.darkMode")}
                          </p>
                        </div>
                      </div>
                      <SwitchDarkMode2 />
                    </div>

                    {email && (
                      <button
                        type="button"
                        className={`${ITEM_CLASS} disabled:opacity-60`}
                        disabled={logout.busy}
                        onClick={() => {
                          // The button is removed as soon as the session is anonymous: keep focus inside this
                          // menu (on its own button) so Esc and Tab still behave while the request runs.
                          triggerRef.current?.focus({ preventScroll: true });
                          logout.run(() => guardedLogout());
                        }}
                      >
                        <div className={ICON_CLASS}>
                          <ArrowRightOnRectangleIcon className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium ">{logout.working ? "Đang đăng xuất…" : "Đăng xuất"}</p>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              </Popover.Panel>
            </Transition>
          </>
        )}
      </Popover>
    </>
  );
}
