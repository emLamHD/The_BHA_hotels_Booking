import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingHoldFlowAction, BookingHoldFlowState, bookingHoldFlowReducer, initialBookingHoldFlowState } from "../bookingHoldFlow";
import { createBookingHoldFlowController } from "../bookingHoldFlowController";
import { createDirectAttemptMarker } from "../directAttemptMarker";
import { ApiHttpError, ApiNetworkError } from "../errors";
import { TEST_QUOTE } from "../quoteTestkit";
import type { CustomerSessionState } from "@/lib/customerSession";
import type { SelectedOfferSnapshot } from "../bookingHoldAttempt";

const createDirect = vi.fn();
vi.mock("../directReservationService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../directReservationService")>()),
  createDirectReservation: (...args: unknown[]) => createDirect(...args),
}));
const createHold = vi.fn();
vi.mock("../bookingHoldService", () => ({ createBookingHold: (...a: unknown[]) => createHold(...a), confirmBookingHold: vi.fn() }));

const OFFER: SelectedOfferSnapshot = {
  propertyId: "10000000-0000-0000-0000-000000000001", roomTypeId: "30000000-0000-0000-0000-000000000001", ratePlanId: "60000000-0000-0000-0000-000000000001",
  checkIn: "2026-08-01", checkOut: "2026-08-03", adults: 2, children: 0, rooms: 1, quote: TEST_QUOTE,
};
const CONTACT = { fullName: "Jane Doe", email: "jane@example.com", phone: "+15551234567" };
const ACCOUNT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ANON: CustomerSessionState = { status: "anonymous", customer: null };
const AUTH: CustomerSessionState = { status: "authenticated", customer: { customerAccountId: ACCOUNT_ID, email: "acc@example.com" } };
const RESERVATION = {
  reservationId: "bbbbbbbb-0000-0000-0000-000000000001", confirmationNumber: "BHA123", status: "Confirmed", propertyId: OFFER.propertyId, roomTypeId: OFFER.roomTypeId,
  ratePlanId: OFFER.ratePlanId, fullName: "Jane Doe", email: "jane@example.com", phone: "+15551234567", checkIn: OFFER.checkIn, checkOut: OFFER.checkOut, adults: 2, children: 0, rooms: 1,
  currencyCode: "VND", totalAmount: 3000000, confirmedAtUtc: "2026-07-30T02:00:10Z", cancelledAtUtc: null, cancellationReason: null, nights: [],
  paymentMethod: "PayAtProperty", collectedAmount: 0, balanceDueAmount: 3000000,
};
const problem = (status: number, code: string, extra: object = {}) => new ApiHttpError(status, { title: "t", status, code, ...extra });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function rig(initialSession: CustomerSessionState = ANON) {
  let state: BookingHoldFlowState = initialBookingHoldFlowState;
  let session = initialSession;
  const stored = new Map<string, string>();
  const marker = createDirectAttemptMarker({ getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => void stored.set(k, v), removeItem: (k) => void stored.delete(k) });
  const refresh = vi.fn();
  const controller = createBookingHoldFlowController({
    getState: () => state,
    dispatch: (action: BookingHoldFlowAction) => { state = bookingHoldFlowReducer(state, action); },
    getSession: () => session,
    requestSessionRefresh: refresh,
    marker,
  });
  const open = () => { controller.selectOffer(OFFER, "label", { channel: "direct" }); controller.updateContact(CONTACT); };
  return { controller, marker, stored, refresh, open, get state() { return state; }, setSession: (s: CustomerSessionState) => { session = s; } };
}

beforeEach(() => { createDirect.mockReset(); createHold.mockReset(); });

