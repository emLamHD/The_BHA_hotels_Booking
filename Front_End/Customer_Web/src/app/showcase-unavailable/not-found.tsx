import React from "react";
import Link from "next/link";

export default function Unavailable() {
  return (
    <div className="container max-w-2xl space-y-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Chức năng này chưa có trong bản hiện tại</h1>
      <p className="text-neutral-600 dark:text-neutral-300">
        Bản demo này chỉ gồm xem chỗ nghỉ, tìm phòng trống, giữ phòng và xác nhận đặt phòng.
      </p>
      {/* CP01-C1 (F1): client navigation keeps an in-progress guest hold. */}
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-full bg-primary-6000 px-6 py-3 font-medium text-neutral-50 hover:bg-primary-700"
      >
        Về trang đặt phòng
      </Link>
    </div>
  );
}
