"use client";

import {
  CurrencyDollarIcon,
  CurrencyEuroIcon,
  BanknotesIcon,
} from "@heroicons/react/24/outline";

/**
 * CUST-WEB-001-CP08a-C2: the currencies the header's Language/Currency menu lists. This is a UI preview of
 * the template's menu: choosing one changes nothing — the site shows VND, the booking API quotes VND, and no
 * conversion, discount or locale is applied anywhere (see `LangDropdown`).
 */
export const headerCurrency = [
  {
    id: "VND",
    name: "VND",
    description: "Đồng Việt Nam",
    icon: BanknotesIcon,
    active: true,
  },
  {
    id: "USD",
    name: "USD",
    description: "Đô la Mỹ",
    icon: CurrencyDollarIcon,
  },
  {
    id: "EUR",
    name: "EUR",
    description: "Euro",
    icon: CurrencyEuroIcon,
  },
];
