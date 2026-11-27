import { describe, expect, it, vi } from "vitest";
import axios from "axios";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { CsrfTokenUnavailableError } from "@/lib/api/csrf";
import { ManagementContractError, type ManagedReservation } from "@/lib/api/reservationManagementService";
import {
  MANAGE,
  arrivalDates,
  classifyExchangeError,
  classifyReadError,
  createReservationManagementController,
  isStateFor,
  manageHref,
  nextDay,
  parseManageFragment,
  receiptManageId,
  validateArrival,
  type ManageContext,
} from "./reservationManagement";

const ID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
const ID_B = "11111111-2222-4333-8444-555555555555";
const SECRET = "Zq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwabc";
const GUEST: ManageContext = { reservationId: ID, identityKey: "guest" };
const RES: ManagedReservation = {
  reservationId: ID, confirmationNumber: "BHA-1", status: "Confirmed", propertyId: "p", checkIn: "2026-12-01", checkOut: "2026-12-03", adults: 2, children: 0, rooms: 1,
  currencyCode: "VND", totalAmount: 3000000, confirmedAtUtc: "u", paymentMethod: "PayAtProperty", ledgerState: "Recorded", collectedAmount: 0, balanceDueAmount: 3000000,
  propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
};
const withEta = (date: string, time: string, base: ManagedReservation = RES): ManagedReservation => ({
  ...base, estimatedArrival: { arrivalDate: date, arrivalTime: time, timeZoneId: base.propertyTimeZoneId, updatedAtUtc: "u" },
});
const problem = (status: number, code?: string) => new ApiHttpError(status, { title: "t", status, code });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

function rig() {
  const exchange = vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined);
  const whenExchangeSettled = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);
  const signals: AbortSignal[] = [];
  const read = vi.fn<[string, AbortSignal], Promise<ManagedReservation>>().mockImplementation(async (id, signal) => { signals.push(signal); return { ...RES, reservationId: id }; });
  const update = vi.fn<[string, { arrivalDate: string; arrivalTime: string }], Promise<ManagedReservation>>();
  const requestSessionRefresh = vi.fn();
  const controller = createReservationManagementController({ exchange, whenExchangeSettled, read, update, requestSessionRefresh });
  return { controller, exchange, whenExchangeSettled, read, update, requestSessionRefresh, signals, get state() { return controller.getState(); } };
}
async function ready(r: ReturnType<typeof rig>, ctx: ManageContext = GUEST) {
  r.controller.bind(ctx);
  await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
}

describe("the fragment and the address", () => {
  it("accepts exactly the 43-character secret; anything else present is malformed; nothing is none", () => {
    expect(parseManageFragment("")).toEqual({ kind: "none" });
    expect(parseManageFragment("#")).toEqual({ kind: "none" });
    expect(parseManageFragment(`#${SECRET}`)).toEqual({ kind: "token", token: SECRET });
    for (const bad of [`#${SECRET}x`, `#${SECRET.slice(1)}`, `#t=${SECRET}`, "#abc", `#${SECRET.replace("Z", "+")}`, `#${SECRET}&x=1`]) {
      expect(parseManageFragment(bad)).toEqual({ kind: "malformed" });
    }
  });
  it("builds the clean account link with no token and the day arithmetic without a time zone", () => {
    expect(manageHref(ID)).toBe(`/reservations/${ID}/manage`);
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(arrivalDates("2026-12-01")).toEqual(["2026-12-01", "2026-12-02"]);
    expect(validateArrival({ arrivalDate: "2026-12-02", arrivalTime: "01:30" }, "2026-12-01")).toBeNull();
    expect(validateArrival({ arrivalDate: "2026-12-03", arrivalTime: "01:30" }, "2026-12-01")).toBe("date");
    expect(validateArrival({ arrivalDate: "2026-12-01", arrivalTime: "24:00" }, "2026-12-01")).toBe("time");
    expect(validateArrival({ arrivalDate: "2026-12-01", arrivalTime: "9:30" }, "2026-12-01")).toBe("time");
    expect(validateArrival({ arrivalDate: "2026-12-01", arrivalTime: "" }, "2026-12-01")).toBe("time");
  });
});

