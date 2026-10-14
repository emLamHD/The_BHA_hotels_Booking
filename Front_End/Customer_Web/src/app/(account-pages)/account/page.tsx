import AccountSessionPanel from "./AccountSessionPanel";

export const metadata = {
  title: "Tài khoản — The BHA",
};

/**
 * CUST-WEB-001-CP04: the read-only account page. Nothing here is fetched on the server — who the Customer is
 * comes from the session provider in the browser, so the server render carries no profile and no email.
 */
export default function AccountPage() {
  return <AccountSessionPanel />;
}
