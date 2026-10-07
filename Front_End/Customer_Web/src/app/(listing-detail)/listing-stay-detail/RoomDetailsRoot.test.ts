import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingHoldProvider } from "@/app/BookingHoldProvider";
import RoomDetailsRoot from "./RoomDetailsRoot";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: with no query (the server render has none) the details route says
 * no room was chosen. It must not fall back to a default room or any template content, and it must
 * not render a booking form. Malformed, unknown and mismatched ids are covered by roomDetailsRoute
 * tests (pure) and in the browser against the API (the loader needs effects).
 */
const markup = renderToStaticMarkup(
  React.createElement(BookingHoldProvider, null, React.createElement(RoomDetailsRoot))
);

describe("RoomDetailsRoot without a room in the URL", () => {
  it("explains that no room was chosen and links back to the rooms", () => {
    expect(markup).toContain("Chưa chọn phòng");
    expect(markup).toContain("/#rooms");
  });

  it("renders no template room, price, host, review or booking form", () => {
    for (const template of ["Beach House", "Kevin Francis", "Tam Coc", "Reserve", "checkout", "Google", "$119"]) {
      expect(markup).not.toContain(template);
    }
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("availability-checkin");
  });
});
