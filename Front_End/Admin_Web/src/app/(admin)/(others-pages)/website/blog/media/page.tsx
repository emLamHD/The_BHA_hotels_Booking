import MediaLibraryScreen from "@/components/blog/MediaLibraryScreen";
import BlogAccessGate from "@/components/blog/BlogAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Thư viện ảnh Blog | The BHA Admin",
  description: "Ảnh dùng chung cho bài viết Blog.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Thư viện ảnh Blog" />
      {/* BHA-BLOG-001-CP03: no request until a confirmed Staff session holds BlogEdit or BlogPublish. */}
      <BlogAccessGate returnTo="/website/blog/media">
        <MediaLibraryScreen />
      </BlogAccessGate>
    </div>
  );
}
