"use client";

import React from "react";
import Amount from "@/components/Amount";
import type { AppliedPromotionDto } from "@/lib/api/availabilityTypes";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * The rule of a promotion, said from its own fields (never typed text, so the words cannot differ from the price): "Giảm 15%" or
 * "Giảm 200.000 ₫/phòng/đêm" (the amount in the guest's currency, through the same `Amount` as every other price).
 */
export function PromotionRule({ kind, value, currencyCode }: { kind: "Percent" | "FixedAmount"; value: number; currencyCode: string | null }) {
  const { t } = useI18n();
  if (kind === "Percent") return <>{t("customer.promotion.percentOff", { percent: value })}</>;
  return (
    <>
      {t("customer.promotion.off")} <Amount amount={value} currencyCode={currencyCode} />
      {t("customer.promotion.perRoomNight")}
    </>
  );
}

/**
 * The promotion the backend applied. Its own title is the content source language's text, so it is shown only in that language; other
 * languages read the rule.
 */
export default function PromotionBadge({ promotion, className = "" }: { promotion: AppliedPromotionDto; className?: string }) {
  const { locale } = useI18n();
  return (
    <span
      data-testid="promotion-badge"
      className={`inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 ${className}`}
    >
      {locale === "vi" && promotion.title ? `${promotion.title} · ` : null}
      <PromotionRule kind={promotion.kind} value={promotion.value} currencyCode={promotion.currencyCode} />
    </span>
  );
}
