/**
 * BHA-ADMIN-BADGE-001-PR09 (ADR 0011 §B, §D): the seven Website screens say "seen" — through the real session, provider and gate — for THEIR OWN stream with the watermark of the read that
 * answered for the view on screen, and for nothing else. The API client and the connections are replaced; every answer is scripted or deferred by the test, so the order of answers is the
 * test's, never a clock's (the scripted transports ignore the AbortSignal, as a late answer from a real one may). What is asserted is what went to `POST menu-unseen/{menu}/seen`.
 * The pipeline itself (queue, retry, dedupe, deferred ack) is covered for the Blog menus in `BlogSeenAck.test.tsx`; here one Website screen proves it is the same pipeline.
 */
import React, { useEffect } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/staff")>()), fetchStaffSession: vi.fn(), staffLogout: vi.fn() }));
vi.mock("@/lib/website/newsletterLive", () => ({ startNewsletterLive: vi.fn(() => ({ retryNow: vi.fn(), dispose: vi.fn() })) }));
vi.mock("@/lib/api/website", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/website")>()),
  getHero: vi.fn(), getMenu: vi.fn(), getSocialSettings: vi.fn(), saveSocialSettings: vi.fn(), getNewsletterSender: vi.fn(), readCurrencies: vi.fn(), readLanguages: vi.fn(),
  readLibraryPacks: vi.fn(), updateLanguage: vi.fn(), deleteLanguage: vi.fn(), completeNewsletterConnect: vi.fn(), listLanguages: vi.fn(), listCurrencies: vi.fn(), listLibraryPacks: vi.fn(), listTranslations: vi.fn(),
}));
vi.mock("@/lib/api/menuUnseen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/menuUnseen")>()),
  fetchMenuUnseenSummary: vi.fn(), markMenuSeen: vi.fn(), markNewsletterSeen: vi.fn(),
}));

import HeroPanel from "./HeroPanel";
import MenusPanel from "./MenusPanel";
import LanguagesPanel from "./LanguagesPanel";
import TranslationsPanel from "./TranslationsPanel";
import CurrenciesPanel from "./CurrenciesPanel";
import SocialMediaPanel from "./SocialMediaPanel";
import NewsletterSenderPanel from "./NewsletterSenderPanel";
import NewsletterSenderCallback from "./NewsletterSenderCallback";
import WebsiteAccessGate from "./WebsiteAccessGate";
import { MenuUnseenProvider, useMenuUnseen } from "./NewsletterBadgeProvider";
import { StaffSessionProvider, useStaffSession } from "@/components/auth/StaffSession";
import { ALLOWED, currency, deferred, lang, ok, translations, VND } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { fetchMenuUnseenSummary, markMenuSeen, type MenuUnseenEntry } from "@/lib/api/menuUnseen";
import {
  getHero, getMenu, getNewsletterSender, getSocialSettings, listCurrencies, completeNewsletterConnect, listLanguages, listLibraryPacks, listTranslations, readCurrencies, readLanguages, readLibraryPacks, saveSocialSettings, updateLanguage, deleteLanguage,
} from "@/lib/api/website";

const seenCall = vi.mocked(markMenuSeen);
const summary = vi.mocked(fetchMenuUnseenSummary);
const reads = {
  hero: vi.mocked(getHero), menus: vi.mocked(getMenu), social: vi.mocked(getSocialSettings), sender: vi.mocked(getNewsletterSender), currencies: vi.mocked(readCurrencies),
  languages: vi.mocked(readLanguages), library: vi.mocked(readLibraryPacks), translations: vi.mocked(listTranslations),
};

const STAFF_A = ALLOWED;
const STAFF_B = { ...ALLOWED, staffAccountId: "22222222-2222-2222-2222-222222222222", email: "b@example.com" };
const entry = (last: string, current: string, count = 0): MenuUnseenEntry => ({ count, lastSeenWatermark: last, currentWatermark: current });
const SEVEN = ["website-hero", "website-menus", "website-languages", "website-translations", "website-currencies", "website-social", "newsletter-sender"] as const;
const ALL_SEVEN = Object.fromEntries(SEVEN.map((key) => [key, entry("0", "100")]));

