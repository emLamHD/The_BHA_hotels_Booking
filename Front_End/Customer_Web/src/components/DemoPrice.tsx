"use client";

import React from "react";
import Money from "@/components/Money";

/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the template pages' sample prices ("$26", "$1,000 - $2,000"). They are not booking data:
 * each sample price is a number of *template units*, and a unit stands for DEMO_UNIT_VND (about the dollar figure it was
 * drawn in). Written as VND like that, a sample goes through the same server conversion and the same format as every real price,
 * in the visitor's language and currency — no `$` is left in the page. Text around the amounts is kept as it is.
 */
export const DEMO_UNIT_VND = 25000;

const AMOUNT = /(\$\s?\d[\d,]*(?:\.\d+)?)/;

export function demoUnits(token: string): number {
  return Number(token.replace(/[^\d.]/g, "")) || 0;
}

export default function DemoPrice({ value, className }: { value: string | number; className?: string }) {
  const parts = String(value).split(AMOUNT);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        AMOUNT.test(part) ? <Money key={index} vnd={demoUnits(part) * DEMO_UNIT_VND} /> : <React.Fragment key={index}>{part}</React.Fragment>
      )}
    </span>
  );
}
