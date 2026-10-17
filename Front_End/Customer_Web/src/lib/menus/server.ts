import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/api/env";
import { LOCALE_COOKIE } from "@/lib/i18n/types";
import { parseMenu, type MenuSnapshot } from "./menu";

/**
 * The menu for this request, read by the root layout with `no-store` (Next caches server fetches by default, which would
 * keep a menu the Admin has since changed). The last good answer per language survives a transient API failure; a first
 * failure gives `null` and the header shows only its controls. A valid but empty menu is returned as it is.
 */
const lastGood = new Map<string, MenuSnapshot>();

export async function getMenuSnapshot(locale?: string): Promise<MenuSnapshot | null> {
  const wanted = locale ?? cookies().get(LOCALE_COOKIE)?.value ?? "";
  try {
    const query = wanted ? `?locale=${encodeURIComponent(wanted)}` : "";
    const response = await fetch(`${getApiBaseUrl()}/api/v1/website/menus${query}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const menu = parseMenu(await response.json());
    if (!menu) throw new Error("not a menu");
    lastGood.set(wanted, menu);
    return menu;
  } catch (error) {
    console.error(`[menu] could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
    return lastGood.get(wanted) ?? null;
  }
}
