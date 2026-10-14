import React, { FC } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import Heading from "@/shared/Heading";
import ButtonSecondary from "@/shared/ButtonSecondary";
import HomeSlider from "./HomeSlider";
import { travelMediaUrl } from "@/data/heroSlides";
import { TravelPost } from "@/data/travelPosts";
import { blogCategoryPath, homeDestinations, postPath } from "@/lib/homepageContent";

/** One destination: its photograph and name, linking to its own article. No count, rating or price is shown. */
export const DestinationCard: FC<{ post: TravelPost }> = ({ post }) => (
  <Link
    href={postPath(post.slug) as Route}
    className="nc-DestinationCard group block overflow-hidden rounded-3xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
  >
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl">
      <Image
        src={travelMediaUrl(post.cover)}
        alt={post.coverAlt}
        width={1200}
        height={800}
        sizes="(min-width: 1024px) 24vw, (min-width: 640px) 40vw, 70vw"
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        <h3 className="text-lg font-semibold text-white">{post.shortTitle ?? post.title}</h3>
        <span className="mt-1 block text-sm text-white/85">Đọc cẩm nang</span>
      </div>
    </div>
  </Link>
);

/**
 * CUST-WEB-001-CP08a-C2: "Điểm đến nổi bật", the template's "Suggestions for discovery" composition over the
 * blog registry: every card is a destination guide with its own page, and "Xem thêm điểm đến" is the real
 * `/blog?category=diem-den-noi-bat` filter.
 */
const HomeDestinationSection: FC = () => {
  const destinations = homeDestinations();
  return (
    <section aria-labelledby="destinations-heading" className="nc-HomeDestinationSection relative">
      <Heading id="destinations-heading" desc="Những nơi nên biết khi ở Đà Nẵng và vùng lân cận, kèm nguồn tham khảo.">
        Điểm đến nổi bật
      </Heading>
      <HomeSlider label="Điểm đến nổi bật">
        {destinations.map((post) => (
          <li key={post.id} className="w-[70%] flex-shrink-0 snap-start sm:w-[40%] lg:w-[24%]">
            <DestinationCard post={post} />
          </li>
        ))}
      </HomeSlider>
      <div className="mt-6 flex justify-center">
        <ButtonSecondary href={blogCategoryPath("diem-den-noi-bat") as Route} className="!leading-none">
          <div className="flex items-center justify-center">
            <span>Xem thêm điểm đến</span>
            <ArrowRightIcon aria-hidden="true" className="ml-3 h-5 w-5" />
          </div>
        </ButtonSecondary>
      </div>
    </section>
  );
};

export default HomeDestinationSection;
