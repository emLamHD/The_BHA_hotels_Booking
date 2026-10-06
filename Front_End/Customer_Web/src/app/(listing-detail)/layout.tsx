import React, { ReactNode } from "react";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's detail-page frame: the page content in a container.
 * The gallery, the booking panel and the mobile booking bar are rendered by the room page itself,
 * from the API's data for the room being viewed; this layout holds no template photos, no second
 * form and no extra marketing sections.
 */
const DetailLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className="ListingDetailPage">
      <div className="container ListingDetailPage__content">{children}</div>
    </div>
  );
};

export default DetailLayout;
