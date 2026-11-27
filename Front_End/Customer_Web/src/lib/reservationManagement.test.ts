import { describe, expect, it, vi } from "vitest";
import axios from "axios";
import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { CsrfTokenUnavailableError, RequestSupersededError } from "@/lib/api/csrf";
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
const LOADING_CTX: ManageContext = { reservationId: ID, identityKey: null };
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
  // A guest who opened a link has no management session until an exchange succeeded: the page's read before the exchange (PR09-C8) is answered like the API does.
  let linkOpen = false;
  let exchanged = false;
  let boundKey: string | null = null; // who the page is verified as: a guest is answered 401, a signed-in account that has no access yet is answered 404 (PR09-C9)
  const exchange = vi.fn<[string, string, (() => boolean)?], Promise<void>>().mockImplementation(async () => { exchanged = true; });
  const whenExchangeSettled = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);
  const signals: AbortSignal[] = [];
  const read = vi.fn<[string, AbortSignal], Promise<ManagedReservation>>().mockImplementation(async (id, signal) => {
    signals.push(signal);
    if (linkOpen && !exchanged) throw boundKey?.startsWith("customer:") ? problem(404, "reservation.not-found") : problem(401, "reservation.manage-session-invalid");
    return { ...RES, reservationId: id };
  });
  const update = vi.fn<[string, { arrivalDate: string; arrivalTime: string }], Promise<ManagedReservation>>();
  const requestSessionRefresh = vi.fn();
  const controller = createReservationManagementController({ exchange, whenExchangeSettled, read, update, requestSessionRefresh });
  const offerLink = controller.offerLink;
  const openLink = controller.openLink;
  const bind = controller.bind;
  controller.bind = (context) => { boundKey = context.identityKey; bind(context); };
  controller.offerLink = (offer) => { if (offer.kind === "token") linkOpen = true; offerLink(offer); };
  controller.openLink = (offer) => { if (offer.kind === "token") linkOpen = true; openLink(offer); };
  const grantSession = () => { exchanged = true; }; // the server set the management cookie (even if the answer to the exchange was lost)
  return { controller, exchange, whenExchangeSettled, read, update, requestSessionRefresh, signals, grantSession, get state() { return controller.getState(); } };
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
    expect(classifyExchangeError(new RequestSupersededError())).toBe("link-not-sent"); // a joined exchange whose POST was never sent (C5): the link is not spent
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
    expect(r.exchange).toHaveBeenCalledWith(ID, SECRET, expect.any(Function)); // the third argument is the view's validity (C5)
    expect(r.read).toHaveBeenCalledTimes(2); // the read before the exchange (PR09-C8: it decides whether the link may be spent) and the read after it
    expect(r.read.mock.invocationCallOrder[0]).toBeLessThan(r.exchange.mock.invocationCallOrder[0]);
    expect(r.exchange.mock.invocationCallOrder[0]).toBeLessThan(r.read.mock.invocationCallOrder[1]);
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
      expect(r.read).toHaveBeenCalledTimes(1); // only the read before the exchange (PR09-C8); none after the failed one
      r.controller.retry(); // a visitor's own repeat reads, it never exchanges
      r.controller.bind(GUEST);
      await tick();
      expect(r.exchange).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(r.state)).not.toContain(SECRET);
    });
  }

  it("after a lost exchange answer, the visitor's repeat is a READ with the cookie and can succeed", async () => {
    const r = rig();
    r.exchange.mockImplementation(async () => { r.grantSession(); throw new ApiNetworkError(); }); // the cookie was set, the answer was lost
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.failure).toBe("exchange-uncertain"));
    r.controller.retry();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(2); // the read before the exchange, and the visitor's own repeat
  });

  it("a used link is not retryable at all", async () => {
    const r = rig();
    r.exchange.mockRejectedValue(problem(401));
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("failed"));
    r.controller.retry();
    await tick();
    expect(r.read).toHaveBeenCalledTimes(1); // only the read before the exchange: a used link has no repeat
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
    expect(r.read).toHaveBeenCalledTimes(1); // only the first view's read before its exchange; the new view waits for the exchange
    r.grantSession();
    exchanging.resolve();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(2);
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
    expect(r.update).toHaveBeenCalledWith(ID, { arrivalDate: "2026-12-02", arrivalTime: "01:30" }, expect.any(Function));
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

  it("a lost answer: the server is read first and shown; it is never reported as saved and the update is never replayed (PR09-C3 P2-1)", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(new ApiNetworkError());
    const verify = deferred<ManagedReservation>();
    r.read.mockReturnValueOnce(verify.promise);
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "verifying" }));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" }); // disabled while verifying
    verify.resolve(withEta("2026-12-01", "21:30"));
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
    expect(r.state.reservation?.estimatedArrival).toMatchObject({ arrivalDate: "2026-12-01", arrivalTime: "21:30" }); // the read is shown ...
    expect(r.update).toHaveBeenCalledTimes(1); // ... but proves nothing about the lost POST
  });

  it("PR09-C3 P2-1: the stored arrival already equals the one submitted; a matching read after a lost POST keeps the lock, so a later, different update cannot be overtaken by the delayed first one", async () => {
    const r = rig();
    r.read.mockResolvedValue(withEta("2026-12-01", "21:30")); // the SAME value is stored before anything is submitted
    await ready(r);
    r.update.mockRejectedValueOnce(new ApiNetworkError());
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" })); // the verifying GET matches at once
    expect(r.state.save.status).not.toBe("saved");
    r.update.mockResolvedValue(withEta("2026-12-02", "09:00"));
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" }); // the guest now tries another value
    await tick();
    expect(r.update).toHaveBeenCalledTimes(1);
    expect(r.state.save).toEqual({ status: "unverified" });
    r.controller.verifySave(); // "Check again" is a read and nothing else, even when it matches again
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(3));
    await tick();
    expect(r.state.save).toEqual({ status: "unverified" });
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("PR09-C3 P2-1: the first read differs from the submitted value and a later read matches it; the form stays shut and nothing is reported saved", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(problem(503));
    r.read.mockResolvedValueOnce(withEta("2026-12-01", "18:00"));
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
    expect(r.state.reservation?.estimatedArrival?.arrivalTime).toBe("18:00"); // what the server holds right now is shown
    r.read.mockResolvedValueOnce(RES); // no arrival at all
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(3));
    await tick();
    expect(r.state.save).toEqual({ status: "unverified" });
    r.read.mockResolvedValueOnce(withEta("2026-12-01", "21:30")); // now it matches
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(4));
    await tick();
    expect(r.state.save).toEqual({ status: "unverified" });
    expect(r.state.reservation?.estimatedArrival?.arrivalTime).toBe("21:30");
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    r.controller.submitArrival({ arrivalDate: "2026-12-01", arrivalTime: "21:30" });
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
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(3));
    await tick();
    expect(r.state.save).toEqual({ status: "unverified" });
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("PR09-C3 P2-2: a token that could not be read means nothing was sent: a retryable error, no verifying read, no automatic resend; the next Save sends exactly one POST", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(new CsrfTokenUnavailableError());
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "error", messageKey: MANAGE.etaNotSent }));
    await tick();
    expect(r.update).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(1); // only the load read: no verifying read
    expect(r.state.reservation?.estimatedArrival).toBeNull();
    r.update.mockResolvedValueOnce(withEta("2026-12-02", "09:00"));
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(2);
    expect(r.read).toHaveBeenCalledTimes(1);
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


