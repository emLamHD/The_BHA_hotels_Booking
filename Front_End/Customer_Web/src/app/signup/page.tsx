import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import SignupForm from "./SignupForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.signup") };
}

/**
 * CUST-WEB-001-CP03: the template's signup layout, connected to the Customer API. Registering creates an
 * account only (no session). Social signup, terms checkboxes and email verification do not exist and are
 * not shown.
 */
export default function PageSignUp() {
  return (
    <div className={`nc-PageSignUp`}>
      <div className="container mb-24 lg:mb-32">
        <SignupForm />
      </div>
    </div>
  );
}
