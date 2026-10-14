import React, { FC } from "react";
import type { Route } from "next";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";

/**
 * CUST-WEB-001-CP04: what the template's account sub-pages (password, billing, saved lists) say now. They keep
 * their route but have no feature behind them, so they say that plainly — no form, no sample data, no API
 * call, no read of the session — and lead to places that exist.
 */
const AccountUnavailable: FC<{ feature: string }> = ({ feature }) => (
  <div className="space-y-6 sm:space-y-8">
    <h2 className="text-3xl font-semibold">Chức năng này chưa được hỗ trợ</h2>
    <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
    <p className="max-w-2xl text-neutral-600 dark:text-neutral-300">
      {feature} chưa có trong phiên bản hiện tại của The BHA.
    </p>
    <div className="flex flex-wrap gap-3">
      <ButtonPrimary href={"/account" as Route}>Về trang tài khoản</ButtonPrimary>
      <ButtonSecondary href={"/" as Route}>Về trang chủ</ButtonSecondary>
    </div>
  </div>
);

export default AccountUnavailable;
