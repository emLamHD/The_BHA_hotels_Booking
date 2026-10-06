import { Poppins } from "next/font/google";
import ClientCommons from "./ClientCommons";
import "./globals.css";
import "@/fonts/line-awesome-1.3.0/css/line-awesome.css";
import "@/styles/index.scss";
import "rc-slider/assets/index.css";
import ShowcaseShell from "@/components/ShowcaseShell";
import { BookingHoldProvider } from "./BookingHoldProvider";

const poppins = Poppins({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata = {
  title: "The BHA — Đặt phòng trực tiếp",
  description: "Tìm phòng trống, giữ phòng và xác nhận đặt phòng tại The BHA.",
};

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
          <ShowcaseShell>{children}</ShowcaseShell>
        </BookingHoldProvider>
      </body>
    </html>
  );
}
