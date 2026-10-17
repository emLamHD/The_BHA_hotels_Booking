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

export const shouldAcceptContact = (current: ContactSettings | null, next: ContactSettings) =>
  current === null || next.revision >= current.revision;

export const backToTopBehavior = (reducedMotion: boolean): ScrollBehavior => reducedMotion ? "auto" : "smooth";
