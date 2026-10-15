/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: the translation editor against a mocked Admin API client — the server filters, pages and
 * counts; a row is "translated" only if its text exists; a draft survives a change of filter or page but not a silent change of
 * language; a save is sent once with the version the row had; a conflict keeps the draft; a lost answer is never retried.
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
  listTranslations: vi.fn(),
  saveTranslation: vi.fn(),
  clearTranslation: vi.fn(),
}));

import TranslationsPanel from "./TranslationsPanel";
import { ALLOWED, btn, deferred, lang, ok, renderInGate, row, translations } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { clearTranslation, listLanguages, listTranslations, saveTranslation } from "@/lib/api/website";

const languages = vi.mocked(listLanguages);
const rows = vi.mocked(listTranslations);
const save = vi.mocked(saveTranslation);
const clear = vi.mocked(clearTranslation);

const VI = lang();
const FR = lang({ code: "fr", displayName: "French", nativeName: "Français", isActive: false, isDefault: false, version: 3 });
const MISSING = row({ key: "customer.booking.hold", sourceText: "Giữ phòng {nights, plural, other {# đêm}}", placeholders: ["nights"], value: null, status: "missing", version: null, updatedAtUtc: null });
const DONE = row({ key: "customer.common.close", sourceText: "Đóng", value: "Fermer", status: "translated", version: 4, isManual: true });
const FR_LIST = translations({
  locale: "fr", isDefaultLocale: false, rows: [MISSING, DONE], total: 2,
  facets: { required: 100, translated: 60, missing: 38, outdated: 2, manual: 5, scopes: [{ name: "customer", count: 80 }, { name: "content", count: 20 }], groups: [{ name: "booking", count: 10 }, { name: "common", count: 90 }] },
});
const refused = (status: number, code: string, detail: string, field: string | null = null) => ({ kind: "refused" as const, status, code, field, detail });

/** Types into a row's box. (`userEvent.type` reads `{` as a key command; a pasted text is typed as it is.) */
async function fill(testId: string, text: string) {
  await userEvent.click(screen.getByTestId(testId));
  await userEvent.paste(text);
}

async function open(locale = "fr") {
  renderInGate(<TranslationsPanel initialLocale={locale} />, "/website/translations");
  await screen.findByTestId("translation-rows");
}

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const fn of [languages, rows, save, clear]) fn.mockReset();
  languages.mockResolvedValue(ok([VI, FR]));
  rows.mockResolvedValue(ok(FR_LIST));
});
afterEach(cleanup);

describe("the list", () => {
  it("shows the real coverage from the server's facets and asks for the texts that still need work", async () => {
    await open();
    expect(rows).toHaveBeenCalledWith("fr", { scope: "", group: "", status: "todo", search: "", reference: "", page: 1, pageSize: 25 }, expect.anything());
    expect(screen.getByTestId("coverage")).toHaveTextContent("đã dịch 60/100 câu bắt buộc (60%) · thiếu 38 · cần cập nhật 2 · chỉnh tay 5");
    const missing = screen.getByTestId("row-customer.booking.hold");
    expect(within(missing).getByText("Chưa dịch")).toBeInTheDocument();
    expect((screen.getByTestId("value-customer.booking.hold") as HTMLTextAreaElement).value).toBe(""); // a fallback is never shown as a translation
    expect(within(screen.getByTestId("row-customer.common.close")).getByText("Đã chỉnh tay")).toBeInTheDocument();
    expect(screen.getByTestId("source-customer.common.close")).toHaveTextContent("Đóng");
  });

  it("every filter goes to the server, and going back to page 1 when the filter changes", async () => {
    await open();
    await userEvent.selectOptions(screen.getByTestId("status-select"), "missing");
    await waitFor(() => expect(rows).toHaveBeenLastCalledWith("fr", expect.objectContaining({ status: "missing", page: 1 }), expect.anything()));
    await userEvent.click(screen.getByTestId("scope-content"));
    await waitFor(() => expect(rows).toHaveBeenLastCalledWith("fr", expect.objectContaining({ scope: "content", group: "" }), expect.anything()));
    await userEvent.selectOptions(screen.getByTestId("group-select"), "booking");
    await waitFor(() => expect(rows).toHaveBeenLastCalledWith("fr", expect.objectContaining({ group: "booking" }), expect.anything()));
    await userEvent.type(screen.getByTestId("search-input"), "giữ");
    await waitFor(() => expect(rows).toHaveBeenLastCalledWith("fr", expect.objectContaining({ search: "giữ" }), expect.anything()));
  });

  it("pages with the server's total", async () => {
    rows.mockResolvedValue(ok({ ...FR_LIST, total: 60, pageSize: 25 }));
    await open();
    expect(screen.getByTestId("page-info")).toHaveTextContent("Trang 1/3");
    await userEvent.click(btn("page-next"));
    await waitFor(() => expect(rows).toHaveBeenLastCalledWith("fr", expect.objectContaining({ page: 2 }), expect.anything()));
  });
});

