import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiHttpError } from "../errors";

const once = vi.fn();
const apiGetMock = vi.fn();
vi.mock("../csrf", async (importOriginal) => ({ ...(await importOriginal<typeof import("../csrf")>()), submitCsrfProtectedRequestOnce: (...a: unknown[]) => once(...a) }));
vi.mock("../httpClient", () => ({ apiGet: (...a: unknown[]) => apiGetMock(...a), apiUnsafeRequest: vi.fn(), mergeHeaders: vi.fn(), isRequestCancelledError: () => false }));

import {
  ManagementContractError,
  canonicalReservationId,
  exchangeManagementLink,
  exchangeOnce,
  readManagedReservation,
  toManagedReservation,
  updateEstimatedArrival,
  whenExchangeSettled,
} from "../reservationManagementService";

const ID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
const DTO = {
  reservationId: ID, confirmationNumber: "BHA-1", status: "Confirmed", propertyId: "a1000000-0000-0000-0000-000000000001",
  roomTypeId: "r", ratePlanId: "p", fullName: "Jane Doe", checkIn: "2026-12-01", checkOut: "2026-12-03", adults: 2, children: 0, rooms: 1,
  currencyCode: "VND", totalAmount: 3000000, confirmedAtUtc: "2026-11-25T02:00:00Z", cancelledAtUtc: null, cancellationReason: null, nights: [],
  paymentMethod: "PayAtProperty", ledgerState: "Recorded", receivableAmount: 3000000, collectedAmount: 0, balanceDueAmount: 3000000,
  propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
};

beforeEach(() => { once.mockReset(); apiGetMock.mockReset(); });

describe("canonicalReservationId", () => {
  it("accepts only a 36-character GUID and lower-cases it", () => {
    expect(canonicalReservationId(ID.toUpperCase())).toBe(ID);
    for (const bad of [ID.replace(/-/g, ""), `{${ID}}`, `${ID}/x`, "", "abc", undefined, null, 5, `${ID} `]) expect(canonicalReservationId(bad)).toBeNull();
  });
});

describe("exchangeManagementLink", () => {
  it("POSTs exactly { token } to the canonical path through the no-retry CSRF path, with no signal", async () => {
    once.mockResolvedValue({ status: 200, data: { reservationId: ID, expiresAtUtc: "2026-11-26T00:00:00Z" } });
    await exchangeManagementLink(ID, "S".repeat(43));
    expect(once).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith(`/api/v1/reservations/${ID}/manage/exchange`, "POST", { token: "S".repeat(43) }, {}, undefined);
  });

  it("a 2xx that is not this reservation's answer is a contract error (unknown outcome), never success", async () => {
    for (const data of [undefined, {}, { reservationId: "other", expiresAtUtc: "x" }, { reservationId: ID }]) {
      once.mockResolvedValueOnce({ status: 200, data });
      await expect(exchangeManagementLink(ID, "S".repeat(43))).rejects.toBeInstanceOf(ManagementContractError);
    }
    once.mockResolvedValueOnce({ status: 204, data: undefined });
    await expect(exchangeManagementLink(ID, "S".repeat(43))).rejects.toBeInstanceOf(ManagementContractError);
  });

  it("does not put the token in a thrown contract error", async () => {
    once.mockResolvedValueOnce({ status: 200, data: {} });
    const error = await exchangeManagementLink(ID, "SECRET".padEnd(43, "x")).catch((e) => e);
    expect(JSON.stringify([error.message, error.name])).not.toContain("SECRET");
  });
});

