"use client";

import React from "react";
import Link from "next/link";
import type { Route } from "next";
import Logo from "@/shared/Logo";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { describeAuthEntry } from "@/lib/customerAuthUi";
import { MEDIA_CREDITS_PATH } from "@/data/heroSlides";
import { blogCategoryPath } from "@/lib/homepageContent";
import {
  BLOG_PATH,
  HOME_PATH,
  OFFERS_PATH,
  RESULTS_PATH,
  RIVERSIDE_ADDRESS,
  RIVERSIDE_NAME,
  RIVERSIDE_PATH,
  RIVERSIDE_SECTION_LINKS,
} from "@/lib/riversideHomeContent";

const LINK_CLASS = "text-neutral-6000 dark:text-neutral-300 hover:text-black dark:hover:text-white";

/**
 * CUST-WEB-001-CP08a: the footer of the Riverside site. The brand and its approved address, and links that
 * lead through the booking journey: search, room types, the guide, the questions, the account entry.
 * CUST-WEB-001-CP08a-C2: the pages of the booking portal (home, Riverside, offers, blog, destinations), the
 * Riverside sections as `/riverside#…`, and the photo credits.
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
      <div className="container grid grid-cols-2 gap-y-10 gap-x-5 sm:gap-x-8 md:grid-cols-5 lg:gap-x-10">
        <div className="col-span-2 space-y-4 text-sm">
          <Logo />
          <p className="font-semibold text-neutral-700 dark:text-neutral-200">{RIVERSIDE_NAME}</p>
          <p className="text-neutral-6000 dark:text-neutral-300">{RIVERSIDE_ADDRESS}</p>
        </div>

        <nav aria-label="Khám phá" className="text-sm">
          <h2 className="font-semibold text-neutral-700 dark:text-neutral-200">Khám phá</h2>
          <ul className="mt-5 space-y-4">
            <li>
              <Link href={HOME_PATH as Route} className={LINK_CLASS}>
                Trang chủ
              </Link>
            </li>
            <li>
              <Link href={RIVERSIDE_PATH as Route} className={LINK_CLASS}>
                Riverside
              </Link>
            </li>
            <li>
              <Link href={OFFERS_PATH as Route} className={LINK_CLASS}>
                Ưu đãi
              </Link>
            </li>
            <li>
              <Link href={BLOG_PATH as Route} className={LINK_CLASS}>
                Blog
              </Link>
            </li>
            <li>
              <Link href={blogCategoryPath("diem-den-noi-bat") as Route} className={LINK_CLASS}>
                Điểm đến nổi bật
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Đặt phòng" className="text-sm">
          <h2 className="font-semibold text-neutral-700 dark:text-neutral-200">Đặt phòng</h2>
          <ul className="mt-5 space-y-4">
            <li>
              <Link href={RESULTS_PATH as Route} className={LINK_CLASS}>
                Tìm phòng
              </Link>
            </li>
            {RIVERSIDE_SECTION_LINKS.map((item) => (
              <li key={item.id}>
                <ShowcaseNavLink section={item.section as string} className={LINK_CLASS}>
                  {item.name}
                </ShowcaseNavLink>
              </li>
            ))}
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
            <li>
              <Link href={MEDIA_CREDITS_PATH as Route} className={LINK_CLASS}>
                Nguồn ảnh
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
};

export default Footer;
