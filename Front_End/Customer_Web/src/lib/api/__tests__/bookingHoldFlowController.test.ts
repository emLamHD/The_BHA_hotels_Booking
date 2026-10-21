import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookingHoldFlowAction,
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "../bookingHoldFlow";
import { SelectedOfferSnapshot } from "../bookingHoldAttempt";
import { ApiHttpError, ApiNetworkError } from "../errors";
import { BookingHoldDto, ReservationDto } from "../bookingHoldTypes";
import { TEST_QUOTE } from "@/lib/api/quoteTestkit";

const createBookingHoldMock = vi.fn();
const confirmBookingHoldMock = vi.fn();
vi.mock("../bookingHoldService", () => ({
  createBookingHold: (...args: unknown[]) => createBookingHoldMock(...args),
  confirmBookingHold: (...args: unknown[]) => confirmBookingHoldMock(...args),
}));

let keyCounter = 0;
const generateIdempotencyKeyMock = vi.fn(() => `bha-hold-fixed-key-${++keyCounter}`);
vi.mock("../idempotencyKey", () => ({
  generateIdempotencyKey: () => generateIdempotencyKeyMock(),
}));

const OFFER: SelectedOfferSnapshot = {
  propertyId: "10000000-0000-0000-0000-000000000001",
  roomTypeId: "30000000-0000-0000-0000-000000000001",
  ratePlanId: "60000000-0000-0000-0000-000000000001",
  checkIn: "2026-08-01",
  checkOut: "2026-08-03",
  adults: 2,
  children: 0,
  rooms: 1,
  quote: TEST_QUOTE,
};
const OTHER_OFFER: SelectedOfferSnapshot = { ...OFFER, roomTypeId: "30000000-0000-0000-0000-000000000002" };
const CONTACT = { fullName: "Jane Doe", email: "jane@example.com", phone: "+15551234567" };

function holdFixture(overrides: Partial<BookingHoldDto> = {}): BookingHoldDto {
  return {
    holdId: "aaaaaaaa-0000-0000-0000-000000000001",
    status: "Active",
    propertyId: OFFER.propertyId,
    roomTypeId: OFFER.roomTypeId,
    ratePlanId: OFFER.ratePlanId,
    checkIn: OFFER.checkIn,
    checkOut: OFFER.checkOut,
    adults: OFFER.adults,
    children: OFFER.children,
    rooms: OFFER.rooms,
    currencyCode: "VND",
    totalAmount: 3000000,
    createdAtUtc: "2026-07-30T01:59:50.389Z",
    expiresAtUtc: "2026-07-30T02:14:50.389Z",
    nights: [],
    guestAccessToken: "one-time-token",
    ...overrides,
  };
}

/** A minimal real-reducer-backed harness — no React involved. */
function createHarness(initialState: BookingHoldFlowState = initialBookingHoldFlowState) {
  let state: BookingHoldFlowState = initialState;
  const dispatched: BookingHoldFlowAction[] = [];
  const dispatch = (action: BookingHoldFlowAction) => {
    dispatched.push(action);
    state = bookingHoldFlowReducer(state, action);
  };
  const attemptStarts: AbortController[] = [];

  return {
    getState: () => state,
    dispatch,
    dispatched,
    attemptStarts,
    onAttemptStart: (controller: AbortController) => attemptStarts.push(controller),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function reservationFixture(overrides: Partial<ReservationDto> = {}): ReservationDto {
  return {
    reservationId: "bbbbbbbb-0000-0000-0000-000000000001",
    confirmationNumber: "BHA2QK7X9F3M8N1P5R7T2V4W6",
    status: "Confirmed",
    propertyId: OFFER.propertyId,
    roomTypeId: OFFER.roomTypeId,
    ratePlanId: OFFER.ratePlanId,
    fullName: CONTACT.fullName,
    email: CONTACT.email,
    phone: CONTACT.phone,
    checkIn: OFFER.checkIn,
    checkOut: OFFER.checkOut,
    adults: OFFER.adults,
    children: OFFER.children,
    rooms: OFFER.rooms,
    currencyCode: "VND",
    totalAmount: 3000000,
    confirmedAtUtc: "2026-07-30T02:00:10.123Z",
    cancelledAtUtc: null,
    cancellationReason: null,
    nights: [],
    ...overrides,
  };
}

function confirmationResult(outcome: "confirmed" | "replayed" = "confirmed") {
  return { reservation: reservationFixture(), outcome };
}

/** Drives the real controller through selectOffer/updateContact/submit to reach a real active-session. */
async function activeSessionHarness(overrides: { guestAccessToken?: string | null } = {}) {
  const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
  const harness = createHarness();
  const controller = createBookingHoldFlowController({
    getState: harness.getState,
    dispatch: harness.dispatch,
    onAttemptStart: harness.onAttemptStart,
  });

  const guestAccessToken = overrides.guestAccessToken ?? "guest-token-value";
  createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture({ guestAccessToken }), outcome: "created" });
  controller.selectOffer(OFFER, "label");
  controller.updateContact(CONTACT);
  controller.submit();
  await vi.waitFor(() => expect(harness.getState().phase).toBe("active-session"));

  createBookingHoldMock.mockClear();
  generateIdempotencyKeyMock.mockClear();

  return { harness, controller };
}