describe("exchangeOnce", () => {
  it("joins an exchange already in flight for the id instead of sending another, and a waiter waits for it", async () => {
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    const a = exchangeOnce(ID, "t1", send);
    const b = exchangeOnce(ID, "t2", send);
    expect(send).toHaveBeenCalledTimes(1);
    let waited = false;
    const waiter = whenExchangeSettled(ID).then(() => { waited = true; });
    await Promise.resolve();
    expect(waited).toBe(false);
    finish();
    await Promise.all([a, b, waiter]);
    expect(waited).toBe(true);
    // settled: a later (deliberate) exchange is a new request
    send.mockResolvedValueOnce(undefined);
    await exchangeOnce(ID, "t3", send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a failed exchange is cleared and does not make the waiter fail", async () => {
    const send = vi.fn().mockRejectedValue(new Error("x"));
    await expect(exchangeOnce(ID, "t", send)).rejects.toThrow("x");
    await expect(whenExchangeSettled(ID)).resolves.toBeUndefined();
  });
});

describe("reads and the arrival update", () => {
  it("GET uses the canonical path; the DTO is reduced to what the page shows (no name, no ids of rooms)", async () => {
    apiGetMock.mockResolvedValue(DTO);
    const r = await readManagedReservation(ID);
    expect(apiGetMock.mock.calls[0][0]).toBe(`/api/v1/reservations/${ID}/manage`);
    expect(r).toMatchObject({ confirmationNumber: "BHA-1", ledgerState: "Recorded", collectedAmount: 0, balanceDueAmount: 3000000, estimatedArrival: null });
    expect(JSON.stringify(r)).not.toMatch(/Jane|roomTypeId|ratePlanId|fullName/);
  });

  it("NotRecorded keeps no amount (nothing is inferred) and a recorded ledger without amounts is refused", () => {
    expect(toManagedReservation({ ...DTO, ledgerState: "NotRecorded", collectedAmount: null, balanceDueAmount: null, receivableAmount: null }, ID)).toMatchObject({ ledgerState: "NotRecorded", collectedAmount: null, balanceDueAmount: null });
    expect(() => toManagedReservation({ ...DTO, ledgerState: "Recorded", collectedAmount: null }, ID)).toThrow(ManagementContractError);
  });

  it("refuses a body for another reservation, an unknown ledger state, another payment method or a bad estimate", () => {
    expect(() => toManagedReservation({ ...DTO, reservationId: "00000000-0000-0000-0000-000000000000" }, ID)).toThrow(ManagementContractError);
    expect(() => toManagedReservation({ ...DTO, ledgerState: "Other" }, ID)).toThrow(ManagementContractError);
    expect(() => toManagedReservation({ ...DTO, paymentMethod: "Card" }, ID)).toThrow(ManagementContractError);
    expect(() => toManagedReservation({ ...DTO, estimatedArrival: { arrivalDate: "x", arrivalTime: "9:5", timeZoneId: "z" } }, ID)).toThrow(ManagementContractError);
    expect(() => toManagedReservation(null, ID)).toThrow(ManagementContractError);
    expect(toManagedReservation({ ...DTO, estimatedArrival: { arrivalDate: "2026-12-02", arrivalTime: "01:30", timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" } }, ID).estimatedArrival).toMatchObject({ arrivalTime: "01:30" });
  });

  it("the arrival update sends exactly { arrivalDate, arrivalTime } once and returns the updated reservation", async () => {
    once.mockResolvedValue({ status: 200, data: { ...DTO, estimatedArrival: { arrivalDate: "2026-12-01", arrivalTime: "21:30", timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" } } });
    const r = await updateEstimatedArrival(ID, { arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    expect(once).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith(`/api/v1/reservations/${ID}/manage/estimated-arrival`, "POST", { arrivalDate: "2026-12-01", arrivalTime: "21:30" }, {}, undefined);
    expect(r.estimatedArrival?.arrivalTime).toBe("21:30");
  });

  // BHA-CHECKOUT-001-PR09-C10 P3: a successful update answers the updated reservation, which must carry exactly the arrival that was sent.
  describe("a 200 for the arrival update is usable only with the arrival that was sent (PR09-C10)", () => {
    const sent = { arrivalDate: "2026-12-01", arrivalTime: "21:30" };
    const answer = (estimatedArrival: unknown) => ({ status: 200, data: { ...DTO, estimatedArrival } });
    const eta = (date: string, time: string) => ({ arrivalDate: date, arrivalTime: time, timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" });

    it("the same date and time: accepted", async () => {
      once.mockResolvedValue(answer(eta("2026-12-01", "21:30")));
      await expect(updateEstimatedArrival(ID, sent)).resolves.toMatchObject({ estimatedArrival: { arrivalDate: "2026-12-01", arrivalTime: "21:30" } });
    });

    it.each([
      ["a null estimate", answer(null)],
      ["a missing estimate", { status: 200, data: (({ estimatedArrival: _omitted, ...rest }) => rest)(DTO) }],
      ["another date", answer(eta("2026-12-02", "21:30"))],
      ["another time", answer(eta("2026-12-01", "21:31"))],
      ["another date and time", answer(eta("2026-12-02", "01:00"))],
    ])("%s: an unusable answer (ManagementContractError), never 'saved'", async (_name, response) => {
      once.mockResolvedValue(response);
      await expect(updateEstimatedArrival(ID, sent)).rejects.toBeInstanceOf(ManagementContractError);
    });

    it("a READ may still have no estimate (the read parser is unchanged)", async () => {
      expect(toManagedReservation({ ...DTO, estimatedArrival: null }, ID).estimatedArrival).toBeNull();
      expect(toManagedReservation((({ estimatedArrival: _omitted, ...rest }) => rest)(DTO), ID)).toMatchObject({ estimatedArrival: null });
    });
  });

  it("an HTTP failure of the update is passed through unchanged for the controller to classify", async () => {
    const refusal = new ApiHttpError(400, { title: "t", status: 400, code: "validation.arrival-out-of-window" });
    once.mockRejectedValue(refusal);
    await expect(updateEstimatedArrival(ID, { arrivalDate: "2026-12-09", arrivalTime: "10:00" })).rejects.toBe(refusal);
    once.mockResolvedValue({ status: 200, data: { nope: true } });
    await expect(updateEstimatedArrival(ID, { arrivalDate: "2026-12-01", arrivalTime: "10:00" })).rejects.toBeInstanceOf(ManagementContractError);
  });
});
