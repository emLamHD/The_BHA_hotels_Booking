import React, { FC } from "react";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3 / CUST-WEB-001-CP02…CP05a / CP08a: one slim line, not a banner per section.
 * It states what a visitor of this demo can rely on and what not. The Riverside's room types, search results,
 * prices, hold and confirmation, and the customer account come from the booking system. There is no online
 * payment, and the pictures' commercial rights are not verified (contract DP-09). The home page, header
 * and footer are Riverside's own now; only pages that are still the template's direct-access routes are
 * sample content, which the last sentence covers.
 */
const TemplateDemoNotice: FC = () => (
  <p className="bg-primary-50 px-4 py-2 text-center text-xs text-primary-700 dark:bg-neutral-800 dark:text-primary-300">
    Bản demo: phòng, giá và đặt phòng của The BHA Riverside lấy từ hệ thống đặt phòng. Chưa có thanh toán trực tuyến; ảnh
    chưa được xác minh quyền sử dụng thương mại. Một số trang khác của giao diện mẫu chưa phải nội dung thật.
  </p>
);

export default TemplateDemoNotice;
