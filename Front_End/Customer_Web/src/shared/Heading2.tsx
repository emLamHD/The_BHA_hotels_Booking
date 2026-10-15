"use client";

import React from "react";
import { ReactNode } from "react";

import { useT } from "@/lib/i18n/I18nProvider";
export interface Heading2Props {
  heading?: ReactNode;
  subHeading?: ReactNode;
  className?: string;
}

const Heading2: React.FC<Heading2Props> = ({
  className = "",
  heading = "Stays in Tokyo",
  subHeading,
}) => {
  const t = useT();
  return (
    <div className={`mb-12 lg:mb-16 ${className}`}>
      <h2 className="text-4xl font-semibold">{heading}</h2>
      {subHeading ? (
        subHeading
      ) : (
        <span className="block text-neutral-500 dark:text-neutral-400 mt-3">{t("customer.shared.heading2.233Stays")}{" "}<span className="mx-2">·</span>{t("customer.shared.heading2.aug1218")}{" "}<span className="mx-2">·</span>{t("customer.shared.heading2.2Guests")}</span>
      )}
    </div>
  );
};

export default Heading2;
