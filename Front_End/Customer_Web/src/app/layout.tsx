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

export const metadata = {
  title: "The BHA — Đặt phòng trực tiếp",
  description: "Chọn loại phòng, xem giá theo đêm, giữ phòng và xác nhận đặt phòng tại The BHA.",
};

/**
 * CUST-WEB-SHOWCASE-001-CP02-C3: the Chisfis root layout as the template ships it (sticky header with
 * its menus, page, footer, mobile app bar). BookingHoldProvider stays above everything, so a guest's
 * in-memory hold and token survive client navigation; HoldReceiptRedirector sends the guest to the
 * receipt page once a hold exists.
 */
export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: any;
}) {
  return (
    <html lang="vi" className={`${poppins.className} ${headerFont.variable}`}>
      <body className="bg-white text-base dark:bg-neutral-900 text-neutral-900 dark:text-neutral-200">
        <CustomerSessionProvider>
          <BookingHoldProvider>
            <StaySearchProvider>
              <ClientCommons />
              <SiteHeader />
              <HoldReceiptRedirector />
              {children}
              <FooterNav />
              <Footer />
            </StaySearchProvider>
          </BookingHoldProvider>
        </CustomerSessionProvider>
      </body>
    </html>
  );
}
