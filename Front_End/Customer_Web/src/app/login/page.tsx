import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import LoginForm from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customer.meta.login") };
}

/**
 * CUST-WEB-001-CP02: the template's login layout, connected to the Customer session. Social login and
 * password recovery do not exist and are not shown; creating an account is a later checkpoint.
 */
export default function PageLogin() {
  return (
    <div className={`nc-PageLogin`}>
      <div className="container mb-24 lg:mb-32">
        <LoginForm />
      </div>
    </div>
  );
}