describe("PR09-C4 P2-1: an unsettled arrival update keeps its hold through a session recheck", () => {
  const LOADING: ManageContext = { reservationId: ID, identityKey: null };
  /** The verified identity goes through loading/unknown (a failed sign-out, a refresh) and the same account is verified again. */
  async function recheck(r: ReturnType<typeof rig>, ctx: ManageContext = GUEST) {
    r.controller.bind(LOADING);
    expect(r.state).toMatchObject({ phase: "waiting", reservation: null }); // hidden at once, nothing private kept
    expect(JSON.stringify(r.state)).not.toContain("BHA-1");
    r.controller.bind(ctx);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
  }
  const submit = (r: ReturnType<typeof rig>, time = "09:00") => r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: time });

  it("a POST still pending: after the recheck the form is shut (published) and a second Save sends nothing", async () => {
    const r = rig();
    await ready(r);
    const pending = deferred<ManagedReservation>();
    r.update.mockReturnValue(pending.promise);
    submit(r);
    expect(r.state.save).toEqual({ status: "saving" });
    await recheck(r);
    expect(r.state.save).toEqual({ status: "unverified" }); // the form is shut, not just ignoring clicks
    submit(r, "10:00");
    await tick();
    expect(r.update).toHaveBeenCalledTimes(1);
    r.controller.verifySave(); // "Check again" is a read only
    await tick();
    expect(r.state.save).toEqual({ status: "unverified" });
    submit(r, "11:00");
    await tick();
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("P2-1 (behaviour only): a pending POST, the identity goes through loading and back, a second Save: exactly one POST (pending, and lost)", async () => {
    for (const lost of [false, true]) {
      const r = rig();
      await ready(r);
      const pending = deferred<ManagedReservation>();
      r.update.mockReturnValueOnce(pending.promise);
      submit(r);
      if (lost) pending.reject(new ApiNetworkError());
      if (lost) await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
      r.controller.bind(LOADING);
      r.controller.bind(GUEST);
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
      r.update.mockResolvedValue(withEta("2026-12-02", "10:00"));
      submit(r, "10:00");
      await tick();
      expect(r.update).toHaveBeenCalledTimes(1);
    }
  });

  it("a lost POST: the same holds through the recheck, and a read that equals the submitted value still confirms nothing", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(new ApiNetworkError());
    submit(r);
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "unverified" }));
    r.read.mockResolvedValue(withEta("2026-12-02", "09:00")); // the same value is on the server
    await recheck(r);
    expect(r.state.save).toEqual({ status: "unverified" });
    expect(r.state.reservation?.estimatedArrival).toMatchObject({ arrivalTime: "09:00" }); // the read is shown ...
    submit(r, "10:00");
    r.controller.verifySave();
    await tick();
    submit(r, "10:00");
    expect(r.update).toHaveBeenCalledTimes(1); // ... and proves nothing about the lost POST
    expect(r.state.save).toEqual({ status: "unverified" });
  });

  it("the hold also survives the recheck of a view that came through a link exchange", async () => {
    const r = rig();
    r.controller.offerLink({ kind: "token", token: SECRET });
    await ready(r);
    r.update.mockReturnValue(deferred<ManagedReservation>().promise);
    submit(r);
    await recheck(r);
    expect(r.state.save).toEqual({ status: "unverified" });
    expect(r.exchange).toHaveBeenCalledTimes(1);
    submit(r, "10:00");
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("a definite success that arrives while the view is hidden frees only its own hold: nothing is rebuilt from it, and the next view is open", async () => {
    const r = rig();
    await ready(r);
    const pending = deferred<ManagedReservation>();
    r.update.mockReturnValueOnce(pending.promise);
    submit(r);
    r.controller.bind(LOADING);
    pending.resolve(withEta("2026-12-02", "09:00"));
    await tick();
    expect(r.state).toMatchObject({ phase: "waiting", reservation: null, save: { status: "idle" } }); // the answer's data is not shown, nothing is published
    expect(r.read).toHaveBeenCalledTimes(1); // no read was started for a hidden view
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.reservation?.estimatedArrival).toBeNull(); // the fresh read, not the old answer
    expect(r.state.save).toEqual({ status: "idle" });
    r.update.mockResolvedValueOnce(withEta("2026-12-02", "10:00"));
    submit(r, "10:00");
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(2);
  });

  it("a definite answer that arrives after the view came back changes nothing in it; Check again then opens the form because that request is settled", async () => {
    const r = rig();
    await ready(r);
    const pending = deferred<ManagedReservation>();
    r.update.mockReturnValueOnce(pending.promise);
    submit(r);
    await recheck(r);
    expect(r.state.save).toEqual({ status: "unverified" });
    pending.resolve(withEta("2026-12-02", "09:00"));
    await tick();
    expect(r.state.save).toEqual({ status: "unverified" }); // the late answer neither says "saved" nor edits the new view
    expect(r.state.reservation?.estimatedArrival).toBeNull();
    submit(r, "10:00");
    expect(r.update).toHaveBeenCalledTimes(1); // still shut until the visitor reads again
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "idle" })); // the hold is gone: its own answer came, not the read's content
    r.update.mockResolvedValueOnce(withEta("2026-12-02", "10:00"));
    submit(r, "10:00");
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(2);
  });

  for (const [name, error] of [
    ["a 400 refusal", problem(400, "validation.arrival-time-invalid")],
    ["a 429", problem(429)],
    ["a 409", problem(409, "reservation.arrival-not-changeable")],
    ["a lost session (401)", problem(401, "reservation.manage-session-invalid")],
    ["a token that was never read", new CsrfTokenUnavailableError()],
  ] as const) {
    it(`${name} that arrives while the view is hidden frees only its hold and publishes nothing`, async () => {
      const r = rig();
      await ready(r);
      const pending = deferred<ManagedReservation>();
      r.update.mockReturnValueOnce(pending.promise);
      submit(r);
      r.controller.bind(LOADING);
      pending.reject(error);
      await tick();
      expect(r.state).toMatchObject({ phase: "waiting", reservation: null, failure: null });
      expect(r.read).toHaveBeenCalledTimes(1);
      r.controller.bind(GUEST);
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
      expect(r.state.save).toEqual({ status: "idle" });
    });
  }

  it("an unknown outcome that arrives while the view is hidden keeps the hold and starts no read; the view comes back shut", async () => {
    const r = rig();
    await ready(r);
    const pending = deferred<ManagedReservation>();
    r.update.mockReturnValueOnce(pending.promise);
    submit(r);
    r.controller.bind(LOADING);
    pending.reject(new ApiNetworkError());
    await tick();
    expect(r.state).toMatchObject({ phase: "waiting", reservation: null });
    expect(r.read).toHaveBeenCalledTimes(1);
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "unverified" });
    submit(r, "10:00");
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("another identity or reservation is not shut by it, and its answer cannot free their lock", async () => {
    const r = rig();
    await ready(r);
    const a = deferred<ManagedReservation>();
    r.update.mockReturnValueOnce(a.promise);
    submit(r); // guest of ID: unsettled
    const OTHER: ManageContext = { reservationId: ID, identityKey: "customer:b" };
    r.controller.bind(OTHER);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "idle" }); // another identity's view is not held by guest's request
    const b = deferred<ManagedReservation>();
    r.update.mockReturnValueOnce(b.promise);
    submit(r, "10:00");
    expect(r.update).toHaveBeenCalledTimes(2);
    a.resolve(withEta("2026-12-02", "09:00")); // the first request's definite answer arrives now
    await tick();
    expect(r.state.save).toEqual({ status: "saving" }); // the other view is untouched
    expect(r.state.reservation?.estimatedArrival).toBeNull();
    submit(r, "11:00");
    expect(r.update).toHaveBeenCalledTimes(2); // and its own lock was not opened by the other's answer
    await recheck(r, OTHER);
    expect(r.state.save).toEqual({ status: "unverified" }); // B's own request is still unsettled
    b.resolve(withEta("2026-12-02", "10:00"));
    await tick();
    r.controller.bind(GUEST); // guest's request was answered: its hold is gone
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "idle" });
  });

  for (const [name, answer] of [
    ["a definite success", (d: ReturnType<typeof deferred<ManagedReservation>>) => d.resolve(withEta("2026-12-02", "09:00"))],
    ["a definite refusal", (d: ReturnType<typeof deferred<ManagedReservation>>) => d.reject(problem(400, "validation.arrival-time-invalid"))],
  ] as const) {
    it(`another reservation's view is not shut by it, and ${name} of the first cannot touch the second's lock or view`, async () => {
      const r = rig();
      await ready(r);
      const a = deferred<ManagedReservation>();
      r.update.mockReturnValueOnce(a.promise);
      submit(r); // reservation A: unsettled
      const OTHER_RESERVATION: ManageContext = { reservationId: ID_B, identityKey: "guest" };
      r.controller.bind(OTHER_RESERVATION);
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
      expect(r.state.reservation).toMatchObject({ reservationId: ID_B });
      expect(r.state.save).toEqual({ status: "idle" }); // not held by A's request
      const b = deferred<ManagedReservation>();
      r.update.mockReturnValueOnce(b.promise);
      r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "10:00" });
      expect(r.update).toHaveBeenCalledTimes(2);
      expect(r.update).toHaveBeenLastCalledWith(ID_B, { arrivalDate: "2026-12-02", arrivalTime: "10:00" }, expect.any(Function));
      answer(a); // A's answer arrives while B is on screen and B's request is out
      await tick();
      expect(r.state.save).toEqual({ status: "saving" }); // B untouched
      expect(r.state.reservation).toMatchObject({ reservationId: ID_B, estimatedArrival: null }); // nothing of A's answer is shown
      r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "11:00" });
      expect(r.update).toHaveBeenCalledTimes(2); // B's own lock was not opened by A's answer
      r.controller.bind(GUEST); // back to A: its request was answered, so its hold is gone
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
      expect(r.state.reservation).toMatchObject({ reservationId: ID });
      expect(r.state.save).toEqual({ status: "idle" });
      r.controller.bind(OTHER_RESERVATION); // and B, whose request is still out, comes back shut
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
      expect(r.state.save).toEqual({ status: "unverified" });
      b.resolve(withEta("2026-12-02", "10:00"));
    });
  }
});

