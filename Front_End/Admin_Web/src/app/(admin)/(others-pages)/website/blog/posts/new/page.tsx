import PostEditorScreen from "@/components/blog/PostEditorScreen";
import BlogAccessGate from "@/components/blog/BlogAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React, { Suspense } from "react";

export const metadata: Metadata = {
  title: "Viết bài mới | The BHA Admin",
  description: "Soạn một bài Blog mới.",
};

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Viết bài mới" />
      <BlogAccessGate returnTo="/website/blog/posts/new">
        <Suspense fallback={null}>
          <PostEditorScreen postId={null} />
        </Suspense>
      </BlogAccessGate>
    </div>
  );
}
