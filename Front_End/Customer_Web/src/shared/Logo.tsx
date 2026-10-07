import React from "react";
import Image, { StaticImageData } from "next/image";
import logoImg from "@/images/logo_the_bha_riverside.jpg";
import Link from "next/link";

export interface LogoProps {
  img?: StaticImageData;
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ img = logoImg, className = "w-24" }) => {
  return (
    <Link
      href="/"
      className={`ttnc-logo inline-block text-primary-6000 focus:outline-none focus:ring-0 ${className}`}
    >
      <Image
        className="block w-full h-auto"
        src={img}
        alt="The BHA Riverside"
        priority
      />
    </Link>
  );
};

export default Logo;
