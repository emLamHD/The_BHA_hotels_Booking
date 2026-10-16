/**
 * CUST-WEB-HEADER-001-CP02-C2-R1: adding or updating a language from a pack — the check is the server's and changes nothing;
 * the apply is bound to the check by its token; a new choice voids the check; a stale check, a double click or a lost answer can
 * neither install twice nor report a success that did not happen.
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
  listLibraryPacks: vi.fn(),
  previewPack: vi.fn(),
  applyPack: vi.fn(),
  downloadPackTemplate: vi.fn(),
}));
vi.mock("@/lib/website/download", () => ({ downloadText: vi.fn() }));

import LanguagePackDialog from "./LanguagePackDialog";
import { ALLOWED, btn, deferred, lang, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { applyPack, downloadPackTemplate, listLibraryPacks, previewPack, type PackCounts, type PackPreview } from "@/lib/api/website";
import { downloadText } from "@/lib/website/download";

const library = vi.mocked(listLibraryPacks);
const preview = vi.mocked(previewPack);
const apply = vi.mocked(applyPack);
const template = vi.mocked(downloadPackTemplate);

const COUNTS: PackCounts = { required: 100, inPack: 100, added: 100, updated: 0, unchanged: 0, keptManual: 0, overwrittenManual: 0, ignored: 0, rejected: 0, missingAfter: 0, obsolete: 0 };
const FR_PREVIEW: PackPreview = {
  locale: "fr", displayName: "French", nativeName: "Français", packId: "bha.fr", packVersion: "7", mode: "keep-manual", isNewLanguage: true,
  languageVersion: null, defaultCurrency: "EUR", counts: COUNTS, issues: [], issuesTruncated: false, canApply: true, canEnable: true, previewToken: "token-1",
};
const FR_PACK = { id: "bha.fr", locale: "fr", displayName: "French", nativeName: "Français", version: "7", texts: 100, missingFromCatalog: 0, state: "available", installedVersion: null };
const refused = (status: number, code: string, detail: string) => ({ kind: "refused" as const, status, code, field: null, detail });

const onClose = vi.fn();
const onDone = vi.fn();
const reload = vi.fn();

async function open(tab: "library" | "upload" = "library", preselect: string | null = null) {
  renderInGate(<LanguagePackDialog initialTab={tab} preselect={preselect} languages={[lang()]} reload={reload} onClose={onClose} onDone={onDone} />);
  await screen.findByTestId("pack-dialog");
}

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const fn of [library, preview, apply, template, onClose, onDone, reload, vi.mocked(downloadText)]) fn.mockReset();
  library.mockResolvedValue(ok([FR_PACK, { ...FR_PACK, id: "bha.vi", locale: "vi", nativeName: "Tiếng Việt", state: "update-available", installedVersion: "6" }]));
  reload.mockResolvedValue([lang()]);
});
afterEach(cleanup);

describe("a pack from the library", () => {
  it("is checked on the server first (nothing is installed), and the preview says what would happen", async () => {
    preview.mockResolvedValue(ok({ ...FR_PREVIEW, counts: { ...COUNTS, added: 90, updated: 10, keptManual: 3 } }));
    await open();
    expect(await screen.findByTestId("library-fr")).toHaveTextContent("Chưa cài");
    expect(screen.getByTestId("library-vi")).toHaveTextContent("Có bản cập nhật");
    await userEvent.click(btn("library-pick-fr"));
    expect(await screen.findByTestId("pack-preview")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({ builtInPackId: "bha.fr" }, "keep-manual");
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByTestId("count-added")).toHaveTextContent("90");
    expect(screen.getByTestId("count-keptManual")).toHaveTextContent("3");
    expect(screen.getByTestId("pack-preview")).toHaveTextContent("100/100 câu bắt buộc — đủ để bật");
  });

  it("applies once with the preview's token and the enable choice, then reports it", async () => {
    preview.mockResolvedValue(ok(FR_PREVIEW));
    apply.mockResolvedValue(ok({ counts: COUNTS, enabled: true, language: lang({ code: "fr", nativeName: "Français" }) }));
    await open();
    await screen.findByTestId("library-fr");
    await userEvent.click(btn("library-pick-fr"));
    await screen.findByTestId("pack-preview");
    expect(screen.getByTestId("pack-enable")).toBeChecked(); // complete: offered on
    await userEvent.dblClick(btn("pack-apply"));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith({ builtInPackId: "bha.fr" }, "keep-manual", "token-1", true);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0][0]).toContain("Đã thêm ngôn ngữ Français (fr)");
  });

  it("changing the mode voids the check: it must be checked again before it can be applied", async () => {
    preview.mockResolvedValue(ok(FR_PREVIEW));
    await open();
    await screen.findByTestId("library-fr");
    await userEvent.click(btn("library-pick-fr"));
    await screen.findByTestId("pack-preview");
    await userEvent.click(screen.getByTestId("pack-mode-overwrite"));
    expect(screen.queryByTestId("pack-preview")).toBeNull();
    expect(screen.queryByTestId("pack-apply")).toBeNull();
    preview.mockResolvedValue(ok({ ...FR_PREVIEW, mode: "overwrite", previewToken: "token-2" }));
    await userEvent.click(btn("pack-recheck"));
    await screen.findByTestId("pack-preview");
    expect(preview).toHaveBeenLastCalledWith({ builtInPackId: "bha.fr" }, "overwrite");
  });

  it("a stale preview is refused with Vietnamese words and the check is cleared", async () => {
    preview.mockResolvedValue(ok(FR_PREVIEW));
    apply.mockResolvedValue(refused(409, "stale-preview", "The preview is stale."));
    await open();
    await screen.findByTestId("library-fr");
    await userEvent.click(btn("library-pick-fr"));
    await screen.findByTestId("pack-preview");
    await userEvent.click(btn("pack-apply"));
    expect(await screen.findByTestId("write-refused")).toHaveTextContent("Bản xem trước đã cũ");
    expect(screen.queryByTestId("pack-preview")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a lost answer is never retried: the operator reads the server, which says whether the pack is installed", async () => {
    preview.mockResolvedValue(ok(FR_PREVIEW));
    const lost = deferred<{ kind: "unverified"; message: string }>();
    apply.mockReturnValueOnce(lost.promise);
    await open();
    await screen.findByTestId("library-fr");
    await userEvent.click(btn("library-pick-fr"));
    await screen.findByTestId("pack-preview");
    await userEvent.click(btn("pack-apply"));
    lost.resolve({ kind: "unverified", message: "Máy chủ Admin không trả lời." });
    expect(await screen.findByTestId("write-unverified")).toBeInTheDocument();
    expect(btn("pack-apply")).toBeDisabled();
    reload.mockResolvedValueOnce([lang(), lang({ code: "fr", packId: "bha.fr", packVersion: "7" })]);
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByTestId("server-note")).toHaveTextContent("Việc cài đặt đã được ghi nhận");
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe("an uploaded file", () => {
  it("is read in the browser and sent to the server as text for the check — never as a URL", async () => {
    preview.mockResolvedValue(ok({ ...FR_PREVIEW, packId: "acme.es", locale: "es", nativeName: "Español" }));
    await open("upload");
    const file = new File(['{"schema":"bha.language-pack/1"}'], "es.json", { type: "application/json" });
    await userEvent.upload(screen.getByTestId("pack-file"), file);
    await userEvent.click(await screen.findByTestId("pack-check").then((holder) => within(holder).getByRole("button")));
    await screen.findByTestId("pack-preview");
    expect(preview).toHaveBeenCalledWith({ json: '{"schema":"bha.language-pack/1"}' }, "keep-manual");
  });

  it("a pack the server rejects shows its reason, offers no Apply, and installs nothing", async () => {
    preview.mockResolvedValue(refused(400, "pack-invalid", "Missing required key."));
    await open("upload");
    await userEvent.upload(screen.getByTestId("pack-file"), new File(["{}"], "bad.json", { type: "application/json" }));
    await userEvent.click(await screen.findByTestId("pack-check").then((holder) => within(holder).getByRole("button")));
    expect(await screen.findByTestId("pack-preview-error")).toHaveTextContent("Gói không hợp lệ");
    expect(screen.queryByTestId("pack-apply")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("per-item errors are listed and a pack with errors cannot be applied or enabled", async () => {
    preview.mockResolvedValue(ok({ ...FR_PREVIEW, canApply: false, canEnable: false, counts: { ...COUNTS, rejected: 2, missingAfter: 7 }, issues: [{ key: "customer.a", severity: "error", code: "variables", message: "Biến {count} bị thiếu." }] }));
    await open("upload");
    await userEvent.upload(screen.getByTestId("pack-file"), new File(["{}"], "p.json", { type: "application/json" }));
    await userEvent.click(await screen.findByTestId("pack-check").then((holder) => within(holder).getByRole("button")));
    const issues = await screen.findByTestId("pack-issues");
    expect(within(issues).getByText(/Biến \{count\} bị thiếu/)).toBeInTheDocument();
    expect(btn("pack-apply")).toBeDisabled();
    expect(screen.getByTestId("pack-enable")).toBeDisabled();
  });

  it("refuses a file over 6 MB without reading it to the server", async () => {
    await open("upload");
    const big = new File(["x"], "big.json", { type: "application/json" });
    Object.defineProperty(big, "size", { value: 7 * 1024 * 1024 });
    await userEvent.upload(screen.getByTestId("pack-file"), big);
    expect(await screen.findByText("Tệp lớn hơn 6 MB nên không được nhận.")).toBeInTheDocument();
    expect(screen.queryByTestId("pack-check")).toBeNull();
    expect(preview).not.toHaveBeenCalled();
  });

  it("the template is the server's file, handed to the browser untouched", async () => {
    template.mockResolvedValue(ok('{"schema":"bha.language-pack/1","messages":{}}'));
    await open("upload");
    await userEvent.click(btn("pack-template"));
    await waitFor(() => expect(downloadText).toHaveBeenCalledWith("bha-language-template.json", '{"schema":"bha.language-pack/1","messages":{}}'));
  });
});
