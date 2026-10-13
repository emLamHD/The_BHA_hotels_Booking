"use client";

import { Popover, Transition } from "@headlessui/react";
import { UserCircleIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { Fragment } from "react";
import type { Route } from "next";
import Avatar from "@/shared/Avatar";
import SwitchDarkMode2 from "@/shared/SwitchDarkMode2";
import Link from "next/link";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { AuthPresentationView, CustomerSessionNotice, useAuthCommand } from "@/components/CustomerAuthNotice";
import { describeAuthEntry } from "@/lib/customerAuthUi";

interface Props {
  className?: string;
  /** Where the panel hangs from the button. The far-right instance of a narrow header passes `right-0`. */
  panelClassName?: string;
}

const ITEM_CLASS =
  "flex w-full items-center p-2 -m-3 text-left transition duration-150 ease-in-out rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus-visible:ring focus-visible:ring-orange-500 focus-visible:ring-opacity-50";

/**
 * CUST-WEB-001-CP02: the account entry of every header. What it shows comes from the Customer session
 * provider's `me` state — an email only while authenticated, a neutral icon otherwise — and its only auth
 * action is `guardedLogout`. The logout owner lives here, not in the panel, so closing the menu (or Esc)
 * never abandons or repeats a request that is already running.
 */
export default function AvatarDropdown({ className = "", panelClassName = "-right-10 sm:right-0" }: Props) {
  const { state, identityChange, guardedLogout } = useCustomerSession();
  const logout = useAuthCommand("logout");
  const email = state.status === "authenticated" ? state.customer.email : null;
  const entry = describeAuthEntry(state.status, identityChange.phase, email);

  return (
    <>
      <Popover className={`AvatarDropdown relative flex ${className}`}>
        {({ close }) => (
          <>
            <Popover.Button
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
                        {email ? (
                          <>
                            <h4 className="font-semibold">Đã đăng nhập</h4>
                            <p className="text-xs mt-0.5 break-all" title={email}>
                              {email}
                            </p>
                          </>
                        ) : (
                          <>
                            <h4 className="font-semibold">
                              {state.status === "anonymous" ? "Bạn chưa đăng nhập" : "Phiên đăng nhập"}
                            </h4>
                            {state.status === "anonymous" && (
                              <p className="text-xs mt-0.5">Bạn vẫn có thể đặt phòng không cần tài khoản.</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <CustomerSessionNotice />
                    <AuthPresentationView presentation={logout.presentation} />

                    <div className="w-full border-b border-neutral-200 dark:border-neutral-700" />

                    {!email && identityChange.phase === "idle" && (
                      <Link href={"/login" as Route} className={ITEM_CLASS} onClick={() => close()}>
                        <div className="flex items-center justify-center flex-shrink-0 text-neutral-500 dark:text-neutral-300">
                          <UserCircleIcon className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium ">{"Đăng nhập"}</p>
                        </div>
                      </Link>
                    )}

                    {!email && identityChange.phase === "idle" && (
                      <Link href={"/signup" as Route} className={ITEM_CLASS} onClick={() => close()}>
                        <div className="flex items-center justify-center flex-shrink-0 text-neutral-500 dark:text-neutral-300">
                          <UserPlusIcon className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium ">{"Tạo tài khoản"}</p>
                        </div>
                      </Link>
                    )}

                    {email && identityChange.phase === "idle" && (
                      <Link href={"/account" as Route} className={ITEM_CLASS} onClick={() => close()}>
                        <div className="flex items-center justify-center flex-shrink-0 text-neutral-500 dark:text-neutral-300">
                          <UserCircleIcon className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium ">{"Tài khoản"}</p>
                        </div>
                      </Link>
                    )}

                    {/* ------------------ 2 --------------------- */}
                    <div className="flex items-center justify-between p-2 -m-3 transition duration-150 ease-in-out rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus-visible:ring focus-visible:ring-orange-500 focus-visible:ring-opacity-50">
                      <div className="flex items-center">
                        <div className="flex items-center justify-center flex-shrink-0 text-neutral-500 dark:text-neutral-300">
                          <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M12.0001 7.88989L10.9301 9.74989C10.6901 10.1599 10.8901 10.4999 11.3601 10.4999H12.6301C13.1101 10.4999 13.3001 10.8399 13.0601 11.2499L12.0001 13.1099"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M8.30011 18.0399V16.8799C6.00011 15.4899 4.11011 12.7799 4.11011 9.89993C4.11011 4.94993 8.66011 1.06993 13.8001 2.18993C16.0601 2.68993 18.0401 4.18993 19.0701 6.25993C21.1601 10.4599 18.9601 14.9199 15.7301 16.8699V18.0299C15.7301 18.3199 15.8401 18.9899 14.7701 18.9899H9.26011C8.16011 18.9999 8.30011 18.5699 8.30011 18.0399Z"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M8.5 22C10.79 21.35 13.21 21.35 15.5 22"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium ">{"Dark theme"}</p>
                        </div>
                      </div>
                      <SwitchDarkMode2 />
                    </div>

                    {email && (
                      <button
                        type="button"
                        className={`${ITEM_CLASS} disabled:opacity-60`}
                        disabled={logout.busy}
                        onClick={() => logout.run(() => guardedLogout())}
                      >
                        <div className="flex items-center justify-center flex-shrink-0 text-neutral-500 dark:text-neutral-300">
                          <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M8.90002 7.55999C9.21002 3.95999 11.06 2.48999 15.11 2.48999H15.24C19.71 2.48999 21.5 4.27999 21.5 8.74999V15.27C21.5 19.74 19.71 21.53 15.24 21.53H15.11C11.09 21.53 9.24002 20.08 8.91002 16.54"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M15 12H3.62"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M5.85 8.6499L2.5 11.9999L5.85 15.3499"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
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
