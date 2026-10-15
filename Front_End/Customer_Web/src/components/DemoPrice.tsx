"use client";

import React from "react";
import Money from "@/components/Money";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { reportMissingTpl } from "@/lib/i18n/Tpl";
import { tplKey } from "@/lib/i18n/tpl";

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

/** A sentence with sample amounts is one pack message (`customer.tpl.<hash of the English text>`) whose amounts are `{price1}`, `{price2}`…: the word order of the language decides where each amount goes. */
const SLOT = /\u0001(\d+)\u0001/;

export default function DemoPrice({ value, className }: { value: string | number; className?: string }) {
  const { t, has, locale } = useI18n();
  const text = String(value);
  const amounts = text.split(AMOUNT).filter((part) => AMOUNT.test(part));
  const key = tplKey(text);
  if (has(key)) {
    const params = Object.fromEntries(amounts.map((_, index) => [`price${index + 1}`, `\u0001${index}\u0001`]));
    const pieces = t(key, params).split(SLOT);
    return (
      <span className={className}>
        {pieces.map((piece, index) =>
          index % 2 === 1 ? <Money key={index} vnd={demoUnits(amounts[Number(piece)]) * DEMO_UNIT_VND} /> : <React.Fragment key={index}>{piece}</React.Fragment>
        )}
      </span>
    );
  }
  if (!(amounts.length === 1 && text.trim() === amounts[0].trim())) reportMissingTpl(text, locale);
  const parts = text.split(AMOUNT);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        AMOUNT.test(part) ? <Money key={index} vnd={demoUnits(part) * DEMO_UNIT_VND} /> : <React.Fragment key={index}>{part}</React.Fragment>
      )}
    </span>
  );
}
