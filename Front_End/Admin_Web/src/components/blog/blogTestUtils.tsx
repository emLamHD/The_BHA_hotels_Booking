/** BHA-BLOG-001-CP03 test helpers: Blog records, and one place that renders a screen inside the real Blog gate with `me` mocked. Test-only. */
import React from "react";
import { render } from "@testing-library/react";
import type { BlogPost, BlogRevision, BlogTranslation } from "@/lib/api/blog";
import type { StaffSession } from "@/lib/api/staff";
import BlogAccessGate from "./BlogAccessGate";

export const session = (permissions: string[]): StaffSession => ({
  staffAccountId: "11111111-1111-1111-1111-111111111111",
  email: "staff@example.com",
  memberships: [{ propertyId: "prop-a", propertyName: "Property A", timeZone: "Asia/Ho_Chi_Minh", role: "FrontDesk" }],
  permissions,
});

export const EDITOR = session(["BlogEdit"]);
export const PUBLISHER = session(["BlogPublish"]);
export const BOTH = session(["BlogEdit", "BlogPublish"]);

export const POST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export function revision(overrides: Partial<BlogRevision> = {}): BlogRevision {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", number: 1, state: "Draft", origin: "Edit", restoredFromRevisionId: null, title: "Bãi biển Mỹ Khê", slug: "bai-bien-my-khe",
    summary: "Một bãi biển dài.", body: { schemaVersion: 1, blocks: [] }, coverMediaId: null, coverAlt: "", authorName: "Ban biên tập", metaTitle: "", metaDescription: "", ogImageMediaId: null,
    categoryIds: [], primaryCategoryId: null, createdAtUtc: "2026-10-21T08:00:00Z", createdBy: null, updatedAtUtc: "2026-10-21T08:00:00Z", updatedBy: null, publishedAtUtc: null, publishedBy: null,
    ...overrides,
  };
}

export function translation(overrides: Partial<BlogTranslation> = {}): BlogTranslation {
  return {
    translationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", locale: "vi", status: "Draft", version: 1, hasDraft: true, firstPublishedAtUtc: null, updatedAtUtc: "2026-10-21T08:00:00Z",
    updatedBy: null, draft: revision(), published: null, ...overrides,
  };
}

export const post = (t: BlogTranslation = translation(), id = POST_ID): BlogPost => ({ id, createdAtUtc: "2026-10-21T08:00:00Z", translations: [t] });

export const ok = <T,>(data: T) => ({ kind: "ok" as const, data });

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export function renderInBlogGate(screen: React.ReactNode, returnTo = "/website/blog/posts") {
  return render(<BlogAccessGate returnTo={returnTo}>{screen}</BlogAccessGate>);
}