describe("PR09-C4 P2-2: a link opened in the same tab", () => {
  const SECRET_2 = "Yq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwxyz";
  it("after a 429 the visitor opens the link again: exactly one more exchange for that open, then the booking is read", async () => {
    const r = rig();
    r.exchange.mockRejectedValueOnce(problem(429, "booking.rate-limited"));
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.failure).toBe("link-rate-limited"));
    r.controller.openLink({ kind: "token", token: SECRET_2 });
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(2);
    expect(r.exchange).toHaveBeenLastCalledWith(ID, SECRET_2, expect.any(Function));
    expect(r.read).toHaveBeenCalledTimes(3); // one read before each exchange (PR09-C8) and the read after the second
    expect(JSON.stringify(r.state)).not.toContain(SECRET_2);
    // nothing afterwards replays it: a re-render, a re-bind, a read
    r.controller.bind(GUEST);
    r.controller.bind(LOADING_CTX);
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(4));
    r.controller.retry();
    await tick();
    expect(r.exchange).toHaveBeenCalledTimes(2);
  });

  it("after a CSRF refusal or an unreadable token the next explicit open sends one POST", async () => {
    const r = rig();
    r.exchange.mockRejectedValueOnce(new CsrfTokenUnavailableError());
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.failure).toBe("link-not-sent"));
    r.controller.openLink({ kind: "token", token: SECRET_2 });
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(2);

    const q = rig();
    q.exchange.mockRejectedValueOnce(problem(400, "auth.csrf-invalid")).mockRejectedValueOnce(problem(400, "auth.csrf-invalid"));
    q.controller.offerLink({ kind: "token", token: SECRET });
    q.controller.bind(GUEST);
    await vi.waitFor(() => expect(q.state.failure).toBe("link-not-sent"));
    q.controller.openLink({ kind: "token", token: SECRET_2 });
    await vi.waitFor(() => expect(q.exchange).toHaveBeenCalledTimes(2));
    await tick();
    q.controller.retry();
    await tick();
    expect(q.exchange).toHaveBeenCalledTimes(2); // a second refusal is not retried by itself
  });

  it("an open while an exchange is already out sends nothing (no parallel exchange)", async () => {
    const r = rig();
    const out = deferred<void>();
    r.exchange.mockImplementationOnce(() => out.promise.then(() => r.grantSession()));
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("exchanging"));
    r.controller.openLink({ kind: "token", token: SECRET_2 });
    await tick();
    expect(r.exchange).toHaveBeenCalledTimes(1);
    out.resolve();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
  });

  it("a malformed fragment in the same tab sends nothing; an empty one does nothing", async () => {
    const r = rig();
    await ready(r);
    r.controller.openLink({ kind: "none" });
    await tick();
    expect(r.state.phase).toBe("ready");
    r.controller.openLink({ kind: "malformed" });
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "link-invalid" }));
    expect(r.exchange).not.toHaveBeenCalled();
  });

  it("while the identity is not verified the open waits, and is exchanged once when it settles", async () => {
    const r = rig();
    r.controller.bind(LOADING_CTX);
    r.controller.openLink({ kind: "token", token: SECRET });
    await tick();
    expect(r.exchange).not.toHaveBeenCalled();
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.exchange).toHaveBeenCalledWith(ID, SECRET, expect.any(Function)); // the third argument is the view's validity (C5)
  });

  it("after an exchange whose answer was lost, Try again is a read; only an explicit open sends one more POST", async () => {
    const r = rig();
    r.exchange.mockImplementationOnce(async () => { r.grantSession(); throw new ApiNetworkError(); });
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.failure).toBe("exchange-uncertain"));
    r.read.mockRejectedValueOnce(problem(503));
    r.controller.retry();
    await vi.waitFor(() => expect(r.state.failure).toBe("server"));
    r.controller.retry();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
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

