/**
 * CUST-WEB-HEADER-001-CP02: the Currencies screen against a mocked Admin API client — VND's protections, the rate as the
 * exact text typed (never a number), the confirmations, and the same refusal / stale / lost-answer handling as Languages.
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
  listCurrencies: vi.fn(),
  createCurrency: vi.fn(),
  updateCurrency: vi.fn(),
  setCurrencyRate: vi.fn(),
  setCurrencyActive: vi.fn(),
  setDefaultCurrency: vi.fn(),
  deleteCurrency: vi.fn(),
}));

import CurrenciesPanel from "./CurrenciesPanel";
import { ALLOWED, VND, btn, currency, deferred, ok, queryBtn, renderInGate } from "./websiteTestUtils";
import { fetchStaffSession } from "@/lib/api/staff";
import {
  createCurrency,
  deleteCurrency,
  listCurrencies,
  setCurrencyActive,
  setCurrencyRate,
  setDefaultCurrency,
  updateCurrency,
} from "@/lib/api/website";

const list = vi.mocked(listCurrencies);
const create = vi.mocked(createCurrency);
const update = vi.mocked(updateCurrency);
const setRate = vi.mocked(setCurrencyRate);
const setActive = vi.mocked(setCurrencyActive);
const makeDefault = vi.mocked(setDefaultCurrency);
const remove = vi.mocked(deleteCurrency);

const USD = currency({ code: "USD", version: 4 });
const EUR = currency({ code: "EUR", name: "Euro", symbol: "€", sortOrder: 30, version: 2, isActive: true, vndPerUnit: "27500.25", rateUpdatedAtUtc: "2026-10-15T01:00:00+00:00" });
const refused = (status: number, code: string, detail: string, field: string | null = null) => ({ kind: "refused" as const, status, code, field, detail });

async function open() {
  renderInGate(<CurrenciesPanel />, "/website/currencies");
  await screen.findByTestId("currency-row-VND");
}

beforeEach(() => {
  vi.mocked(fetchStaffSession).mockResolvedValue({ kind: "authenticated", session: ALLOWED });
  for (const fn of [list, create, update, setRate, setActive, makeDefault, remove]) fn.mockReset();
  list.mockResolvedValue(ok([VND, USD, EUR]));
});
afterEach(cleanup);

describe("the list", () => {
  it("shows the base, the default, on/off, 'No rate yet' and the rate exactly as the server sent it", async () => {
    await open();
    const vnd = screen.getByTestId("currency-row-VND");
    expect(within(vnd).getByText("Base")).toBeInTheDocument();
    expect(within(vnd).getByText("Display default")).toBeInTheDocument();
    expect(within(vnd).getByText("Fixed: rate 1, always on")).toBeInTheDocument();
    for (const id of ["edit-VND", "rate-edit-VND", "toggle-VND", "delete-VND", "default-VND"]) expect(queryBtn(id)).toBeNull();

    const usd = screen.getByTestId("currency-row-USD");
    expect(within(usd).getByText("No rate yet")).toBeInTheDocument();
    expect(within(usd).getByText("Off")).toBeInTheDocument();
    expect(within(usd).getByText("Set rate")).toBeInTheDocument();

    expect(screen.getByTestId("rate-EUR")).toHaveTextContent("27500.25");
    expect(within(screen.getByTestId("currency-row-EUR")).getByText("Nhập thủ công")).toBeInTheDocument();
    expect(within(screen.getByTestId("currency-row-EUR")).getByText("Change rate")).toBeInTheDocument();
  });

  it("a failed load is an error with Retry", async () => {
    list.mockResolvedValueOnce({ kind: "error", status: 500, message: "The Admin API returned an error (500)." });
    renderInGate(<CurrenciesPanel />, "/website/currencies");
    expect(await screen.findByText(/returned an error \(500\)/)).toBeInTheDocument();
    list.mockResolvedValueOnce(ok([VND]));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("currency-row-VND")).toBeInTheDocument();
  });
});

describe("setting a rate", () => {
  it.each(["", "0", "-1", "1,5", "1e3", " 12", "1.123456789", "0.0", "1234567890123"])("refuses %j before sending anything", async (text) => {
    await open();
    await userEvent.click(btn("rate-edit-USD"));
    const field = screen.getByTestId("field-rate");
    await userEvent.clear(field);
    if (text) await userEvent.type(field, text);
    await userEvent.click(btn("dialog-save"));
    expect(setRate).not.toHaveBeenCalled();
    expect(screen.getByTestId("rate-dialog")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("sends the typed text unchanged (no number conversion) with the version it loaded, once", async () => {
    await open();
    await userEvent.click(btn("rate-edit-USD"));
    await userEvent.type(screen.getByTestId("field-rate"), "25000.50");
    setRate.mockResolvedValue(ok({ ...USD, vndPerUnit: "25000.50", version: 5 }));
    list.mockResolvedValue(ok([VND, { ...USD, vndPerUnit: "25000.50", version: 5, rateUpdatedAtUtc: "2026-10-15T02:00:00+00:00" }, EUR]));
    await userEvent.dblClick(btn("dialog-save"));
    await waitFor(() => expect(screen.queryByTestId("rate-dialog")).toBeNull());
    expect(setRate).toHaveBeenCalledTimes(1);
    expect(setRate).toHaveBeenCalledWith("USD", 4, "25000.50");
    expect(await screen.findByTestId("website-success")).toHaveTextContent("1 USD = 25000.50 VND.");
    expect(screen.getByTestId("rate-USD")).toHaveTextContent("25000.50");
  });

  it("warns when the currency is on that visitors see the new rate immediately", async () => {
    await open();
    await userEvent.click(btn("rate-edit-EUR"));
    expect(screen.getByTestId("rate-dialog")).toHaveTextContent("EUR is on: visitors will see the new rate");
    expect(screen.getByTestId("field-rate")).toHaveValue("27500.25");
  });

  it("a server refusal on the rate shows beside the field and keeps the text", async () => {
    await open();
    await userEvent.click(btn("rate-edit-USD"));
    await userEvent.type(screen.getByTestId("field-rate"), "5");
    setRate.mockResolvedValue(refused(400, "validation", "The rate is outside the accepted range.", "vndPerUnit"));
    await userEvent.click(btn("dialog-save"));
    expect(await screen.findByText("The rate is outside the accepted range.")).toBeInTheDocument();
    expect(screen.getByTestId("field-rate")).toHaveValue("5");
  });

  it("stale: draft kept, Reload shows the server's rate, the next save uses the server's version", async () => {
    await open();
    await userEvent.click(btn("rate-edit-EUR"));
    await userEvent.clear(screen.getByTestId("field-rate"));
    await userEvent.type(screen.getByTestId("field-rate"), "28000");
    setRate.mockResolvedValueOnce(refused(409, "stale-version", "changed"));
    await userEvent.click(btn("dialog-save"));
    await screen.findByTestId("write-refused");
    list.mockResolvedValue(ok([VND, USD, { ...EUR, vndPerUnit: "27999", version: 9 }]));
    await userEvent.click(screen.getByTestId("reload-latest"));
    expect(await screen.findByText(/version 9: "Euro" \(€\).*rate 27999 VND/)).toBeInTheDocument();
    expect(screen.getByTestId("field-rate")).toHaveValue("28000");
    setRate.mockResolvedValueOnce(ok({ ...EUR, vndPerUnit: "28000", version: 10 }));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(setRate).toHaveBeenCalledTimes(2));
    expect(setRate.mock.calls[1]).toEqual(["EUR", 9, "28000"]);
  });

  it("a lost answer blocks resubmitting until Check server", async () => {
    await open();
    await userEvent.click(btn("rate-edit-USD"));
    await userEvent.type(screen.getByTestId("field-rate"), "25000");
    setRate.mockResolvedValue({ kind: "unverified", message: "no answer" });
    await userEvent.click(btn("dialog-save"));
    await screen.findByTestId("write-unverified");
    expect(btn("dialog-save")).toBeDisabled();
    list.mockResolvedValue(ok([VND, { ...USD, vndPerUnit: "25000", version: 5 }, EUR]));
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByText(/rate 25000 VND/)).toBeInTheDocument();
    expect(setRate).toHaveBeenCalledTimes(1);
  });
});

describe("adding and editing", () => {
  it("validates code, symbol, decimals and order locally; then creates once", async () => {
    await open();
    await userEvent.click(btn("add-currency"));
    await userEvent.type(screen.getByTestId("field-code"), "jp");
    await userEvent.type(screen.getByTestId("field-name"), "Japanese yen");
    await userEvent.type(screen.getByTestId("field-symbol"), "¥");
    await userEvent.clear(screen.getByTestId("field-minorUnits"));
    await userEvent.type(screen.getByTestId("field-minorUnits"), "9");
    await userEvent.click(btn("dialog-save"));
    expect(create).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByTestId("field-code"));
    await userEvent.type(screen.getByTestId("field-code"), "JPY");
    await userEvent.clear(screen.getByTestId("field-minorUnits"));
    await userEvent.type(screen.getByTestId("field-minorUnits"), "0");
    create.mockResolvedValue(ok(currency({ code: "JPY", name: "Japanese yen", symbol: "¥", minorUnits: 0, sortOrder: 40 })));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith("JPY", { name: "Japanese yen", symbol: "¥", minorUnits: 0, sortOrder: 40 });
    expect(await screen.findByTestId("website-success")).toHaveTextContent("Added JPY. It is off and has no rate yet.");
  });

  it("double click on Add sends one request", async () => {
    await open();
    await userEvent.click(btn("add-currency"));
    await userEvent.type(screen.getByTestId("field-code"), "JPY");
    await userEvent.type(screen.getByTestId("field-name"), "Japanese yen");
    await userEvent.type(screen.getByTestId("field-symbol"), "¥");
    const pending = deferred<ReturnType<typeof ok>>();
    create.mockReturnValue(pending.promise as never);
    await userEvent.dblClick(btn("dialog-save"));
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(ok(currency({ code: "JPY" }))));
  });

  it("Cancel in the rate form sends nothing", async () => {
    await open();
    await userEvent.click(btn("rate-edit-EUR"));
    await userEvent.click(btn("dialog-cancel"));
    expect(setRate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("rate-dialog")).toBeNull();
  });

  it("editing sends the loaded version and the four editable fields", async () => {
    await open();
    await userEvent.click(btn("edit-USD"));
    await userEvent.clear(screen.getByTestId("field-name"));
    await userEvent.type(screen.getByTestId("field-name"), "United States dollar");
    update.mockResolvedValue(ok({ ...USD, name: "United States dollar", version: 5 }));
    await userEvent.click(btn("dialog-save"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("USD", 4, { name: "United States dollar", symbol: "$", minorUnits: 2, sortOrder: 20 });
  });
});

describe("turning on / off, default and delete", () => {
  it("turning on asks first and tells the operator the rate it will use", async () => {
    await open();
    await userEvent.click(btn("toggle-EUR")); // EUR is on → turn off
    expect(screen.getByTestId("currency-toggle-dialog")).toHaveTextContent("Turn off EUR?");
    await userEvent.click(btn("dialog-cancel"));
    expect(setActive).not.toHaveBeenCalled();

    await userEvent.click(btn("toggle-USD"));
    expect(screen.getByTestId("currency-toggle-dialog")).toHaveTextContent("It has no rate yet, so the server will refuse");
  });

  it("the server's refusal to turn on a currency without a rate is shown and nothing changes", async () => {
    await open();
    await userEvent.click(btn("toggle-USD"));
    setActive.mockResolvedValue(refused(409, "currency-needs-rate", "USD has no rate yet."));
    await userEvent.click(btn("dialog-confirm"));
    expect(await screen.findByTestId("write-refused")).toHaveTextContent("USD has no rate yet.");
    expect(setActive).toHaveBeenCalledWith("USD", 4, true);
    expect(within(screen.getByTestId("currency-row-USD")).getByText("Off")).toBeInTheDocument();
  });

  it("making the default names the current default; confirmation sends once with the version", async () => {
    await open();
    await userEvent.click(btn("default-EUR"));
    expect(screen.getByTestId("currency-default-dialog")).toHaveTextContent(/instead of\s*VND/);
    makeDefault.mockResolvedValue(ok({ ...EUR, isDefault: true, version: 3 }));
    await userEvent.dblClick(btn("dialog-confirm"));
    await waitFor(() => expect(makeDefault).toHaveBeenCalledTimes(1));
    expect(makeDefault).toHaveBeenCalledWith("EUR", 2);
    expect(await screen.findByTestId("website-success")).toHaveTextContent("EUR is now the display default currency.");
  });

  it("VND can be made the default again", async () => {
    list.mockResolvedValue(ok([{ ...VND, isDefault: false }, USD, { ...EUR, isDefault: true }]));
    await open();
    await userEvent.click(btn("default-VND"));
    makeDefault.mockResolvedValue(ok({ ...VND, isDefault: true }));
    await userEvent.click(btn("dialog-confirm"));
    await waitFor(() => expect(makeDefault).toHaveBeenCalledWith("VND", 1));
  });

  it("delete: cancel sends nothing; confirm sends the version; the row goes with the re-read", async () => {
    await open();
    await userEvent.click(btn("delete-USD"));
    await userEvent.click(btn("dialog-cancel"));
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(btn("delete-USD"));
    remove.mockResolvedValue(ok(undefined));
    list.mockResolvedValue(ok([VND, EUR]));
    await userEvent.click(btn("dialog-confirm"));
    await waitFor(() => expect(screen.queryByTestId("currency-row-USD")).toBeNull());
    expect(remove).toHaveBeenCalledWith("USD", 4);
  });

  it("a delete with a lost answer: the dialog survives the row's disappearance and says it was deleted", async () => {
    await open();
    await userEvent.click(btn("delete-USD"));
    remove.mockResolvedValue({ kind: "unverified", message: "no answer" });
    await userEvent.click(btn("dialog-confirm"));
    await screen.findByTestId("write-unverified");
    list.mockResolvedValue(ok([VND, EUR]));
    await userEvent.click(screen.getByTestId("check-server"));
    expect(await screen.findByText(/USD is no longer on the server: it was deleted/)).toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
