import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { NEWSLETTER_UNSUBSCRIBE } from "@/lib/newsletterUi";
import UnsubscribeNewsletter from "./UnsubscribeNewsletter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  // A private, one-purpose page reached from an e-mail: not for search engines, and the link's origin is not sent on to other sites.
  return { title: t(NEWSLETTER_UNSUBSCRIBE.meta), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** BHA-NEWSLETTER-003: where the unsubscribe link of the Welcome e-mail lands. Opening it changes nothing; the visitor presses the button. */
export default function PageNewsletterUnsubscribe() {
  return (
    <div className="nc-PageNewsletterUnsubscribe">
      <div className="container mb-24 lg:mb-32">
        <UnsubscribeNewsletter />
      </div>
    </div>
  );
}