describe("PR09-C5 P2-1: a read's answer is checked again where it is published", () => {
  const OTHER: ManageContext = { reservationId: ID, identityKey: "customer:aaaa" };
  const OLD = withEta("2026-12-02", "03:00");
  /**
   * The answer is a reservation whose `reservationId` getter changes the view when `read()` looks at it: that happens inside `read()`, after its own epoch check and
   * before it returns, i.e. exactly in the gap before the caller continues. Deterministic: no timer, no microtask counting.
   */
  function answerThenChange(answer: ReturnType<typeof deferred<ManagedReservation>>, value: ManagedReservation, change: () => void) {
    let fired = false;
    const hooked = { ...value };
    Object.defineProperty(hooked, "reservationId", {
      enumerable: true,
      get: () => {
        if (!fired) { fired = true; change(); }
        return value.reservationId;
      },
    });
    answer.resolve(hooked);
  }
  /** The next two reads: the first one is held (the old view's), the second one (the new view's) is held too. */
  function twoHeldReads(r: ReturnType<typeof rig>) {
    const oldView = deferred<ManagedReservation>();
    const newView = deferred<ManagedReservation>();
    r.read.mockImplementationOnce(() => oldView.promise).mockImplementationOnce(() => newView.promise);
    return { oldView, newView };
  }
  const nothingOld = (r: ReturnType<typeof rig>) => {
    expect(r.state).toMatchObject({ phase: "loading", reservation: null, save: { status: "idle" }, bound: OTHER });
    expect(JSON.stringify(r.state)).not.toContain("03:00");
  };

  it("load(): the old view's DTO is not published under the new identity", async () => {
    const r = rig();
    const { oldView, newView } = twoHeldReads(r);
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(1));
    answerThenChange(oldView, OLD, () => r.controller.bind(OTHER));
    await tick();
    nothingOld(r);
    newView.resolve(RES);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.reservation?.estimatedArrival).toBeNull();
    expect(r.state.bound).toEqual(OTHER);
  });

  it("load(): the same holds when the reservation changes, and when the page is left", async () => {
    const r = rig();
    const { oldView, newView } = twoHeldReads(r);
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(1));
    const B: ManageContext = { reservationId: ID_B, identityKey: "guest" };
    answerThenChange(oldView, OLD, () => r.controller.bind(B));
    await tick();
    expect(r.state).toMatchObject({ phase: "loading", reservation: null, bound: B });
    newView.resolve({ ...RES, reservationId: ID_B });
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));

    const left = rig();
    const held = deferred<ManagedReservation>();
    left.read.mockImplementationOnce(() => held.promise);
    left.controller.bind(GUEST);
    await vi.waitFor(() => expect(left.read).toHaveBeenCalledTimes(1));
    const seen: string[] = [];
    left.controller.subscribe(() => seen.push(left.state.phase));
    answerThenChange(held, OLD, () => left.controller.dispose());
    await tick();
    expect(seen).not.toContain("ready"); // nothing is published for a view that is gone
  });

  it("settle(): the old view's read is not published, and its lock decision is not applied, under the new view", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(new ApiNetworkError()); // lost: the read below settles it
    const { oldView, newView } = twoHeldReads(r);
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "03:00" });
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2)); // load + the verifying read
    expect(r.state.save).toEqual({ status: "verifying" });
    answerThenChange(oldView, OLD, () => r.controller.bind(OTHER));
    await tick();
    nothingOld(r);
    newView.resolve(RES);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "idle" }); // the other identity is free: the old lock did not leak
    r.controller.bind(GUEST); // ... while the lost POST still holds its own view
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST, save: { status: "unverified" } }));
  });

  it("refreshAfterRefusal(): the old view's read, error text and unlock are not applied under the new view", async () => {
    const r = rig();
    await ready(r);
    r.update.mockRejectedValueOnce(problem(409, "reservation.not-editable"));
    const { oldView, newView } = twoHeldReads(r);
    r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "03:00" });
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    expect(r.state.save).toMatchObject({ status: "conflict", checking: true });
    answerThenChange(oldView, OLD, () => r.controller.bind(OTHER));
    await tick();
    nothingOld(r);
    newView.resolve(RES);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "idle" });
  });
});

