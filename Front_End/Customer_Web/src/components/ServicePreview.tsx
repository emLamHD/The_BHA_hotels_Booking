import React, { FC, ReactNode } from "react";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's service/marketing sections (categories, features,
 * how-it-works, authors, videos, testimonials …) stay on the home page as layout previews. None of
 * them has a backend yet, so the wrapper makes the whole block inert: nothing in it can be clicked,
 * focused or submitted, no request is sent and no checkout, login or fake success is reachable.
 * The visible pill says what the block is.
 */
export interface ServicePreviewProps {
  children: ReactNode;
  className?: string;
  /** Short note shown above the block. */
  label?: string;
  /** Anchor id for links into the block. */
  id?: string;
}

const INERT = { inert: "" } as Record<string, string>;

const ServicePreview: FC<ServicePreviewProps> = ({
  children,
  className = "",
  label = "Dịch vụ đang được phát triển · Nội dung mẫu",
  id,
}) => (
  <section id={id} className={`nc-ServicePreview relative scroll-mt-28 ${className}`}>
    <div className="mb-4 flex justify-end">
      <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700">
        {label}
      </span>
    </div>
    <div className="pointer-events-none select-none" {...INERT}>
      {children}
    </div>
  </section>
);

export default ServicePreview;
