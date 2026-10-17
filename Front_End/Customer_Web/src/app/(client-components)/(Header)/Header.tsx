import React, { FC } from "react";
import MainNav2 from "./MainNav2";

export interface HeaderProps {
  navType?: "MainNav2";
  className?: string;
}

/** The one public header (the template's "Header 2"); its menu is data from the API, see `lib/menus`. */
const Header: FC<HeaderProps> = ({ className = "" }) => {
  return (
    <div
      className={`nc-Header sticky top-0 w-full left-0 right-0 z-40 nc-header-bg ${className}`}
    >
      <MainNav2 />
    </div>
  );
};

export default Header;
