"use client";

import React, { FC } from "react";
import type { Route } from "next";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";

import { useT } from "@/lib/i18n/I18nProvider";
/**
 * CUST-WEB-001-CP04: what the template's account sub-pages (password, billing, saved lists) say now. They keep
 * their route but have no feature behind them, so they say that plainly — no form, no sample data, no API
 * call, no read of the session — and lead to places that exist.
 */
const AccountUnavailable: FC<{ feature: string }> = ({ feature }) => {
  const t = useT();
  return (
  <div className="space-y-6 sm:space-y-8">
    <h2 className="text-3xl font-semibold">{t("customer.accountPages.accountUnavailable.thisFeatureIsnTAvailable")}</h2>
    <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
    <p className="max-w-2xl text-neutral-600 dark:text-neutral-300">
      {t("customer.accountPages.accountUnavailable.isnTAvailableInThe", { feature })}</p>
    <div className="flex flex-wrap gap-3">
      <ButtonPrimary href={"/account" as Route}>{t("customer.accountPages.accountUnavailable.backToYourAccount")}</ButtonPrimary>
      <ButtonSecondary href={"/" as Route}>{t("customer.common.backToHome")}</ButtonSecondary>
    </div>
  </div>
);
};

export default AccountUnavailable;
