/**
 * CUST-WEB-HEADER-001-CP02: the Languages screen against a mocked Admin API client — what is listed, what each
 * dialog sends (exactly once), how a refusal / a stale version / a lost answer is handled, and that nothing is
 * shown as saved until the server has said so and been read again.
 */
import React from "react";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
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
  createLanguage: vi.fn(),
  updateLanguage: vi.fn(),
  setDefaultLanguage: vi.fn(),
  deleteLanguage: vi.fn(),
}));

import LanguagesPanel from "./LanguagesPanel";
import { ALLOWED, btn, deferred, lang, ok, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import { createLanguage, deleteLanguage, listLanguages, setDefaultLanguage, updateLanguage } from "@/lib/api/website";

const list = vi.mocked(listLanguages);
const create = vi.mocked(createLanguage);
const update = vi.mocked(updateLanguage);
const makeDefault = vi.mocked(setDefaultLanguage);
const remove = vi.mocked(deleteLanguage);

const VI = lang();
const EN = lang({ code: "en", displayName: "English", nativeName: "English", sortOrder: 20, isActive: false, isDefault: false, translatedKeys: 25, version: 3 });
const refused = (status: number, code: string, detail: string, field: string | null = null) => ({ kind: "refused" as const, status, code, field, detail });

async function open() {
  renderInGate(<LanguagesPanel />);
  await screen.findByTestId("languages-panel");
  await screen.findByTestId("language-row-vi");
}

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const fn of [list, create, update, makeDefault, remove]) fn.mockReset();
  list.mockResolvedValue(ok([VI, EN]));
});
afterEach(cleanup);