describe("Direct submit — owner", () => {
  it("a guest gets a fresh 43-char token and a key before the first request; the marker is written first", async () => {
    const r = rig(ANON);
    createDirect.mockImplementation(() => { expect(r.marker.isSet()).toBe(true); return Promise.resolve({ reservation: RESERVATION, outcome: "created" }); });
    r.open();
    r.controller.submitDirect();
    const [request, key, owner] = createDirect.mock.calls[0];
    expect(request).toMatchObject({ paymentMethod: "PayAtProperty", expectedTotalAmount: 3000000, expectedCurrencyCode: "VND" });
    expect(key).toMatch(/^bha-direct-/);
    expect(owner.kind).toBe("guest");
    expect(owner.guestAccessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await vi.waitFor(() => expect(r.state.phase).toBe("reservation-result"));
    expect(createHold).not.toHaveBeenCalled();
  });

  it("an account sends no token, and the success scrubs the credential, contact and marker", async () => {
    const r = rig(AUTH);
    createDirect.mockResolvedValue({ reservation: RESERVATION, outcome: "created" });
    r.open();
    r.controller.submitDirect();
    expect(createDirect.mock.calls[0][2]).toEqual({ kind: "account", customerAccountId: ACCOUNT_ID });
    await vi.waitFor(() => expect(r.state.phase).toBe("reservation-result"));
    expect(r.state.reservationResult).toEqual({ reservation: RESERVATION, outcome: "confirmed" });
    expect(r.state.direct).toMatchObject({ attempt: null, active: false, receiptOwnerKey: `customer:${ACCOUNT_ID}` });
    expect(r.state.contact).toEqual({ fullName: "", email: "", phone: "" });
    expect(r.marker.isSet()).toBe(false);
  });

  it.each([{ status: "loading", customer: null }, { status: "unknown", customer: null }] as CustomerSessionState[])(
    "does not send while the session is %o: blocks, re-verifies, never falls back to a guest or a Hold",
    (session) => {
      const r = rig(session);
      r.open();
      r.controller.submitDirect();
      expect(createDirect).not.toHaveBeenCalled();
      expect(createHold).not.toHaveBeenCalled();
      expect(r.refresh).toHaveBeenCalledTimes(1);
      expect(r.state.errorMessage).toBe("customer.direct.identityUnverified");
      expect(r.marker.isSet()).toBe(false);
    }
  );

  it("an expired session after the form opened (account -> anonymous) sends nothing and tells the guest", () => {
    const r = rig(AUTH);
    r.open();
    r.setSession(ANON);
    r.controller.submitDirect();
    expect(createDirect).not.toHaveBeenCalled();
    expect(r.state.errorMessage).toBe("customer.direct.ownerChanged");
    expect(r.state.direct.ownerKey).toBe("guest");
    // having been told, the guest confirms again as the verified identity
    createDirect.mockResolvedValue({ reservation: RESERVATION, outcome: "created" });
    r.controller.submitDirect();
    expect(createDirect.mock.calls[0][2].kind).toBe("guest");
  });

  it("is refused while an earlier attempt of this tab is unacknowledged", () => {
    const r = rig(ANON);
    r.marker.set();
    r.open();
    r.controller.submitDirect();
    expect(createDirect).not.toHaveBeenCalled();
    expect(r.state.errorMessage).toBe("customer.direct.unresolved.blocked");
  });

  it("validates the contact before anything is generated or sent", () => {
    const r = rig(ANON);
    r.controller.selectOffer(OFFER, "label", { channel: "direct" });
    r.controller.submitDirect();
    expect(createDirect).not.toHaveBeenCalled();
    expect(r.state.fieldErrors).not.toBeNull();
  });

  it("a double submit in the same tick sends once", async () => {
    const r = rig(ANON);
    const pending = deferred<unknown>();
    createDirect.mockReturnValue(pending.promise);
    r.open();
    r.controller.submitDirect();
    r.controller.submitDirect();
    expect(createDirect).toHaveBeenCalledTimes(1);
    expect(r.state.phase).toBe("submitting");
    pending.resolve({ reservation: RESERVATION, outcome: "created" });
    await vi.waitFor(() => expect(r.state.phase).toBe("reservation-result"));
  });

  it("the Hold submit does nothing for a Direct selection", () => {
    const r = rig(ANON);
    r.open();
    r.controller.submit();
    expect(createHold).not.toHaveBeenCalled();
    expect(r.state.phase).toBe("selected");
  });
});

describe("Direct submit — known refusals keep the form and never become a Hold", () => {
  it.each(["checkout.direct-unavailable", "reservation.rooms-unavailable", "booking.closed", "booking.rate-limited"])("%s", async (code) => {
    const r = rig(ANON);
    createDirect.mockRejectedValue(problem(code === "booking.closed" ? 503 : code === "booking.rate-limited" ? 429 : 409, code));
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("known-error"));
    expect(r.state.contact).toEqual(CONTACT);
    expect(r.state.direct).toMatchObject({ active: true, attempt: null, unresolved: false });
    expect(r.marker.isSet()).toBe(false);
    expect(createHold).not.toHaveBeenCalled();
  });

  it("price-changed with a quote asks the guest to reconfirm; a new request needs the acceptance and a new key", async () => {
    const r = rig(ANON);
    const newQuote = { ...TEST_QUOTE, totalAmount: 3300000 };
    createDirect.mockRejectedValueOnce(problem(409, "reservation.price-changed", { quote: newQuote }));
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.priceChange).toEqual(newQuote));
    const firstKey = createDirect.mock.calls[0][1];
    r.controller.submitDirect();
    expect(createDirect).toHaveBeenCalledTimes(1);
    r.controller.acceptPriceChange();
    createDirect.mockResolvedValueOnce({ reservation: RESERVATION, outcome: "created" });
    r.controller.submitDirect();
    expect(createDirect.mock.calls[1][0].expectedTotalAmount).toBe(3300000);
    expect(createDirect.mock.calls[1][1]).not.toBe(firstKey);
    await vi.waitFor(() => expect(r.state.phase).toBe("reservation-result"));
  });

  it("price-changed without a usable quote is an ordinary refusal (no guessed price)", async () => {
    const r = rig(ANON);
    createDirect.mockRejectedValue(problem(409, "reservation.price-changed"));
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("known-error"));
    expect(r.state.priceChange).toBeNull();
  });

  it.each(["auth.session-invalid", "booking.credential-invalid"])("a 401 (%s) for an account re-reads the session and is never retried as a guest", async (code) => {
    const r = rig(AUTH);
    createDirect.mockRejectedValue(problem(401, code));
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("known-error"));
    expect(r.refresh).toHaveBeenCalled();
    expect(createDirect).toHaveBeenCalledTimes(1);
  });
});

