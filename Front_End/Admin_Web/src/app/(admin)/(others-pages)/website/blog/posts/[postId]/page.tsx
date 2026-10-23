import PostEditorScreen from "@/components/blog/PostEditorScreen";
import BlogAccessGate from "@/components/blog/BlogAccessGate";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import React, { Suspense } from "react";

export const metadata: Metadata = {
  title: "Soạn bài Blog | The BHA Admin",
  description: "Sửa một bài Blog: nội dung, bản dịch, xem trước và xuất bản.",
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  if (!GUID.test(postId)) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb pageTitle="Soạn bài Blog" />
      {/* Signing in from a post's own page comes back to the list: only fixed paths are allowed as a return target. */}
      <BlogAccessGate returnTo="/website/blog/posts">
        <Suspense fallback={null}>
          <PostEditorScreen postId={postId} />
        </Suspense>
      </BlogAccessGate>
    </div>
  );
}
