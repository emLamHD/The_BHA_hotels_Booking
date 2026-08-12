import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookingHoldFlowAction,
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "../bookingHoldFlow";
import { SelectedOfferSnapshot } from "../bookingHoldAttempt";
import { ApiNetworkError } from "../errors";
import { BookingHoldDto, ReservationDto } from "../bookingHoldTypes";

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
      })
    );

    controller.confirmHold();

    await vi.waitFor(() => expect(harness.getState().phase).toBe("confirm-known-error"));
    expect(harness.getState().errorMessage).toBe("The Hold has expired and cannot be confirmed.");
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