describe("Direct — uncertain outcome", () => {
  it.each([
    ["a lost response", () => new ApiNetworkError()],
    ["a gateway 502", () => problem(502, "x")],
    ["an unexpected body", () => new Error("contract")],
  ])("%s keeps the marker and leaves the outcome unknown", async (_name, error) => {
    const r = rig(ANON);
    createDirect.mockRejectedValue(error());
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("uncertain"));
    expect(r.state.direct.unresolved).toBe(true);
    expect(r.marker.isSet()).toBe(true);
    expect(r.stored.size).toBe(1);
    expect(Array.from(r.stored.values())).toEqual(["1"]); // nothing but the flag is stored
  });

  it("the retry resends EXACTLY the original owner, token, key and body; a replay resolves it and clears the marker", async () => {
    const r = rig(ANON);
    createDirect.mockRejectedValueOnce(new ApiNetworkError());
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("uncertain"));
    createDirect.mockResolvedValueOnce({ reservation: RESERVATION, outcome: "replayed" });
    r.controller.retryDirectExact();
    expect(createDirect).toHaveBeenCalledTimes(2);
    const [a, b] = createDirect.mock.calls;
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
    expect(b[2]).toBe(a[2]);
    await vi.waitFor(() => expect(r.state.phase).toBe("reservation-result"));
    expect(r.state.reservationResult?.outcome).toBe("replayed");
    expect(r.marker.isSet()).toBe(false);
  });

  it("a lost response, then a 429 on the retry: still unresolved, same key/token/body, marker kept, no fresh submit", async () => {
    const r = rig(ANON);
    createDirect.mockRejectedValueOnce(new ApiNetworkError());
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("uncertain"));
    const original = createDirect.mock.calls[0];

    createDirect.mockRejectedValueOnce(problem(429, "booking.rate-limited"));
    r.controller.retryDirectExact();
    await vi.waitFor(() => expect(r.state.direct.retryErrorMessage).toBe("shared.apiError.auth.rate-limited"));
    expect(r.state.phase).toBe("uncertain");
    expect(r.state.direct.unresolved).toBe(true);
    expect(r.state.direct.attempt).toMatchObject({ idempotencyKey: original[1], owner: original[2], request: original[0] });
    expect(r.marker.isSet()).toBe(true);

    r.controller.submitDirect(); // no fresh-key submit from here
    expect(createDirect).toHaveBeenCalledTimes(2);

    createDirect.mockRejectedValueOnce(problem(409, "reservation.price-changed", { quote: TEST_QUOTE }));
    r.controller.retryDirectExact();
    await vi.waitFor(() => expect(r.state.direct.retryErrorMessage).toBe("shared.apiError.reservation.price-changed"));
    expect(r.state.phase).toBe("uncertain");
    expect(r.state.priceChange).toBeNull();
    expect(r.marker.isSet()).toBe(true);
    expect(createDirect.mock.calls[2][1]).toBe(original[1]);
  });

  it("the retry is refused (and the session re-read) when the session is no longer the original owner", async () => {
    const r = rig(AUTH);
    createDirect.mockRejectedValueOnce(new ApiNetworkError());
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("uncertain"));
    r.setSession(ANON);
    r.controller.retryDirectExact();
    expect(createDirect).toHaveBeenCalledTimes(1);
    expect(r.state.direct.retryErrorMessage).toBe("customer.direct.sessionMismatchRetry");
    expect(r.refresh).toHaveBeenCalled();
    expect(r.marker.isSet()).toBe(true);
  });

  it("an uncertain attempt blocks searching, switching offer and identity changes", async () => {
    const r = rig(ANON);
    createDirect.mockRejectedValueOnce(new ApiNetworkError());
    r.open();
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("uncertain"));
    expect(r.controller.isAvailabilitySearchLocked()).toBe(true);
    expect(r.controller.tryBeginAvailabilitySearch()).toBe(false);
    r.controller.selectOffer({ ...OFFER, roomTypeId: "other" }, "x");
    expect(r.state.offer?.roomTypeId).toBe(OFFER.roomTypeId);
  });
});

