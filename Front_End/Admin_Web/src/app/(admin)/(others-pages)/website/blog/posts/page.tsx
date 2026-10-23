import PostsScreen from "@/components/blog/PostsScreen";
import BlogAccessGate from "@/components/blog/BlogAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Bài viết Blog | The BHA Admin",
  description: "Danh sách bài viết Blog của The BHA theo ngôn ngữ và trạng thái.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Bài viết Blog" />
      {/* BHA-BLOG-001-CP03: no request until a confirmed Staff session holds BlogEdit or BlogPublish. */}
      <BlogAccessGate returnTo="/website/blog/posts">
        <PostsScreen />
      </BlogAccessGate>
    </div>
  );
}
