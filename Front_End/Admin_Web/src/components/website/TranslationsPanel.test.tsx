/**
 * CUST-WEB-HEADER-001-CP02: the UI translations screen against a mocked Admin API client — which language is picked,
 * the filters, the local placeholder/plain-text checks, create-override vs update (expectedVersion null vs number),
 * removing an override, and the same refusal / stale / lost-answer handling as the other screens.
 */
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  listTranslations: vi.fn(),
  saveTranslation: vi.fn(),
  clearTranslation: vi.fn(),
}));

import TranslationsPanel from "./TranslationsPanel";
import { ALLOWED, btn, deferred, lang, ok, renderInGate, row, translations } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { clearTranslation, listLanguages, listTranslations, saveTranslation } from "@/lib/api/website";

const languages = vi.mocked(listLanguages);
const listRows = vi.mocked(listTranslations);
const save = vi.mocked(saveTranslation);
const clear = vi.mocked(clearTranslation);

const VI = lang();
const EN = lang({ code: "en", displayName: "English", nativeName: "English", sortOrder: 20, isActive: true, isDefault: false, translatedKeys: 1 });
const refused = (status: number, code: string, detail: string, field: string | null = null) => ({ kind: "refused" as const, status, code, field, detail });

/** An English view: one translated row, one that falls back to Vietnamese, one with a placeholder. */
const EN_VIEW = translations({
  locale: "en", isDefaultLocale: false, translatedKeys: 1, totalKeys: 3,
  rows: [
    row({ key: "common.close", sourceText: "Đóng", value: "Close", effectiveValue: "Close", hasOverride: true, isFallback: false, version: 6 }),
    row({ key: "header.menu.offers", group: "header-menu", sourceText: "Ưu đãi", value: null, effectiveValue: "Ưu đãi", hasOverride: false, isFallback: true, version: null as never, updatedAtUtc: null as never }),
    row({ key: "common.error.loadFailed", sourceText: "Đã có lỗi khi tải {what}.", placeholders: ["what"], value: null, effectiveValue: "Đã có lỗi khi tải {what}.", hasOverride: false, isFallback: true, version: null as never, updatedAtUtc: null as never }),
  ],
});
const VI_VIEW = translations();

async function open(initialLocale: string | null = null) {
  renderInGate(<TranslationsPanel initialLocale={initialLocale} />, "/website/translations");
  await screen.findByTestId("locale-select");
  await screen.findByTestId("coverage");
}
const paste = async (testId: string, text: string) => {
  await userEvent.clear(screen.getByTestId(testId));
  await userEvent.click(screen.getByTestId(testId));
  await userEvent.paste(text);
};

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const fn of [languages, listRows, save, clear]) fn.mockReset();
  languages.mockResolvedValue(ok([VI, EN]));
  listRows.mockImplementation(async (locale) => ok(locale === "en" ? EN_VIEW : VI_VIEW));
});
afterEach(cleanup);

