import { StarIcon } from "@heroicons/react/24/solid";
import React, { FC } from "react";

export interface StartRatingProps {
  className?: string;
  point?: number;
  reviewCount?: number;
  /** CP02-C3: the 4.5 (112) figure is template sample data; say so in text, not only in a tooltip. */
  sample?: "short" | "full";
}

const StartRating: FC<StartRatingProps> = ({
  className = "",
  point = 4.5,
  reviewCount = 112,
  sample,
}) => {
  return (
    <div
      className={`nc-StartRating flex items-center space-x-1 text-sm  ${className}`}
      data-nc-id="StartRating"
    >
      <div className="pb-[2px]">
        <StarIcon className="w-[18px] h-[18px] text-orange-500" />
      </div>
      <span className="font-medium ">{point}</span>
      <span className="text-neutral-500 dark:text-neutral-400">
        ({reviewCount})
      </span>
      {sample && (
        <span
          className="text-xs whitespace-nowrap text-neutral-500 dark:text-neutral-400"
          title="Đánh giá mẫu (không phải đánh giá của khách)"
        >
          {sample === "full" ? "· Đánh giá mẫu" : "(mẫu)"}
        </span>
      )}
    </div>
  );
};

export default StartRating;
