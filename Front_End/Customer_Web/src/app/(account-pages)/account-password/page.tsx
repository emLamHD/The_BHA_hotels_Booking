import AccountUnavailable from "../(components)/AccountUnavailable";

export const metadata = {
  title: "Chức năng chưa được hỗ trợ — The BHA",
};

/** CUST-WEB-001-CP04: no password-change feature behind this route yet; it says so instead of showing a template. */
export default function AccountPasswordPage() {
  return <AccountUnavailable feature="Đổi mật khẩu" />;
}
