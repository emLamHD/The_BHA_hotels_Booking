import SignInForm from "@/components/auth/SignInForm";
import { Metadata } from "next";
import { resolveReturnTo } from "@/lib/website/returnTo";

export const metadata: Metadata = {
  title: "Staff sign in | The BHA Admin",
  description: "Sign in with a Staff account to use The BHA Reservation Board.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  // Only an exact allowlisted path survives; anything else is /calendar (lib/website/returnTo).
  const { returnTo } = await searchParams;
  return <SignInForm returnTo={resolveReturnTo(returnTo)} />;
}
