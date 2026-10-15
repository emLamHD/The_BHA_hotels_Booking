"use client";

import { Popover, Tab, Transition } from "@headlessui/react";
import {
  BanknotesIcon,
  GlobeAltIcon,
  ChevronDownIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { FC, Fragment, useState } from "react";
import { headerCurrency } from "./CurrencyDropdown";

export const headerLanguage = [
  {
    id: "vi",
    name: "Tiếng Việt",
    description: "Việt Nam",
    active: true,
  },
  {
    id: "en",
    name: "English",
    description: "United States",
  },
  {
    id: "fr",
    name: "Français",
    description: "France",
  },
];

export const LANG_CURRENCY_NOTE =
  "Bản demo: lựa chọn này chưa được áp dụng. Trang vẫn hiển thị tiếng Việt và giá bằng VND.";

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
 * CUST-WEB-001-CP08a-C2: the template's Language / Currency tabs as a UI preview. The options are buttons
 * (not `href="##"` links, which would navigate to `/#`); picking one only moves the check mark and says, in a
 * live region, that nothing is applied. It keeps no state anywhere (no storage, no URL, no provider), changes
 * no price or request, and a reload shows the defaults again. Used by the header's popover and, inline, by
 * the mobile menu.
 */
export const LangCurrencyTabs: FC = () => {
  const [language, setLanguage] = useState(headerLanguage[0].id);
  const [currency, setCurrency] = useState(headerCurrency[0].id);
  const [message, setMessage] = useState("");
  const choose = (kind: "language" | "currency", id: string, name: string) => {
    if (kind === "language") setLanguage(id);
    else setCurrency(id);
    setMessage(`Đã chọn ${name} — chưa áp dụng.`);
  };

  return (
    <Tab.Group>
      <Tab.List className="flex space-x-1 rounded-full bg-gray-100 dark:bg-slate-700 p-1">
        {["Ngôn ngữ", "Tiền tệ"].map((category) => (
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
            {headerLanguage.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={language === item.id}
                onClick={() => choose("language", item.id, item.name)}
                className={`${OPTION_CLASS} ${language === item.id ? "bg-gray-100 dark:bg-gray-700" : "opacity-80"}`}
              >
                <span>
                  <span className="block text-sm font-medium">{item.name}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{item.description}</span>
                </span>
                {language === item.id && <CheckIcon className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Tab.Panel>
        <Tab.Panel className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          <div className="grid gap-1 sm:grid-cols-2">
            {headerCurrency.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={currency === item.id}
                onClick={() => choose("currency", item.id, item.name)}
                className={`${OPTION_CLASS} ${currency === item.id ? "bg-gray-100 dark:bg-gray-700" : "opacity-80"}`}
              >
                <span className="flex items-center">
                  <item.icon className="w-[18px] h-[18px]" aria-hidden="true" />
                  <span className="ml-2">
                    <span className="block text-sm font-medium">{item.name}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{item.description}</span>
                  </span>
                </span>
                {currency === item.id && <CheckIcon className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Tab.Panel>
      </Tab.Panels>
      <p className="mt-4 text-xs text-gray-600 dark:text-gray-300">{LANG_CURRENCY_NOTE}</p>
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
  return (
    <>
      <Popover className={`LangDropdown relative ${className}`}>
        {({ open }) => (
          <>
            <Popover.Button
              aria-label="Ngôn ngữ và tiền tệ"
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
