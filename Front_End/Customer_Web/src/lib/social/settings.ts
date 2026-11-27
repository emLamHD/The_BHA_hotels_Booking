import { getApiBaseUrl } from "@/lib/api/env";

export interface ContactSettings {
  revision: number;
  generatedAtUtc: string;
  phoneEnabled: boolean;
  phoneNumber: string | null;
  phoneHref: string | null;
  messengerEnabled: boolean;
  messengerUrl: string | null;
  zaloEnabled: boolean;
  zaloUrl: string | null;
  backToTopEnabled: boolean;
}

export const CONTACT_LABELS = {
  vi: { phone: "Điện thoại", messenger: "Nhắn tin Messenger", zalo: "Liên hệ Zalo", top: "Về đầu trang", call: "Gọi" },
  en: { phone: "Phone", messenger: "Chat on Messenger", zalo: "Contact on Zalo", top: "Back to top", call: "Call" },
  fr: { phone: "Téléphone", messenger: "Discuter sur Messenger", zalo: "Contacter sur Zalo", top: "Retour en haut", call: "Appeler" },
} as const;

export const contactLabels = (locale: string) =>
  CONTACT_LABELS[(locale.split("-")[0] as keyof typeof CONTACT_LABELS)] ?? CONTACT_LABELS.en;

export function parseContactSettings(data: unknown): ContactSettings | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (typeof value.revision !== "number" || typeof value.generatedAtUtc !== "string" ||
      typeof value.phoneEnabled !== "boolean" || !(typeof value.phoneNumber === "string" || value.phoneNumber === null) ||
      !(typeof value.phoneHref === "string" || value.phoneHref === null) || typeof value.messengerEnabled !== "boolean" ||
      !(typeof value.messengerUrl === "string" || value.messengerUrl === null) || typeof value.zaloEnabled !== "boolean" ||
      !(typeof value.zaloUrl === "string" || value.zaloUrl === null) || typeof value.backToTopEnabled !== "boolean") return null;
  return value as unknown as ContactSettings;
}

/** The one contact destination a page offers (PR09-C6): Phone, then Zalo, then Messenger, among the channels that are enabled and have a usable destination. */
export type ContactChoice =
  | { status: "loading" }
  | { status: "none" }
  | { status: "channel"; kind: "phone" | "zalo" | "messenger"; href: string };

const hasScheme = (value: string | null, scheme: "tel:" | "https:") => {
  if (!value) return false;
  try {
    return scheme === "tel:" ? value.startsWith("tel:") && value.length > 4 : new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** Only a `tel:` number or an `https:` address is ever offered (a `javascript:`, `http:` or malformed destination is skipped); nothing is added to it. */
export function chooseContact(settings: ContactSettings | null): ContactChoice {
  if (settings) {
    if (settings.phoneEnabled && settings.phoneNumber && hasScheme(settings.phoneHref, "tel:")) return { status: "channel", kind: "phone", href: settings.phoneHref as string };
    if (settings.zaloEnabled && hasScheme(settings.zaloUrl, "https:")) return { status: "channel", kind: "zalo", href: settings.zaloUrl as string };
    if (settings.messengerEnabled && hasScheme(settings.messengerUrl, "https:")) return { status: "channel", kind: "messenger", href: settings.messengerUrl as string };
  }
  return { status: "none" };
}

/** The public contact settings: no cache and `credentials: "omit"` (a same-origin deployment, i.e. the API proxy, would otherwise send the customer's root-scoped session cookie with this public request). Rejects on any failure; null for an unusable body. */
export async function fetchContactSettings(signal?: AbortSignal): Promise<ContactSettings | null> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/website/social-media`, { signal, cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseContactSettings(await response.json());
}

export const shouldAcceptContact = (current: ContactSettings | null, next: ContactSettings) =>
  current === null || next.revision >= current.revision;

export const backToTopBehavior = (reducedMotion: boolean): ScrollBehavior => reducedMotion ? "auto" : "smooth";