describe("PR09-C5 P2-3: a read that began before the POST was settled cannot open the form", () => {
  const LOADING: ManageContext = { reservationId: ID, identityKey: null };
  const submit = (r: ReturnType<typeof rig>, time = "09:00") => r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: time });

  /** A POST is pending; the identity goes through loading and the same account is verified again; the new view's GET is out (held). */
  async function pendingPostAndHeldGet() {
    const r = rig();
    await ready(r);
    const post = deferred<ManagedReservation>();
    const get = deferred<ManagedReservation>();
    r.update.mockReturnValueOnce(post.promise);
    submit(r);
    r.read.mockImplementationOnce(() => get.promise);
    r.controller.bind(LOADING);
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    return { r, post, get };
  }

  it("the POST succeeds, then the older GET answers with the old ETA: the form stays shut until a GET that began after the POST; then it shows the new ETA", async () => {
    const { r, post, get } = await pendingPostAndHeldGet();
    post.resolve(withEta("2026-12-02", "09:00"));
    await tick();
    expect(r.state.phase).toBe("loading"); // the POST's answer is not published into the new view
    get.resolve(RES); // the OLD arrival (none), answered after the POST's answer
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.reservation?.estimatedArrival).toBeNull();
    expect(r.state.save).toEqual({ status: "unverified" }); // shut: a read that began before the POST settled decides nothing
    submit(r, "10:00");
    await tick();
    expect(r.update).toHaveBeenCalledTimes(1);

    r.read.mockResolvedValueOnce(withEta("2026-12-02", "09:00")); // a GET that begins now, after the POST settled
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "idle" }));
    expect(r.state.reservation?.estimatedArrival).toMatchObject({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    r.update.mockResolvedValueOnce(withEta("2026-12-02", "10:00"));
    submit(r, "10:00");
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(r.update).toHaveBeenCalledTimes(2);
  });

  it("a definite refusal of the POST before the older GET answers: the same rule (the read began under the hold)", async () => {
    const { r, post, get } = await pendingPostAndHeldGet();
    post.reject(problem(400, "reservation.arrival-invalid"));
    await tick();
    get.resolve(RES);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "unverified" });
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "idle" }));
  });

  it("the older GET fails for a moment: nothing opens; a read the visitor repeats after the POST was settled does", async () => {
    const { r, post, get } = await pendingPostAndHeldGet();
    post.resolve(withEta("2026-12-02", "09:00"));
    await tick();
    get.reject(new ApiNetworkError());
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "network" }));
    expect(r.state.save).toEqual({ status: "idle" }); // there is no form on a failed view
    r.read.mockResolvedValueOnce(withEta("2026-12-02", "09:00"));
    r.controller.retry();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "idle" }); // began after the settle, succeeded
    expect(r.state.reservation?.estimatedArrival).toMatchObject({ arrivalTime: "09:00" });
  });

  it("the older GET fails while the POST is still unsettled: the retry keeps the lock, and only Check again after the POST's answer opens it", async () => {
    const { r, post, get } = await pendingPostAndHeldGet();
    get.reject(new ApiNetworkError());
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "network" }));
    r.controller.retry();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "unverified" }); // the POST has no answer yet
    submit(r, "10:00");
    await tick();
    expect(r.update).toHaveBeenCalledTimes(1);
    post.resolve(withEta("2026-12-02", "09:00"));
    await tick();
    expect(r.state.save).toEqual({ status: "unverified" }); // its answer publishes nothing into this view
    r.controller.verifySave();
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "idle" }));
  });

  it("a POST whose result stays unknown keeps the form shut whatever any read shows (C3/C4 behaviour kept)", async () => {
    const { r, post, get } = await pendingPostAndHeldGet();
    post.reject(new ApiNetworkError());
    await tick();
    get.resolve(withEta("2026-12-02", "09:00"));
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.state.save).toEqual({ status: "unverified" });
    r.controller.verifySave();
    await tick();
    expect(r.state.save).toEqual({ status: "unverified" });
    expect(r.update).toHaveBeenCalledTimes(1);
  });

  it("access lost and Cancelled still behave as before after a recheck", async () => {
    const { r, post, get } = await pendingPostAndHeldGet();
    post.resolve(withEta("2026-12-02", "09:00"));
    get.reject(problem(403));
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "no-access", reservation: null }));
    r.read.mockResolvedValueOnce({ ...RES, status: "Cancelled" });
    r.controller.bind(LOADING);
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    submit(r, "10:00");
    await tick();
    expect(r.update).toHaveBeenCalledTimes(1); // Cancelled stays shut by its status
  });
});

