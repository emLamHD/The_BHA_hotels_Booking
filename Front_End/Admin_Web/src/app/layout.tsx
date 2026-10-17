import { Be_Vietnam_Pro, Outfit, Poppins } from 'next/font/google';
import './globals.css';
import "flatpickr/dist/flatpickr.css";
import { SidebarProvider } from '@/context/SidebarContext';
import { ThemeProvider } from '@/context/ThemeContext';

const outfit = Outfit({
  subsets: ["latin"],
});

// CUST-WEB-HERO-001-CP01: the two families the Customer's hero can use, loaded only so the hero preview draws the same letters
// (same weights, same subsets as Customer_Web/src/app/layout.tsx). Nothing else in the Admin uses them.
const heroPoppins = Poppins({ subsets: ["latin"], display: "swap", weight: ["300", "400", "500", "600", "700"], variable: "--font-poppins" });
const heroVietnamPro = Be_Vietnam_Pro({ subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", weight: ["400", "500"], variable: "--font-header" });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${outfit.className} ${heroPoppins.variable} ${heroVietnamPro.variable} dark:bg-gray-900`}>
        <ThemeProvider>
          <SidebarProvider>{children}</SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
