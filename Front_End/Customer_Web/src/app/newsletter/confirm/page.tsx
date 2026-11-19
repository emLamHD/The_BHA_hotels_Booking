import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { NEWSLETTER_CONFIRM } from "@/lib/newsletterUi";
import ConfirmNewsletter from "./ConfirmNewsletter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  // A private, one-purpose page reached from an e-mail: not for search engines, and the link's origin is not sent on to other sites.
  return { title: t(NEWSLETTER_CONFIRM.meta), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** BHA-NEWSLETTER-002: where the link of the confirmation e-mail lands. Opening it changes nothing; the visitor presses the button. */
export default function PageNewsletterConfirm() {
  return (
    <div className="nc-PageNewsletterConfirm">
      <div className="container mb-24 lg:mb-32">
        <ConfirmNewsletter />
      </div>
    </div>
  );
}
