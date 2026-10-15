"use client";

import { Popover, Tab, Transition } from "@headlessui/react";
import {
  BanknotesIcon,
  GlobeAltIcon,
  ChevronDownIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { FC, Fragment, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface LangDropdownProps {
  panelClassName?: string;
  className?: string;
}

function classNames(...classes: any) {
  return classes.filter(Boolean).join(" ");
}

const OPTION_CLASS =
  "flex w-full items-center justify-between p-2 text-left transition duration-150 ease-in-out rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/**
 * CUST-WEB-HEADER-001-CP02-C2: the Language / Currency tabs. Both lists come from the website settings the Admin
 * keeps (the languages that are on, the currencies that are on and have a rate); nothing here names a language or a
 * currency. Choosing a language shows the whole site in it and brings that language's own default currency; choosing
 * a currency changes the currency only. The choice is remembered in two cookies, applied by the server on the next
 * render, and never sent to the booking API. Used by the header's popover and, inline, by the mobile menu.
 */
export const LangCurrencyTabs: FC = () => {
  const { t, locales, currencies, locale, currency, formatLocale, setLocale, setCurrency, switching } = useI18n();
  const [message, setMessage] = useState("");
  const languageNames = new Intl.DisplayNames([formatLocale], { type: "language" });
  const currencyNames = new Intl.DisplayNames([formatLocale], { type: "currency" });
  const safeName = (names: Intl.DisplayNames, code: string, fallback: string) => {
    try {
      return names.of(code) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const chooseLanguage = (code: string, nativeName: string, defaultCurrency: string | null) => {
    setMessage(t("customer.header.selector.languageChanged", { language: nativeName, currency: defaultCurrency ?? currency }));
    setLocale(code);
  };
  const chooseCurrency = (code: string) => {
    setMessage(t("customer.header.selector.currencyChanged", { currency: code }));
    setCurrency(code);
  };

  return (
    <Tab.Group>
      <Tab.List className="flex space-x-1 rounded-full bg-gray-100 dark:bg-slate-700 p-1">
        {[t("customer.header.menu.language"), t("customer.header.menu.currency")].map((category) => (
          <Tab
            key={category}
            className={({ selected }) =>
              classNames(
                "w-full rounded-full py-2 text-sm font-medium leading-5",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                selected
                  ? "bg-white text-gray-900 shadow dark:bg-slate-900 dark:text-white"
                  : "text-gray-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-900/40"
              )
            }
          >
            {category}
          </Tab>
        ))}
      </Tab.List>
      <Tab.Panels className="mt-4">
        <Tab.Panel className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          <div className="grid gap-1 sm:grid-cols-2">
            {locales.map((item) => (
              <button
                key={item.code}
                type="button"
                lang={item.code}
                aria-pressed={locale === item.code}
                disabled={switching}
                onClick={() => chooseLanguage(item.code, item.nativeName, item.defaultCurrency)}
                className={`${OPTION_CLASS} ${locale === item.code ? "bg-gray-100 dark:bg-gray-700" : "opacity-80"}`}
              >
                <span>
                  <span className="block text-sm font-medium">{item.nativeName}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{safeName(languageNames, item.code, item.displayName)}</span>
                </span>
                {locale === item.code && <CheckIcon className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Tab.Panel>
        <Tab.Panel className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          <div className="grid gap-1 sm:grid-cols-2">
            {currencies.map((item) => (
              <button
                key={item.code}
                type="button"
                aria-pressed={currency === item.code}
                disabled={switching}
                onClick={() => chooseCurrency(item.code)}
                className={`${OPTION_CLASS} ${currency === item.code ? "bg-gray-100 dark:bg-gray-700" : "opacity-80"}`}
              >
                <span className="flex items-center">
                  <BanknotesIcon className="w-[18px] h-[18px]" aria-hidden="true" />
                  <span className="ml-2">
                    <span className="block text-sm font-medium">{item.code}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{safeName(currencyNames, item.code, item.name)}</span>
                  </span>
                </span>
                {currency === item.code && <CheckIcon className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Tab.Panel>
      </Tab.Panels>
      <p className="mt-4 text-xs text-gray-600 dark:text-gray-300">{t("customer.header.selector.rateNote")}</p>
      <p role="status" aria-live="polite" className="mt-1 min-h-[1rem] text-xs font-medium text-primary-700 dark:text-primary-300">
        {message}
      </p>
    </Tab.Group>
  );
};

const LangDropdown: FC<LangDropdownProps> = ({
  panelClassName = "top-full right-0 max-w-sm w-96",
  className = "hidden md:flex",
}) => {
  const { t } = useI18n();
  return (
    <>
      <Popover className={`LangDropdown relative ${className}`}>
        {({ open }) => (
          <>
            <Popover.Button
              aria-label={t("customer.header.menu.languageCurrency")}
              className={`
                ${open ? "" : "text-opacity-80"}
             group self-center h-10 sm:h-12 px-3 py-1.5 inline-flex items-center text-sm text-gray-800 dark:text-neutral-200 font-medium hover:text-opacity-100 hover:bg-neutral-100 active:bg-neutral-200 dark:hover:bg-neutral-800 dark:active:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-full`}
            >
              <GlobeAltIcon className="w-5 h-5 opacity-80" aria-hidden="true" />
              <span className="mx-1" aria-hidden="true">/</span>
              <BanknotesIcon className="w-5 h-5 opacity-80" aria-hidden="true" />
              <ChevronDownIcon
                className={`${open ? "-rotate-180" : "text-opacity-70"}
                  ml-1 h-4 w-4  group-hover:text-opacity-80 transition ease-in-out duration-150`}
                aria-hidden="true"
              />
            </Popover.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-200"
              enterFrom="opacity-0 translate-y-1"
              enterTo="opacity-100 translate-y-0"
              leave="transition ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 translate-y-1"
            >
              <Popover.Panel className={`absolute z-20  ${panelClassName}`}>
                <div className="p-3 sm:p-6 rounded-2xl bg-white dark:bg-neutral-800 shadow-lg ring-1 ring-black ring-opacity-5">
                  <LangCurrencyTabs />
                </div>
              </Popover.Panel>
            </Transition>
          </>
        )}
      </Popover>
    </>
  );
};
export default LangDropdown;