describe("PR09-C6 P3: one recovery read after the same signed-in account is verified again", () => {
  const OWNER: ManageContext = { reservationId: ID, identityKey: "customer:aaaa" };
  const OTHER_OWNER: ManageContext = { reservationId: ID, identityKey: "customer:bbbb" };
  const invalid = () => problem(401, "auth.session-invalid");
  /** What the session provider does after the refresh that was asked for: the identity goes through loading and the same account is verified again. */
  const reverify = (r: ReturnType<typeof rig>, ctx: ManageContext = OWNER) => {
    r.controller.bind(LOADING_CTX);
    expect(r.state).toMatchObject({ phase: "waiting", reservation: null }); // nothing private while it is unverified
    r.controller.bind(ctx);
  };
  const refused = async (r: ReturnType<typeof rig>) => vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "session-invalid" }));

  it("the read is refused, the same account is verified again: exactly one more GET, which succeeds; one session refresh, no exchange", async () => {
    const r = rig();
    r.read.mockRejectedValueOnce(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    reverify(r);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", failure: null, bound: OWNER }));
    expect(r.read).toHaveBeenCalledTimes(2);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    expect(r.exchange).not.toHaveBeenCalled();
  });

  it("the recovery read is refused too: the error stays, the session is not refreshed again, and no further read starts for this account (also after another recheck)", async () => {
    const r = rig();
    r.read.mockRejectedValue(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    reverify(r);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    await refused(r);
    await tick();
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1); // the recovery pass is over: no refresh from its refusal
    reverify(r);
    await tick();
    reverify(r);
    await tick();
    expect(r.read).toHaveBeenCalledTimes(2);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    expect(r.state).toMatchObject({ phase: "failed", failure: "session-invalid", reservation: null });
    expect(r.exchange).not.toHaveBeenCalled();
  });

  it("a link that was exchanged for the first view is not exchanged again by the recovery read", async () => {
    const r = rig();
    r.controller.offerLink({ kind: "token", token: SECRET });
    // the account has no access yet (404): the link is exchanged; the read after it is refused (the customer cookie is invalid); then the recovery read
    r.read.mockRejectedValueOnce(problem(404, "reservation.not-found")).mockRejectedValueOnce(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    expect(r.exchange).toHaveBeenCalledTimes(1);
    reverify(r);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(3);
  });

  it("a binding that was superseded before it started does not use up the single recovery read", async () => {
    const r = rig();
    r.read.mockRejectedValueOnce(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    // verified, then lost again in the same tick (never started), then verified again: still exactly one recovery GET
    r.controller.bind(LOADING_CTX);
    r.controller.bind(OWNER);
    r.controller.bind(LOADING_CTX);
    await tick();
    expect(r.read).toHaveBeenCalledTimes(1);
    r.controller.bind(OWNER);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.read).toHaveBeenCalledTimes(2);
  });

  it("a guest view gets no recovery: the refusal is followed by one refresh, and the same guest verified again reads nothing (as before)", async () => {
    const r = rig();
    r.read.mockRejectedValueOnce(invalid());
    r.controller.bind(GUEST);
    await refused(r);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    reverify(r, GUEST);
    await tick();
    expect(r.read).toHaveBeenCalledTimes(1);
    expect(r.state).toMatchObject({ phase: "failed", failure: "session-invalid" });
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
  });

  it("another verified identity is a fresh view and ends the old pass; coming back to the first account later gets its own recovery", async () => {
    const r = rig();
    r.read.mockRejectedValueOnce(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    reverify(r, OTHER_OWNER); // another account is verified: its read is a normal first read
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: OTHER_OWNER }));
    expect(r.read).toHaveBeenCalledTimes(2);
    r.read.mockRejectedValueOnce(invalid());
    reverify(r, OWNER); // back to the first account: a normal first read (refused again), not a suppressed one
    await refused(r);
    expect(r.read).toHaveBeenCalledTimes(3);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(2);
    reverify(r, OWNER);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready")); // and it has its own single recovery
    expect(r.read).toHaveBeenCalledTimes(4);
  });

  it("a successful read ends the pass: a later refusal starts a new one (refresh and recovery again)", async () => {
    const r = rig();
    r.read.mockRejectedValueOnce(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    reverify(r);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    r.read.mockRejectedValueOnce(invalid());
    r.controller.bind(LOADING_CTX);
    r.controller.bind(OWNER); // a normal read (refused again)
    await refused(r);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(2);
    reverify(r);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
  });

  it("the recovery read's answer is checked by the epoch: a view that changed meanwhile shows nothing from it", async () => {
    const r = rig();
    r.read.mockRejectedValueOnce(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    const held = deferred<ManagedReservation>();
    r.read.mockImplementationOnce(() => held.promise);
    reverify(r);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    r.controller.bind(LOADING_CTX); // the identity is lost again while the recovery read is out
    held.resolve(RES);
    await tick();
    expect(r.state).toMatchObject({ phase: "waiting", reservation: null });
  });
});