describe("the receipt's manage button", () => {
  const owner = "customer:aaaa";
  const base = { isDirect: true, receiptOwnerKey: owner, sessionOwnerKey: owner, reservationId: ID.toUpperCase() };
  it("is the clean lowercase link for the verified account that booked a Direct reservation", () => {
    expect(receiptManageId(base)).toBe(ID);
  });
  it("is absent for a guest, a Hold, an unverified or different session, or a bad id", () => {
    expect(receiptManageId({ ...base, receiptOwnerKey: "guest", sessionOwnerKey: "guest" })).toBeNull();
    expect(receiptManageId({ ...base, isDirect: false })).toBeNull();
    expect(receiptManageId({ ...base, sessionOwnerKey: null })).toBeNull();
    expect(receiptManageId({ ...base, sessionOwnerKey: "customer:bbbb" })).toBeNull();
    expect(receiptManageId({ ...base, sessionOwnerKey: "guest" })).toBeNull();
    expect(receiptManageId({ ...base, receiptOwnerKey: null })).toBeNull();
    expect(receiptManageId({ ...base, reservationId: "not-a-guid" })).toBeNull();
  });
});

describe("classification", () => {
  it("separates a link that was certainly not spent from one that may be", () => {
    expect(classifyExchangeError(problem(401, "reservation.manage-link-invalid"))).toBe("link-invalid");
    expect(classifyExchangeError(problem(429, "booking.rate-limited"))).toBe("link-rate-limited");
    expect(classifyExchangeError(problem(400, "auth.csrf-invalid"))).toBe("link-not-sent");
    expect(classifyExchangeError(new CsrfTokenUnavailableError())).toBe("link-not-sent");
    expect(classifyExchangeError(new ApiConfigError("x"))).toBe("config");
    for (const unknown of [new ApiNetworkError(), problem(500), problem(503), problem(404), new ManagementContractError(), new Error("x")]) {
      expect(classifyExchangeError(unknown)).toBe("exchange-uncertain");
    }
  });
  it("reads: one generic access failure for 401/403/404, and its own kind for an invalid customer session, 429 and the network", () => {
    expect(classifyReadError(problem(401, "reservation.manage-session-invalid"))).toBe("no-access");
    expect(classifyReadError(problem(404, "reservation.not-found"))).toBe("no-access");
    expect(classifyReadError(problem(403))).toBe("no-access");
    expect(classifyReadError(problem(401, "auth.session-invalid"))).toBe("session-invalid");
    expect(classifyReadError(problem(429))).toBe("rate-limited");
    expect(classifyReadError(new ApiNetworkError())).toBe("network");
    expect(classifyReadError(problem(500))).toBe("server");
    expect(classifyReadError(new ManagementContractError())).toBe("server");
  });
});

