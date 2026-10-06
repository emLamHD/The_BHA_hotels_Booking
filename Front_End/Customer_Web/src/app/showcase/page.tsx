import React from "react";
import SectionGridFeatureProperty from "@/app/(home)/SectionGridFeatureProperty";
import ShowcaseNavLink from "@/components/ShowcaseNavLink";

/**
 * CUST-WEB-SHOWCASE-001-CP01-C2: the live booking entry rendered directly at
 * `/` (a direct visit to /showcase redirects to `/`). Everything below
 * the intro comes from the API: properties, room types, availability with
 * nightly prices, then the contact → hold → confirm panel.
 */
const STEPS = ["Chọn chỗ nghỉ", "Tìm phòng", "Giữ phòng", "Xác nhận"];

export default function ShowcasePage() {
  return (
    <div className="container relative space-y-16 py-12 lg:space-y-24 lg:py-16">
      <section className="max-w-3xl space-y-6">
        <h1 className="text-3xl font-semibold sm:text-4xl">Đặt phòng trực tiếp tại The BHA</h1>
        <p className="text-neutral-600 dark:text-neutral-300">
          Xem chỗ nghỉ và loại phòng, tìm phòng trống theo ngày với giá từng đêm, giữ phòng bằng thông tin liên hệ
          rồi xác nhận để nhận mã đặt phòng.
        </p>
        <ol className="flex flex-wrap gap-2 text-sm">
          {STEPS.map((step, index) => (
            <li key={step} className="rounded-full border border-neutral-200 px-4 py-2 dark:border-neutral-700">
              {index + 1}. {step}
            </li>
          ))}
        </ol>
        <ShowcaseNavLink
          section="booking"
          className="inline-flex items-center justify-center rounded-full bg-primary-6000 px-6 py-3 font-medium text-neutral-50 hover:bg-primary-700"
        >
          Tìm phòng trống
        </ShowcaseNavLink>
      </section>

      <SectionGridFeatureProperty heading="Chỗ nghỉ" subHeading="Danh sách lấy trực tiếp từ hệ thống đặt phòng" />
    </div>
  );
}
