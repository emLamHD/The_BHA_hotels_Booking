import { MegamenuItem, NavItemType } from "@/shared/Navigation/NavigationItem";
import ncNanoId from "@/utils/ncNanoId";
import { Route } from "@/routers/types";
import __megamenu from "./jsons/__megamenu.json";

const megaMenuDemo: MegamenuItem[] = [
  {
    id: ncNanoId(),
    image:
      "https://images.pexels.com/photos/1591373/pexels-photo-1591373.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Company",
    items: __megamenu.map((i) => ({
      id: ncNanoId(),
      href: "/",
      name: i.Company,
    })),
  },
  {
    id: ncNanoId(),
    image:
      "https://images.pexels.com/photos/2662116/pexels-photo-2662116.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "App Name",
    items: __megamenu.map((i) => ({
      id: ncNanoId(),
      href: "/",
      name: i.AppName,
    })),
  },
  {
    id: ncNanoId(),
    image:
      "https://images.pexels.com/photos/5059013/pexels-photo-5059013.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "City",
    items: __megamenu.map((i) => ({
      id: ncNanoId(),
      href: "/",
      name: i.City,
    })),
  },
  {
    id: ncNanoId(),
    image:
      "https://images.pexels.com/photos/5159141/pexels-photo-5159141.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Contruction",
    items: __megamenu.map((i) => ({
      id: ncNanoId(),
      href: "/",
      name: i.Contruction,
    })),
  },
  {
    id: ncNanoId(),
    image:
      "https://images.pexels.com/photos/7473041/pexels-photo-7473041.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Country",
    items: __megamenu.map((i) => ({
      id: ncNanoId(),
      href: "/",
      name: i.Country,
    })),
  },
];

const demoChildMenus: NavItemType[] = [
  {
    id: ncNanoId(),
    href: "/",
    name: "Online booking",
  },
  {
    id: ncNanoId(),
    href: "/home-2",
    name: "Real estate",
    isNew: true,
  },
  {
    id: ncNanoId(),
    href: "/home-3",
    name: "Home 3",
    isNew: true,
  },
];

const otherPageChildMenus: NavItemType[] = [
  // CUST-WEB-001-CP08a-C2: `/blog` is the real travel blog now, and the template's single article route
  // (`/blog/single`) is not an article any more, so it is no longer offered.
  { id: ncNanoId(), href: "/blog", name: "Blog" },
  { id: ncNanoId(), href: "/about", name: "About" },
  { id: ncNanoId(), href: "/contact", name: "Contact us" },
  { id: ncNanoId(), href: "/login", name: "Login" },
  { id: ncNanoId(), href: "/signup", name: "Signup" },
];

const templatesChildrenMenus: NavItemType[] = [
  {
    id: ncNanoId(),
    href: "/add-listing/1" as Route,
    name: "Add listing",
    type: "dropdown",
    children: [
      {
        id: ncNanoId(),
        href: "/add-listing/1" as Route,
        name: "Add listing 1",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/2" as Route,
        name: "Add listing 2",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/3" as Route,
        name: "Add listing 3",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/4" as Route,
        name: "Add listing 4",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/5" as Route,
        name: "Add listing 5",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/6" as Route,
        name: "Add listing 6",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/7" as Route,
        name: "Add listing 7",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/8" as Route,
        name: "Add listing 8",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/9" as Route,
        name: "Add listing 9",
      },
      {
        id: ncNanoId(),
        href: "/add-listing/10" as Route,
        name: "Add listing 10",
      },
    ],
  },
  //
  { id: ncNanoId(), href: "/checkout", name: "Checkout" },
  { id: ncNanoId(), href: "/pay-done", name: "Pay done" },
  //
  { id: ncNanoId(), href: "/author", name: "Author page" },
  { id: ncNanoId(), href: "/account", name: "Account page" },
  //
  {
    id: ncNanoId(),
    href: "/subscription",
    name: "Subscription",
  },
];

export const NAVIGATION_DEMO: NavItemType[] = [
  {
    id: ncNanoId(),
    href: "/",
    name: "Home",
    type: "dropdown",
    children: demoChildMenus,
    isNew: true,
  },
  {
    id: ncNanoId(),
    href: "/",
    name: "Five columns",
    type: "megaMenu",
    megaMenu: megaMenuDemo,
  },
  {
    id: ncNanoId(),
    href: "/listing-stay",
    name: "Listing Page",
    type: "dropdown",
    children: [
      {
        id: ncNanoId(),
        href: "/listing-stay",
        name: "Stay listings",
        type: "dropdown",
        children: [
          { id: ncNanoId(), href: "/listing-stay", name: "Stay page" },
          {
            id: ncNanoId(),
            href: "/listing-stay-map",
            name: "Stay page (map)",
          },
          { id: ncNanoId(), href: "/listing-stay-detail", name: "Stay Detail" },
        ],
      },

      //
      {
        id: ncNanoId(),
        href: "/listing-experiences",
        name: "Experiences listings",
        type: "dropdown",
        children: [
          {
            id: ncNanoId(),
            href: "/listing-experiences",
            name: "Experiences page",
          },
          {
            id: ncNanoId(),
            href: "/listing-experiences-map",
            name: "Experiences page (map)",
          },
          {
            id: ncNanoId(),
            href: "/listing-experiences-detail",
            name: "Experiences Detail",
          },
        ],
      },

      //
      {
        id: ncNanoId(),
        href: "/listing-car",
        name: "Cars listings",
        type: "dropdown",
        children: [
          { id: ncNanoId(), href: "/listing-car", name: "Cars page" },
          { id: ncNanoId(), href: "/listing-car-map", name: "Cars page (map)" },
          { id: ncNanoId(), href: "/listing-car-detail", name: "Car Detail" },
        ],
      },

      //
      {
        id: ncNanoId(),
        href: "/listing-real-estate",
        name: "Real Estate Listings",
        type: "dropdown",
        children: [
          {
            id: ncNanoId(),
            href: "/listing-real-estate",
            name: "Real Estate Listings",
          },
          {
            id: ncNanoId(),
            href: "/listing-real-estate-map",
            name: "Real Estate Maps",
          },
        ],
      },
      //
      {
        id: ncNanoId(),
        href: "/listing-flights",
        name: "Flights listings",
      },
    ],
  },
  {
    id: ncNanoId(),
    href: "/author",
    name: "Templates",
    type: "dropdown",
    children: templatesChildrenMenus,
  },

  {
    id: ncNanoId(),
    href: "/blog",
    name: "Other pages",
    type: "dropdown",
    children: otherPageChildMenus,
  },
];