describe("opening the link: one exchange, never replayed", () => {
  it("sends the secret once, then reads with the cookie; the secret is in no state", async () => {
    const r = rig();
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    r.controller.bind(GUEST); // a re-render or a second effect run
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.exchange).toHaveBeenCalledWith(ID, SECRET);
    expect(r.read).toHaveBeenCalledTimes(1);
    expect(r.exchange.mock.invocationCallOrder[0]).toBeLessThan(r.read.mock.invocationCallOrder[0]);
    expect(JSON.stringify(r.state)).not.toContain(SECRET);
  });

  it("a re-offer after the first exchange started, or a later bind, never sends it again", async () => {
    const r = rig();
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    r.controller.bind({ reservationId: ID, identityKey: null });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    expect(r.exchange).toHaveBeenCalledTimes(1);
  });

  it("reload without a fragment reads with the existing session and does not exchange", async () => {
    const r = rig();
    r.controller.offerLink({ kind: "none" });
    await ready(r);
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).toHaveBeenCalledTimes(1);
  });

  it("a malformed fragment sends nothing at all", async () => {
    const r = rig();
    r.controller.offerLink({ kind: "malformed" });
    r.controller.bind(GUEST);
    await tick();
    expect(r.state).toMatchObject({ phase: "failed", failure: "link-invalid" });
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).not.toHaveBeenCalled();
  });

  it("waits for a verified identity before anything is requested, then opens the link once", async () => {
    const r = rig();
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind({ reservationId: ID, identityKey: null });
    await tick();
    expect(r.state.phase).toBe("waiting");
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).not.toHaveBeenCalled();
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
  });

  for (const [name, error, failure] of [
    ["an expired, used or unknown link (401)", problem(401, "reservation.manage-link-invalid"), "link-invalid"],
    ["429", problem(429, "booking.rate-limited"), "link-rate-limited"],
    ["a lost answer (network)", new ApiNetworkError(), "exchange-uncertain"],
    ["a 5xx", problem(502), "exchange-uncertain"],
    ["an unusable 2xx", new ManagementContractError(), "exchange-uncertain"],
    ["no CSRF token", new CsrfTokenUnavailableError(), "link-not-sent"],
  ] as const) {
    it(`${name}: guidance, no read, no second exchange`, async () => {
      const r = rig();
      r.exchange.mockRejectedValue(error);
      r.controller.offerLink({ kind: "token", token: SECRET });
      r.controller.bind(GUEST);
      await vi.waitFor(() => expect(r.state.phase).toBe("failed"));
      expect(r.state.failure).toBe(failure);
      expect(r.read).not.toHaveBeenCalled();
      r.controller.retry(); // a visitor's own repeat reads, it never exchanges
      r.controller.bind(GUEST);
      await tick();
      expect(r.exchange).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(r.state)).not.toContain(SECRET);
    });
  }

  it("after a lost exchange answer, the visitor's repeat is a READ with the cookie and can succeed", async () => {
    const r = rig();
    r.exchange.mockRejectedValue(new ApiNetworkError());
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.failure).toBe("exchange-uncertain"));
    r.controller.retry();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(1);
  });

  it("a used link is not retryable at all", async () => {
    const r = rig();
    r.exchange.mockRejectedValue(problem(401));
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("failed"));
    r.controller.retry();
    await tick();
    expect(r.read).not.toHaveBeenCalled();
  });

  it("the read after an exchange waits for any exchange of the id still under way (a re-mounted page)", async () => {
    const r = rig();
    const gate = deferred<void>();
    r.whenExchangeSettled.mockReturnValue(gate.promise);
    r.controller.bind(GUEST);
    await tick();
    expect(r.read).not.toHaveBeenCalled();
    gate.resolve();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
  });
});

describe("read failures", () => {
  it("is one generic message for another account, a guest without session and an unknown reservation", async () => {
    for (const error of [problem(401, "reservation.manage-session-invalid"), problem(404, "reservation.not-found"), problem(403)]) {
      const r = rig();
      r.read.mockRejectedValue(error);
      r.controller.bind(GUEST);
      await vi.waitFor(() => expect(r.state.phase).toBe("failed"));
      expect(r.state).toMatchObject({ failure: "no-access", reservation: null });
    }
  });

  it("an invalid customer session asks for one re-read, shows no data and never loops or falls back to guest", async () => {
    const r = rig();
    r.read.mockRejectedValue(problem(401, "auth.session-invalid"));
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.failure).toBe("session-invalid"));
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    // the provider's re-read passes through "loading" and settles to the same identity
    r.controller.bind({ reservationId: ID, identityKey: null });
    r.controller.bind(GUEST);
    await tick();
    expect(r.read).toHaveBeenCalledTimes(1);
    expect(r.state).toMatchObject({ phase: "failed", failure: "session-invalid" });
    r.controller.retry(); // not offered for this failure
    await tick();
    expect(r.read).toHaveBeenCalledTimes(1);
    // a different verified identity is a new view and is read
    r.read.mockResolvedValue(RES);
    r.controller.bind({ reservationId: ID, identityKey: "customer:aaaa" });
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
  });

  it("network, 429 and 5xx are told apart and a read can be repeated", async () => {
    for (const [error, failure] of [[new ApiNetworkError(), "network"], [problem(429), "rate-limited"], [problem(500), "server"]] as const) {
      const r = rig();
      r.read.mockRejectedValueOnce(error);
      r.controller.bind(GUEST);
      await vi.waitFor(() => expect(r.state.failure).toBe(failure));
      r.controller.retry();
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    }
  });

  it("an answer for another reservation is refused by the service contract and shows as a server failure, never as data", async () => {
    const r = rig();
    r.read.mockRejectedValue(new ManagementContractError());
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "server", reservation: null }));
  });
});

