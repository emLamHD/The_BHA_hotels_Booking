import { redirect } from "next/navigation";
import { RECEIPT_PAGE } from "@/lib/routePolicy";

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the template's fake receipt (booking #222-333-111, $199, credit card) is
 * gone. The middleware redirects `/pay-done` to the live receipt; this is the same redirect for any path
 * that reaches the page itself.
 */
export default function PayDoneAlias() {
  redirect(RECEIPT_PAGE);
}
