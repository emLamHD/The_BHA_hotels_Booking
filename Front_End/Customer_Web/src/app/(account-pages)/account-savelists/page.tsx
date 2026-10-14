import AccountUnavailable from "../(components)/AccountUnavailable";

export const metadata = {
  title: "Chức năng chưa được hỗ trợ — The BHA",
};

/** CUST-WEB-001-CP04: no saved-list feature behind this route yet; it says so instead of showing a template. */
export default function AccountSavelistsPage() {
  return <AccountUnavailable feature="Danh sách yêu thích" />;
}