describe("PR09-C7: a link the visitor opens on purpose is not held back by the session-recovery limit", () => {
  const OWNER: ManageContext = { reservationId: ID, identityKey: "customer:aaaa" };
  const SECRET_2 = "Yq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwxyz";
  const invalid = () => problem(401, "auth.session-invalid");
  const notFound = () => problem(404, "reservation.not-found"); // what the API answers a signed-in account that neither owns the booking nor holds a management session
  const refused = (r: ReturnType<typeof rig>) => vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "session-invalid" }));
  const reverify = (r: ReturnType<typeof rig>) => { r.controller.bind(LOADING_CTX); r.controller.bind(OWNER); };
  /** The recovery allowance is used up: the first read and the recovery read were both refused, and a further recheck started nothing. */
  async function exhausted() {
    const r = rig();
    r.read.mockRejectedValue(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    reverify(r);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    await refused(r);
    reverify(r);
    await tick();
    expect(r.read).toHaveBeenCalledTimes(2); // the limit holds for automatic starts
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    return r;
  }

  it("a valid link opened now: exactly one exchange POST, then the booking is read once access is back", async () => {
    const r = await exhausted();
    r.read.mockReset();
    r.read.mockRejectedValueOnce(notFound()).mockResolvedValue(RES); // the customer cookie was repaired in another tab: the account has no access yet (404), then it has
    r.controller.openLink({ kind: "token", token: SECRET });
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: OWNER }));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.exchange).toHaveBeenCalledWith(ID, SECRET, expect.any(Function));
    expect(r.read).toHaveBeenCalledTimes(2); // the read before the exchange (PR09-C9) and the read after it
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1); // no refresh was asked for
    expect(JSON.stringify(r.state)).not.toContain(SECRET);
  });

  it("the exchange succeeds but the read is still refused: the error stays, no refresh, no loop, and the limit is not reset by the paste", async () => {
    const r = await exhausted();
    r.read.mockReset();
    r.read.mockRejectedValueOnce(notFound()).mockRejectedValue(invalid());
    r.controller.openLink({ kind: "token", token: SECRET });
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    await refused(r);
    await tick();
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    reverify(r); // automatic rechecks afterwards still start nothing
    await tick();
    reverify(r);
    await tick();
    expect(r.read).toHaveBeenCalledTimes(2);
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    expect(r.state).toMatchObject({ phase: "failed", failure: "session-invalid", reservation: null });
  });

  it("a malformed fragment sends nothing, shows link-invalid, and does not consume a link or reset the limit", async () => {
    const r = await exhausted();
    r.controller.openLink({ kind: "malformed" });
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "link-invalid" }));
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).toHaveBeenCalledTimes(2);
    reverify(r); // nothing is left over for a later automatic start to send
    await tick();
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).toHaveBeenCalledTimes(2);
    expect(r.state).toMatchObject({ phase: "failed", failure: "session-invalid" });
  });

  it("the link is spent by the paste, not kept for a later start: no exchange from a recheck that follows", async () => {
    const r = await exhausted();
    r.read.mockReset();
    r.read.mockRejectedValueOnce(notFound()).mockRejectedValue(invalid());
    r.controller.openLink({ kind: "token", token: SECRET });
    await refused(r);
    for (let i = 0; i < 3; i += 1) { reverify(r); await tick(); }
    expect(r.exchange).toHaveBeenCalledTimes(1);
  });

  it("no parallel exchange: a second paste while the first exchange is out sends nothing more", async () => {
    const r = await exhausted();
    r.read.mockReset();
    r.read.mockRejectedValueOnce(notFound()).mockResolvedValue(RES);
    const out = deferred<void>();
    r.exchange.mockReturnValueOnce(out.promise);
    r.controller.openLink({ kind: "token", token: SECRET });
    await vi.waitFor(() => expect(r.state.phase).toBe("exchanging"));
    r.controller.openLink({ kind: "token", token: SECRET_2 });
    await tick();
    expect(r.exchange).toHaveBeenCalledTimes(1);
    out.resolve();
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
  });

  it("a pasted link whose exchange fails does not use the allowance: after the account is verified again the recovery read still happens", async () => {
    for (const failure of [problem(429, "booking.rate-limited"), new ApiNetworkError(), new CsrfTokenUnavailableError()]) {
      const r = rig();
      r.read.mockRejectedValueOnce(invalid());
      r.controller.bind(OWNER);
      await refused(r);
      r.exchange.mockRejectedValueOnce(failure);
      r.controller.openLink({ kind: "token", token: SECRET });
      await vi.waitFor(() => expect(r.state.phase).toBe("failed"));
      expect(r.state.failure).not.toBe("session-invalid");
      expect(r.exchange).toHaveBeenCalledTimes(1);
      expect(r.read).toHaveBeenCalledTimes(2); // the read before the exchange (PR09-C9); none followed the failed exchange
      r.read.mockResolvedValueOnce(RES); // the account's own recovery read
      reverify(r);
      await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
      expect(r.read).toHaveBeenCalledTimes(3); // exactly the one recovery GET
      expect(r.exchange).toHaveBeenCalledTimes(1);
    }
  });

  it("with the allowance still available (the first refusal, no recheck yet) a pasted link is exchanged once and its refused read starts no second refresh", async () => {
    const r = rig();
    r.read.mockRejectedValueOnce(invalid()).mockRejectedValueOnce(notFound()).mockRejectedValue(invalid());
    r.controller.bind(OWNER);
    await refused(r);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
    r.controller.openLink({ kind: "token", token: SECRET });
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(3));
    await refused(r);
    await tick();
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.requestSessionRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("PR09-C8 P2: a guest's link is read-checked before it is spent", () => {
  const OWNER: ManageContext = { reservationId: ID, identityKey: "customer:aaaa" };
  const expiredCustomerCookie = () => problem(401, "auth.session-invalid");
  const noSession = () => problem(401, "reservation.manage-session-invalid");
  const open = (r: ReturnType<typeof rig>, ctx: ManageContext = GUEST) => { r.controller.offerLink({ kind: "token", token: SECRET }); r.controller.bind(ctx); };

  it("an expired customer cookie (the server answers auth.session-invalid): 0 exchanges, the link is kept unspent, guidance is shown, and nothing retries by itself", async () => {
    const r = rig();
    r.read.mockRejectedValue(expiredCustomerCookie());
    open(r);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "link-session-expired", reservation: null }));
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.requestSessionRefresh).not.toHaveBeenCalled(); // not the session-recovery pass: the page does not refresh or sign anyone out
    expect(JSON.stringify(r.state)).not.toContain(SECRET);
    r.controller.retry(); // not a read-retryable failure
    r.controller.bind(LOADING_CTX); // rechecks and re-binds never send the (discarded) secret
    r.controller.bind(GUEST);
    await tick();
    r.controller.bind(LOADING_CTX);
    r.controller.bind(GUEST);
    await tick();
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).toHaveBeenCalledTimes(2); // the read before the link, then the first recheck's automatic load (a read, never an exchange); the next is held back by the C6 limit
  });

  it("the same link works in a clean browser: the read says there is no management session, then exactly one exchange, then the booking", async () => {
    const r = rig();
    open(r); // the rig answers reservation.manage-session-invalid until the exchange succeeded
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(2);
    expect(r.read.mock.invocationCallOrder[0]).toBeLessThan(r.exchange.mock.invocationCallOrder[0]);
    expect(r.exchange.mock.invocationCallOrder[0]).toBeLessThan(r.read.mock.invocationCallOrder[1]);
  });

  it("a booking this browser may already read is shown and the link is not spent", async () => {
    const r = rig();
    r.read.mockResolvedValue(RES);
    open(r);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.state)).not.toContain(SECRET);
    r.controller.bind(LOADING_CTX);
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    expect(r.exchange).not.toHaveBeenCalled(); // the secret was not kept for a later start
  });

  for (const [name, error, failure] of [
    ["429", problem(429, "booking.rate-limited"), "link-rate-limited"],
    ["a lost answer (network)", new ApiNetworkError(), "link-not-sent"],
    ["a 5xx", problem(503), "link-not-sent"],
    ["an unusable 2xx", new ManagementContractError(), "link-not-sent"],
    ["a 403", problem(403), "no-access"],
    ["a 404", problem(404), "no-access"],
    ["another 401", problem(401, "something.else"), "no-access"],
    ["a configuration error", new ApiConfigError("x"), "config"],
  ] as const) {
    it(`${name} on the read before the link: this open stops, the link is not sent, and nothing is exchanged later`, async () => {
      const r = rig();
      r.read.mockRejectedValue(error);
      open(r);
      await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure }));
      expect(r.exchange).not.toHaveBeenCalled();
      expect(JSON.stringify(r.state)).not.toContain(SECRET);
      r.controller.bind(LOADING_CTX);
      r.controller.bind(GUEST);
      await tick();
      expect(r.exchange).not.toHaveBeenCalled();
    });
  }

  it("the view changes while the read before the link is out: that answer is dropped, so no exchange of the old view is sent", async () => {
    const r = rig();
    const held = deferred<ManagedReservation>();
    r.read.mockImplementationOnce(() => held.promise);
    open(r);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(1));
    r.controller.bind({ reservationId: ID, identityKey: "customer:bbbb" }); // another account is verified
    held.reject(noSession()); // the old view's answer would have allowed the exchange
    await tick();
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.state).toMatchObject({ bound: { identityKey: "customer:bbbb" } });
    expect(r.state.failure).not.toBe("link-session-expired");
  });

  it("the page is left while that read is out: nothing is exchanged", async () => {
    const r = rig();
    const held = deferred<ManagedReservation>();
    r.read.mockImplementationOnce(() => held.promise);
    open(r);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(1));
    r.controller.dispose();
    held.reject(noSession());
    await tick();
    expect(r.exchange).not.toHaveBeenCalled();
  });

  it("an account that has no access yet (404 reservation.not-found): the link is exchanged once, then the booking is read (PR09-C9)", async () => {
    const r = rig(); // the rig answers a signed-in account 404 reservation.not-found until the exchange succeeded
    open(r, OWNER);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: OWNER }));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(2);
  });

  it("after the expired-cookie guidance, the cookie is gone and the visitor opens the link again in the same tab: one read, one exchange, the booking", async () => {
    const r = rig();
    r.read.mockRejectedValueOnce(expiredCustomerCookie());
    open(r);
    await vi.waitFor(() => expect(r.state.failure).toBe("link-session-expired"));
    r.controller.openLink({ kind: "token", token: SECRET }); // the rig has no management session: the read before the link now says so
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(3);
  });

  it("a malformed fragment still sends nothing and reads nothing before it", async () => {
    const r = rig();
    r.controller.offerLink({ kind: "malformed" });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "link-invalid" }));
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).not.toHaveBeenCalled();
  });
});

