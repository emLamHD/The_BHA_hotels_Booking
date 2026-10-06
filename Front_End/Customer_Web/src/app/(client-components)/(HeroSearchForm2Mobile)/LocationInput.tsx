"use client";

import { MapPinIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import React, { useState, useEffect, useRef, FC } from "react";

interface Props {
  onClick?: () => void;
  onChange?: (value: string) => void;
  className?: string;
  defaultValue?: string;
  headingText?: string;
  /** CP02-C3: a fixed list (The BHA House / Riverside / Villa); no free text. */
  options?: string[];
}

const LocationInput: FC<Props> = ({
  onChange = () => {},
  className = "",
  defaultValue = "United States",
  headingText = "Where to?",
  options,
}) => {
  const [value, setValue] = useState("");
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const handleSelectLocation = (item: string) => {
    // DO NOT REMOVE SETTIMEOUT FUNC
    setTimeout(() => {
      setValue(item);
      onChange && onChange(item);
    }, 0);
  };

  const renderSearchValues = ({
    heading,
    items,
  }: {
    heading: string;
    items: string[];
  }) => {
    return (
      <>
        <p className="block font-semibold text-base">
          {heading || "Destinations"}
        </p>
        <div className="mt-3">
          {items.map((item) => {
            return (
              <div
                className="py-2 mb-1 flex items-center space-x-3 text-sm"
                onClick={() => handleSelectLocation(item)}
                key={item}
              >
                <MapPinIcon className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
                <span className="">{item}</span>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  if (options) {
    return (
      <div className={`${className}`} ref={containerRef}>
        <div className="p-5">
          <span className="block font-semibold text-xl sm:text-2xl">{headingText}</span>
          <ul className="mt-5" role="listbox" aria-label={headingText}>
            {options.map((item) => (
              <li
                key={item}
                role="option"
                aria-selected={item === defaultValue}
                tabIndex={0}
                className={`py-3 px-2 mb-1 flex items-center space-x-3 text-sm rounded-xl cursor-pointer focus:outline-none focus-visible:bg-neutral-100 ${
                  item === defaultValue ? "bg-neutral-100 dark:bg-neutral-700 font-semibold" : ""
                }`}
                onClick={() => handleSelectLocation(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleSelectLocation(item);
                  }
                }}
              >
                <MapPinIcon className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className={`${className}`} ref={containerRef}>
      <div className="p-5">
        <span className="block font-semibold text-xl sm:text-2xl">
          {headingText}
        </span>
        <div className="relative mt-5">
          <input
            className={`block w-full bg-transparent border px-4 py-3 pr-12 border-neutral-900 dark:border-neutral-200 rounded-xl focus:ring-0 focus:outline-none text-base leading-none placeholder-neutral-500 dark:placeholder-neutral-300 truncate font-bold placeholder:truncate`}
            placeholder={"Search destinations"}
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            ref={inputRef}
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <MagnifyingGlassIcon className="w-5 h-5 text-neutral-700 dark:text-neutral-400" />
          </span>
        </div>
        <div className="mt-7">
          {value
            ? renderSearchValues({
                heading: "Locations",
                items: [
                  "Afghanistan",
                  "Albania",
                  "Algeria",
                  "American Samao",
                  "Andorra",
                ],
              })
            : renderSearchValues({
                heading: "Popular destinations",
                items: [
                  "Australia",
                  "Canada",
                  "Germany",
                  "United Kingdom",
                  "United Arab Emirates",
                ],
              })}
        </div>
      </div>
    </div>
  );
};

export default LocationInput;
