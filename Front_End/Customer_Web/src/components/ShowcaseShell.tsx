import React, { FC, ReactNode } from "react";
import Link from "next/link";
import ShowcaseNavLink from "./ShowcaseNavLink";

/**
 * CUST-WEB-SHOWCASE-001-CP01: the public frame of the Customer Web. Replaces
 * the template header, footer and mobile nav (demo switchers, account, login,
 * wishlist) with links that only point at what really works.
 *
 * CP01-C1 (F1): no link loads a new document. A document load would remount
 * BookingHoldProvider and lose the guest's in-memory hold and access token,
 * so the hold could no longer be confirmed.
 */
const NAV = [
  { section: "catalog", label: "Chỗ nghỉ" },
  { section: "room-types", label: "Loại phòng" },
  { section: "booking", label: "Đặt phòng" },
];

const ShowcaseShell: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen flex-col">
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
      <div className="container flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          The BHA
        </Link>
        <nav aria-label="Chính" className="flex gap-4 text-sm font-medium sm:gap-6">
          {NAV.map((item) => (
            <ShowcaseNavLink key={item.section} section={item.section} className="py-2 hover:text-primary-6000">
              {item.label}
            </ShowcaseNavLink>
          ))}
        </nav>
      </div>
      <p className="bg-primary-50 py-2 text-center text-xs text-primary-700 dark:bg-neutral-800 dark:text-primary-300">
        Bản demo: giá và tình trạng phòng là dữ liệu thử nghiệm. Chưa có thanh toán trực tuyến.
      </p>
    </header>
    <main className="flex-grow">{children}</main>
    <footer className="border-t border-neutral-200 py-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      © The BHA · Đặt phòng trực tiếp
    </footer>
  </div>
);

export default ShowcaseShell;