describe("a change of reservation or identity", () => {
  it("clears the old view in the same call, aborts its read and ignores its late answer", async () => {
    const r = rig();
    await ready(r);
    const late = deferred<ManagedReservation>();
    r.read.mockImplementationOnce((_id, signal) => { r.signals.push(signal); return late.promise; });
    r.controller.bind({ reservationId: ID, identityKey: "customer:b" });
    expect(r.state.reservation).toBeNull(); // synchronously
    expect(isStateFor(r.state, ID, "guest")).toBe(false);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    const stale = r.signals[r.signals.length - 1];
    r.controller.bind({ reservationId: ID, identityKey: "customer:c" });
    expect(stale.aborted).toBe(true);
    late.resolve({ ...RES, confirmationNumber: "OLD" });
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.reservation?.confirmationNumber).toBe("BHA-1");
    expect(isStateFor(r.state, ID, "customer:c")).toBe(true);
  });

  it("A → B while A is still in flight never renders A", async () => {
    const r = rig();
    const a = deferred<ManagedReservation>();
    r.read.mockImplementationOnce((_id, signal) => { r.signals.push(signal); return a.promise; });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(1));
    r.controller.bind({ reservationId: ID_B, identityKey: "guest" });
    a.resolve({ ...RES, confirmationNumber: "A-ONLY" });
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.reservation).toMatchObject({ reservationId: ID_B });
    expect(JSON.stringify(r.state)).not.toContain("A-ONLY");
  });

  it("a verified identity that becomes unknown (loading) hides everything and requests nothing until it settles", async () => {
    const r = rig();
    await ready(r);
    r.controller.bind({ reservationId: ID, identityKey: null });
    expect(r.state).toMatchObject({ phase: "waiting", reservation: null });
    expect(isStateFor(r.state, ID, null)).toBe(false);
    expect(r.read).toHaveBeenCalledTimes(1);
  });

  it("the exchange of the first view finishes while the identity changes: the new view reads after it, and exchanges nothing", async () => {
    const r = rig();
    const exchanging = deferred<void>();
    r.exchange.mockReturnValue(exchanging.promise);
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await tick();
    // the registry (not this controller) is what the second view waits on
    r.whenExchangeSettled.mockReturnValue(exchanging.promise);
    r.controller.bind({ reservationId: ID, identityKey: "customer:a" });
    await tick();
    expect(r.read).not.toHaveBeenCalled();
    exchanging.resolve();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(1);
    expect(isStateFor(r.state, ID, "customer:a")).toBe(true);
  });

  it("dispose drops answers on their way, and the controller can be bound again", async () => {
    const r = rig();
    const slow = deferred<ManagedReservation>();
    r.read.mockImplementationOnce(() => slow.promise);
    r.controller.bind(GUEST);
    r.controller.dispose();
    slow.resolve(RES);
    await tick();
    expect(r.state.reservation).toBeNull();
    await ready(r);
  });
});