describe("choosing the language", () => {
  it("starts on the default language", async () => {
    await open();
    expect(screen.getByTestId("locale-select")).toHaveValue("vi");
    expect(listRows).toHaveBeenLastCalledWith("vi", { group: "", search: "" }, expect.anything());
    expect(screen.getByTestId("coverage")).toHaveTextContent("the default language keeps all of them");
  });

  it("starts on the language the link asked for, case-insensitively; an unknown one falls back to the default", async () => {
    await open("EN");
    expect(screen.getByTestId("locale-select")).toHaveValue("en");
    cleanup();
    listRows.mockClear();
    await open("zz");
    expect(screen.getByTestId("locale-select")).toHaveValue("vi");
  });

  it("changing the language loads that language and shows what falls back", async () => {
    await open();
    await userEvent.selectOptions(screen.getByTestId("locale-select"), "en");
    await waitFor(() => expect(screen.getByTestId("coverage")).toHaveTextContent("the other 2 use the vi text"));
    expect(within(screen.getByTestId("row-header.menu.offers")).getByText("Uses the vi text")).toBeInTheDocument();
    expect(within(screen.getByTestId("row-common.close")).queryByText("Uses the vi text")).toBeNull();
    expect(within(screen.getByTestId("row-common.close")).getByText("Edit")).toBeInTheDocument();
    expect(within(screen.getByTestId("row-header.menu.offers")).getByText("Translate")).toBeInTheDocument();
  });

  it("a group filter and a search (after the pause) are sent to the server", async () => {
    await open();
    await userEvent.selectOptions(screen.getByTestId("group-select"), "common");
    await waitFor(() => expect(listRows).toHaveBeenLastCalledWith("vi", { group: "common", search: "" }, expect.anything()));
    await userEvent.type(screen.getByTestId("search-input"), "menu");
    await waitFor(() => expect(listRows).toHaveBeenLastCalledWith("vi", { group: "common", search: "menu" }, expect.anything()));
  });

  it("no match shows a plain message", async () => {
    listRows.mockResolvedValue(ok(translations({ rows: [] })));
    await open();
    expect(screen.getByTestId("no-rows")).toHaveTextContent("Nothing matches.");
  });

  it("no languages at all points to the Languages screen", async () => {
    languages.mockResolvedValue(ok([]));
    renderInGate(<TranslationsPanel initialLocale={null} />, "/website/translations");
    expect(await screen.findByText(/There are no languages yet/)).toBeInTheDocument();
    expect(listRows).not.toHaveBeenCalled();
  });

  it("a failed load is an error with Retry", async () => {
    listRows.mockResolvedValueOnce({ kind: "network", message: "The Admin API is unreachable." });
    renderInGate(<TranslationsPanel initialLocale={null} />, "/website/translations");
    expect(await screen.findByText(/unreachable/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("coverage")).toBeInTheDocument();
  });
});

describe("the local checks (the server decides again)", () => {
  async function openDialog(key: string) {
    await open("en");
    await userEvent.click(btn(`edit-${key}`));
    await screen.findByTestId("translation-dialog");
  }

  it.each([
    ["empty", "", /Enter the text/],
    ["markup", "<b>Close</b>", /Plain text only/],
    ["a line break", "a\nb", /No line breaks/],
    ["a stray brace", "Close }", /must be part of a placeholder/],
    ["too long", "x".repeat(1001), /At most 1000/],
  ])("%s is refused without a request", async (_label, text, message) => {
    await openDialog("common.close");
    const field = screen.getByTestId("field-value");
    await userEvent.clear(field);
    if (text) fireEvent.change(field, { target: { value: text } });
    await userEvent.click(btn("dialog-save"));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("a placeholder the key declares must stay, and one it does not declare is refused", async () => {
    await openDialog("common.error.loadFailed");
    await paste("field-value", "Could not load.");
    await userEvent.click(btn("dialog-save"));
    expect(screen.getByText("Keep the placeholder {what}.")).toBeInTheDocument();
    await paste("field-value", "Could not load {what} {who}.");
    await userEvent.click(btn("dialog-save"));
    expect(screen.getByText("{who} is not declared for this key.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("saving", () => {
  it("a key with no override creates one: expectedVersion null; the text is trimmed; the list is re-read", async () => {
    await open("en");
    await userEvent.click(btn("edit-header.menu.offers"));
    expect(screen.getByTestId("source-text")).toHaveTextContent("Ưu đãi");
    expect(screen.getByTestId("translation-dialog")).toHaveTextContent("Currently shown from vi: Ưu đãi");
    await paste("field-value", "  Special offers  ");
    save.mockResolvedValue(ok(row({ key: "header.menu.offers", value: "Special offers", version: 1 })));
    listRows.mockImplementation(async () => ok({ ...EN_VIEW, rows: EN_VIEW.rows.map((r) => (r.key === "header.menu.offers" ? { ...r, value: "Special offers", effectiveValue: "Special offers", hasOverride: true, isFallback: false, version: 1 } : r)) }));
    await userEvent.dblClick(btn("dialog-save"));
    await waitFor(() => expect(screen.queryByTestId("translation-dialog")).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("en", "header.menu.offers", "Special offers", null);
    expect(await screen.findByTestId("website-success")).toHaveTextContent("Saved header.menu.offers (en).");
    await waitFor(() => expect(screen.getByTestId("value-header.menu.offers")).toHaveTextContent("Special offers"));
  });

  it("an existing override is updated with the version it loaded", async () => {
    await open("en");
    await userEvent.click(btn("edit-common.close"));
    expect(screen.getByTestId("field-value")).toHaveValue("Close");
    await paste("field-value", "Dismiss");
    save.mockResolvedValue(ok(row({ value: "Dismiss", version: 7 })));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith("en", "common.close", "Dismiss", 6));
  });

  it("a placeholder is kept and sent as typed", async () => {
    await open("en");
    await userEvent.click(btn("edit-common.error.loadFailed"));
    await paste("field-value", "Could not load {what}.");
    save.mockResolvedValue(ok(row({ key: "common.error.loadFailed", value: "Could not load {what}." })));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith("en", "common.error.loadFailed", "Could not load {what}.", null));
  });

  it("a server refusal on the value shows beside the field and keeps the draft", async () => {
    await open("en");
    await userEvent.click(btn("edit-common.close"));
    await paste("field-value", "Dismiss");
    save.mockResolvedValue(refused(400, "validation", "The text must be plain text.", "value"));
    await userEvent.click(btn("dialog-save"));
    expect(await screen.findByText("The text must be plain text.")).toBeInTheDocument();
    expect(screen.getByTestId("field-value")).toHaveValue("Dismiss");
  });

  it("stale: draft kept; Reload shows the server's text; the next save uses the server's version", async () => {
    await open("en");
    await userEvent.click(btn("edit-common.close"));
    await paste("field-value", "Dismiss");
    save.mockResolvedValueOnce(refused(409, "stale-version", "changed"));
    await userEvent.click(btn("dialog-save"));
    await screen.findByTestId("write-refused");
    listRows.mockImplementation(async () => ok({ ...EN_VIEW, rows: EN_VIEW.rows.map((r) => (r.key === "common.close" ? { ...r, value: "Shut", effectiveValue: "Shut", version: 11 } : r)) }));
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByText(/version 11: "Shut"/)).toBeInTheDocument();
    expect(screen.getByTestId("field-value")).toHaveValue("Dismiss");
    save.mockResolvedValueOnce(ok(row({ value: "Dismiss", version: 12 })));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]).toEqual(["en", "common.close", "Dismiss", 11]);
  });

  it("a lost answer blocks a second send until the server has been read", async () => {
    await open("en");
    await userEvent.click(btn("edit-common.close"));
    await paste("field-value", "Dismiss");
    save.mockResolvedValue({ kind: "unverified", message: "no answer" });
    await userEvent.click(btn("dialog-save"));
    await screen.findByTestId("write-unverified");
    expect(btn("dialog-save")).toBeDisabled();
    expect(screen.getByTestId("field-value")).toBeDisabled();
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByText(/Latest on the server — version 6: "Close"/)).toBeInTheDocument();
    expect(btn("dialog-save")).toBeEnabled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("the Save button is held while another write is on the wire", async () => {
    await open("en");
    await userEvent.click(btn("edit-common.close"));
    await paste("field-value", "Dismiss");
    const pending = deferred<ReturnType<typeof ok>>();
    save.mockReturnValue(pending.promise as never);
    await userEvent.click(btn("dialog-save"));
    expect(screen.getByTestId("write-pending")).toBeInTheDocument();
    expect(btn("dialog-save")).toBeDisabled();
    expect(btn("dialog-cancel")).toBeDisabled();
    await act(async () => pending.resolve(ok(row({ value: "Dismiss" }))));
  });
});

describe("removing an override", () => {
  it("is offered only for a non-default language that has one, asks first, and sends the version", async () => {
    await open("en");
    await userEvent.click(btn("edit-header.menu.offers")); // no override
    expect(screen.queryByTestId("remove-text")).toBeNull();
    await userEvent.click(btn("dialog-cancel"));

    await userEvent.click(btn("edit-common.close"));
    await userEvent.click(btn("remove-text"));
    expect(screen.getByTestId("remove-confirm")).toHaveTextContent("It will use the vi text again");
    await userEvent.click(btn("remove-confirm-no"));
    expect(clear).not.toHaveBeenCalled();

    await userEvent.click(btn("remove-text"));
    clear.mockResolvedValue(ok(row()));
    await userEvent.click(btn("remove-confirm-yes"));
    await waitFor(() => expect(clear).toHaveBeenCalledWith("en", "common.close", 6));
    expect(await screen.findByTestId("website-success")).toHaveTextContent("Removed the en text of common.close; it uses the vi text again.");
  });

  it("the default language can never remove a text", async () => {
    await open();
    await userEvent.click(btn("edit-common.close"));
    expect(screen.queryByTestId("remove-text")).toBeNull();
  });
});

describe("access changes while a dialog is open", () => {
  it("a 403 re-reads me; the permission gone closes the screen", async () => {
    await open("en");
    await userEvent.click(btn("edit-common.close"));
    await paste("field-value", "Dismiss");
    save.mockResolvedValue({ kind: "denied" });
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: { ...ALLOWED, permissions: [] } });
    await userEvent.click(btn("dialog-save"));
    expect(await screen.findByTestId("website-no-permission")).toBeInTheDocument();
    expect(screen.queryByTestId("translations-panel")).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