describe("Direct — identity guard (login/logout are refused while a booking is unresolved or on its receipt)", () => {
  it("uncertain -> booking-in-progress (and the draft cannot be scrubbed); receipt -> receipt-not-finished", async () => {
    const r = rig(ANON);
    // controllers expose the guard on the internal object
    const controller = r.controller as unknown as { identityGuard: { identityChangeBlockReason: () => string | null; scrubForIdentityChange: () => boolean } };
    r.open();
    expect(controller.identityGuard.identityChangeBlockReason()).toBeNull(); // a draft may be scrubbed
    createDirect.mockRejectedValueOnce(new ApiNetworkError());
    r.controller.submitDirect();
    await vi.waitFor(() => expect(r.state.phase).toBe("uncertain"));
    expect(controller.identityGuard.identityChangeBlockReason()).toBe("booking-in-progress");
    expect(controller.identityGuard.scrubForIdentityChange()).toBe(false);
    createDirect.mockResolvedValueOnce({ reservation: RESERVATION, outcome: "replayed" });
    r.controller.retryDirectExact();
    await vi.waitFor(() => expect(r.state.phase).toBe("reservation-result"));
    expect(controller.identityGuard.identityChangeBlockReason()).toBe("receipt-not-finished");
    expect(r.controller.finishBooking(RESERVATION.reservationId)).toBe(true);
    expect(r.state.direct.receiptOwnerKey).toBeNull();
  });
});
