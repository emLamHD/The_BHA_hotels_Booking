"use client";

import React from "react";
import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import PromotionsWorkspace, { PROMOTION_RULE } from "./PromotionsWorkspace";

/** The gate and the workspace together, so the server page passes no function across the client boundary. */
export default function PromotionsScreen() {
  return (
    <WebsiteAccessGate returnTo="/promotions" rule={PROMOTION_RULE}>
      <PromotionsWorkspace />
    </WebsiteAccessGate>
  );
}
