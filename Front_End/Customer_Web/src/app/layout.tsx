import { Poppins } from "next/font/google";
import SiteHeader from "./(client-components)/(Header)/SiteHeader";
import ClientCommons from "./ClientCommons";
import "./globals.css";
import "@/fonts/line-awesome-1.3.0/css/line-awesome.css";
import "@/styles/index.scss";
import "rc-slider/assets/index.css";
import Footer from "@/components/Footer";
import { BookingHoldProvider } from "./BookingHoldProvider";

const poppins = Poppins({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata = {
  title: "The BHA — Đặt phòng trực tiếp",
  description: "Chọn loại phòng, xem giá theo đêm, giữ phòng và xác nhận đặt phòng tại The BHA.",
};

/**
 * CUST-WEB-SHOWCASE-001-CP02-C2: the template's root layout (sticky header, page, footer with the
 * mobile app bar) again. BookingHoldProvider stays here, above every page, so a guest's in-memory
 * hold and token survive client navigation between the home page and a room's page.
 */
export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: any;
}) {
  return (
    <html lang="vi" className={poppins.className}>
      <body className="bg-white text-base dark:bg-neutral-900 text-neutral-900 dark:text-neutral-200">
        <BookingHoldProvider>
          <ClientCommons />
          <SiteHeader />
          {children}
          <Footer />
        </BookingHoldProvider>
      </body>
    </html>
  );
}
