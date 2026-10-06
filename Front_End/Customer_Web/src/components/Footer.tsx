"use client";

import Logo from "@/shared/Logo";
import React from "react";
import FooterNav from "./FooterNav";
import ShowcaseNavLink from "./ShowcaseNavLink";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's footer frame (logo column + link columns). The
 * template's placeholder menus (installation, release notes …) and social links are gone; the
 * links point at what exists, and the not-yet-built brands/services are stated as such. No contact
 * details are shown because none have been supplied.
 */
const COLUMN_TITLE = "font-semibold text-neutral-700 dark:text-neutral-200";
const LINK = "text-neutral-6000 dark:text-neutral-300 hover:text-black dark:hover:text-white";
const SOON = "text-neutral-400 dark:text-neutral-500";

const Footer: React.FC = () => {
  return (
    <>
      <FooterNav />

      <div className="nc-Footer relative py-24 lg:py-28 border-t border-neutral-200 dark:border-neutral-700">
        <div className="container grid grid-cols-2 gap-y-10 gap-x-5 sm:gap-x-8 md:grid-cols-4 lg:gap-x-10">
          <div className="col-span-2 space-y-4">
            <Logo />
            <p className="max-w-xs text-sm text-neutral-6000 dark:text-neutral-300">
              The BHA — đặt phòng trực tiếp. Bản demo: giá và tình trạng phòng là dữ liệu thử nghiệm, chưa có thanh toán
              trực tuyến.
            </p>
          </div>

          <div className="text-sm">
            <h2 className={COLUMN_TITLE}>Thương hiệu</h2>
            <ul className="mt-5 space-y-4">
              <li>
                <ShowcaseNavLink section="rooms" className={LINK}>
                  The BHA Riverside
                </ShowcaseNavLink>
              </li>
              <li className={SOON}>The BHA House · sắp ra mắt</li>
              <li className={SOON}>The BHA Villa · sắp ra mắt</li>
            </ul>
          </div>

          <div className="text-sm">
            <h2 className={COLUMN_TITLE}>Khám phá</h2>
            <ul className="mt-5 space-y-4">
              <li>
                <ShowcaseNavLink section="rooms" className={LINK}>
                  Phòng nghỉ
                </ShowcaseNavLink>
              </li>
              <li>
                <ShowcaseNavLink section="services" className={LINK}>
                  Dịch vụ (đang phát triển)
                </ShowcaseNavLink>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
};

export default Footer;
