/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the "Ngôn ngữ & bản dịch" screen against a mocked Admin API client — what the cards say (a
 * fallback never counts as translated), what each action sends (exactly once, with the version the card was read at), how a
 * refusal / a stale version / a lost answer is handled, and that the export hands the server's file to the browser untouched.
 */
import React from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/staff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/staff")>()),
  fetchStaffSession: vi.fn(),
  staffLogout: vi.fn(),
}));
vi.mock("@/lib/api/website", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/website")>()),
  listLanguages: vi.fn(),
  listCurrencies: vi.fn(),
  createLanguage: vi.fn(),
  updateLanguage: vi.fn(),
  setDefaultLanguage: vi.fn(),
  deleteLanguage: vi.fn(),
  exportPack: vi.fn(),
  listLibraryPacks: vi.fn(),
}));
vi.mock("@/lib/website/download", () => ({ downloadText: vi.fn() }));

import LanguagesPanel from "./LanguagesPanel";
import { ALLOWED, btn, currency, deferred, lang, ok, renderInGate, VND } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { createLanguage, deleteLanguage, exportPack, listCurrencies, listLanguages, listLibraryPacks, setDefaultLanguage, updateLanguage } from "@/lib/api/website";
import { downloadText } from "@/lib/website/download";

const list = vi.mocked(listLanguages);
const currencies = vi.mocked(listCurrencies);
const create = vi.mocked(createLanguage);
const update = vi.mocked(updateLanguage);
const makeDefault = vi.mocked(setDefaultLanguage);
const remove = vi.mocked(deleteLanguage);
const exportOne = vi.mocked(exportPack);
const library = vi.mocked(listLibraryPacks);

const VI = lang();
const FR_INCOMPLETE = lang({ code: "fr", displayName: "French", nativeName: "Français", sortOrder: 20, isActive: false, isDefault: false, version: 3, formatLocale: "fr-FR", requiredKeys: 100, translatedKeys: 60, missingKeys: 40, outdatedKeys: 2, manualKeys: 5, isComplete: false, defaultCurrencyCode: "EUR" });
const EN = lang({ code: "en", displayName: "English", nativeName: "English", sortOrder: 30, isActive: false, isDefault: false, version: 2, formatLocale: "en-US", defaultCurrencyCode: "USD" });
const USD = currency({ isActive: true, vndPerUnit: "26060", rateUpdatedAtUtc: "2026-10-15T00:00:00+00:00" });
const refused = (status: number, code: string, detail: string, field: string | null = null) => ({ kind: "refused" as const, status, code, field, detail });

async function open() {
  renderInGate(<LanguagesPanel />);
  await screen.findByTestId("languages-panel");
  await screen.findByTestId("language-card-vi");
}

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const fn of [list, currencies, create, update, makeDefault, remove, exportOne, library, vi.mocked(downloadText)]) fn.mockReset();
  list.mockResolvedValue(ok([VI, FR_INCOMPLETE, EN]));
  currencies.mockResolvedValue(ok([VND, USD]));
  library.mockResolvedValue(ok([]));
});
afterEach(cleanup);

