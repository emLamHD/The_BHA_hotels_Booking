import React, { FC, Suspense } from "react";
import SectionGridFilterCard from "../SectionGridFilterCard";

export interface ListingStayPageProps {}

// The page reads the URL's search on the client; Suspense keeps the static shell buildable.
const ListingStayPage: FC<ListingStayPageProps> = () => {
  return (
    <Suspense
      fallback={
        <div className="container pt-10 pb-24 lg:pt-16 lg:pb-28">
          <p role="status" className="text-neutral-500">
            Đang tải…
          </p>
        </div>
      }
    >
      <SectionGridFilterCard className="container pt-10 pb-24 lg:pt-16 lg:pb-28" />
    </Suspense>
  );
};

export default ListingStayPage;
