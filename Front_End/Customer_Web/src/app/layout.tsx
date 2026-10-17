import { Be_Vietnam_Pro, Poppins } from "next/font/google";
import SiteHeader from "./(client-components)/(Header)/SiteHeader";
import ClientCommons from "./ClientCommons";
import "./globals.css";
import "@/fonts/line-awesome-1.3.0/css/line-awesome.css";
import "@/styles/index.scss";
import "rc-slider/assets/index.css";
import Footer from "@/components/Footer";
import FooterNav from "@/components/FooterNav";
import { BookingHoldProvider } from "./BookingHoldProvider";
import { CustomerSessionProvider } from "./CustomerSessionProvider";
import HoldReceiptRedirector from "@/components/HoldReceiptRedirector";
import { StaySearchProvider } from "@/components/StaySearchProvider";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { getI18n, getT } from "@/lib/i18n/server";
import { MenuProvider } from "@/lib/menus/MenuProvider";
import { getMenuSnapshot } from "@/lib/menus/server";
import FloatingContactActions from "@/components/FloatingContactActions";

const poppins = Poppins({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

// CUST-WEB-HEADER-001-CP01: header/menu font only (see shared/headerTypography). Poppins has no Vietnamese subset.
const headerFont = Be_Vietnam_Pro({
  subsets: ["latin", "latin-ext", "vietnamese"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-header",
});

// CUST-WEB-HEADER-001-CP02-C2: the document's language, direction, title and description follow the visitor's language.
export async function generateMetadata() {
  const t = await getT();
  return { title: t("customer.meta.title"), description: t("customer.meta.description") };
}

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the Chisfis root layout as the template ships it (sticky header with
 * its menus, page, footer, mobile app bar). BookingHoldProvider stays above everything, so a guest's
 * in-memory hold and token survive client navigation; HoldReceiptRedirector sends the guest to the
 * receipt page once a hold exists.
 */
export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: any;
}) {
  // The visitor's language, currency and dictionary, read once per request and shared by every server component below.
  const snapshot = await getI18n();
  // The header navigation in the same language, read fresh for every request (it is the Admin's data, not a build artifact).
  const menu = await getMenuSnapshot(snapshot.locale);
  return (
    <html lang={snapshot.locale} dir={snapshot.direction} className={`${poppins.className} ${headerFont.variable}`}>
      <body className="bg-white text-base dark:bg-neutral-900 text-neutral-900 dark:text-neutral-200">
        <I18nProvider snapshot={snapshot}>
          <MenuProvider initial={menu}>
            <CustomerSessionProvider>
              <BookingHoldProvider>
                <StaySearchProvider>
                  <ClientCommons />
                  <SiteHeader />
                  <HoldReceiptRedirector />
                  <FloatingContactActions />
                  {children}
                  <FooterNav />
                  <Footer />
                </StaySearchProvider>
              </BookingHoldProvider>
            </CustomerSessionProvider>
          </MenuProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