beforeEach(() => {
  createBookingHoldMock.mockReset();
  confirmBookingHoldMock.mockReset();
  generateIdempotencyKeyMock.mockClear();
  keyCounter = 0;
});

describe("createBookingHoldFlowController — same-tick double submit", () => {
  it("causes exactly one key generation and one create call", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
      onAttemptStart: harness.onAttemptStart,
    });

    const pending = deferred<{ hold: BookingHoldDto; outcome: "created" }>();
    createBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);

    // Two same-tick calls, exactly as a rapid double-click would produce.
    controller.submit();
    controller.submit();

    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1);
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
    expect(harness.getState().phase).toBe("submitting");

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });

  it("Enter-key submission (a second synchronous submit call) does not duplicate the request", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    const pending = deferred<{ hold: BookingHoldDto; outcome: "created" }>();
    createBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit(); // form submit
    controller.submit(); // Enter key firing a second submit in the same tick

    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });
});

describe("createBookingHoldFlowController — locking while submitting/uncertain", () => {
  it("blocks offer switching and a fresh submit while submitting", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    const pending = deferred<{ hold: BookingHoldDto; outcome: "created" }>();
    createBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    expect(harness.getState().phase).toBe("submitting");

    controller.selectOffer(OTHER_OFFER, "other label");
    expect(controller.tryBeginAvailabilitySearch()).toBe(false);
    controller.submit();

    expect(harness.getState().offer).toEqual(OFFER);
    expect(harness.getState().phase).toBe("submitting");
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });

  it("a network/unclassified failure preserves the immutable attempt and enters uncertain", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    const attemptBefore = (() => {
      controller.submit();
      return harness.getState().attempt;
    })();

    await vi.waitFor(() => expect(harness.getState().phase).toBe("uncertain"));
    expect(harness.getState().attempt).toEqual(attemptBefore);
  });

  it("uncertain rejects a fresh submit and does not generate a new key", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("uncertain"));

    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1);
    controller.submit();
    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1);
    expect(harness.getState().phase).toBe("uncertain");
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
  });

  it("also blocks search/offer-switching/fresh-submit while uncertain", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("uncertain"));

    controller.selectOffer(OTHER_OFFER, "other");
    expect(controller.tryBeginAvailabilitySearch()).toBe(false);
    controller.updateContact({ ...CONTACT, fullName: "Changed" });

    expect(harness.getState().offer).toEqual(OFFER);
    expect(harness.getState().phase).toBe("uncertain");
    expect(harness.getState().contact.fullName).toBe(CONTACT.fullName);
  });

  it("exact retry reuses the exact same request body and idempotency key", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("uncertain"));

    const firstCallArgs = createBookingHoldMock.mock.calls[0];

    createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture(), outcome: "created" });
    controller.retryExact();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("active-session"));

    const secondCallArgs = createBookingHoldMock.mock.calls[1];
    expect(secondCallArgs[0]).toEqual(firstCallArgs[0]); // exact request body
    expect(secondCallArgs[1]).toBe(firstCallArgs[1]); // exact idempotency key
    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1); // never regenerated
  });

  it("a same-tick double retry causes exactly one retry call", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("uncertain"));

    const pending = deferred<{ hold: BookingHoldDto; outcome: "created" }>();
    createBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.retryExact();
    controller.retryExact();

    expect(createBookingHoldMock).toHaveBeenCalledTimes(2); // 1 original + 1 retry
    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });
});

describe("createBookingHoldFlowController — known-error unlocks a fresh, newly keyed attempt", () => {
  it("allows editing and a new key after a definitive known-error", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const { ApiHttpError } = await import("../errors");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    createBookingHoldMock.mockRejectedValueOnce(
      new ApiHttpError(400, { title: "Invalid booking Hold request", status: 400, detail: "email must be a valid contact email." })
    );
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("known-error"));
    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1);

    createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture(), outcome: "created" });
    controller.updateContact({ ...CONTACT, email: "fixed@example.com" });
    controller.submit();

    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(2); // a genuinely new attempt/key
    await vi.waitFor(() => expect(harness.getState().phase).toBe("active-session"));
  });
});

describe("createBookingHoldFlowController — no mutation from mere construction", () => {
  it("creating the controller and reading state never calls the service", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    createBookingHoldFlowController({ getState: harness.getState, dispatch: harness.dispatch });

    // Simulate "remount": construct a second controller against the same state.
    createBookingHoldFlowController({ getState: harness.getState, dispatch: harness.dispatch });

    expect(createBookingHoldMock).not.toHaveBeenCalled();
    expect(generateIdempotencyKeyMock).not.toHaveBeenCalled();
    expect(harness.getState().phase).toBe("idle");
  });
});

