import SignInForm from "@/components/auth/SignInForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Staff sign in | The BHA Admin",
  description: "Sign in with a Staff account to use The BHA Reservation Board.",
};

export default function SignIn() {
  return <SignInForm />;
}