export const NAVIGATION_DEMO_2: NavItemType[] = [
  {
    id: ncNanoId(),
    href: "/",
    name: "Home",
    type: "dropdown",
    children: demoChildMenus,
    isNew: true,
  },

  //
  {
    id: ncNanoId(),
    href: "/listing-stay",
    name: "Listing pages",
    children: [
      { id: ncNanoId(), href: "/listing-stay", name: "Stay listings" },
      {
        id: ncNanoId(),
        href: "/listing-stay-map",
        name: "Stay listings (map)",
      },
      { id: ncNanoId(), href: "/listing-stay-detail", name: "Stay detail" },

      //
      {
        id: ncNanoId(),
        href: "/listing-experiences",
        name: "Experiences listings",
      },
      {
        id: ncNanoId(),
        href: "/listing-experiences-map",
        name: "Experiences (map)",
      },
      {
        id: ncNanoId(),
        href: "/listing-experiences-detail",
        name: "Experiences detail",
      },
    ],
  },
  {
    id: ncNanoId(),
    href: "/listing-car",
    name: "Listing pages",
    children: [
      { id: ncNanoId(), href: "/listing-car", name: "Cars listings" },
      { id: ncNanoId(), href: "/listing-car-map", name: "Cars listings (map)" },
      { id: ncNanoId(), href: "/listing-car-detail", name: "Car detail" },

      //
      {
        id: ncNanoId(),
        href: "/listing-real-estate",
        name: "Real estate listings",
      },
      {
        id: ncNanoId(),
        href: "/listing-real-estate-map",
        name: "Real estate (map)",
      },
      //
      {
        id: ncNanoId(),
        href: "/listing-flights",
        name: "Flights listings",
      },
    ],
  },

  //
  {
    id: ncNanoId(),
    href: "/author",
    name: "Templates",
    type: "dropdown",
    children: templatesChildrenMenus,
  },

  //
  {
    id: ncNanoId(),
    href: "/blog",
    name: "Other pages",
    type: "dropdown",
    children: otherPageChildMenus,
  },
];

/**
 * CUST-WEB-001-CP08a-C2: the Blog dropdown of the header and the mobile menu. Every entry is a real filter of
 * `/blog` (see `lib/homepageContent.resolveBlogFilter`).
 */
export const BLOG_NAV_ITEMS: NavItemType[] = [
  { id: "bha-blog-all", href: "/blog" as Route, name: "Tất cả bài viết" },
  { id: "bha-blog-destinations", href: "/blog?category=diem-den-noi-bat" as Route, name: "Điểm đến nổi bật" },
  { id: "bha-blog-news", href: "/blog?category=tin-du-lich" as Route, name: "Tin du lịch" },
];

/**
 * The mobile menu's tree (the template's `NAVIGATION_DEMO` shape): the public pages, the service menu with
 * its demo status, and the template's own sample pages under "Giao diện mẫu".
 */
export const NAVIGATION_BHA: NavItemType[] = [
  { id: "bha-nav-riverside", href: "/riverside" as Route, name: "Riverside" },
  { id: "bha-nav-offers", href: "/offers" as Route, name: "Ưu đãi" },
  {
    id: "bha-nav-blog",
    href: "/blog" as Route,
    name: "Blog",
    type: "dropdown",
    children: BLOG_NAV_ITEMS,
  },
  {
    id: "bha-nav-services",
    href: "/listing-stay" as Route,
    name: "Dịch vụ",
    type: "dropdown",
    children: [
      { id: "bha-svc-stays", href: "/listing-stay" as Route, name: "Lưu trú — đặt phòng The BHA Riverside" },
      { id: "bha-svc-estate", href: "/listing-real-estate" as Route, name: "Bất động sản (trang mẫu)" },
      { id: "bha-svc-cars", href: "/listing-car" as Route, name: "Thuê xe (trang mẫu)" },
      { id: "bha-svc-exp", href: "/listing-experiences" as Route, name: "Trải nghiệm (trang mẫu)" },
      { id: "bha-svc-flights", href: "/listing-flights" as Route, name: "Chuyến bay (trang mẫu)" },
    ],
  },
  {
    id: "bha-nav-templates",
    href: "/author" as Route,
    name: "Giao diện mẫu",
    type: "dropdown",
    children: NAVIGATION_DEMO.filter((item) => item.name !== "Home" && item.type !== "megaMenu"),
  },
];
