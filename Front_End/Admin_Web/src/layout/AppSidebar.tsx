"use client";
import React, { useEffect, useRef, useState,useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSidebar } from "../context/SidebarContext";
import {
  BoxCubeIcon,
  DollarLineIcon,
  CalenderIcon,
  ChevronDownIcon,
  GridIcon,
  HorizontaLDots,
  ListIcon,
  PageIcon,
  PieChartIcon,
  PlugInIcon,
  TableIcon,
  UserCircleIcon,
} from "../icons/index";
import SidebarWidget from "./SidebarWidget";
import { UnseenBadge } from "./UnseenBadge";
import { useMenuUnseen } from "../components/website/NewsletterBadgeProvider";
import { ADMIN_MENU, type AdminMenuKey } from "../lib/adminMenus";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  /** `menu`: the registry key whose unseen number the entry shows (BHA-ADMIN-BADGE-001-PR04). Template entries have none, so they never carry a badge. */
  menu?: AdminMenuKey;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean; menu?: AdminMenuKey }[];
};

/** Name, path and badge key of an entry come from the registry, so the sidebar and the provider cannot disagree on what a menu is. */
const menuEntry = (key: AdminMenuKey) => ({ name: ADMIN_MENU[key].label, path: ADMIN_MENU[key].path, menu: key });

const navItems: NavItem[] = [
  { icon: <BoxCubeIcon />, ...menuEntry("catalog") },
  // BHA-BOOKING-PROMOTIONS-001: a link is not authorization; the page asks the server (a Manager of the Property).
  { icon: <DollarLineIcon />, ...menuEntry("promotions") },
  {
    icon: <GridIcon />,
    name: "Dashboard",
    subItems: [{ name: "Ecommerce", path: "/", pro: false }],
  },
  { icon: <CalenderIcon />, ...menuEntry("calendar") },
  {
    icon: <UserCircleIcon />,
    name: "User Profile",
    path: "/profile",
  },
  // CUST-WEB-HEADER-001-CP02: the website settings. A link is not authorization: each page asks the server.
  {
    icon: <PlugInIcon />,
    name: "Website",
    subItems: [
      menuEntry("website-languages"),
      menuEntry("website-translations"),
      menuEntry("website-currencies"),
      menuEntry("website-menus"),
      menuEntry("website-hero"),
      menuEntry("website-social"),
      // BHA-NEWSLETTER-001: the newsletter requests. The page asks the server for WebsiteSettingsManage.
      menuEntry("newsletter"),
      // BHA-NEWSLETTER-002: the Gmail account the confirmation e-mails are sent from.
      menuEntry("newsletter-sender"),
      // BHA-BLOG-001-CP03: the Blog. Flat entries (the menu has one level); each page asks the server for BlogEdit or BlogPublish.
      menuEntry("blog-posts"),
      menuEntry("blog-categories"),
      menuEntry("blog-media"),
      menuEntry("blog-settings"),
    ],
  },

  {
    name: "Forms",
    icon: <ListIcon />,
    subItems: [{ name: "Form Elements", path: "/form-elements", pro: false }],
  },
  {
    name: "Tables",
    icon: <TableIcon />,
    subItems: [{ name: "Basic Tables", path: "/basic-tables", pro: false }],
  },
  {
    name: "Pages",
    icon: <PageIcon />,
    subItems: [
      { name: "Blank Page", path: "/blank", pro: false },
      { name: "404 Error", path: "/error-404", pro: false },
    ],
  },
];