describe("the cards", () => {
  it("show the real coverage, the state of each language and what a language still needs", async () => {
    await open();
    expect(screen.getByText("3 ngôn ngữ")).toBeInTheDocument();
    const vi_ = screen.getByTestId("language-card-vi");
    expect(within(vi_).getByText("Mặc định")).toBeInTheDocument();
    expect(within(vi_).getByText("Đang bật")).toBeInTheDocument();
    expect(within(vi_).getByText(/Đã dịch 25\/25/)).toBeInTheDocument();
    expect(within(vi_).queryByTestId("default-vi")).toBeNull(); // the default cannot be made default, switched off or deleted
    expect(within(vi_).queryByTestId("delete-vi")).toBeNull();
    const fr = screen.getByTestId("language-card-fr");
    expect(within(fr).getByText("Đã tắt")).toBeInTheDocument();
    expect(within(fr).getByText(/Đã dịch 60\/100/)).toBeInTheDocument();
    expect(screen.getByTestId("coverage-fr")).toHaveTextContent("Thiếu 40 · Cần cập nhật 2 · Chỉnh tay 5");
    expect(within(fr).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
    expect(within(fr).getByRole("link", { name: "Dịch" })).toHaveAttribute("href", "/website/translations?locale=fr");
  });

  it("a language that is not complete cannot be switched on from the card", async () => {
    await open();
    expect(btn("switch-fr")).toBeDisabled();
    expect(within(screen.getByTestId("switch-fr")).getByRole("button")).toHaveTextContent("Chưa đủ để bật");
    expect(btn("switch-en")).toBeEnabled(); // complete: it may be switched on
  });

  it("a failed load is an error with Thử lại that reads the server again", async () => {
    list.mockResolvedValueOnce({ kind: "network", message: "Không kết nối được tới máy chủ Admin." });
    renderInGate(<LanguagesPanel />);
    expect(await screen.findByText(/Không kết nối được/)).toBeInTheDocument();
    list.mockResolvedValueOnce(ok([VI]));
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByTestId("language-card-vi")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe("switching a language on and off", () => {
  it("sends one update with the card's version and every other field unchanged, then reads the server again", async () => {
    update.mockResolvedValue(ok({ ...EN, isActive: true, version: 3 }));
    await open();
    await userEvent.click(btn("switch-en"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("en", 2, {
      displayName: "English", nativeName: "English", sortOrder: 30, isActive: true, defaultCurrencyCode: "USD", direction: "ltr", formatLocale: "en-US",
    });
    expect(await screen.findByTestId("website-success")).toHaveTextContent("English (en) đã được bật.");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("shows the server's reason in Vietnamese when it refuses, and reads the card again", async () => {
    update.mockResolvedValue(refused(409, "language-incomplete", "Language en is missing 3 required texts."));
    await open();
    await userEvent.click(btn("switch-en"));
    expect(await screen.findByTestId("website-problem")).toHaveTextContent("Ngôn ngữ chưa đủ bản dịch bắt buộc nên chưa bật được");
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe("the default currency of a language", () => {
  it("is chosen from the active currencies and saved with the rest of the language unchanged", async () => {
    update.mockResolvedValue(ok({ ...FR_INCOMPLETE, defaultCurrencyCode: "USD", version: 4 }));
    await open();
    const select = screen.getByTestId("currency-fr") as HTMLSelectElement;
    // the active currencies, plus the language's own current choice when that currency has since been switched off
    expect([...select.options].map((option) => option.value)).toEqual(["", "VND", "USD", "EUR"]);
    expect(select.options[3]).toHaveTextContent("EUR (đang tắt)");
    await userEvent.selectOptions(select, "USD");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("fr", 3, expect.objectContaining({ defaultCurrencyCode: "USD", isActive: false, formatLocale: "fr-FR", nativeName: "Français" }));
  });
});

describe("export", () => {
  it("hands the server's pack to the browser as a file and sends nothing else", async () => {
    exportOne.mockResolvedValue(ok('{"schema":"bha.language-pack/1"}'));
    await open();
    await userEvent.click(btn("export-fr"));
    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(1));
    expect(downloadText).toHaveBeenCalledWith("bha-language-fr.json", '{"schema":"bha.language-pack/1"}');
    expect(exportOne).toHaveBeenCalledWith("fr");
    expect(update).not.toHaveBeenCalled();
  });

  it("says so when the export fails and downloads nothing", async () => {
    exportOne.mockResolvedValue(refused(404, "validation", "no such language"));
    await open();
    await userEvent.click(btn("export-fr"));
    await waitFor(() => expect(screen.getByTestId("website-problem")).toBeInTheDocument());
    expect(downloadText).not.toHaveBeenCalled();
  });
});

describe("making a language the default, and deleting it", () => {
  it("an active language can be made the default after a confirmation", async () => {
    list.mockResolvedValue(ok([VI, { ...EN, isActive: true }]));
    makeDefault.mockResolvedValue(ok({ ...EN, isActive: true, isDefault: true }));
    await open();
    await userEvent.click(btn("default-en"));
    expect(await screen.findByTestId("language-default-dialog")).toBeInTheDocument();
    await userEvent.click(btn("dialog-confirm"));
    await waitFor(() => expect(makeDefault).toHaveBeenCalledTimes(1));
    expect(makeDefault).toHaveBeenCalledWith("en", 2);
  });

  it("only an off, non-default language offers Xoá, and the confirmation sends one delete", async () => {
    remove.mockResolvedValue(ok(undefined));
    await open();
    expect(screen.queryByTestId("delete-vi")).toBeNull();
    await userEvent.click(btn("delete-fr"));
    await userEvent.click(btn("dialog-confirm"));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith("fr", 3);
    expect(await screen.findByTestId("website-success")).toHaveTextContent("Đã xoá fr.");
  });

  it("a lost answer blocks sending again until the server has been read", async () => {
    const pending = deferred<{ kind: "unverified"; message: string }>();
    remove.mockReturnValueOnce(pending.promise);
    await open();
    await userEvent.click(btn("delete-fr"));
    await userEvent.click(btn("dialog-confirm"));
    pending.resolve({ kind: "unverified", message: "Máy chủ Admin không trả lời." });
    expect(await screen.findByTestId("write-unverified")).toBeInTheDocument();
    expect(btn("dialog-confirm")).toBeDisabled();
    expect(remove).toHaveBeenCalledTimes(1);
    list.mockResolvedValueOnce(ok([VI, EN])); // the server shows fr is gone
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("fr không còn trên máy chủ");
  });
});

describe("creating an empty language by hand", () => {
  it("validates the code before sending and sends once with the chosen currency and direction", async () => {
    create.mockResolvedValue(ok(lang({ code: "es", isActive: false, isDefault: false })));
    await open();
    await userEvent.click(btn("create-manual"));
    await userEvent.type(screen.getByTestId("field-code"), "e");
    await userEvent.type(screen.getByTestId("field-displayName"), "Spanish");
    await userEvent.type(screen.getByTestId("field-nativeName"), "Español");
    await userEvent.click(btn("dialog-save"));
    expect(create).not.toHaveBeenCalled(); // "e" is not a language tag
    expect(await screen.findByText(/Dùng mã ngôn ngữ như vi/)).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("field-code"), "s");
    await userEvent.selectOptions(screen.getByTestId("field-currency"), "USD");
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith("es", expect.objectContaining({ displayName: "Spanish", nativeName: "Español", isActive: false, defaultCurrencyCode: "USD", direction: "ltr", formatLocale: "es" }));
  });
});
