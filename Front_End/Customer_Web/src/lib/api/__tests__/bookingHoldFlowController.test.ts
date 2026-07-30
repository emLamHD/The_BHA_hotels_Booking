import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookingHoldFlowAction,
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "../bookingHoldFlow";
import { SelectedOfferSnapshot } from "../bookingHoldAttempt";
import { ApiNetworkError } from "../errors";
import { BookingHoldDto } from "../bookingHoldTypes";

const createBookingHoldMock = vi.fn();
vi.mock("../bookingHoldService", () => ({
  createBookingHold: (...args: unknown[]) => createBookingHoldMock(...args),
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
function createHarness() {
  let state: BookingHoldFlowState = initialBookingHoldFlowState;
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

beforeEach(() => {
  createBookingHoldMock.mockReset();
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
    controller.resetSearchSelection();
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
    controller.resetSearchSelection();
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