const locale = { code: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt", isDefault: true, isActive: true, isContentSource: true };
const text = { vi: "x" };
const hero = (viewWatermark?: string) => ({
  revision: "r1", version: 1, updatedAtUtc: "2026-11-21T00:00:00Z", locales: [locale], fontKey: "default" as const, autoplayEnabled: true, intervalSeconds: 6, slides: [], media: [],
  texts: { title: text, description: text, primaryAction: text, secondaryAction: text }, ...(viewWatermark ? { viewWatermark } : {}),
});
const menu = (viewWatermark?: string) => ({ revision: "r1", version: 1, updatedAtUtc: "2026-11-21T00:00:00Z", locales: [locale], items: [], ...(viewWatermark ? { viewWatermark } : {}) });
const social = (viewWatermark?: string) => ({
  revision: 1, updatedAtUtc: "2026-11-21T00:00:00Z", phoneEnabled: true, phoneNumber: "0900000000", phoneHref: "tel:0900000000", messengerEnabled: false, messengerUrl: null,
  zaloEnabled: false, zaloNumber: null, zaloUrl: null, backToTopEnabled: true, ...(viewWatermark ? { viewWatermark } : {}),
});
const sender = (viewWatermark?: string) => ({
  status: "NotConnected" as const, clientId: null, hasClientSecret: false, connectedEmail: null, senderName: null, replyTo: null, connectedAtUtc: null, redirectUri: null, scopes: [],
  customerOriginReady: true, version: 0, pendingRequests: 0, ...(viewWatermark ? { viewWatermark } : {}),
});
const items = <T,>(list: T[], viewWatermark?: string) => ok({ items: list, ...(viewWatermark ? { viewWatermark } : {}) });
const VI = lang();
const FR = lang({ code: "fr", displayName: "French", nativeName: "Français", isActive: false, isDefault: false, version: 3 });
const frList = (viewWatermark?: string, over = {}) => translations({ locale: "fr", isDefaultLocale: false, ...(viewWatermark ? { viewWatermark } : {}), ...over });

let session: ReturnType<typeof useStaffSession> | null = null;
function Probe() {
  const value = useStaffSession();
  useEffect(() => {
    session = value;
  });
  return null;
}
function Count({ menu: key }: { menu: (typeof SEVEN)[number] }) {
  return <span data-testid="count">{useMenuUnseen()[key]?.count ?? "-"}</span>;
}

const mount = (node: React.ReactNode) =>
  render(
    <StaffSessionProvider>
      <MenuUnseenProvider>
        <Probe />
        <WebsiteAccessGate returnTo="/website/hero">{node}</WebsiteAccessGate>
      </MenuUnseenProvider>
    </StaffSessionProvider>,
  );
const sent = () => seenCall.mock.calls.map((call) => `${call[0]}:${call[1]}`);
const flush = (ms = 60) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_CALENDAR_ACCESS_MODE", "Staff");
  for (const m of [seenCall, summary, ...Object.values(reads), vi.mocked(listLanguages), vi.mocked(listCurrencies), vi.mocked(listLibraryPacks), vi.mocked(saveSocialSettings), vi.mocked(updateLanguage), vi.mocked(deleteLanguage), vi.mocked(completeNewsletterConnect)]) m.mockReset();
  session = null;
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_A });
  summary.mockResolvedValue({ kind: "ok", data: ALL_SEVEN } as never);
  seenCall.mockImplementation((async (_menu: string, watermark: string) => ({ kind: "ok", data: entry(watermark, "100") })) as never);
  vi.mocked(listLanguages).mockResolvedValue(ok([VI, FR]) as never);
  vi.mocked(listCurrencies).mockResolvedValue(ok([VND, currency()]) as never);
  vi.mocked(listLibraryPacks).mockResolvedValue(ok([]) as never);
  reads.translations.mockResolvedValue(ok(frList("12")) as never);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllEnvs();
});

