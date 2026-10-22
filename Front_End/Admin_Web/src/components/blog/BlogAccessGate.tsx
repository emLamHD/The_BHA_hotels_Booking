"use client";

/**
 * BHA-BLOG-001-CP03: what stands in front of every Blog page. It is the website gate (same Staff session, same 401/403/sign-out handling, no request
 * before `GET /me` confirmed a session) with the Blog's own rule: the Staff member needs `BlogEdit` or `BlogPublish` — not the website-settings
 * permission, which a Blog-only account does not have and which this does not open. The links and buttons that follow are a convenience; the server
 * checks every request again.
 */

import React from "react";
import WebsiteAccessGate, { type GateRule } from "@/components/website/WebsiteAccessGate";
import { useStaffSession } from "@/components/auth/StaffSession";
import { blogRights, type BlogRights } from "@/lib/api/blog";

export const BLOG_RULE: GateRule = {
  isAllowed: (session) => blogRights(session.permissions).access,
  noPermission:
    "Tài khoản này không có quyền với Blog. Quyền sửa và quyền xuất bản do người vận hành cấp riêng cho tài khoản Staff bằng dòng lệnh của Admin API, tách biệt với vai trò theo cơ sở lưu trú và với cài đặt website. Chưa có yêu cầu nào được gửi.",
  signInPrompt: "Hãy đăng nhập để quản lý Blog.",
};

export default function BlogAccessGate({ returnTo, children }: { returnTo: string; children: React.ReactNode }) {
  return (
    <WebsiteAccessGate returnTo={returnTo} rule={BLOG_RULE}>
      {children}
    </WebsiteAccessGate>
  );
}

const NONE: BlogRights = { access: false, edit: false, publish: false };

/** What the signed-in Staff member may do in the Blog (display only). Inside the gate this is always a signed-in session. */
export function useBlogRights(): BlogRights {
  const { state } = useStaffSession();
  return state.status === "authenticated" ? blogRights(state.session.permissions) : NONE;
}
