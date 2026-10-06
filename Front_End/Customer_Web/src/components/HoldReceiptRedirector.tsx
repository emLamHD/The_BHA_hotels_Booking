"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useBookingHoldFlow } from "@/app/BookingHoldProvider";
import { RECEIPT_PAGE } from "@/lib/routePolicy";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: sends the guest to the receipt page, once, at the moment a hold has just
 * been created — the booking flow going from "submitting" to "active-session". Anything else does not
 * redirect: a known error or an unknown outcome has no hold to show, a page that merely renders while a
 * hold already exists (reload of the room page, coming back) is not a new hold, and a replay that
 * returns the existing hold arrives through the same transition and is shown as such. The flow state
 * stays in the provider; nothing about it goes through the URL or any storage.
 */
export default function HoldReceiptRedirector() {
  const router = useRouter();
  const { state } = useBookingHoldFlow();
  const previous = useRef(state.phase);

  useEffect(() => {
    const was = previous.current;
    previous.current = state.phase;
    if (was === "submitting" && state.phase === "active-session" && state.session) {
      router.push(RECEIPT_PAGE as never);
    }
  }, [state.phase, state.session, router]);

  return null;
}
