"use client";

import React, { Fragment, FC } from "react";
import { Popover, Transition } from "@headlessui/react";
import NcInputNumber from "@/components/NcInputNumber";
import { UserPlusIcon } from "@heroicons/react/24/outline";

export interface GuestsInputProps {
  className?: string;
  adults: number;
  children: number;
  rooms: number;
  onChange: (patch: { adults?: number; children?: number; rooms?: number }) => void;
  disabled?: boolean;
}

/**
 * The template's sidebar guest field (popover with +/- counters), controlled by the booking panel's
 * draft. The booking API counts adults, children and rooms, so those are the counters; the template's
 * "Infants" counter is not offered (there is no infant count to send) and the popover says so.
 */
const GuestsInput: FC<GuestsInputProps> = ({ className = "flex-1", adults, children, rooms, onChange, disabled }) => {
  const totalGuests = adults + children;

  return (
    <Popover className={`flex relative ${className}`}>
      {({ open }) => (
        <>
          <div
            className={`flex-1 flex items-center focus:outline-none rounded-b-3xl ${
              open ? "shadow-lg" : ""
            }`}
          >
            <Popover.Button
              disabled={disabled}
              className={`relative z-10 flex-1 flex text-left items-center p-3 space-x-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6000 rounded-b-3xl disabled:opacity-60`}
            >
              <div className="text-neutral-300 dark:text-neutral-400">
                <UserPlusIcon className="w-5 h-5 lg:w-7 lg:h-7" />
              </div>
              <div className="flex-grow">
                <span className="block xl:text-lg font-semibold">
                  {totalGuests} Guests
                </span>
                <span className="block mt-1 text-sm text-neutral-400 leading-none font-light">
                  {rooms} {rooms === 1 ? "room" : "rooms"}
                </span>
              </div>
            </Popover.Button>
          </div>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel className="absolute right-0 z-10 w-full sm:min-w-[340px] max-w-sm bg-white dark:bg-neutral-800 top-full mt-3 py-5 sm:py-6 px-4 sm:px-8 rounded-3xl shadow-xl ring-1 ring-black ring-opacity-5 ">
              <NcInputNumber
                className="w-full"
                value={adults}
                onChange={(value) => onChange({ adults: value })}
                max={10}
                min={1}
                label="Adults"
                desc="Ages 13 or above"
              />
              <NcInputNumber
                className="w-full mt-6"
                value={children}
                onChange={(value) => onChange({ children: value })}
                max={4}
                label="Children"
                desc="Ages 2–12"
              />
              <NcInputNumber
                className="w-full mt-6"
                value={rooms}
                onChange={(value) => onChange({ rooms: value })}
                max={10}
                min={1}
                label="Rooms"
                desc="Number of apartments"
              />
              <p className="mt-5 text-xs text-neutral-500 dark:text-neutral-400">
                Trẻ dưới 2 tuổi chưa có lựa chọn riêng khi đặt phòng.
              </p>
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default GuestsInput;
