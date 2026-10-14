"use client";

import React from "react";
import Link from "next/link";
import type { Route } from "next";
import Logo from "@/shared/Logo";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { describeAuthEntry } from "@/lib/customerAuthUi";
import { HOME_SECTION, RESULTS_PATH, RIVERSIDE_ADDRESS, RIVERSIDE_NAME } from "@/lib/riversideHomeContent";

const LINK_CLASS = "text-neutral-6000 dark:text-neutral-300 hover:text-black dark:hover:text-white";

/**
 * CUST-WEB-001-CP08a: the footer of the Riverside site. The brand and its approved address, and links that
 * lead through the booking journey: search, room types, the guide, the questions, the account entry.
 * There is no phone, e-mail, Zalo or social link because none has been supplied; none is invented.
 * (The small-screen app bar, FooterNav, is mounted once by the root layout, not here.)
 */
const Footer: React.FC = () => {
  const { state, identityChange } = useCustomerSession();
  const entry = describeAuthEntry(
    state.status,
    identityChange.phase,
    state.status === "authenticated" ? state.customer.email : null
  );
  const showSignup = state.status === "anonymous";

  return (
    <div className="nc-Footer relative py-24 lg:py-28 border-t border-neutral-200 dark:border-neutral-700">
      <div className="container grid grid-cols-2 gap-y-10 gap-x-5 sm:gap-x-8 md:grid-cols-4 lg:gap-x-10">
        <div className="col-span-2 space-y-4 text-sm">
          <Logo />
          <p className="font-semibold text-neutral-700 dark:text-neutral-200">{RIVERSIDE_NAME}</p>
          <p className="text-neutral-6000 dark:text-neutral-300">{RIVERSIDE_ADDRESS}</p>
        </div>

        <nav aria-label="Đặt phòng" className="text-sm">
          <h2 className="font-semibold text-neutral-700 dark:text-neutral-200">Đặt phòng</h2>
          <ul className="mt-5 space-y-4">
            <li>
              <Link href={RESULTS_PATH as Route} className={LINK_CLASS}>
                Tìm phòng
              </Link>
            </li>
            <li>
              <ShowcaseNavLink section={HOME_SECTION.rooms} className={LINK_CLASS}>
                Loại phòng
              </ShowcaseNavLink>
            </li>
            <li>
              <ShowcaseNavLink section={HOME_SECTION.guide} className={LINK_CLASS}>
                Hướng dẫn đặt phòng
              </ShowcaseNavLink>
            </li>
            <li>
              <ShowcaseNavLink section={HOME_SECTION.faq} className={LINK_CLASS}>
                Thông tin cần biết
              </ShowcaseNavLink>
            </li>
          </ul>
        </nav>

        <nav aria-label="Tài khoản" className="text-sm">
          <h2 className="font-semibold text-neutral-700 dark:text-neutral-200">Tài khoản</h2>
          <ul className="mt-5 space-y-4">
            <li>
              <Link href={entry.href as Route} className={LINK_CLASS}>
                {entry.label}
              </Link>
            </li>
            {showSignup && (
              <li>
                <Link href={"/signup" as Route} className={LINK_CLASS}>
                  Tạo tài khoản
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </div>
  );
};

export default Footer;
