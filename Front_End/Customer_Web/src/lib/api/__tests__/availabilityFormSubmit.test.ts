import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAvailabilityFormSubmit } from "../availabilityFormSubmit";
import { AvailabilityDraft } from "../availabilityValidation";
import { SelectedOfferSnapshot } from "../bookingHoldAttempt";
import { BookingHoldFlowAction, BookingHoldFlowState, bookingHoldFlowReducer, initialBookingHoldFlowState } from "../bookingHoldFlow";
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
const CONTACT = { fullName: "Jane Doe", email: "jane@example.com", phone: "+15551234567" };

const VALID_DRAFT: AvailabilityDraft = {
  checkIn: "2026-08-01",
  checkOut: "2026-08-02",
  adults: "1",
  children: "0",
  rooms: "1",
};

const INVALID_DRAFT: AvailabilityDraft = {
  checkIn: "2026-08-02",
  checkOut: "2026-08-01", // reversed range: fails validateAvailabilityDraft
  adults: "1",
  children: "0",
  rooms: "1",
};

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
  return { getState: () => state, dispatch, dispatched };
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

describe("runAvailabilityFormSubmit — pure orchestration order", () => {
  it("locked with a valid draft: complete no-op (no validation, no field errors, no search)", () => {
    const setFieldErrors = vi.fn();
    const runSearch = vi.fn();

    const outcome = runAvailabilityFormSubmit(VALID_DRAFT, {
      isAvailabilitySearchLocked: () => true,
      setFieldErrors,
      runSearch,
    });

    expect(outcome).toBe("locked");
    expect(setFieldErrors).not.toHaveBeenCalled();
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("locked with an invalid draft: still a complete no-op — the lock is consulted before validation", () => {
    const setFieldErrors = vi.fn();
    const runSearch = vi.fn();

    const outcome = runAvailabilityFormSubmit(INVALID_DRAFT, {
      isAvailabilitySearchLocked: () => true,
      setFieldErrors,
      runSearch,
    });

    expect(outcome).toBe("locked");
    expect(setFieldErrors).not.toHaveBeenCalled();
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("unlocked + invalid: sets field errors exactly once and does not run a search", () => {
    const setFieldErrors = vi.fn();
    const runSearch = vi.fn();

    const outcome = runAvailabilityFormSubmit(INVALID_DRAFT, {
      isAvailabilitySearchLocked: () => false,
      setFieldErrors,
      runSearch,
    });

    expect(outcome).toBe("invalid");
    expect(setFieldErrors).toHaveBeenCalledTimes(1);
    expect(setFieldErrors.mock.calls[0][0]).toHaveProperty("checkOut");
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("unlocked + valid: clears field errors and starts exactly one search", () => {
    const setFieldErrors = vi.fn();
    const runSearch = vi.fn();

    const outcome = runAvailabilityFormSubmit(VALID_DRAFT, {
      isAvailabilitySearchLocked: () => false,
      setFieldErrors,
      runSearch,
    });

    expect(outcome).toBe("started");
    expect(setFieldErrors).toHaveBeenCalledWith({});
    expect(runSearch).toHaveBeenCalledTimes(1);
    expect(runSearch.mock.calls[0][0]).toMatchObject({ checkIn: "2026-08-01", checkOut: "2026-08-02" });
  });
});

describe("runAvailabilityFormSubmit + real controller — same-tick cross-flow races", () => {
  it("Hold submit first, then an invalid Availability form submit in the same tick: complete no-op", async () => {
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
    controller.submit(); // synchronously acquires the coordinator's inFlight lock

    const setFieldErrors = vi.fn();
    const runSearch = vi.fn();
    const outcome = runAvailabilityFormSubmit(INVALID_DRAFT, {
      isAvailabilitySearchLocked: controller.isAvailabilitySearchLocked,
      setFieldErrors,
      runSearch,
    });

    expect(outcome).toBe("locked");
    expect(setFieldErrors).not.toHaveBeenCalled();
    expect(runSearch).not.toHaveBeenCalled();
    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1);
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
    expect(harness.getState().phase).toBe("submitting");
    expect(harness.getState().offer).toEqual(OFFER); // never reset by the rejected form submit

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });

  it("Hold submit first, then a valid Availability form submit in the same tick: complete no-op, Hold remains the sole mutation", async () => {
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

    const setFieldErrors = vi.fn();
    const runSearch = vi.fn();
    const outcome = runAvailabilityFormSubmit(VALID_DRAFT, {
      isAvailabilitySearchLocked: controller.isAvailabilitySearchLocked,
      setFieldErrors,
      runSearch,
    });

    expect(outcome).toBe("locked");
    expect(setFieldErrors).not.toHaveBeenCalled();
    expect(runSearch).not.toHaveBeenCalled();
    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1); // only the Hold submit's key
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1); // only the Hold submit's POST

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });

  it("Exact retry first (holding the lock), then an Availability form submit in the same tick: complete no-op", async () => {
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

    controller.retryExact(); // synchronously re-acquires the lock

    const setFieldErrors = vi.fn();
    const runSearch = vi.fn();
    const outcome = runAvailabilityFormSubmit(VALID_DRAFT, {
      isAvailabilitySearchLocked: controller.isAvailabilitySearchLocked,
      setFieldErrors,
      runSearch,
    });

    expect(outcome).toBe("locked");
    expect(setFieldErrors).not.toHaveBeenCalled();
    expect(runSearch).not.toHaveBeenCalled();
    expect(generateIdempotencyKeyMock).toHaveBeenCalledTimes(1); // retry never regenerates a key
    expect(createBookingHoldMock).toHaveBeenCalledTimes(2); // 1 original + 1 retry only

    pending.resolve({ hold: holdFixture(), outcome: "created" });
    await pending.promise;
  });

  it("an unlocked Availability search accepted first, then a Hold submit in the same tick: the obsolete offer produces zero keys/POSTs", async () => {
    const { createBookingHoldFlowController, runIfAvailabilitySearchAllowed } = await import(
      "../bookingHoldFlowController"
    );
    const harness = createHarness();
    const controller = createBookingHoldFlowController({
      getState: harness.getState,
      dispatch: harness.dispatch,
    });

    controller.selectOffer(OFFER, "label");
    controller.updateContact(CONTACT);

    const setFieldErrors = vi.fn();
    const performSearchSideEffect = vi.fn();
    const outcome = runAvailabilityFormSubmit(VALID_DRAFT, {
      isAvailabilitySearchLocked: controller.isAvailabilitySearchLocked,
      setFieldErrors,
      // Mirrors SectionAvailabilitySearch's runSearch: commits through the
      // exact same `runIfAvailabilitySearchAllowed`/`tryBeginAvailabilitySearch`
      // pair the component uses.
      runSearch: (query) => {
        runIfAvailabilitySearchAllowed(controller.tryBeginAvailabilitySearch, () => {
          performSearchSideEffect(query);
        });
      },
    });

    expect(outcome).toBe("started");
    expect(setFieldErrors).toHaveBeenCalledWith({});
    expect(performSearchSideEffect).toHaveBeenCalledTimes(1);

    // Same tick: a Hold submit immediately afterward must not use the now-obsolete offer.
    controller.submit();

    expect(generateIdempotencyKeyMock).not.toHaveBeenCalled();
    expect(createBookingHoldMock).not.toHaveBeenCalled();
  });
});

describe("runAvailabilityFormSubmit — ordinary unlocked semantics preserved", () => {
  it("an unlocked invalid submit does not touch the selected offer", () => {
    const setFieldErrors = vi.fn();
    const runSearch = vi.fn();

    runAvailabilityFormSubmit(INVALID_DRAFT, {
      isAvailabilitySearchLocked: () => false,
      setFieldErrors,
      runSearch,
    });

    // No offer-invalidating side effect is exposed to this orchestration
    // layer at all when the draft is invalid — `runSearch` (the only
    // function that could ever trigger `tryBeginAvailabilitySearch`) is
    // never called.
    expect(runSearch).not.toHaveBeenCalled();
  });
});