describe("each screen says 'seen' for its own stream with the watermark of its own read", () => {
  const cases: Array<[string, string, () => void, React.ReactNode]> = [
    ["Hero → website-hero (body)", "website-hero:11", () => reads.hero.mockResolvedValue(ok(hero("11")) as never), <HeroPanel key="a" />],
    ["Menus → website-menus (body)", "website-menus:12", () => reads.menus.mockResolvedValue(ok(menu("12")) as never), <MenusPanel key="a" />],
    ["Social → website-social (body)", "website-social:13", () => reads.social.mockResolvedValue(ok(social("13")) as never), <SocialMediaPanel key="a" />],
    ["Sender → newsletter-sender (body)", "newsletter-sender:14", () => reads.sender.mockResolvedValue(ok(sender("14")) as never), <NewsletterSenderPanel key="a" />],
    ["Currencies → website-currencies (header)", "website-currencies:15", () => reads.currencies.mockResolvedValue(items([VND], "15") as never), <CurrenciesPanel key="a" />],
    [
      "Languages → website-languages (headers of languages and library)", "website-languages:16",
      () => { reads.languages.mockResolvedValue(items([VI], "16") as never); reads.library.mockResolvedValue(items([], "17") as never); }, <LanguagesPanel key="a" />,
    ],
    ["Translations → website-translations (body of translations)", "website-translations:12", () => undefined, <TranslationsPanel key="a" initialLocale="fr" />],
  ];

  it.each(cases)("%s, once, and nothing for any other menu", async (_name, expected, script, node) => {
    script();
    mount(node);
    await waitFor(() => expect(sent()).toEqual([expected]));
    await flush();
    expect(sent()).toEqual([expected]);
  });

  it("the OAuth callback page is never an acknowledgement: it forwards the code once and says nothing, whatever it answers", async () => {
    vi.mocked(completeNewsletterConnect).mockResolvedValue(ok({ ...sender("77"), status: "Connected" as const, connectedEmail: "owner@gmail.test" }) as never);
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, pathname: "/website/newsletter/sender/callback", search: `?state=${"S".repeat(43)}&code=abc`, hash: "" } });
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
    mount(<NewsletterSenderCallback />);
    await screen.findByTestId("callback-connected");
    await flush();
    expect(completeNewsletterConnect).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([]);
    replace.mockRestore();
  });
});

describe("a read that is not shown, current and marked says nothing", () => {
  it.each([["missing", undefined], ["malformed", "007"]])("data with a %s watermark renders and is never acknowledged (an older backend)", async (_label, value) => {
    reads.hero.mockResolvedValue(ok({ ...hero(), ...(value ? { viewWatermark: value } : {}) }) as never);
    mount(<HeroPanel />);
    await screen.findByTestId("hero-slides");
    await flush();
    expect(sent()).toEqual([]);
  });

  it("a failed read is an error panel and says nothing", async () => {
    reads.currencies.mockResolvedValue({ kind: "network", message: "Không kết nối được." } as never);
    mount(<CurrenciesPanel />);
    await screen.findByTestId("website-load-error");
    await flush();
    expect(sent()).toEqual([]);
  });

  it("a Staff member without WebsiteSettingsManage never reaches the screen's read, so nothing is read or said", async () => {
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: { ...STAFF_A, permissions: [] } });
    mount(<CurrenciesPanel />);
    await flush(200);
    expect(reads.currencies).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
  });

  it("a save's answer carries no mark and says nothing (a write is never an acknowledgement)", async () => {
    reads.social.mockResolvedValue(ok(social("13")) as never);
    vi.mocked(saveSocialSettings).mockResolvedValue(ok({ ...social("99"), revision: 2, phoneNumber: "0911111111" }) as never);
    mount(<SocialMediaPanel />);
    await waitFor(() => expect(sent()).toEqual(["website-social:13"]));
    await userEvent.type(await screen.findByLabelText("Số điện thoại"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(saveSocialSettings).toHaveBeenCalledTimes(1));
    await flush();
    expect(sent()).toEqual(["website-social:13"]);
  });
});

