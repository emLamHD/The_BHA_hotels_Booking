import BgGlassmorphism from "@/components/BgGlassmorphism";
import SectionSubscribe2 from "@/components/SectionSubscribe2";
import React, { ReactNode } from "react";

/**
 * CUST-WEB-001-CP05a: the page itself carries its title, search form and results. The template's hero
 * ("Stays in Tokyo", "112 properties"), its category slider ("Houseboat · 36,612 properties") and its
 * author box are gone from this route: their numbers and names are sample data that nothing in the
 * booking system backs, and the category cards linked into the live results.
 */
const Layout = ({ children }: { children: ReactNode }) => {
  return (
    <div className={`nc-ListingStayPage relative `}>
      <BgGlassmorphism />

      {children}

      <div className="container overflow-hidden">
        {/* SECTION */}
        <SectionSubscribe2 className="py-24 lg:py-28" />
      </div>
    </div>
  );
};

export default Layout;