describe("PR09-C9: the read before an exchange covers every identity, and only the API's own 'no access yet' lets a link be exchanged", () => {
  const ACCOUNT: ManageContext = { reservationId: ID, identityKey: "customer:aaaa" };
  const strangerNotFound = () => problem(404, "reservation.not-found");
  const open = (r: ReturnType<typeof rig>, ctx: ManageContext) => { r.controller.offerLink({ kind: "token", token: SECRET }); r.controller.bind(ctx); };

  it("a signed-in visitor who can already read the booking (the owner, or an account that also holds its management cookie): shown, 0 POSTs, the link is not spent, whether it is used or fresh", async () => {
    const r = rig();
    r.read.mockResolvedValue(RES);
    open(r, ACCOUNT);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: ACCOUNT }));
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.state)).not.toContain(SECRET);
    // the same link pasted again in this tab: the read answers 200 again, so nothing is posted (the link was not spent by the first open either)
    r.controller.openLink({ kind: "token", token: SECRET });
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(2));
    await tick();
    expect(r.exchange).not.toHaveBeenCalled();
    expect(r.state).toMatchObject({ phase: "ready", bound: ACCOUNT });
  });

  it("a signed-in account with no access yet (404 reservation.not-found): exactly one POST for this open, then the booking; the read comes first", async () => {
    const r = rig(); // the rig answers a signed-in account 404 reservation.not-found until the exchange succeeded
    open(r, ACCOUNT);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: ACCOUNT }));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    expect(r.read).toHaveBeenCalledTimes(2);
    expect(r.read.mock.invocationCallOrder[0]).toBeLessThan(r.exchange.mock.invocationCallOrder[0]);
    expect(r.exchange.mock.invocationCallOrder[0]).toBeLessThan(r.read.mock.invocationCallOrder[1]);
  });

  it("the guest and account rules are exact: a 404 does not let a guest's link go, and a guest's 401 does not let an account's", async () => {
    const guest = rig();
    guest.read.mockRejectedValue(strangerNotFound()); // a guest is never answered 404 by the API
    open(guest, GUEST);
    await vi.waitFor(() => expect(guest.state).toMatchObject({ phase: "failed", failure: "no-access" }));
    expect(guest.exchange).not.toHaveBeenCalled();
    const account = rig();
    account.read.mockRejectedValue(problem(401, "reservation.manage-session-invalid")); // an account is never answered this by the API
    open(account, ACCOUNT);
    await vi.waitFor(() => expect(account.state).toMatchObject({ phase: "failed", failure: "no-access" }));
    expect(account.exchange).not.toHaveBeenCalled();
  });

  for (const [name, error, failure] of [
    ["a 404 that is not reservation.not-found", problem(404, "something.else"), "no-access"],
    ["a 404 without a code", problem(404), "no-access"],
    ["a 403", problem(403), "no-access"],
    ["the customer cookie no longer validates", problem(401, "auth.session-invalid"), "link-session-expired"],
    ["429", problem(429, "booking.rate-limited"), "link-rate-limited"],
    ["a lost answer (network)", new ApiNetworkError(), "link-not-sent"],
    ["a 5xx", problem(503), "link-not-sent"],
    ["an unusable 2xx", new ManagementContractError(), "link-not-sent"],
  ] as const) {
    it(`a signed-in account whose read ends in ${name}: this open stops, 0 POSTs, and nothing is exchanged later`, async () => {
      const r = rig();
      r.read.mockRejectedValue(error);
      open(r, ACCOUNT);
      await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure }));
      expect(r.exchange).not.toHaveBeenCalled();
      expect(JSON.stringify(r.state)).not.toContain(SECRET);
      r.controller.bind(LOADING_CTX); // an automatic recheck is a read, never an exchange
      r.controller.bind(ACCOUNT);
      await tick();
      expect(r.exchange).not.toHaveBeenCalled();
    });
  }

  it("no link, a malformed link and an automatic recheck never exchange, for an account", async () => {
    const r = rig();
    r.controller.bind(ACCOUNT); // a clean address: a read only
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    r.controller.openLink({ kind: "none" });
    r.controller.openLink({ kind: "malformed" });
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "link-invalid" }));
    r.controller.bind(LOADING_CTX);
    r.controller.bind(ACCOUNT);
    await tick();
    expect(r.exchange).not.toHaveBeenCalled();
  });

  it("the view changes while the account's read is out: the old answer is dropped, so no exchange of the old view is sent", async () => {
    const r = rig();
    const held = deferred<ManagedReservation>();
    r.read.mockImplementationOnce(() => held.promise);
    open(r, ACCOUNT);
    await vi.waitFor(() => expect(r.read).toHaveBeenCalledTimes(1));
    r.controller.bind({ reservationId: ID, identityKey: "customer:bbbb" });
    held.reject(strangerNotFound());
    await tick();
    expect(r.exchange).not.toHaveBeenCalled();
  });

  it("a wrong link (the API refuses the exchange) grants nothing: link-invalid, no booking, and no second POST", async () => {
    const r = rig();
    r.exchange.mockRejectedValue(problem(401, "reservation.manage-link-invalid"));
    open(r, ACCOUNT);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "link-invalid", reservation: null }));
    expect(r.exchange).toHaveBeenCalledTimes(1);
    r.controller.bind(LOADING_CTX);
    r.controller.bind(ACCOUNT);
    await tick();
    expect(r.exchange).toHaveBeenCalledTimes(1);
  });
});