describe("createBookingHoldFlowController — tryBeginAvailabilitySearch gate", () => {
  it("accepts from idle and from selected, and two ordinary searches both succeed", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    expect(controller.tryBeginAvailabilitySearch()).toBe(true); // from idle
    controller.selectOffer(OFFER, "label");
    expect(controller.tryBeginAvailabilitySearch()).toBe(true); // from selected
  });

  it("rejects while submitting", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });
    const pending = deferred<{ hold: BookingHoldDto; outcome: "created" }>();
    createBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    expect(harness.getState().phase).toBe("submitting");

    expect(controller.tryBeginAvailabilitySearch()).toBe(false);

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });

  it("rejects while uncertain", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });
    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("uncertain"));

    expect(controller.tryBeginAvailabilitySearch()).toBe(false);
  });

  it("rejects search, retry-search, and offer switching from active-session", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });
    createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture(), outcome: "created" });
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("active-session"));

    expect(controller.tryBeginAvailabilitySearch()).toBe(false); // search / retry-search
    controller.selectOffer(OTHER_OFFER, "other"); // offer switching
    expect(harness.getState().offer).toBeNull(); // scrubbed by P2, and never replaced
  });
});

describe("createBookingHoldFlowController — cross-flow same-tick serialization", () => {
  it("Hold submit first, then Availability in the same tick: one key, one POST, search rejected", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });
    const pending = deferred<{ hold: BookingHoldDto; outcome: "created" }>();
    createBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);

    // Same synchronous tick: Hold submit acquires the lock first, then an
    // Availability operation is attempted immediately afterward — before
    // React would ever have re-rendered `phase` to "submitting".
    controller.submit();
    const searchAccepted = controller.tryBeginAvailabilitySearch();

    expect(searchAccepted).toBe(false);
    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1);
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
    expect(harness.getState().phase).toBe("submitting");
    expect(harness.getState().offer).toEqual(OFFER); // never reset by the rejected search

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });

  it("Exact retry first, then Availability in the same tick: retry remains the only mutation", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });
    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("uncertain"));

    const pending = deferred<{ hold: BookingHoldDto; outcome: "created" }>();
    createBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.retryExact();
    const searchAccepted = controller.tryBeginAvailabilitySearch();

    expect(searchAccepted).toBe(false);
    expect(createBookingHoldMock).toHaveBeenCalledTimes(2); // 1 original + 1 retry, never a search-triggered call
    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1); // retry never regenerates a key

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });

  it("Availability accepted first, then Hold submit in the same tick: the old offer cannot produce a Hold", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);

    // Same synchronous tick: an Availability search is accepted first
    // (synchronously invalidating the current offer selection), and a
    // fresh Hold submit is attempted immediately afterward — before
    // `getState()` would ever reflect the reducer's eventual
    // "search-reset". The old offer must not produce a Hold.
    const searchAccepted = controller.tryBeginAvailabilitySearch();
    controller.submit();

    expect(searchAccepted).toBe(true);
    expect(generateIdempotencyKeyMock).not.toHaveBeenCalled();
    expect(createBookingHoldMock).not.toHaveBeenCalled();
  });

  it("a live offer explicitly selected after an accepted search can still be submitted", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });
    createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture(), outcome: "created" });

    controller.selectOffer(OFFER, "label");
    expect(controller.tryBeginAvailabilitySearch()).toBe(true);

    // A genuinely new offer selection (e.g. from the new search's results)
    // is accepted normally and can be submitted.
    controller.selectOffer(OTHER_OFFER, "new label");
    controller.updateContact(CONTACT);
    controller.submit();

    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1);
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
    expect(createBookingHoldMock.mock.calls[0][0]).toMatchObject({ roomTypeId: OTHER_OFFER.roomTypeId });
  });
});

describe("runIfAvailabilitySearchAllowed", () => {
  it("performs no side effect at all when the gate rejects", async () => {
    const { runIfAvailabilitySearchAllowed } = await import("../bookingHoldFlowController");
    const performSearch = vi.fn();
    const tryBeginAvailabilitySearch = vi.fn(() => false);

    const accepted = runIfAvailabilitySearchAllowed(tryBeginAvailabilitySearch, performSearch);

    expect(accepted).toBe(false);
    expect(performSearch).not.toHaveBeenCalled();
  });

  it("performs the side effect exactly once when the gate accepts", async () => {
    const { runIfAvailabilitySearchAllowed } = await import("../bookingHoldFlowController");
    const performSearch = vi.fn();
    const tryBeginAvailabilitySearch = vi.fn(() => true);

    const accepted = runIfAvailabilitySearchAllowed(tryBeginAvailabilitySearch, performSearch);

    expect(accepted).toBe(true);
    expect(performSearch).toHaveBeenCalledTimes(1);
  });

  it("proves the real gate rejects before any Availability-shaped side effect runs (submitting)", async () => {
    const { createBookingHoldFlowController, runIfAvailabilitySearchAllowed } = await import(
      "../bookingHoldFlowController"
    );
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });
    const pending = deferred<{ hold: BookingHoldDto; outcome: "created" }>();
    createBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    controller.submit();

    // Simulates exactly what SectionAvailabilitySearch.runSearch does: an
    // abort, a request-identity bump, local state mutation, and finally
    // the network call — all bundled as one `performSearch` side effect.
    let aborted = false;
    let requestId = 0;
    let searchAvailabilityCalled = false;
    const performSearch = () => {
      aborted = true;
      requestId += 1;
      searchAvailabilityCalled = true;
    };

    const accepted = runIfAvailabilitySearchAllowed(
      controller.tryBeginAvailabilitySearch,
      performSearch
    );

    expect(accepted).toBe(false);
    expect(aborted).toBe(false);
    expect(requestId).toBe(0);
    expect(searchAvailabilityCalled).toBe(false);

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });
});

