"use client";

import React from "react";
import { getAccessMode } from "@/lib/api/accessMode";
import { StaffSessionProvider } from "@/components/auth/StaffSession";
import { NewsletterBadgeProvider } from "@/components/website/NewsletterBadgeProvider";

/**
 * BHA-NEWSLETTER-BADGE-001: the Staff session and the Newsletter badge for the whole Admin shell, so the sidebar and the page share ONE session and ONE live connection. Only in
 * `Staff` mode: in `LocalGate` (or with an invalid setting) no sign-in exists, nothing is requested here, and every page keeps saying what it said. A page's gate that asks to reuse an
 * enclosing session (the website gate) uses this one; the others keep their own, exactly as before.
 */
export default function AdminStaffScope({ children }: { children: React.ReactNode }) {
  const mode = getAccessMode();
  if (!mode.ok || mode.mode !== "Staff") return <>{children}</>;
  return (
    <StaffSessionProvider>
      <NewsletterBadgeProvider>{children}</NewsletterBadgeProvider>
    </StaffSessionProvider>
  );
}
