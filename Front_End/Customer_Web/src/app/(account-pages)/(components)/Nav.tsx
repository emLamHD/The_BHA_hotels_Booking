import React from "react";

/**
 * CUST-WEB-001-CP04: the account shell's header. The template's four tabs (saved lists, password, billing)
 * pointed at features that do not exist, so only the real section title remains.
 */
export const Nav = () => {
  return (
    <div className="container">
      <div className="flex space-x-8 md:space-x-14 overflow-x-auto hiddenScrollbar">
        <span className="block py-5 md:py-8 border-b-2 flex-shrink-0 border-primary-500 font-medium">Tài khoản</span>
      </div>
    </div>
  );
};
