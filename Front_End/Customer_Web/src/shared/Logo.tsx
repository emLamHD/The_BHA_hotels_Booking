import React from "react";
import Image, { StaticImageData } from "next/image";
import logoImg from "@/images/logo_the_bha_riverside.png";
import logoDarkImg from "@/images/logo_the_bha_riverside_dark.png";
import Link from "next/link";

export interface LogoProps {
  img?: StaticImageData;
  imgDark?: StaticImageData;
  className?: string;
}

/**
 * CUST-WEB-HEADER-001-CP01: the logo is a transparent PNG (no white box) in two variants with the same geometry.
 * The dark one only recolours the near-black ink ("The", "RIVERSIDE") to off-white; the gold is untouched. The
 * theme is switched in CSS (`dark:` on <html>, the class `useThemeMode` already owns), so no second theme state
 * exists and there is no flash on reload. Both images are eager so toggling never waits for a download, and
 * `sizes` is the widest placement (w-32): without it the browser fetches the 1920px rendition of a 128px logo.
 */
const Logo: React.FC<LogoProps> = ({ img = logoImg, imgDark = logoDarkImg, className = "w-24" }) => {
  return (
    <Link
      href="/"
      className={`ttnc-logo inline-block text-primary-6000 focus:outline-none focus:ring-0 ${className}`}
    >
      <Image className="block w-full h-auto dark:hidden" src={img} alt="The BHA Riverside" sizes="128px" priority />
      <Image className="hidden w-full h-auto dark:block" src={imgDark} alt="The BHA Riverside" sizes="128px" priority />
    </Link>
  );
};

export default Logo;