describe("saving a text", () => {
  it("sends one save with the version the row had, then clears the draft and reads the server again", async () => {
    save.mockResolvedValue(ok({ ...MISSING, value: "Bloquer la chambre", status: "translated", version: 1, isManual: true }));
    await open();
    await fill("value-customer.booking.hold", "Bloquer {nights, plural, other {# nuit}}");
    await userEvent.click(btn("save-customer.booking.hold"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("fr", "customer.booking.hold", "Bloquer {nights, plural, other {# nuit}}", null);
    expect(await screen.findByTestId("website-success")).toHaveTextContent("Đã lưu câu customer.booking.hold (fr).");
    expect(screen.queryByTestId("dirty-count")).toBeNull();
    expect(rows.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("an edit of an existing text is checked against that text's version", async () => {
    save.mockResolvedValue(ok({ ...DONE, value: "Fermer la fenêtre", version: 5 }));
    await open();
    const box = screen.getByTestId("value-customer.common.close");
    await userEvent.clear(box);
    await userEvent.type(box, "Fermer la fenêtre");
    await userEvent.click(btn("save-customer.common.close"));
    await waitFor(() => expect(save).toHaveBeenCalledWith("fr", "customer.common.close", "Fermer la fenêtre", 4));
  });

  it("will not send a text that drops a variable, and says which one", async () => {
    await open();
    await fill("value-customer.booking.hold", "Bloquer la chambre");
    expect(await screen.findByRole("alert")).toHaveTextContent("Cần giữ lại {nights}.");
    expect(btn("save-customer.booking.hold")).toBeDisabled();
    await userEvent.click(screen.getByTestId("placeholder-customer.booking.hold-nights"));
    expect((screen.getByTestId("value-customer.booking.hold") as HTMLTextAreaElement).value).toContain("{nights}");
  });

  it("a stale version keeps the draft and offers the latest; it sends nothing a second time on its own", async () => {
    save.mockResolvedValue(refused(409, "stale-version", "changed"));
    await open();
    await fill("value-customer.booking.hold", "Bloquer {nights}");
    await userEvent.click(btn("save-customer.booking.hold"));
    expect(await screen.findByTestId("note-customer.booking.hold")).toHaveTextContent("Bản nháp của bạn vẫn được giữ");
    expect((screen.getByTestId("value-customer.booking.hold") as HTMLTextAreaElement).value).toBe("Bloquer {nights}");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a lost answer is not retried: the row asks the server first and recognises the saved text", async () => {
    const lost = deferred<{ kind: "unverified"; message: string }>();
    save.mockReturnValueOnce(lost.promise);
    await open();
    await fill("value-customer.booking.hold", "Bloquer {nights}");
    await userEvent.click(btn("save-customer.booking.hold"));
    lost.resolve({ kind: "unverified", message: "Máy chủ Admin không trả lời." });
    expect(await screen.findByTestId("note-customer.booking.hold")).toHaveTextContent("Hệ thống không tự gửi lại");
    rows.mockResolvedValueOnce(ok({ ...FR_LIST, rows: [{ ...MISSING, value: "Bloquer {nights}", status: "translated", version: 1 }, DONE] }));
    await userEvent.click(screen.getByTestId("refresh-customer.booking.hold"));
    expect(await screen.findByTestId("website-success")).toHaveTextContent("máy chủ đã có đúng nội dung này");
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("drafts", () => {
  it("survive a change of filter, and changing the language asks before dropping them", async () => {
    await open();
    await fill("value-customer.booking.hold", "Bloquer {nights}");
    expect(screen.getByTestId("dirty-count")).toHaveTextContent("Có 1 câu chưa lưu");
    await userEvent.selectOptions(screen.getByTestId("status-select"), "translated");
    await waitFor(() => expect(rows).toHaveBeenLastCalledWith("fr", expect.objectContaining({ status: "translated" }), expect.anything()));
    expect(screen.getByTestId("dirty-count")).toBeInTheDocument(); // the draft is still there
    await userEvent.selectOptions(screen.getByTestId("locale-select"), "vi");
    expect(screen.getByTestId("leave-warning")).toHaveTextContent("Có 1 câu chưa lưu");
    expect((screen.getByTestId("locale-select") as HTMLSelectElement).value).toBe("fr"); // not switched yet
    await userEvent.click(btn("leave-no"));
    expect(screen.queryByTestId("leave-warning")).toBeNull();
  });
});

describe("removing a text", () => {
  it("is offered only where a text exists and the language is not the default, and sends one clear with its version", async () => {
    clear.mockResolvedValue(ok({ ...DONE, value: null, status: "missing", version: null }));
    await open();
    expect(screen.queryByTestId("remove-customer.booking.hold")).toBeNull(); // nothing to remove
    await userEvent.click(btn("remove-customer.common.close"));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(clear).toHaveBeenCalledWith("fr", "customer.common.close", 4);
  });
});