describe("estimated arrival", () => {
  it("saves once, shows the server's answer, and a double click sends one request", async () => {
    const r = rig();
    await ready(r);
    const saved = deferred<ManagedReservation>();
    r.update.mockReturnValue(saved.promise);
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "01:30" });
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "01:30" });
    expect(r.update).toHaveBeenCalledTimes(1);
    expect(r.update).toHaveBeenCalledWith(ID, { arrivalDate: "2026-12-02", arrivalTime: "01:30" });
    expect(r.state.save).toEqual({ status: "saving" });
    saved.resolve(withEta("2026-12-02", "01:30"));
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.state.reservation?.estimatedArrival).toMatchObject({ arrivalDate: "2026-12-02", arrivalTime: "01:30" });
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("refuses locally an out-of-window date or a bad time without a request, and never for a cancelled booking", async () => {
    const r = rig();
    await ready(r);
    r.controller.submitArrival({ arrivalDate: "2026-12-05", arrivalTime: "10:00" });
    expect(r.state.save).toEqual({ status: "error", messageKey: MANAGE.etaInvalidDate });
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "" });
    expect(r.state.save).toEqual({ status: "error", messageKey: MANAGE.etaInvalidTime });
    expect(r.update).not.toHaveBeenCalled();
    const c = rig();
    c.read.mockResolvedValue({ ...RES, status: "Cancelled" });
    await ready(c);
    c.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "10:00" });
    expect(c.update).not.toHaveBeenCalled();
  });

  it("a refusal before anything was written is shown by its code and the form can be sent again by the visitor", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(problem(400, "validation.arrival-time-nonexistent"));
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "02:30" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "error", messageKey: "shared.apiError.validation.arrival-time-nonexistent" }));
    expect(r.update).toHaveBeenCalledTimes(1);
    r.update.mockResolvedValueOnce(withEta("2026-12-01", "21:00"));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:00" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(2);
  });

  it("a 429 or an antiforgery refusal is a known refusal, not a replay", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(problem(429, "booking.rate-limited"));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:00" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "error", messageKey: "shared.apiError.auth.rate-limited" }));
    r.update.mockRejectedValueOnce(problem(400, "auth.csrf-invalid"));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:00" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "error", messageKey: "shared.apiError.auth.csrf-invalid" }));
    expect(r.update).toHaveBeenCalledTimes(2);
  });

  it("a 409 (cancelled meanwhile) reads the reservation again and editing becomes impossible", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(problem(409, "reservation.arrival-not-changeable"));
    r.read.mockResolvedValueOnce({ ...RES, status: "Cancelled" });
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:00" });
    await vi.waitFor(() => expect(r.state.reservation?.status).toBe("Cancelled"));
    expect(r.state.save).toEqual({ status: "error", messageKey: "shared.apiError.reservation.arrival-not-changeable" });
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "22:00" });
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("a lost answer: the server is read first; 'saved' only when it holds exactly what was sent; the update is never replayed", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(new ApiNetworkError());
    const verify = deferred<ManagedReservation>();
    r.read.mockReturnValueOnce(verify.promise);
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "verifying" }));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" }); // disabled while verifying
    verify.resolve(withEta("2026-12-01", "21:30"));
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("P2-1: a lost answer is never turned into 'not saved' by a read that does not show the value; the update is never replayed", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(problem(503));
    r.read.mockResolvedValueOnce(withEta("2026-12-01", "18:00")); // first read still shows the OLD value: the lost POST may not have committed yet
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
    expect(r.state.reservation?.estimatedArrival?.arrivalTime).toBe("18:00"); // what the server holds right now is shown, nothing is claimed about the POST
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" }); // the submit lock holds for this management session
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    expect(r.update).toHaveBeenCalledTimes(1);
    // "Check again" only reads: a read with no arrival at all, and another with a different value, stay unverified
    r.read.mockResolvedValueOnce(RES);
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
    r.read.mockResolvedValueOnce(withEta("2026-12-02", "09:00"));
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
    // ... and only a read that shows exactly the submitted date and time confirms it
    r.read.mockResolvedValueOnce(withEta("2026-12-01", "21:30"));
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(1);
    // confirmed: the form is free again
    r.update.mockResolvedValueOnce(withEta("2026-12-01", "22:00"));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "22:00" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(2);
  });

  it("P2-1: the first verifying read sees the old value, the next one the new value: one POST only", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(new ApiNetworkError());
    const first = deferred<ManagedReservation>();
    r.read.mockReturnValueOnce(first.promise);
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "verifying" }));
    first.resolve(withEta("2026-12-01", "18:00"));
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
    r.read.mockResolvedValueOnce(withEta("2026-12-01", "21:30"));
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("when the verifying read fails too, nothing is claimed, submitting stays off, and only a read can be repeated", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(new ApiNetworkError());
    r.read.mockRejectedValueOnce(new ApiNetworkError());
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    expect(r.update).toHaveBeenCalledTimes(1);
    r.read.mockResolvedValueOnce(withEta("2026-12-01", "21:30"));
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("P2-2 (behaviour only): after a 409 with the read held, a second submit sends nothing and the late read cannot overwrite a saved arrival", async () => {
    const r = rig();
    await ready(r);
    const held = deferred<ManagedReservation>();
    r.update.mockRejectedValueOnce(problem(409, "reservation.arrival-not-changeable"));
    r.read.mockReturnValueOnce(held.promise);
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:00" });
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    r.update.mockResolvedValueOnce(withEta("2026-12-01", "22:00"));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "22:00" }); // the visitor presses Save again while the read is out
    await tick();
    held.resolve(RES); // the read answers last, with the state from before any second save
    await tick();
    // the page must never show something older than a save the server accepted ...
    expect.soft(r.state.reservation?.estimatedArrival?.arrivalTime ?? null).toBe(r.update.mock.calls.length > 1 ? "22:00" : null);
    // ... and no second POST goes out while the booking is being re-read
    expect.soft(r.update).toHaveBeenCalledTimes(1);
  });

  describe("P2-2: the read after a 409 keeps the form shut", () => {
    async function conflict(r: ReturnType<typeof rig>) {
      await ready(r);
      const held = deferred<ManagedReservation>();
      r.update.mockRejectedValueOnce(problem(409, "reservation.arrival-not-changeable"));
      r.read.mockReturnValueOnce(held.promise);
      r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:00" });
      const refusal = "shared.apiError.reservation.arrival-not-changeable";
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "conflict", messageKey: refusal, checking: true }));
      return { held, refusal };
    }

    it("a second click or Enter while the read is held sends no second POST; when the read says it is still editable the form opens again", async () => {
      const r = rig();
      const { held, refusal } = await conflict(r);
      r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "22:00" });
      r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "22:00" });
      expect(r.update).toHaveBeenCalledTimes(1);
      held.resolve(withEta("2026-12-01", "08:00"));
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "error", messageKey: refusal }));
      expect(r.state.reservation?.estimatedArrival?.arrivalTime).toBe("08:00");
      r.update.mockResolvedValueOnce(withEta("2026-12-01", "22:00"));
      r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "22:00" });
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
      expect(r.update).toHaveBeenCalledTimes(2);
    });

    it("a held read cannot overwrite a later save: there is no later save", async () => {
      const r = rig();
      const { held } = await conflict(r);
      r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
      held.resolve(RES);
      await vi.waitFor(() => expect(r.state.save.status).toBe("error"));
      expect(r.update).toHaveBeenCalledTimes(1);
      expect(r.state.reservation?.estimatedArrival).toBeNull();
    });

    it("a Cancelled answer keeps writing shut", async () => {
      const r = rig();
      const { held, refusal } = await conflict(r);
      held.resolve({ ...RES, status: "Cancelled" });
      await vi.waitFor(() => expect(r.state.reservation?.status).toBe("Cancelled"));
      expect(r.state.save).toEqual({ status: "error", messageKey: refusal });
      r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "22:00" });
      expect(r.update).toHaveBeenCalledTimes(1);
    });

    it("a temporary read failure keeps writing shut; Check again only reads and reopens the form when the booking is still editable", async () => {
      const r = rig();
      const { held, refusal } = await conflict(r);
      held.reject(new ApiNetworkError());
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "conflict", messageKey: refusal, checking: false }));
      r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "22:00" });
      expect(r.update).toHaveBeenCalledTimes(1);
      const again = deferred<ManagedReservation>();
      r.read.mockReturnValueOnce(again.promise);
      r.controller.verifySave();
      r.controller.verifySave(); // a second press while the read is out starts nothing
      expect(r.state.save).toEqual({ status: "conflict", messageKey: refusal, checking: true });
      await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(3));
      expect(r.read).toHaveBeenCalledTimes(3); // the second press started nothing
      again.reject(problem(503));
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "conflict", messageKey: refusal, checking: false }));
      r.read.mockResolvedValueOnce(RES);
      r.controller.verifySave();
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "error", messageKey: refusal }));
      expect(r.update).toHaveBeenCalledTimes(1);
      r.update.mockResolvedValueOnce(withEta("2026-12-01", "22:00"));
      r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "22:00" });
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    });

    it("losing access during the read clears the private view", async () => {
      const r = rig();
      const { held } = await conflict(r);
      held.reject(problem(404));
      await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "no-access", reservation: null }));
    });

    it("a read that returns after the identity changed neither updates the new view nor opens or shuts its form", async () => {
      const r = rig();
      const { held } = await conflict(r);
      r.controller.bind({ reservationId: ID, identityKey: "customer:b" });
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
      const snapshot = r.state;
      held.resolve({ ...RES, status: "Cancelled" });
      await tick();
      expect(r.state).toBe(snapshot);
      expect(r.state.reservation?.status).toBe("Confirmed");
      r.update.mockResolvedValueOnce(withEta("2026-12-02", "00:15"));
      r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "00:15" });
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    });

    it("a read that fails after the identity changed does not shut the new view's form", async () => {
      const r = rig();
      const { held } = await conflict(r);
      r.controller.bind({ reservationId: ID, identityKey: "customer:b" });
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
      held.reject(new ApiNetworkError());
      await tick();
      expect(r.state.save).toEqual({ status: "idle" });
      r.update.mockResolvedValueOnce(withEta("2026-12-02", "00:15"));
      r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "00:15" });
      await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    });
  });

  it("losing access during the update clears the private view", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(problem(401, "reservation.manage-session-invalid"));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "no-access", reservation: null }));
  });

  it("an answer that arrives after the view changed is dropped (no stale write result)", async () => {
    const r = rig();
    await ready(r);
    const late = deferred<ManagedReservation>();
    r.update.mockReturnValue(late.promise);
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    r.controller.bind({ reservationId: ID, identityKey: "customer:b" });
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    late.resolve(withEta("2026-12-01", "21:30"));
    await tick();
    expect(r.state.reservation?.estimatedArrival).toBeNull();
    expect(r.state.save).toEqual({ status: "idle" });
    // the new view is free to submit (the old request's lock did not leak into it)
    r.update.mockResolvedValueOnce(withEta("2026-12-02", "00:15"));
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "00:15" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
  });
});

describe("the secret never reaches an error object", () => {
  it("an axios error that carried the token in its request config is not what the page keeps", async () => {
    const r = rig();
    const leaky = new axios.AxiosError("Network Error", "ERR_NETWORK", { data: JSON.stringify({ token: SECRET }) } as never);
    r.exchange.mockRejectedValue(leaky);
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("failed"));
    expect(JSON.stringify(r.state)).not.toContain(SECRET);
    expect(Object.values(r.state).some((v) => v === leaky)).toBe(false);
  });
});
