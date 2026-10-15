"use client";

import React, { useEffect, useState } from "react";
import { FC } from "react";
import Slider from "rc-slider";
import convertNumbThousand from "@/utils/convertNumbThousand";

import { useT } from "@/lib/i18n/I18nProvider";
import DemoPrice from "@/components/DemoPrice";
export interface PriceRangeInputProps {
  onChange?: (e: number[]) => void;
  defaultValue?: number[];
}

const PriceRangeInput: FC<PriceRangeInputProps> = ({
  onChange,
  defaultValue,
}) => {
  const t = useT();
  const [rangePrices, setRangePrices] = useState(
    defaultValue || [100000, 4000000]
  );

  useEffect(() => {
    if (!defaultValue) return;
    setRangePrices(defaultValue);
  }, [defaultValue]);

  return (
    <div className="p-5">
      <span className="block font-semibold text-xl sm:text-2xl">{t("customer.heroSearchForm2Mobile.realEstateSearchForm.priceRangeInput.rangePrice")}</span>
      <div className="relative flex flex-col space-y-8 mt-7">
        <Slider
          range
          className="text-red-400"
          min={10000}
          max={10000000}
          defaultValue={[rangePrices[0], rangePrices[1]]}
          allowCross={false}
          step={1000}
          onChange={(e) => {
            setRangePrices(e as number[]);
            onChange && onChange(e as number[]);
          }}
        />

        <div className="flex justify-between space-x-3">
          <div>
            <label
              htmlFor="minPrice"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >{t("customer.common.minPrice")}</label>
            <div className="mt-1 relative rounded-md">
              <div className="block w-full px-4 py-2 sm:text-sm border border-neutral-200 dark:border-neutral-500 rounded-full text-neutral-900 dark:text-neutral-200"><DemoPrice value={`$${rangePrices[0]}`} /></div>
            </div>
          </div>
          <div>
            <label
              htmlFor="maxPrice"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >{t("customer.common.maxPrice")}</label>
            <div className="mt-1 relative rounded-md">
              <div className="block w-full px-4 py-2 sm:text-sm border border-neutral-200 dark:border-neutral-500 rounded-full text-neutral-900 dark:text-neutral-200"><DemoPrice value={`$${rangePrices[1]}`} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PriceRangeInput;