const othersItems: NavItem[] = [
  {
    icon: <PieChartIcon />,
    name: "Charts",
    subItems: [
      { name: "Line Chart", path: "/line-chart", pro: false },
      { name: "Bar Chart", path: "/bar-chart", pro: false },
    ],
  },
  {
    icon: <BoxCubeIcon />,
    name: "UI Elements",
    subItems: [
      { name: "Alerts", path: "/alerts", pro: false },
      { name: "Avatar", path: "/avatars", pro: false },
      { name: "Badge", path: "/badge", pro: false },
      { name: "Buttons", path: "/buttons", pro: false },
      { name: "Images", path: "/images", pro: false },
      { name: "Videos", path: "/videos", pro: false },
    ],
  },
  {
    icon: <PlugInIcon />,
    name: "Authentication",
    subItems: [
      { name: "Sign In", path: "/signin", pro: false },
      { name: "Sign Up", path: "/signup", pro: false },
    ],
  },
];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();
  // BHA-ADMIN-BADGE-001-PR04: a number only for a menu the API returned with a count above 0. No provider (LocalGate), or a menu the Staff may not read, shows nothing.
  const unseen = useMenuUnseen();
  // The submenu is DRAWN only while the sidebar is expanded, hovered or the mobile drawer is open. `openSubmenu` says which one is open, not whether it is on screen.
  const submenuDrawn = isExpanded || isHovered || isMobileOpen;
  const unseenOf = (key: AdminMenuKey) => unseen[key]?.count ?? 0;
  const badgeLabel = (name: string) => `thay đổi chưa xem ở ${name}`;

  const renderMenuItems = (
    navItems: NavItem[],
    menuType: "main" | "others"
  ) => (
    <ul className="flex flex-col gap-4">
      {navItems.map((nav, index) => {
        // A parent shows the REAL sum of its children's numbers (formatted only after summing). While its open submenu is drawn the children show their own, so the parent stays quiet.
        const childrenUnseen = (nav.subItems ?? []).reduce((sum, subItem) => sum + (subItem.menu ? unseenOf(subItem.menu) : 0), 0);
        const parentOpen = openSubmenu?.type === menuType && openSubmenu?.index === index;
        const parentUnseen = parentOpen && submenuDrawn ? 0 : childrenUnseen;
        return (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group  ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={`relative ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
                {/* Collapsed (no room for the text): the sum sits on the icon. Opening or collapsing never marks anything seen. */}
                {!submenuDrawn && <UnseenBadge corner count={parentUnseen} testId="menu-unseen-badge-parent" label={badgeLabel(nav.name)} />}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className={`menu-item-text`}>{nav.name}</span>
              )}
              {submenuDrawn && <UnseenBadge count={parentUnseen} testId="menu-unseen-badge-parent" label={badgeLabel(nav.name)} />}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIcon
                  className={`${parentUnseen > 0 ? "ml-2" : "ml-auto"} w-5 h-5 transition-transform duration-200  ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                href={nav.path}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`relative ${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                  {nav.menu && !submenuDrawn && <UnseenBadge corner count={unseenOf(nav.menu)} testId={`menu-unseen-badge-${nav.menu}`} label={badgeLabel(nav.name)} />}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className={`menu-item-text`}>{nav.name}</span>
                )}
                {nav.menu && submenuDrawn && <UnseenBadge count={unseenOf(nav.menu)} testId={`menu-unseen-badge-${nav.menu}`} label={badgeLabel(nav.name)} />}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      href={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      <span className="flex items-center gap-1 ml-auto">
                        {subItem.menu && <UnseenBadge count={unseenOf(subItem.menu)} testId={`menu-unseen-badge-${subItem.menu}`} label={badgeLabel(subItem.name)} />}
                        {subItem.new && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge `}
                          >
                            new
                          </span>
                        )}
                        {subItem.pro && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge `}
                          >
                            pro
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
        );
      })}
    </ul>
  );

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {}
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // const isActive = (path: string) => path === pathname;
   // A post's own page (/website/blog/posts/<id>, /new) belongs to the "Blog: Bài viết" entry.
   const isActive = useCallback((path: string) => path === pathname || (path === "/website/blog/posts" && !!pathname?.startsWith("/website/blog/posts/")), [pathname]);

  useEffect(() => {
    // Check if the current path matches any submenu item
    let submenuMatched = false;
    ["main", "others"].forEach((menuType) => {
      const items = menuType === "main" ? navItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (isActive(subItem.path)) {
              setOpenSubmenu({
                type: menuType as "main" | "others",
                index,
              });
              submenuMatched = true;
            }
          });
        }
      });
    });

    // If no submenu item matches, close the open submenu
    if (!submenuMatched) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs open submenu with route changes
      setOpenSubmenu(null);
    }
  }, [pathname,isActive]);

  useEffect(() => {
    // Set the height of the submenu items when the submenu is opened
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200
        ${
          isExpanded || isMobileOpen
            ? "w-[290px]"
            : isHovered
            ? "w-[290px]"
            : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`py-8 flex  ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link href="/">
          {isExpanded || isHovered || isMobileOpen ? (
            <>
              <Image
                className="dark:hidden"
                src="/images/logo/logo.svg"
                alt="Logo"
                width={150}
                height={40}
              />
              <Image
                className="hidden dark:block"
                src="/images/logo/logo-dark.svg"
                alt="Logo"
                width={150}
                height={40}
              />
            </>
          ) : (
            <Image
              src="/images/logo/logo-icon.svg"
              alt="Logo"
              width={32}
              height={32}
            />
          )}
        </Link>
      </div>
      <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Menu"
                ) : (
                  <HorizontaLDots />
                )}
              </h2>
              {renderMenuItems(navItems, "main")}
            </div>

            <div className="">
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Others"
                ) : (
                  <HorizontaLDots />
                )}
              </h2>
              {renderMenuItems(othersItems, "others")}
            </div>
          </div>
        </nav>
        {isExpanded || isHovered || isMobileOpen ? <SidebarWidget /> : null}
      </div>
    </aside>
  );
};

export default AppSidebar;