describe("Languages: one stream behind two reads", () => {
  it("waits for BOTH reads and says the lower watermark; the pack dialog's own library read and the currency lookup say nothing", async () => {
    const library = deferred<ReturnType<typeof items>>();
    reads.languages.mockResolvedValue(items([VI, FR], "30") as never);
    reads.library.mockReturnValue(library.promise as never);
    mount(<LanguagesPanel />);
    await screen.findByTestId("language-card-vi");
    await flush();
    expect(sent()).toEqual([]);                                                          // the cards are shown, the library is still out: not yet

    await act(async () => { library.resolve(items([], "25")); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["website-languages:25"]));              // min(30, 25), compared as integers

    await userEvent.click(within(screen.getByTestId("add-language")).getByRole("button"));
    await waitFor(() => expect(vi.mocked(listLibraryPacks)).toHaveBeenCalled());        // the dialog reads the library for itself (a bare array)
    await flush();
    expect(sent()).toEqual(["website-languages:25"]);                                    // and the currency lookup (listCurrencies) never became website-currencies
  });

  it("a reload (a card switched, a pack applied) reads both again, so the lower mark advances with it", async () => {
    const EN = lang({ code: "en", displayName: "English", nativeName: "English", isActive: false, isDefault: false, version: 2, sortOrder: 30 });
    reads.languages.mockResolvedValue(items([VI, EN], "30") as never);
    reads.library.mockResolvedValue(items([], "25") as never);
    vi.mocked(updateLanguage).mockResolvedValue(ok({ ...EN, isActive: true, version: 3 }) as never);
    mount(<LanguagesPanel />);
    await waitFor(() => expect(sent()).toEqual(["website-languages:25"]));

    reads.languages.mockResolvedValue(items([VI, EN], "40") as never);
    reads.library.mockResolvedValue(items([], "38") as never);
    await userEvent.click(within(screen.getByTestId("switch-en")).getByRole("button"));
    await waitFor(() => expect(sent()).toEqual(["website-languages:25", "website-languages:38"]));      // min(40, 38); the library's 25 would have stayed the mark forever
    expect(reads.library).toHaveBeenCalledTimes(2);
  });

  it("the server check after a lost save finishes from the languages read; the ack waits for the library and then says the lower mark (C1)", async () => {
    reads.languages.mockResolvedValue(items([VI, FR], "30") as never);
    reads.library.mockResolvedValue(items([], "25") as never);
    vi.mocked(deleteLanguage).mockResolvedValue({ kind: "unverified", message: "Máy chủ Admin không trả lời." } as never);
    mount(<LanguagesPanel />);
    await waitFor(() => expect(sent()).toEqual(["website-languages:25"]));
    await userEvent.click(within(screen.getByTestId("delete-fr")).getByRole("button"));
    await userEvent.click(within(screen.getByTestId("dialog-confirm")).getByRole("button"));
    await screen.findByTestId("write-unverified");

    const libraryRead = deferred<ReturnType<typeof items>>();
    reads.languages.mockResolvedValue(items([VI], "40") as never);
    reads.library.mockReturnValueOnce(libraryRead.promise as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("fr không còn trên máy chủ");
    expect(within(screen.getByTestId("dialog-cancel")).getByRole("button")).toBeEnabled();
    await flush();
    expect(sent()).toEqual(["website-languages:25"]);                                    // the library is still out: no new ack

    await act(async () => { libraryRead.resolve(items([], "38")); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["website-languages:25", "website-languages:38"]));      // min(40, 38)
  });

  it("a failed library read after a reload leaves the server check done and says nothing new", async () => {
    reads.languages.mockResolvedValue(items([VI, FR], "30") as never);
    reads.library.mockResolvedValue(items([], "25") as never);
    vi.mocked(deleteLanguage).mockResolvedValue({ kind: "unverified", message: "Máy chủ Admin không trả lời." } as never);
    mount(<LanguagesPanel />);
    await waitFor(() => expect(sent()).toEqual(["website-languages:25"]));
    await userEvent.click(within(screen.getByTestId("delete-fr")).getByRole("button"));
    await userEvent.click(within(screen.getByTestId("dialog-confirm")).getByRole("button"));
    await screen.findByTestId("write-unverified");

    reads.languages.mockResolvedValue(items([VI], "40") as never);
    reads.library.mockResolvedValue({ kind: "network", message: "x" } as never);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("fr không còn trên máy chủ");
    await flush();
    expect(sent()).toEqual(["website-languages:25"]);
  });

  it("a library read without a valid mark means no acknowledgement at all (the cards alone are not enough)", async () => {
    reads.languages.mockResolvedValue(items([VI], "30") as never);
    reads.library.mockResolvedValue(items([]) as never);
    mount(<LanguagesPanel />);
    await screen.findByTestId("language-card-vi");
    await flush();
    expect(sent()).toEqual([]);
  });
});

describe("Translations: only its own list says 'seen', and only for the view on screen", () => {
  const FIRST_PAGE = (viewWatermark: string) => ok(frList(viewWatermark, { total: 60, pageSize: 25 })) as never;

  it("the language picker never says (or lowers) anything; a new filter or page is a new read with its own watermark", async () => {
    reads.translations.mockResolvedValue(FIRST_PAGE("12"));
    mount(<TranslationsPanel initialLocale="fr" />);
    await screen.findByTestId("translation-rows");
    await waitFor(() => expect(sent()).toEqual(["website-translations:12"]));
    expect(vi.mocked(listLanguages)).toHaveBeenCalled();                                  // the picker was read, with no say

    reads.translations.mockResolvedValue(FIRST_PAGE("15"));
    await userEvent.selectOptions(screen.getByTestId("status-select"), "missing");
    await waitFor(() => expect(sent()).toEqual(["website-translations:12", "website-translations:15"]));

    reads.translations.mockResolvedValue(FIRST_PAGE("18"));
    await userEvent.click(within(screen.getByTestId("page-next")).getByRole("button"));
    await waitFor(() => expect(sent()).toEqual(["website-translations:12", "website-translations:15", "website-translations:18"]));
  });

  it("an answer for an older filter that arrives after a newer one is dropped, and so is its watermark", async () => {
    const slow = deferred<unknown>();
    const fast = deferred<unknown>();
    reads.translations.mockResolvedValueOnce(FIRST_PAGE("12")).mockReturnValueOnce(slow.promise as never).mockReturnValueOnce(fast.promise as never);
    mount(<TranslationsPanel initialLocale="fr" />);
    await waitFor(() => expect(sent()).toEqual(["website-translations:12"]));

    await userEvent.selectOptions(screen.getByTestId("status-select"), "missing");
    await userEvent.selectOptions(screen.getByTestId("status-select"), "todo");
    await act(async () => { fast.resolve(FIRST_PAGE("20")); await Promise.resolve(); });
    await waitFor(() => expect(sent()).toEqual(["website-translations:12", "website-translations:20"]));
    await act(async () => { slow.resolve(FIRST_PAGE("14")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual(["website-translations:12", "website-translations:20"]);
  });

  it("a read of the language you left that answers after you switched is dropped", async () => {
    const late = deferred<unknown>();
    reads.translations.mockResolvedValueOnce(FIRST_PAGE("12")).mockReturnValueOnce(late.promise as never);
    mount(<TranslationsPanel initialLocale="fr" />);
    await waitFor(() => expect(sent()).toEqual(["website-translations:12"]));

    await userEvent.selectOptions(screen.getByTestId("status-select"), "missing");      // a read for FR/missing is out …
    reads.translations.mockResolvedValue(ok(translations({ viewWatermark: "21" })) as never);
    await userEvent.selectOptions(screen.getByTestId("locale-select"), "vi");           // … and the screen moves to VI
    await waitFor(() => expect(sent()).toEqual(["website-translations:12", "website-translations:21"]));
    await act(async () => { late.resolve(FIRST_PAGE("13")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual(["website-translations:12", "website-translations:21"]);
  });
});

describe("the session decides who says it, through the one shared pipeline", () => {
  it("a read started by Staff A that answers after Staff B took over is not used to acknowledge for B", async () => {
    const late = deferred<unknown>();
    reads.currencies.mockReturnValueOnce(late.promise as never);
    mount(<CurrenciesPanel />);
    await waitFor(() => expect(reads.currencies).toHaveBeenCalledTimes(1));

    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: STAFF_B });
    reads.currencies.mockResolvedValue(items([VND], "9") as never);
    await act(async () => { await session!.refresh(); });
    await waitFor(() => expect(sent()).toEqual(["website-currencies:9"]));

    await act(async () => { late.resolve(items([VND], "5")); await Promise.resolve(); });
    await flush();
    expect(sent()).toEqual(["website-currencies:9"]);
  });

  it("a menu the latest summary does not list yet keeps the watermark of the read that WAS shown, and says it once the summary lists the menu (never the summary's own)", async () => {
    summary.mockResolvedValue({ kind: "ok", data: {} } as never);
    reads.currencies.mockResolvedValue(items([VND], "5") as never);
    mount(<><Count menu="website-currencies" /><CurrenciesPanel /></>);
    await screen.findByTestId("currencies-panel");
    await flush();
    expect(sent()).toEqual([]);                                                          // not listed: nothing is said yet

    summary.mockResolvedValue({ kind: "ok", data: { "website-currencies": entry("0", "9", 3) } } as never);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(sent()).toEqual(["website-currencies:5"]), { timeout: 4000 });
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));      // the badge is the server's answer to the POST, not ours
    expect(reads.currencies).toHaveBeenCalledTimes(1);
  });
});
