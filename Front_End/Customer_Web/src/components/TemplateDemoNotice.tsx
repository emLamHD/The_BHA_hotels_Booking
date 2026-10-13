import React, { FC } from "react";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3 / CUST-WEB-001-CP02: one slim line, not a banner per section. It tells a
 * visitor which part of the restored Chisfis site is real. The Riverside's rooms, prices, hold and
 * confirmation, and signing in and out of a Customer account, come from the booking system; the rest
 * (other brands, cars, flights, experiences, real estate, sign-up, account pages, blog, sample ratings and
 * pictures) is the template's demo content with no backend.
 */
const TemplateDemoNotice: FC = () => (
  <p className="bg-primary-50 px-4 py-2 text-center text-xs text-primary-700 dark:bg-neutral-800 dark:text-primary-300">
    Bản demo: phòng, giá và đặt phòng của The BHA Riverside, cùng đăng nhập và đăng xuất tài khoản khách, là dữ liệu
    thật của hệ thống đặt phòng (chưa có thanh toán trực tuyến, đăng ký hay trang tài khoản). Các mục khác trên trang
    là nội dung mẫu của template, chưa có backend.
  </p>
);

export default TemplateDemoNotice;
