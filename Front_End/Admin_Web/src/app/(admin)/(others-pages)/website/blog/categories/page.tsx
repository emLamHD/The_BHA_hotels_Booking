import CategoriesScreen from "@/components/blog/CategoriesScreen";
import BlogAccessGate from "@/components/blog/BlogAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Chuyên mục Blog | The BHA Admin",
  description: "Chuyên mục Blog theo ngôn ngữ và bài được ghim.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Chuyên mục Blog" />
      {/* BHA-BLOG-001-CP03: no request until a confirmed Staff session holds BlogEdit or BlogPublish. */}
      <BlogAccessGate returnTo="/website/blog/categories">
        <CategoriesScreen />
      </BlogAccessGate>
    </div>
  );
}
