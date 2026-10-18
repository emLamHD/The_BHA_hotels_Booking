import WebsiteAccessGate from "@/components/website/WebsiteAccessGate";
import CatalogWorkspace from "@/components/catalog/CatalogWorkspace";

export default function Page() {
  return <WebsiteAccessGate returnTo="/products"><CatalogWorkspace /></WebsiteAccessGate>;
}