describe("createBookingHoldFlowController — confirmation lifecycle (P2)", () => {
  it("confirmHold calls confirmBookingHold with the active session's exact Hold ID", async () => {
    const { harness, controller } = await activeSessionHarness();
    const holdId = harness.getState().session!.hold.holdId;
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold();

    expect(confirmBookingHoldMock).toHaveBeenCalledWith(holdId, "guest-token-value", expect.any(Object));
    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("passes the retained session.guestAccessToken even when session.hold.guestAccessToken is null", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness({
      ...initialBookingHoldFlowState,
      phase: "active-session",
      session: {
        hold: holdFixture({ guestAccessToken: null }),
        guestAccessToken: "retained-token",
        outcome: "replayed",
      },
      operationId: 1,
    });
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
      onAttemptStart: harness.onAttemptStart,
    });
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold();

    expect(confirmBookingHoldMock).toHaveBeenCalledWith(
      "aaaaaaaa-0000-0000-0000-000000000001",
      "retained-token",
      expect.any(Object)
    );
    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("passes null for an authenticated/tokenless session", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness({
      ...initialBookingHoldFlowState,
      phase: "active-session",
      session: {
        hold: holdFixture({ guestAccessToken: null }),
        guestAccessToken: null,
        outcome: "created",
      },
      operationId: 1,
    });
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
      onAttemptStart: harness.onAttemptStart,
    });
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold();

    expect(confirmBookingHoldMock).toHaveBeenCalledWith(
      "aaaaaaaa-0000-0000-0000-000000000001",
      null,
      expect.any(Object)
    );
    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("forwards an AbortSignal to confirmBookingHold", async () => {
    const { harness, controller } = await activeSessionHarness();
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold();

    const [, , options] = confirmBookingHoldMock.mock.calls[0];
    expect(options.signal).toBe(harness.attemptStarts[harness.attemptStarts.length - 1]?.signal);

    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("same-tick double confirmHold causes exactly one confirmation call", async () => {
    const { controller } = await activeSessionHarness();
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold();
    controller.confirmHold();

    expect(confirmBookingHoldMock).toHaveBeenCalledTimes(1);
    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("Enter-key-equivalent second synchronous confirmHold call does not duplicate the request", async () => {
    const { controller } = await activeSessionHarness();
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold(); // e.g. a click handler firing
    controller.confirmHold(); // Enter key firing a second call in the same tick

    expect(confirmBookingHoldMock).toHaveBeenCalledTimes(1);
    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("confirmHold never generates an idempotency key", async () => {
    const { controller } = await activeSessionHarness();
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold();

    expect(generateIdempotencyKeyMock).not.toHaveBeenCalled();
    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("confirmHold never calls createBookingHold", async () => {
    const { controller } = await activeSessionHarness();
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold();

    expect(createBookingHoldMock).not.toHaveBeenCalled();
    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("a network error enters confirm-uncertain", async () => {
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());

    controller.confirmHold();

    await vi.waitFor(() => expect(harness.getState().phase).toBe("confirm-uncertain"));
  });

  it("an unclassified error (e.g. an ambiguous response with no usable body) enters confirm-uncertain", async () => {
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockRejectedValueOnce(new Error("The server did not return a Reservation."));

    controller.confirmHold();

    await vi.waitFor(() => expect(harness.getState().phase).toBe("confirm-uncertain"));
  });

  it("a known HTTP error enters confirm-known-error with a customer-safe message", async () => {
    const { ApiHttpError } = await import("../errors");
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockRejectedValueOnce(
      new ApiHttpError(409, {
        title: "Booking Hold cannot be confirmed",
        status: 409,
        detail: "The Hold has expired and cannot be confirmed.",
        code: "hold.expired",
      })
    );

    controller.confirmHold();

    await vi.waitFor(() => expect(harness.getState().phase).toBe("confirm-known-error"));
    // The visitor reads the pack message for the API's stable code, never the English detail.
    expect(harness.getState().errorMessage).toBe("shared.apiError.hold.expired");
  });

  it("retryConfirmationExact reuses the identical Hold ID and token", async () => {
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.confirmHold();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("confirm-uncertain"));

    const firstCallArgs = confirmBookingHoldMock.mock.calls[0];
    confirmBookingHoldMock.mockResolvedValueOnce(confirmationResult());
    controller.retryConfirmationExact();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("reservation-result"));

    const secondCallArgs = confirmBookingHoldMock.mock.calls[1];
    expect(secondCallArgs[0]).toBe(firstCallArgs[0]);
    expect(secondCallArgs[1]).toBe(firstCallArgs[1]);
  });

  it("same-tick double retryConfirmationExact causes exactly one additional confirmation call", async () => {
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.confirmHold();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("confirm-uncertain"));

    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.retryConfirmationExact();
    controller.retryConfirmationExact();

    expect(confirmBookingHoldMock).toHaveBeenCalledTimes(2); // 1 original + 1 retry
    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("a successful first confirmation reaches reservation-result", async () => {
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockResolvedValueOnce(confirmationResult("confirmed"));

    controller.confirmHold();

    await vi.waitFor(() => expect(harness.getState().phase).toBe("reservation-result"));
    expect(harness.getState().reservationResult?.outcome).toBe("confirmed");
  });

  it("a replayed confirmation reaches reservation-result preserving outcome replayed", async () => {
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockResolvedValueOnce(confirmationResult("replayed"));

    controller.confirmHold();

    await vi.waitFor(() => expect(harness.getState().phase).toBe("reservation-result"));
    expect(harness.getState().reservationResult?.outcome).toBe("replayed");
  });

  it("confirmHold is a no-op without an active session", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({ getState: harness.getState, dispatch: harness.dispatch });

    controller.confirmHold();

    expect(confirmBookingHoldMock).not.toHaveBeenCalled();
    expect(harness.getState().phase).toBe("idle");
  });

  it("retryConfirmationExact is a no-op outside confirm-uncertain/confirm-known-error", async () => {
    const { controller } = await activeSessionHarness();

    controller.retryConfirmationExact();

    expect(confirmBookingHoldMock).not.toHaveBeenCalled();
  });

  it("creating the controller and reading state never calls confirmBookingHold", async () => {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    createBookingHoldFlowController({ getState: harness.getState, dispatch: harness.dispatch });

    // Simulate "remount": construct a second controller against the same state.
    createBookingHoldFlowController({ getState: harness.getState, dispatch: harness.dispatch });

    expect(confirmBookingHoldMock).not.toHaveBeenCalled();
    expect(harness.getState().phase).toBe("idle");
  });

  it("blocks Availability search and offer switching while confirming", async () => {
    const { harness, controller } = await activeSessionHarness();
    const pending = deferred<ReturnType<typeof confirmationResult>>();
    confirmBookingHoldMock.mockReturnValueOnce(pending.promise);

    controller.confirmHold();
    expect(harness.getState().phase).toBe("confirming");

    expect(controller.tryBeginAvailabilitySearch()).toBe(false);
    controller.selectOffer(OTHER_OFFER, "other");
    expect(harness.getState().offer).toBeNull();
    expect(harness.getState().phase).toBe("confirming");

    pending.resolve(confirmationResult());
    await pending.promise;
  });

  it("blocks Availability search and offer switching while confirm-uncertain", async () => {
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.confirmHold();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("confirm-uncertain"));

    expect(controller.tryBeginAvailabilitySearch()).toBe(false);
    controller.selectOffer(OTHER_OFFER, "other");
    expect(harness.getState().offer).toBeNull();
    expect(harness.getState().phase).toBe("confirm-uncertain");
  });

  it("blocks Availability search and offer switching while confirm-known-error", async () => {
    const { ApiHttpError } = await import("../errors");
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockRejectedValueOnce(
      new ApiHttpError(409, { title: "Booking Hold cannot be confirmed", status: 409, detail: "expired" })
    );
    controller.confirmHold();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("confirm-known-error"));

    expect(controller.tryBeginAvailabilitySearch()).toBe(false);
    controller.selectOffer(OTHER_OFFER, "other");
    expect(harness.getState().offer).toBeNull();
    expect(harness.getState().phase).toBe("confirm-known-error");
  });

  it("blocks Availability search and offer switching while reservation-result", async () => {
    const { harness, controller } = await activeSessionHarness();
    confirmBookingHoldMock.mockResolvedValueOnce(confirmationResult());
    controller.confirmHold();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("reservation-result"));

    expect(controller.tryBeginAvailabilitySearch()).toBe(false);
    controller.selectOffer(OTHER_OFFER, "other");
    expect(harness.getState().offer).toBeNull();
    expect(harness.getState().phase).toBe("reservation-result");
  });
});

/**
 * CUST-WEB-001-CP01b — the identity guard. The harness below keeps `getState()` STALE until `commit()` is
 * called, exactly like a React snapshot between a dispatch and the next render: every authority assertion
 * is made before a commit.
 */
function createStaleHarness() {
  let state: BookingHoldFlowState = initialBookingHoldFlowState;
  const queue: BookingHoldFlowAction[] = [];
  const dispatched: BookingHoldFlowAction[] = [];
  return {
    getState: () => state,
    dispatch: (action: BookingHoldFlowAction) => {
      dispatched.push(action);
      queue.push(action);
    },
    commit: () => {
      while (queue.length) state = bookingHoldFlowReducer(state, queue.shift() as BookingHoldFlowAction);
    },
    dispatched,
    queued: () => queue.length,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function identityRig() {
  const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
  const harness = createStaleHarness();
  const lock = { locked: false };
  const controller = createBookingHoldFlowController({
    getState: harness.getState,
    dispatch: harness.dispatch,
    isIdentityChangeLocked: () => lock.locked,
  });
  const toSelected = () => {
    controller.selectOffer(OFFER, "label");
    harness.commit();
    controller.updateContact(CONTACT);
    harness.commit();
  };
  return { harness, controller, lock, guard: controller.identityGuard, toSelected };
}

type Rig = Awaited<ReturnType<typeof identityRig>>;

/** Each builder leaves the flow in the named phase WITHOUT committing the last dispatches (stale snapshot). */
const PHASES: Record<string, (rig: Rig) => Promise<void>> = {
  idle: async () => undefined,
  selected: async (rig) => rig.toSelected(),
  "known-error": async (rig) => {
    rig.toSelected();
    createBookingHoldMock.mockRejectedValueOnce(new ApiHttpError(409, { title: "conflict", status: 409 }));
    rig.controller.submit();
    await settle();
  },
  submitting: async (rig) => {
    rig.toSelected();
    createBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.controller.submit();
  },
  uncertain: async (rig) => {
    rig.toSelected();
    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    rig.controller.submit();
    await settle();
  },
  "active-session": async (rig) => {
    rig.toSelected();
    createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture(), outcome: "created" });
    rig.controller.submit();
    await settle();
  },
  confirming: async (rig) => {
    await PHASES["active-session"](rig);
    rig.harness.commit();
    confirmBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.controller.confirmHold();
  },
  "confirm-uncertain": async (rig) => {
    await PHASES["active-session"](rig);
    rig.harness.commit();
    confirmBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    rig.controller.confirmHold();
    await settle();
  },
  "confirm-known-error": async (rig) => {
    await PHASES["active-session"](rig);
    rig.harness.commit();
    confirmBookingHoldMock.mockRejectedValueOnce(new ApiHttpError(409, { title: "conflict", status: 409 }));
    rig.controller.confirmHold();
    await settle();
  },
  "reservation-result": async (rig) => {
    await PHASES["active-session"](rig);
    rig.harness.commit();
    confirmBookingHoldMock.mockResolvedValueOnce(confirmationResult());
    rig.controller.confirmHold();
    await settle();
  },
};

describe("identity guard — booking → identity (synchronous authority)", () => {
  it.each([
    ["idle", null],
    ["selected", null],
    ["known-error", null],
    ["submitting", "booking-in-progress"],
    ["uncertain", "booking-in-progress"],
    ["active-session", "booking-in-progress"],
    ["confirming", "booking-in-progress"],
    ["confirm-uncertain", "booking-in-progress"],
    ["confirm-known-error", "booking-in-progress"],
    ["reservation-result", "receipt-not-finished"],
  ])("%s → %s, decided from the live view before React commits the response", async (phase, reason) => {
    const rig = await identityRig();
    await PHASES[phase](rig);
    expect(rig.guard.identityChangeBlockReason()).toBe(reason);
  });

  it("a response that has settled (lock released in finally) but is not yet rendered still blocks", async () => {
    const rig = await identityRig();
    rig.toSelected();
    let resolveHold!: (value: unknown) => void;
    createBookingHoldMock.mockReturnValueOnce(new Promise((resolve) => (resolveHold = resolve)));
    rig.controller.submit();
    resolveHold({ hold: holdFixture(), outcome: "created" });
    await settle();

    // React has not committed anything since `selected`, and the in-flight flag is already released…
    expect(rig.harness.getState().phase).toBe("selected");
    expect(rig.harness.queued()).toBeGreaterThan(0);
    // …yet the controller knows the flow is an active session.
    expect(rig.guard.identityChangeBlockReason()).toBe("booking-in-progress");
    expect(rig.guard.scrubForIdentityChange()).toBe(false);
  });

  it("submit() then the guard in the same tick: blocked by the in-flight lock, no commit needed", async () => {
    const rig = await identityRig();
    rig.toSelected();
    createBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.controller.submit();
    expect(rig.guard.identityChangeBlockReason()).toBe("booking-in-progress");
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
  });

  it.each(["submitting", "uncertain", "active-session", "confirming", "confirm-uncertain", "confirm-known-error", "reservation-result"])(
    "scrubForIdentityChange in %s changes nothing: no dispatch, same state, same attempt and token",
    async (phase) => {
      const rig = await identityRig();
      await PHASES[phase](rig);
      rig.harness.commit();
      const before = rig.harness.getState();
      const dispatchedBefore = rig.harness.dispatched.length;

      expect(rig.guard.scrubForIdentityChange()).toBe(false);

      expect(rig.harness.dispatched).toHaveLength(dispatchedBefore);
      expect(rig.harness.getState()).toBe(before);
    }
  );

  it.each(["idle", "selected", "known-error"])("scrubForIdentityChange from %s discards the draft synchronously", async (phase) => {
    const rig = await identityRig();
    await PHASES[phase](rig);
    rig.harness.commit();

    expect(rig.guard.scrubForIdentityChange()).toBe(true);

    // Before React commits: a stale submit in the same tick cannot use the old selection or contact.
    createBookingHoldMock.mockClear();
    generateIdempotencyKeyMock.mockClear();
    rig.controller.submit();
    expect(createBookingHoldMock).not.toHaveBeenCalled();
    expect(generateIdempotencyKeyMock).not.toHaveBeenCalled();

    rig.harness.commit();
    expect(rig.harness.getState()).toMatchObject({ phase: "idle", offer: null, attempt: null, errorMessage: null });
    expect(JSON.stringify(rig.harness.getState())).not.toContain(CONTACT.email);
  });
});

describe("identity guard — identity → booking (every booking mutation refused while locked)", () => {
  it("refuses submit, selectOffer, updateContact and search before any key, validation dispatch or network", async () => {
    const rig = await identityRig();
    rig.toSelected();
    rig.lock.locked = true;
    const dispatchedBefore = rig.harness.dispatched.length;

    rig.controller.submit();
    rig.controller.selectOffer(OTHER_OFFER, "other");
    rig.controller.updateContact({ ...CONTACT, fullName: "Someone Else" });
    expect(rig.controller.tryBeginAvailabilitySearch()).toBe(false);
    expect(rig.controller.isAvailabilitySearchLocked()).toBe(true);

    expect(rig.harness.dispatched).toHaveLength(dispatchedBefore);
    expect(generateIdempotencyKeyMock).not.toHaveBeenCalled();
    expect(createBookingHoldMock).not.toHaveBeenCalled();

    rig.lock.locked = false; // control: the same calls work again
    createBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.controller.submit();
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an invalid-draft submit too: no validation-failed dispatch", async () => {
    const rig = await identityRig();
    rig.controller.selectOffer(OFFER, "label");
    rig.harness.commit();
    rig.lock.locked = true;
    const before = rig.harness.dispatched.length;
    rig.controller.submit();
    expect(rig.harness.dispatched).toHaveLength(before);
  });

  it("refuses retryExact, confirmHold and retryConfirmationExact: no request and no state change", async () => {
    for (const [phase, call] of [
      ["uncertain", (c: Rig["controller"]) => c.retryExact()],
      ["active-session", (c: Rig["controller"]) => c.confirmHold()],
      ["confirm-uncertain", (c: Rig["controller"]) => c.retryConfirmationExact()],
    ] as const) {
      createBookingHoldMock.mockReset();
      confirmBookingHoldMock.mockReset();
      const rig = await identityRig();
      await PHASES[phase](rig);
      rig.harness.commit();
      const before = rig.harness.getState();
      const dispatchedBefore = rig.harness.dispatched.length;
      createBookingHoldMock.mockClear();
      confirmBookingHoldMock.mockClear();
      rig.lock.locked = true;

      call(rig.controller);

      expect(createBookingHoldMock).not.toHaveBeenCalled();
      expect(confirmBookingHoldMock).not.toHaveBeenCalled();
      expect(rig.harness.dispatched).toHaveLength(dispatchedBefore);
      expect(rig.harness.getState()).toBe(before);
    }
  });
});

describe("finishBooking (explicit local receipt completion)", () => {
  const RECEIPT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

  it("scrubs the receipt synchronously for exactly that reservation, sends nothing, and keeps the operation identity monotonic", async () => {
    const rig = await identityRig();
    await PHASES["reservation-result"](rig);
    rig.harness.commit();
    const operationBefore = rig.harness.getState().operationId;
    confirmBookingHoldMock.mockClear();
    createBookingHoldMock.mockClear();

    expect(rig.controller.finishBooking(RECEIPT_ID)).toBe(true);

    expect(confirmBookingHoldMock).not.toHaveBeenCalled();
    expect(createBookingHoldMock).not.toHaveBeenCalled();
    // A second, stale call in the same tick finds nothing to finish.
    expect(rig.controller.finishBooking(RECEIPT_ID)).toBe(false);
    // A stale same-tick submit cannot revive the receipt's flow.
    rig.controller.submit();
    expect(createBookingHoldMock).not.toHaveBeenCalled();

    rig.harness.commit();
    expect(rig.harness.getState()).toEqual({ ...initialBookingHoldFlowState, operationId: operationBefore });
    expect(JSON.stringify(rig.harness.getState())).not.toContain(CONTACT.email);
    expect(rig.guard.identityChangeBlockReason()).toBeNull();
  });

  it("works from the live view even when React has not committed the receipt yet", async () => {
    const rig = await identityRig();
    await PHASES["reservation-result"](rig); // no commit after the confirmation settled
    expect(rig.harness.getState().phase).not.toBe("reservation-result");
    expect(rig.controller.finishBooking(RECEIPT_ID)).toBe(true);
  });

  it("is refused, with zero effect, for a wrong reservation id", async () => {
    const rig = await identityRig();
    await PHASES["reservation-result"](rig);
    rig.harness.commit();
    const before = rig.harness.getState();
    const dispatchedBefore = rig.harness.dispatched.length;
    expect(rig.controller.finishBooking("cccccccc-0000-0000-0000-000000000009")).toBe(false);
    expect(rig.harness.dispatched).toHaveLength(dispatchedBefore);
    expect(rig.harness.getState()).toBe(before);
  });

  it.each(["idle", "selected", "submitting", "uncertain", "active-session", "confirming", "confirm-uncertain", "confirm-known-error"])(
    "is refused in %s, with zero effect",
    async (phase) => {
      const rig = await identityRig();
      await PHASES[phase](rig);
      rig.harness.commit();
      const before = rig.harness.getState();
      const dispatchedBefore = rig.harness.dispatched.length;
      expect(rig.controller.finishBooking(RECEIPT_ID)).toBe(false);
      expect(rig.harness.dispatched).toHaveLength(dispatchedBefore);
      expect(rig.harness.getState()).toBe(before);
    }
  );

  it("is refused while an identity change is locked", async () => {
    const rig = await identityRig();
    await PHASES["reservation-result"](rig);
    rig.harness.commit();
    rig.lock.locked = true;
    expect(rig.controller.finishBooking(RECEIPT_ID)).toBe(false);
    expect(rig.harness.getState().phase).toBe("reservation-result");
  });
});

describe("createBookingHoldFlowController — price changed between the quote and the hold (BHA-BOOKING-PROMOTIONS-001)", () => {
  const NEW_QUOTE = {
    currencyCode: "VND",
    totalAmount: 2550000,
    listTotalAmount: 3000000,
    discountTotalAmount: 450000,
    nightlyRates: [
      { stayDate: "2026-08-01", amount: 1275000, listAmount: 1500000, discountAmount: 225000 },
      { stayDate: "2026-08-02", amount: 1275000, listAmount: 1500000, discountAmount: 225000 },
    ],
    appliedPromotion: { id: "pr", slug: "giam-15", title: "Giảm 15%", kind: "Percent" as const, value: 15, currencyCode: null },
  };
  const priceChanged = (quote: unknown = NEW_QUOTE) =>
    new ApiHttpError(409, { title: "Booking Hold price changed", status: 409, code: "hold.price-changed", quote: quote as never });

  async function selectedHarness() {
    const { createBookingHoldFlowController } = await import("../bookingHoldFlowController");
    const harness = createHarness();
    const controller = createBookingHoldFlowController({ getState: harness.getState, dispatch: harness.dispatch, onAttemptStart: harness.onAttemptStart });
    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);
    return { harness, controller };
  }

  it("sends the price the guest was shown, and nothing else about price", async () => {
    const { controller } = await selectedHarness();
    createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture(), outcome: "created" });

    controller.submit();

    const request = createBookingHoldMock.mock.calls[0][0];
    expect(request).toMatchObject({ expectedTotalAmount: 3000000, expectedCurrencyCode: "VND" });
    expect(Object.keys(request).filter((key) => /amount|price|total|discount|promo/i.test(key)).sort()).toEqual(["expectedTotalAmount"]);
  });

  it("is a known refusal: the form stays, the new quote is held for the guest, and nothing is retried or resent", async () => {
    const { harness, controller } = await selectedHarness();
    createBookingHoldMock.mockRejectedValueOnce(priceChanged());

    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("known-error"));

    const state = harness.getState();
    expect(state.priceChange).toEqual(NEW_QUOTE);
    expect(state.errorMessage).toBeNull();
    expect(state.attempt).toBeNull();                    // nothing to retry: this is not an unknown result
    expect(state.offer?.quote.totalAmount).toBe(3000000); // the confirmed price is still the one the guest saw
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
  });

  it("cannot ask for a hold again until the guest accepts the new price", async () => {
    const { harness, controller } = await selectedHarness();
    createBookingHoldMock.mockRejectedValueOnce(priceChanged());
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().priceChange).not.toBeNull());

    controller.submit();
    controller.submit();

    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
    expect(harness.getState().phase).toBe("known-error");
  });

  it("after accepting, the next hold carries the new expected price and a NEW Idempotency-Key", async () => {
    const { harness, controller } = await selectedHarness();
    createBookingHoldMock.mockRejectedValueOnce(priceChanged());
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().priceChange).not.toBeNull());
    const firstKey = createBookingHoldMock.mock.calls[0][1];

    controller.acceptPriceChange();
    expect(harness.getState().priceChange).toBeNull();
    expect(harness.getState().offer?.quote.totalAmount).toBe(2550000);
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);   // accepting sends nothing

    createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture({ totalAmount: 2550000 }), outcome: "created" });
    controller.submit();

    await vi.waitFor(() => expect(harness.getState().phase).toBe("active-session"));
    const [request, secondKey] = createBookingHoldMock.mock.calls[1];
    expect(request).toMatchObject({ expectedTotalAmount: 2550000, expectedCurrencyCode: "VND" });
    expect(secondKey).not.toBe(firstKey);
  });

  it("an answer that never came is uncertain, and its retry carries the SAME payload and key — the payload is never changed", async () => {
    const { harness, controller } = await selectedHarness();
    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("uncertain"));
    expect(harness.getState().priceChange).toBeNull();
    const [firstRequest, firstKey] = createBookingHoldMock.mock.calls[0];

    createBookingHoldMock.mockResolvedValueOnce({ hold: holdFixture(), outcome: "replayed" });
    controller.retryExact();

    await vi.waitFor(() => expect(createBookingHoldMock).toHaveBeenCalledTimes(2));
    expect(createBookingHoldMock.mock.calls[1][0]).toEqual(firstRequest);
    expect(createBookingHoldMock.mock.calls[1][1]).toBe(firstKey);
  });

  it("a price-changed answer without a usable quote is an ordinary known error, never a guessed price", async () => {
    const { harness, controller } = await selectedHarness();
    createBookingHoldMock.mockRejectedValueOnce(new ApiHttpError(409, { title: "Booking Hold price changed", status: 409, code: "hold.price-changed" }));

    controller.submit();
    await vi.waitFor(() => expect(harness.getState().phase).toBe("known-error"));

    expect(harness.getState().priceChange).toBeNull();
    expect(harness.getState().errorMessage).toBe("shared.apiError.hold.price-changed");
  });

  it("accepting does nothing when there is no price change, and a new offer clears a pending one", async () => {
    const { harness, controller } = await selectedHarness();
    controller.acceptPriceChange();
    expect(harness.getState().offer?.quote.totalAmount).toBe(3000000);

    createBookingHoldMock.mockRejectedValueOnce(priceChanged());
    controller.submit();
    await vi.waitFor(() => expect(harness.getState().priceChange).not.toBeNull());
    controller.selectOffer(OTHER_OFFER, "other");
    expect(harness.getState().priceChange).toBeNull();
  });
});
