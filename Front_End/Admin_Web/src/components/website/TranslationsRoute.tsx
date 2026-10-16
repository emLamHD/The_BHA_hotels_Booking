"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import TranslationsPanel from "./TranslationsPanel";

/** Reads the optional `?locale=` (a link from the Languages screen) and hands it to the panel, which validates it against the real list. */
export default function TranslationsRoute() {
  const params = useSearchParams();
  return <TranslationsPanel initialLocale={params.get("locale")} />;
}
