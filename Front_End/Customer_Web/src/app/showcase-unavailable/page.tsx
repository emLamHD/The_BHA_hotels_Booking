import { notFound } from "next/navigation";

/**
 * CUST-WEB-SHOWCASE-001-CP01: every denied path is rewritten here by the
 * middleware; throwing notFound() answers it with HTTP 404 and the message in
 * ./not-found.tsx, never with the template page that lives at that path.
 * Rendered per request: a prerendered copy is served by `next start` as 200.
 */
export const dynamic = "force-dynamic";

export default function UnavailablePage() {
  notFound();
}
