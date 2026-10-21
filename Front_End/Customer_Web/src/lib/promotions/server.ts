import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/api/env";
import { LOCALE_COOKIE } from "@/lib/i18n/types";
import { parsePromotionDetail, parsePromotionList, type PromotionCard, type PromotionDetail } from "./promotions";

/**
 * The public promotions for this request, read with `no-store` (Next caches server fetches by default, which would keep a card the Admin
 * has since hidden). Unlike the hero there is NO last-good copy: a card that may since have ended must not be advertised during an
 * outage, so a failed read is `error` and the page shows nothing rather than something possibly out of date.
 */
export type PromotionsResult = { status: "ok"; items: PromotionCard[] } | { status: "error" };
export type PromotionDetailResult = { status: "ok"; detail: PromotionDetail } | { status: "missing" } | { status: "error" };

const localeOf = (locale?: string) => locale ?? cookies().get(LOCALE_COOKIE)?.value ?? "";

export async function getPromotions(locale?: string): Promise<PromotionsResult> {
  try {
    const base = getApiBaseUrl();
    const wanted = localeOf(locale);
    const query = wanted ? `?locale=${encodeURIComponent(wanted)}` : "";
    const response = await fetch(`${base}/api/v1/website/promotions${query}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = parsePromotionList(await response.json(), base);
    if (!items) throw new Error("not a promotion list");
    return { status: "ok", items };
  } catch (error) {
    console.error(`[promotions] could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
    return { status: "error" };
  }
}

export async function getPromotion(slug: string, locale?: string): Promise<PromotionDetailResult> {
  try {
    const base = getApiBaseUrl();
    const wanted = localeOf(locale);
    const query = wanted ? `?locale=${encodeURIComponent(wanted)}` : "";
    const response = await fetch(`${base}/api/v1/website/promotions/${encodeURIComponent(slug)}${query}`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const detail = parsePromotionDetail(await response.json(), base);
    if (!detail) throw new Error("not a promotion");
    return { status: "ok", detail };
  } catch (error) {
    console.error(`[promotions] ${slug} could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
    return { status: "error" };
  }
}
