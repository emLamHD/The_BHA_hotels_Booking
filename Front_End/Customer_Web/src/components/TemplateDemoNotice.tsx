import React, { FC } from "react";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3 / CUST-WEB-001-CP02/CP03/CP04/CP05a: one slim line, not a banner per section. It tells a
 * visitor which part of the restored Chisfis site is real. The Riverside's rooms, prices, hold and
 * confirmation, signing up, in and out of a Customer account, and the read-only account page that shows
 * the signed-in email, and the stay search results at /listing-stay (live catalog and availability), come from
 * the booking system; the rest (other brands, the map, cars, flights, experiences,
 * real estate, profile editing, booking history, blog, sample ratings and pictures) is the template's demo content with no backend.
 */
const TemplateDemoNotice: FC = () => (
  <p className="bg-primary-50 px-4 py-2 text-center text-xs text-primary-700 dark:bg-neutral-800 dark:text-primary-300">
    Bản demo: phòng, giá, kết quả tìm phòng và đặt phòng của The BHA Riverside, cùng đăng ký, đăng nhập, đăng xuất và
    trang xem email tài khoản khách, là dữ liệu thật của hệ thống đặt phòng (chưa có thanh toán trực tuyến, bản đồ,
    chỉnh sửa hồ sơ hay lịch sử đặt phòng). Các mục khác trên trang là nội dung mẫu của template, chưa có backend.
  </p>
);

export default TemplateDemoNotice;