describe("the list", () => {
  it("shows what the server returned: default / on / off badges and how many keys are translated", async () => {
    await open();
    expect(screen.getByText("2 languages")).toBeInTheDocument();
    const vi_ = screen.getByTestId("language-row-vi");
    expect(within(vi_).getByText("Default")).toBeInTheDocument();
    expect(within(vi_).getByText("On")).toBeInTheDocument();
    expect(within(vi_).queryByTestId("default-vi")).toBeNull(); // the default cannot be made default or deleted
    expect(within(vi_).queryByTestId("delete-vi")).toBeNull();
    const en = screen.getByTestId("language-row-en");
    expect(within(en).getByText("Off")).toBeInTheDocument();
    expect(within(en).getByRole("link", { name: "Translations" })).toHaveAttribute("href", "/website/translations?locale=en");
    expect(within(en).getByTestId("default-en")).toBeInTheDocument();
  });

  it("says a language with missing keys falls back to the default", async () => {
    list.mockResolvedValue(ok([VI, { ...EN, translatedKeys: 20 }]));
    await open();
    expect(within(screen.getByTestId("language-row-en")).getByText("5 fall back to the default")).toBeInTheDocument();
  });

  it("a failed load is an error with Retry that reads the server again", async () => {
    list.mockResolvedValueOnce({ kind: "network", message: "The Admin API is unreachable." });
    renderInGate(<LanguagesPanel />);
    expect(await screen.findByText(/unreachable/)).toBeInTheDocument();
    list.mockResolvedValueOnce(ok([VI]));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("language-row-vi")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe("adding a language", () => {
  it("checks the code locally, sends nothing while it is invalid, then sends once and re-reads", async () => {
    await open();
    await userEvent.click(btn("add-language"));
    await userEvent.type(screen.getByTestId("field-code"), "not a tag!");
    await userEvent.type(screen.getByTestId("field-displayName"), "French");
    await userEvent.type(screen.getByTestId("field-nativeName"), "Français");
    await userEvent.click(btn("dialog-save"));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByTestId("language-dialog")).toBeInTheDocument();

    await userEvent.clear(screen.getByTestId("field-code"));
    await userEvent.type(screen.getByTestId("field-code"), "fr");
    const fr = lang({ code: "fr", displayName: "French", nativeName: "Français", sortOrder: 30, isActive: false, isDefault: false, translatedKeys: 0, version: 1 });
    create.mockResolvedValue(ok(fr));
    list.mockResolvedValue(ok([VI, EN, fr]));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(screen.queryByTestId("language-dialog")).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith("fr", { displayName: "French", nativeName: "Français", sortOrder: 30, isActive: false });
    expect(await screen.findByTestId("language-row-fr")).toBeInTheDocument();
    expect(screen.getByTestId("website-success")).toHaveTextContent("Added fr.");
  });

  it("a double click sends one request", async () => {
    await open();
    await userEvent.click(btn("add-language"));
    await userEvent.type(screen.getByTestId("field-code"), "fr");
    await userEvent.type(screen.getByTestId("field-displayName"), "French");
    await userEvent.type(screen.getByTestId("field-nativeName"), "Français");
    const pending = deferred<ReturnType<typeof ok>>();
    create.mockReturnValue(pending.promise as never);
    const save = btn("dialog-save");
    await userEvent.dblClick(save);
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("write-pending")).toBeInTheDocument();
    await act(async () => pending.resolve(ok(lang({ code: "fr" }))));
  });

  it("a refusal keeps the draft and shows the server's reason beside the field", async () => {
    await open();
    await userEvent.click(btn("add-language"));
    await userEvent.type(screen.getByTestId("field-code"), "fr");
    await userEvent.type(screen.getByTestId("field-displayName"), "French");
    await userEvent.type(screen.getByTestId("field-nativeName"), "Français");
    create.mockResolvedValue(refused(409, "language-exists", "A language with this code already exists."));
    await userEvent.click(btn("dialog-save"));
    expect(await screen.findByTestId("write-refused")).toHaveTextContent("A language with this code already exists.");
    expect(screen.getByTestId("field-displayName")).toHaveValue("French");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a lost answer is unverified: no second send until the server has been read", async () => {
    await open();
    await userEvent.click(btn("add-language"));
    await userEvent.type(screen.getByTestId("field-code"), "fr");
    await userEvent.type(screen.getByTestId("field-displayName"), "French");
    await userEvent.type(screen.getByTestId("field-nativeName"), "Français");
    create.mockResolvedValue({ kind: "unverified", message: "The Admin API did not answer; the change may or may not have been applied." });
    await userEvent.click(btn("dialog-save"));
    expect(await screen.findByTestId("write-unverified")).toBeInTheDocument();
    expect(btn("dialog-save")).toBeDisabled();
    await userEvent.click(btn("dialog-save"));
    expect(create).toHaveBeenCalledTimes(1);

    // The server does not have it: Check server re-enables the form, and says it was not saved.
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByText(/does not have this language yet, so it was not saved/)).toBeInTheDocument();
    expect(btn("dialog-save")).toBeEnabled();
  });

  it("a lost answer where the server DID apply it says so and blocks a duplicate", async () => {
    await open();
    await userEvent.click(btn("add-language"));
    await userEvent.type(screen.getByTestId("field-code"), "fr");
    await userEvent.type(screen.getByTestId("field-displayName"), "French");
    await userEvent.type(screen.getByTestId("field-nativeName"), "Français");
    create.mockResolvedValue({ kind: "unverified", message: "no answer" });
    await userEvent.click(btn("dialog-save"));
    await screen.findByTestId("write-unverified");
    list.mockResolvedValue(ok([VI, EN, lang({ code: "fr", displayName: "French", nativeName: "Français", isActive: false, isDefault: false, version: 1 })]));
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByText(/already has fr/)).toBeInTheDocument();
    expect(btn("dialog-save")).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("editing", () => {
  it("sends the version it loaded and only the editable fields", async () => {
    await open();
    await userEvent.click(btn("edit-en"));
    expect(screen.getByTestId("language-dialog")).toHaveTextContent("Edit en");
    await userEvent.clear(screen.getByTestId("field-displayName"));
    await userEvent.type(screen.getByTestId("field-displayName"), "English (UK)");
    update.mockResolvedValue(ok({ ...EN, displayName: "English (UK)", version: 4 }));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("en", 3, { displayName: "English (UK)", nativeName: "English", sortOrder: 20, isActive: false });
    expect(await screen.findByTestId("website-success")).toHaveTextContent("Saved en.");
  });

  it("Cancel closes the form without sending anything (it is not a submit button), and Enter in a field saves once", async () => {
    await open();
    await userEvent.click(btn("edit-en"));
    await userEvent.click(btn("dialog-cancel"));
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByTestId("language-dialog")).toBeNull();

    await userEvent.click(btn("edit-en"));
    update.mockResolvedValue(ok({ ...EN, version: 4 }));
    await userEvent.type(screen.getByTestId("field-sortOrder"), "{Enter}");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("the default language's On switch is locked", async () => {
    await open();
    await userEvent.click(btn("edit-vi"));
    expect(screen.getByLabelText(/the default language stays on/)).toBeDisabled();
  });

  it("a stale version keeps the draft; Reload the latest values rebinds to the server's version and the next save uses it", async () => {
    await open();
    await userEvent.click(btn("edit-en"));
    await userEvent.clear(screen.getByTestId("field-displayName"));
    await userEvent.type(screen.getByTestId("field-displayName"), "My draft");
    update.mockResolvedValueOnce(refused(409, "stale-version", "Another editor changed it."));
    await userEvent.click(btn("dialog-save"));
    expect(await screen.findByTestId("write-refused")).toHaveTextContent("Nothing was saved.");
    expect(screen.getByTestId("field-displayName")).toHaveValue("My draft");

    list.mockResolvedValue(ok([VI, { ...EN, displayName: "Theirs", version: 7 }]));
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByText(/version 7: "Theirs"/)).toBeInTheDocument();
    expect(screen.getByTestId("field-displayName")).toHaveValue("My draft");

    update.mockResolvedValueOnce(ok({ ...EN, displayName: "My draft", version: 8 }));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toBe(7);
  });
});

describe("making a language the default, and deleting one", () => {
  it("asks first, names the language that stops being the default, then sends once", async () => {
    await open();
    await userEvent.click(btn("default-en"));
    const dialog = screen.getByTestId("language-default-dialog");
    expect(dialog).toHaveTextContent("Make en the default language?");
    expect(dialog).toHaveTextContent("vi stops being the default");
    expect(makeDefault).not.toHaveBeenCalled();
    makeDefault.mockResolvedValue(ok({ ...EN, isActive: true, isDefault: true, version: 4 }));
    await userEvent.click(btn("dialog-confirm"));
    await waitFor(() => expect(makeDefault).toHaveBeenCalledTimes(1));
    expect(makeDefault).toHaveBeenCalledWith("en", 3);
    expect(await screen.findByTestId("website-success")).toHaveTextContent("en is now the default language.");
  });

  it("Cancel sends nothing", async () => {
    await open();
    await userEvent.click(btn("delete-en"));
    expect(screen.getByTestId("language-delete-dialog")).toHaveTextContent("It cannot be undone");
    await userEvent.click(btn("dialog-cancel"));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByTestId("language-delete-dialog")).toBeNull();
  });

  it("the server's reason for refusing a delete is shown and the row stays", async () => {
    await open();
    await userEvent.click(btn("delete-en"));
    remove.mockResolvedValue(refused(409, "language-has-translations", "en has saved translations. Turn it off instead."));
    await userEvent.click(btn("dialog-confirm"));
    expect(await screen.findByTestId("write-refused")).toHaveTextContent("has saved translations");
    expect(screen.getByTestId("language-row-en")).toBeInTheDocument();
  });

  it("a delete shows as done only after the server answered ok, and the row goes with the re-read", async () => {
    await open();
    await userEvent.click(btn("delete-en"));
    remove.mockResolvedValue(ok(undefined));
    list.mockResolvedValue(ok([VI]));
    await userEvent.click(btn("dialog-confirm"));
    await waitFor(() => expect(screen.queryByTestId("language-row-en")).toBeNull());
    expect(remove).toHaveBeenCalledWith("en", 3);
    expect(screen.getByTestId("website-success")).toHaveTextContent("Deleted en.");
  });

  it("a delete whose answer was lost: after reading the server and finding the row gone the dialog reports it", async () => {
    await open();
    await userEvent.click(btn("delete-en"));
    remove.mockResolvedValue({ kind: "unverified", message: "no answer" });
    await userEvent.click(btn("dialog-confirm"));
    await screen.findByTestId("write-unverified");
    expect(btn("dialog-confirm")).toBeDisabled();
    list.mockResolvedValue(ok([VI]));
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByText(/en is no longer on the server: it was deleted/)).toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("access changes while a dialog is open", () => {
  it("a 403 re-reads me and, when the permission is gone, the whole screen closes", async () => {
    await open();
    await userEvent.click(btn("delete-en"));
    remove.mockResolvedValue({ kind: "denied" });
    vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: { ...ALLOWED, permissions: [] } });
    await userEvent.click(btn("dialog-confirm"));
    expect(await screen.findByTestId("website-no-permission")).toBeInTheDocument();
    expect(screen.queryByTestId("languages-panel")).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
