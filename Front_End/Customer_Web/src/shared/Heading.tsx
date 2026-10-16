import React, { HTMLAttributes, ReactNode } from "react";
import { Tpl } from "@/lib/i18n/Tpl";

/** Plain text goes through the template translation (shown as written when the pack has no entry); other nodes are shown as they are. */
const text = (node: ReactNode) => (typeof node === "string" ? <Tpl text={node} quiet /> : node);

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  fontClass?: string;
  desc?: ReactNode;
  isCenter?: boolean;
}

const Heading: React.FC<HeadingProps> = ({
  children,
  desc = "Discover the most outstanding articles in all topics of life. ",
  className = "mb-10 text-neutral-900 dark:text-neutral-50",
  isCenter = false,
  ...args
}) => {
  return (
    <div className={`nc-Section-Heading relative ${className}`}>
      <div
        className={
          isCenter ? "text-center w-full max-w-2xl mx-auto mb-4" : "max-w-2xl"
        }
      >
        <h2 className={`text-3xl md:text-4xl font-semibold`} {...args}>
          {text(children) || <Tpl text="Section Heading" quiet />}
        </h2>
        {desc && (
          <span className="block mt-2 md:mt-3 font-normal text-base sm:text-lg text-neutral-500 dark:text-neutral-400">
            {text(desc)}
          </span>
        )}
      </div>
    </div>
  );
};

export default Heading;
