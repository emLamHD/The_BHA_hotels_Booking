import React, { FC, ReactNode } from "react";
import { DEMO_STAY_LISTINGS } from "@/data/listings";
import { StayDataType } from "@/data/types";
import ButtonPrimary from "@/shared/ButtonPrimary";
import HeaderFilter from "./HeaderFilter";
import StayCard from "./StayCard";
import StayCard2 from "./StayCard2";

// OTHER DEMO WILL PASS PROPS
const DEMO_DATA: StayDataType[] = DEMO_STAY_LISTINGS.filter((_, i) => i < 8);

//
export interface SectionGridFeaturePlacesProps {
  stayListings?: StayDataType[];
  gridClass?: string;
  heading?: ReactNode;
  subHeading?: ReactNode;
  headingIsCenter?: boolean;
  tabs?: string[];
  cardType?: "card1" | "card2";
  /** Controlled tab selection; without it the first tab is shown. */
  tabActive?: string;
  onClickTab?: (tab: string) => void;
  /** Replaces the demo grid (and its "Show me more" button) with real content for the active tab. */
  children?: ReactNode;
  /** Anchor id for links into the section. */
  id?: string;
}

const SectionGridFeaturePlaces: FC<SectionGridFeaturePlacesProps> = ({
  stayListings = DEMO_DATA,
  gridClass = "",
  heading = "Featured places to stay",
  subHeading = "Popular places to stay that The BHA recommends for you",
  headingIsCenter,
  tabs = ["New York", "Tokyo", "Paris", "London"],
  cardType = "card2",
  tabActive,
  onClickTab,
  children,
  id,
}) => {
  const renderCard = (stay: StayDataType) => {
    let CardName = StayCard;
    switch (cardType) {
      case "card1":
        CardName = StayCard;
        break;
      case "card2":
        CardName = StayCard2;
        break;

      default:
        CardName = StayCard;
    }

    return <CardName key={stay.id} data={stay} />;
  };

  return (
    <div id={id} className="nc-SectionGridFeaturePlaces relative scroll-mt-28">
      <HeaderFilter
        tabActive={tabActive ?? tabs[0]}
        subHeading={subHeading}
        tabs={tabs}
        heading={heading}
        onClickTab={onClickTab}
      />
      {children !== undefined ? (
        children
      ) : (
        <>
          <div
            className={`grid gap-6 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${gridClass}`}
          >
            {stayListings.map((stay) => renderCard(stay))}
          </div>
          <div className="flex mt-16 justify-center items-center">
            <ButtonPrimary loading>Show me more</ButtonPrimary>
          </div>
        </>
      )}
    </div>
  );
};

export default SectionGridFeaturePlaces;
