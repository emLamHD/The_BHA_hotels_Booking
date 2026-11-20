"use client";

import React from "react";
import { getAccessMode } from "@/lib/api/accessMode";
import { StaffSessionProvider } from "@/components/auth/StaffSession";
import { MenuUnseenProvider } from "@/components/website/NewsletterBadgeProvider";

/**
 * BHA-NEWSLETTER-BADGE-001 / BHA-ADMIN-BADGE-001-PR04: the Staff session and the shared unseen provider for the whole Admin shell, so the sidebar and the pages share ONE session and ONE set of live connections. Only in
 * `Staff` mode: in `LocalGate` (or with an invalid setting) no sign-in exists, nothing is requested here, and every page keeps saying what it said. Every Staff page gate under the shell
 * (Website, Blog, Promotions, Catalog, Calendar) shares this session, so a sign-out or expiry from the page ends the sidebar's too; a gate rendered on its own, with no enclosing session,
 * makes its own.
 */
export default function AdminStaffScope({ children }: { children: React.ReactNode }) {
  const mode = getAccessMode();
  if (!mode.ok || mode.mode !== "Staff") return <>{children}</>;
  return (
    <StaffSessionProvider>
      <MenuUnseenProvider>{children}</MenuUnseenProvider>
    </StaffSessionProvider>
  );
}
