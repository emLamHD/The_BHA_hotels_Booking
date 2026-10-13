import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookingHoldFlowAction,
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "@/lib/api/bookingHoldFlow";
import type { BookingIdentityGuard, IdentityChangeBlockReason } from "@/lib/api/bookingHoldFlowController";
import type { SelectedOfferSnapshot } from "@/lib/api/bookingHoldAttempt";
import type { CustomerIdentity } from "@/lib/api/authService";
import { ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { createCustomerIdentityCoordinator } from "@/lib/customerIdentityChange";
import type { IdentitySessionPort } from "@/lib/customerIdentityChange";
import { createCustomerSessionController } from "@/lib/customerSession";
import type { SessionReadOutcome } from "@/lib/customerSession";

const createBookingHoldMock = vi.fn();
const confirmBookingHoldMock = vi.fn();
vi.mock("@/lib/api/bookingHoldService", () => ({
  createBookingHold: (...args: unknown[]) => createBookingHoldMock(...args),
  confirmBookingHold: (...args: unknown[]) => confirmBookingHoldMock(...args),
}));
const generateIdempotencyKeyMock = vi.fn(() => "bha-hold-key");
vi.mock("@/lib/api/idempotencyKey", () => ({ generateIdempotencyKey: () => generateIdempotencyKeyMock() }));

const ALICE: CustomerIdentity = { customerAccountId: "11111111-1111-4111-8111-111111111111", email: "alice@example.test" };
const BOB: CustomerIdentity = { customerAccountId: "22222222-2222-4222-8222-222222222222", email: "bob@example.test" };
const CREDENTIALS = { email: "bob@example.test", password: "  Pa55 word!  " };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const http = (status: number) => new ApiHttpError(status, { title: "x", status });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  createBookingHoldMock.mockReset();
  confirmBookingHoldMock.mockReset();
  generateIdempotencyKeyMock.mockClear();
});

/* ------------------------------------------------------------------ unit: fake session + fake booking */

function unitRig(options: { blockReason?: IdentityChangeBlockReason | null; bind?: boolean; activate?: boolean } = {}) {
  const reads: ReturnType<typeof deferred<SessionReadOutcome>>[] = [];
  const calls: string[] = [];
  const session: IdentitySessionPort = {
    beginIdentityChange: vi.fn(() => {
      calls.push("session.beginIdentityChange");
      return true;
    }),
    read: vi.fn(() => {
      calls.push("session.read");
      const d = deferred<SessionReadOutcome>();
      reads.push(d);
      return d.promise;
    }),
    refresh: vi.fn(() => {
      calls.push("session.refresh");
    }),
  };
  const guard: BookingIdentityGuard = {
    identityChangeBlockReason: vi.fn(() => {
      calls.push("booking.block?");
      return options.blockReason ?? null;
    }),
    scrubForIdentityChange: vi.fn(() => {
      calls.push("booking.scrub");
      return true;
    }),
  };
  const transports: { kind: string; credentials?: unknown; signal: AbortSignal; d: ReturnType<typeof deferred<unknown>> }[] = [];
  const coordinator = createCustomerIdentityCoordinator({
    session,
    login: (credentials, { signal }) => {
      calls.push("login");
      const d = deferred<unknown>();
      transports.push({ kind: "login", credentials, signal, d });
      return d.promise;
    },
    logout: ({ signal }) => {
      calls.push("logout");
      const d = deferred<unknown>();
      transports.push({ kind: "logout", signal, d });
      return d.promise;
    },
  });
  if (options.activate !== false) coordinator.activate();
  const unbind = options.bind === false ? () => undefined : coordinator.bindBooking(guard);
  return { coordinator, session, guard, reads, transports, calls, unbind };
}

describe("identity coordinator — refusals have no effect", () => {
  it("is refused before activation and without a booking binding (fails closed)", async () => {
    const inactive = unitRig({ activate: false });
    await expect(inactive.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason: "session-inactive" });
    await expect(inactive.coordinator.logout()).resolves.toEqual({ status: "blocked", reason: "session-inactive" });
    expect(inactive.calls).toEqual([]);

    const unbound = unitRig({ bind: false });
    await expect(unbound.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason: "booking-unbound" });
    expect(unbound.calls).toEqual([]);
    expect(unbound.coordinator.isIdentityChangeLocked()).toBe(false);
  });

  it.each(["booking-in-progress", "receipt-not-finished"] as const)(
    "is refused with %s: no auth request, no session read or clearing, no scrub, no lock",
    async (reason) => {
      const rig = unitRig({ blockReason: reason });
      await expect(rig.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason });
      await expect(rig.coordinator.logout()).resolves.toEqual({ status: "blocked", reason });
      expect(rig.calls).toEqual(["booking.block?", "booking.block?"]);
      expect(rig.coordinator.isIdentityChangeLocked()).toBe(false);
      expect(rig.coordinator.getState()).toEqual({ phase: "idle" });
    }
  );

  it("activation alone starts nothing", () => {
    const rig = unitRig();
    expect(rig.calls).toEqual([]);
  });
});

describe("identity coordinator — claim, serialize, hold through recovery", () => {
  it("claims the lock synchronously, in order: booking check, session cleared, draft scrubbed, then the auth request", async () => {
    const rig = unitRig();
    const pending = rig.coordinator.login(CREDENTIALS);
    // Everything up to the request happened before this line returned, with no await in between.
    expect(rig.calls).toEqual(["booking.block?", "session.beginIdentityChange", "booking.scrub", "login"]);
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(true);
    expect(rig.coordinator.getState()).toEqual({ phase: "transport" });
    expect(rig.transports[0].credentials).toEqual(CREDENTIALS);
    rig.transports[0].d.resolve(undefined);
    await settle();
    rig.reads[0].resolve("authenticated");
    await pending;
  });

  it("a second login, a logout or another login in the same tick is refused: exactly one auth request", async () => {
    const rig = unitRig();
    const first = rig.coordinator.login(CREDENTIALS);
    const second = rig.coordinator.login(CREDENTIALS);
    const third = rig.coordinator.logout();
    await expect(second).resolves.toEqual({ status: "blocked", reason: "identity-change-in-progress" });
    await expect(third).resolves.toEqual({ status: "blocked", reason: "identity-change-in-progress" });
    expect(rig.transports).toHaveLength(1);
    rig.transports[0].d.resolve(undefined);
    await settle();
    rig.reads[0].resolve("anonymous");
    await first;
  });

  it("keeps the lock through the canonical me read and releases it only when me answers", async () => {
    const rig = unitRig();
    const pending = rig.coordinator.login(CREDENTIALS);
    rig.transports[0].d.resolve({ some: "login response" });
    await settle();
    expect(rig.coordinator.getState()).toEqual({ phase: "recovering" });
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(true);
    expect(rig.session.read).toHaveBeenCalledTimes(1);

    rig.reads[0].resolve("authenticated");
    await expect(pending).resolves.toEqual({ status: "settled", transport: "succeeded", session: "authenticated", transportError: undefined });
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(false);
    expect(rig.coordinator.getState()).toEqual({ phase: "idle" });
  });

  it.each([
    ["a 401", http(401), "refused"],
    ["a 429", http(429), "refused"],
    ["a lost response", new ApiNetworkError(), "lost"],
  ] as const)("after %s the session is still read: me decides, not the transport", async (_name, error, transport) => {
    const rig = unitRig();
    const pending = rig.coordinator.login(CREDENTIALS);
    rig.transports[0].d.reject(error);
    await settle();
    expect(rig.session.read).toHaveBeenCalledTimes(1);
    rig.reads[0].resolve("anonymous");
    const result = await pending;
    expect(result).toMatchObject({ status: "settled", transport, session: "anonymous", transportError: error });
    expect(rig.transports).toHaveLength(1); // never resent
  });

  it("logout goes through the same path", async () => {
    const rig = unitRig();
    const pending = rig.coordinator.logout();
    expect(rig.calls).toEqual(["booking.block?", "session.beginIdentityChange", "booking.scrub", "logout"]);
    rig.transports[0].d.resolve(undefined);
    await settle();
    rig.reads[0].resolve("anonymous");
    await expect(pending).resolves.toMatchObject({ status: "settled", transport: "succeeded", session: "anonymous" });
  });
});

describe("identity coordinator — failed recovery and refresh", () => {
  it("a failed me read keeps the lock; refresh retries only the read; me 401 then releases it", async () => {
    const rig = unitRig();
    const pending = rig.coordinator.login(CREDENTIALS);
    rig.transports[0].d.resolve(undefined);
    await settle();
    rig.reads[0].resolve("unknown");
    await expect(pending).resolves.toMatchObject({ status: "recovery-unresolved", transport: "succeeded" });
    expect(rig.coordinator.getState()).toEqual({ phase: "recovery-unresolved" });
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(true);

    // a new command is refused while unresolved
    await expect(rig.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason: "identity-change-in-progress" });

    rig.coordinator.requestRefresh();
    expect(rig.coordinator.getState()).toEqual({ phase: "recovering" });
    rig.reads[1].resolve("unknown"); // still failing
    await settle();
    expect(rig.coordinator.getState()).toEqual({ phase: "recovery-unresolved" });
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(true);

    rig.coordinator.requestRefresh();
    rig.reads[2].resolve("anonymous"); // 401 is a verified answer
    await settle();
    expect(rig.coordinator.getState()).toEqual({ phase: "idle" });
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(false);
    expect(rig.transports).toHaveLength(1); // the login was never repeated
    expect(rig.session.refresh).not.toHaveBeenCalled();
  });

  it("an ordinary refresh while idle is an ordinary read", () => {
    const rig = unitRig();
    rig.coordinator.requestRefresh();
    expect(rig.session.refresh).toHaveBeenCalledTimes(1);
    expect(rig.session.read).not.toHaveBeenCalled();
  });

  it("a refresh while the auth request is pending, or while the recovery read runs, reads nothing and supersedes nothing", async () => {
    const rig = unitRig();
    const pending = rig.coordinator.login(CREDENTIALS);
    rig.coordinator.requestRefresh();
    rig.coordinator.requestRefresh();
    expect(rig.session.refresh).not.toHaveBeenCalled();
    expect(rig.session.read).not.toHaveBeenCalled(); // not read before the request settles

    rig.transports[0].d.resolve(undefined);
    await settle();
    expect(rig.session.read).toHaveBeenCalledTimes(1);
    rig.coordinator.requestRefresh(); // joins the recovery read
    expect(rig.session.read).toHaveBeenCalledTimes(1);
    expect(rig.session.refresh).not.toHaveBeenCalled();
    expect(rig.coordinator.getState()).toEqual({ phase: "recovering" });

    rig.reads[0].resolve("authenticated");
    await pending;
    expect(rig.coordinator.getState()).toEqual({ phase: "idle" });
  });
});

describe("identity coordinator — lifetime and binding", () => {
  it("deactivating aborts the request on the wire only as a signal, discards late completions and releases nothing wrongly", async () => {
    const rig = unitRig();
    const pending = rig.coordinator.login(CREDENTIALS);
    expect(rig.transports[0].signal.aborted).toBe(false);
    rig.coordinator.deactivate();
    expect(rig.transports[0].signal.aborted).toBe(true);
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(false);

    rig.transports[0].d.resolve(undefined); // the old request settles late
    await expect(pending).resolves.toEqual({ status: "aborted" });
    expect(rig.session.read).not.toHaveBeenCalled(); // nothing restarted by the late completion
    expect(rig.coordinator.getState()).toEqual({ phase: "idle" });
  });

  it("an old operation's late settlement cannot unlock or disturb a newer one", async () => {
    const rig = unitRig();
    const old = rig.coordinator.login(CREDENTIALS);
    rig.coordinator.deactivate();
    rig.coordinator.activate();
    const fresh = rig.coordinator.logout();
    expect(rig.coordinator.getState()).toEqual({ phase: "transport" });

    rig.transports[0].d.resolve(undefined); // the OLD login settles now
    await expect(old).resolves.toEqual({ status: "aborted" });
    expect(rig.coordinator.getState()).toEqual({ phase: "transport" });
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(true);
    expect(rig.session.read).not.toHaveBeenCalled();

    rig.transports[1].d.resolve(undefined);
    await settle();
    rig.reads[0].resolve("anonymous");
    await expect(fresh).resolves.toMatchObject({ status: "settled", session: "anonymous" });
  });

  it("a late recovery answer of a deactivated coordinator changes nothing", async () => {
    const rig = unitRig();
    const pending = rig.coordinator.login(CREDENTIALS);
    rig.transports[0].d.resolve(undefined);
    await settle();
    rig.coordinator.deactivate();
    rig.reads[0].resolve("authenticated");
    await expect(pending).resolves.toEqual({ status: "aborted" });
    expect(rig.coordinator.getState()).toEqual({ phase: "idle" });
  });

  it("a stale unbind never removes a newer booking binding; StrictMode bind→unbind→bind keeps working", async () => {
    const rig = unitRig({ bind: false });
    const guardA = rig.guard;
    const guardB: BookingIdentityGuard = {
      identityChangeBlockReason: vi.fn(() => "booking-in-progress" as const),
      scrubForIdentityChange: vi.fn(() => false),
    };

    const unbindA1 = rig.coordinator.bindBooking(guardA);
    unbindA1(); // StrictMode cleanup
    const unbindA2 = rig.coordinator.bindBooking(guardA); // remount
    unbindA1(); // a late, duplicate cleanup of the first registration
    const first = rig.coordinator.login(CREDENTIALS);
    expect(rig.transports).toHaveLength(1); // guard A is still bound
    rig.transports[0].d.resolve(undefined);
    await settle();
    rig.reads[0].resolve("anonymous");
    await first;

    const unbindB = rig.coordinator.bindBooking(guardB); // a newer registration replaces A
    unbindA2(); // A's cleanup must not remove B
    await expect(rig.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason: "booking-in-progress" });
    unbindB();
    await expect(rig.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason: "booking-unbound" });
  });

  it("two coordinators are independent: no shared lock, binding or state", async () => {
    const one = unitRig();
    const two = unitRig();
    const first = one.coordinator.login(CREDENTIALS);
    expect(one.coordinator.isIdentityChangeLocked()).toBe(true);
    expect(two.coordinator.isIdentityChangeLocked()).toBe(false);
    const other = two.coordinator.logout();
    expect(two.transports).toHaveLength(1);
    one.transports[0].d.resolve(undefined);
    two.transports[0].d.resolve(undefined);
    await settle();
    one.reads[0].resolve("authenticated");
    two.reads[0].resolve("anonymous");
    await expect(first).resolves.toMatchObject({ session: "authenticated" });
    await expect(other).resolves.toMatchObject({ session: "anonymous" });
  });
});

/* ------------------------------------------------------------------ integration: real controllers */

/** A React-like harness: `getState` is stale until `commit()`. */
function staleHarness() {
  let state: BookingHoldFlowState = initialBookingHoldFlowState;
  const queue: BookingHoldFlowAction[] = [];
  return {
    getState: () => state,
    dispatch: (action: BookingHoldFlowAction) => queue.push(action),
    commit: () => {
      while (queue.length) state = bookingHoldFlowReducer(state, queue.shift() as BookingHoldFlowAction);
    },
  };
}

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
const HOLD = {
  holdId: "aaaaaaaa-0000-0000-0000-000000000001",
  status: "Active",
  propertyId: OFFER.propertyId,
  roomTypeId: OFFER.roomTypeId,
  ratePlanId: OFFER.ratePlanId,
  checkIn: OFFER.checkIn,
  checkOut: OFFER.checkOut,
  adults: 2,
  children: 0,
  rooms: 1,
  currencyCode: "VND",
  totalAmount: 3000000,
  createdAtUtc: "2026-07-30T01:59:50.389Z",
  expiresAtUtc: "2026-07-30T02:14:50.389Z",
  nights: [],
  guestAccessToken: "guest-token",
};
const RESERVATION = {
  reservationId: "bbbbbbbb-0000-0000-0000-000000000001",
  confirmationNumber: "BHA1",
  status: "Confirmed",
  propertyId: OFFER.propertyId,
  roomTypeId: OFFER.roomTypeId,
  ratePlanId: OFFER.ratePlanId,
  fullName: CONTACT.fullName,
  email: CONTACT.email,
  phone: CONTACT.phone,
  checkIn: OFFER.checkIn,
  checkOut: OFFER.checkOut,
  adults: 2,
  children: 0,
  rooms: 1,
  currencyCode: "VND",
  totalAmount: 3000000,
  confirmedAtUtc: "2026-07-30T02:00:10.123Z",
  cancelledAtUtc: null,
  cancellationReason: null,
  nights: [],
};

async function integrationRig() {
  const { createBookingHoldFlowController } = await import("@/lib/api/bookingHoldFlowController");
  const harness = staleHarness();
  const sessionReads: ReturnType<typeof deferred<CustomerIdentity>>[] = [];
  const invalidateCsrf = vi.fn();
  const session = createCustomerSessionController({
    readSession: () => {
      const d = deferred<CustomerIdentity>();
      sessionReads.push(d);
      return d.promise;
    },
    invalidateCsrf,
  });
  const authCalls: { kind: string; d: ReturnType<typeof deferred<unknown>> }[] = [];
  const coordinator = createCustomerIdentityCoordinator({
    session,
    login: () => {
      const d = deferred<unknown>();
      authCalls.push({ kind: "login", d });
      return d.promise;
    },
    logout: () => {
      const d = deferred<unknown>();
      authCalls.push({ kind: "logout", d });
      return d.promise;
    },
  });
  const booking = createBookingHoldFlowController({
    getState: harness.getState,
    dispatch: harness.dispatch,
    isIdentityChangeLocked: coordinator.isIdentityChangeLocked, // the wiring the provider does
  });
  // The provider's effects, in React's order: child binds, parent activates and starts.
  const unbind = coordinator.bindBooking(booking.identityGuard);
  coordinator.activate();
  session.start();
  return { harness, session, sessionReads, invalidateCsrf, coordinator, booking, authCalls, unbind };
}
type IRig = Awaited<ReturnType<typeof integrationRig>>;

const toSelected = (rig: IRig) => {
  rig.booking.selectOffer(OFFER, "label");
  rig.harness.commit();
  rig.booking.updateContact(CONTACT);
  rig.harness.commit();
};

const LOCKED: Record<string, (rig: IRig) => Promise<void>> = {
  submitting: async (rig) => {
    toSelected(rig);
    createBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.booking.submit();
  },
  uncertain: async (rig) => {
    toSelected(rig);
    createBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    rig.booking.submit();
    await settle();
  },
  "active-session": async (rig) => {
    toSelected(rig);
    createBookingHoldMock.mockResolvedValueOnce({ hold: HOLD, outcome: "created" });
    rig.booking.submit();
    await settle();
  },
  confirming: async (rig) => {
    await LOCKED["active-session"](rig);
    rig.harness.commit();
    confirmBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.booking.confirmHold();
  },
  "confirm-uncertain": async (rig) => {
    await LOCKED["active-session"](rig);
    rig.harness.commit();
    confirmBookingHoldMock.mockRejectedValueOnce(new ApiNetworkError());
    rig.booking.confirmHold();
    await settle();
  },
  "confirm-known-error": async (rig) => {
    await LOCKED["active-session"](rig);
    rig.harness.commit();
    confirmBookingHoldMock.mockRejectedValueOnce(new ApiHttpError(409, { title: "c", status: 409 }));
    rig.booking.confirmHold();
    await settle();
  },
  "reservation-result": async (rig) => {
    await LOCKED["active-session"](rig);
    rig.harness.commit();
    confirmBookingHoldMock.mockResolvedValueOnce({ reservation: RESERVATION, outcome: "confirmed" });
    rig.booking.confirmHold();
    await settle();
  },
};

async function startAndAnswerInitialRead(rig: IRig, answer: CustomerIdentity | "401") {
  if (answer === "401") rig.sessionReads[0].reject(http(401));
  else rig.sessionReads[0].resolve(answer);
  await settle();
}

describe("guard integration — locked booking phases refuse guarded login/logout with zero side effects", () => {
  it.each(Object.keys(LOCKED))("%s", async (phase) => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, ALICE);
    await LOCKED[phase](rig);
    // Do NOT commit the last dispatches: the stale React snapshot must not matter.
    const csrfBefore = rig.invalidateCsrf.mock.calls.length;
    const readsBefore = rig.sessionReads.length;
    const sessionBefore = rig.session.getState();
    createBookingHoldMock.mockClear();
    confirmBookingHoldMock.mockClear();
    generateIdempotencyKeyMock.mockClear();

    const login = await rig.coordinator.login(CREDENTIALS);
    const logout = await rig.coordinator.logout();

    const reason = phase === "reservation-result" ? "receipt-not-finished" : "booking-in-progress";
    expect(login).toEqual({ status: "blocked", reason });
    expect(logout).toEqual({ status: "blocked", reason });
    expect(rig.authCalls).toHaveLength(0);
    expect(rig.sessionReads).toHaveLength(readsBefore); // no me read
    expect(rig.invalidateCsrf.mock.calls.length).toBe(csrfBefore); // no CSRF invalidation
    expect(rig.session.getState()).toBe(sessionBefore); // identity not even cleared
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(false);
    expect(createBookingHoldMock).not.toHaveBeenCalled();
    expect(confirmBookingHoldMock).not.toHaveBeenCalled();
    expect(generateIdempotencyKeyMock).not.toHaveBeenCalled();
  });

  it("the retained hold, token and attempt are exactly what they were", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, "401");
    await LOCKED["active-session"](rig);
    rig.harness.commit();
    const before = rig.harness.getState();
    await rig.coordinator.login(CREDENTIALS);
    rig.harness.commit();
    expect(rig.harness.getState()).toBe(before);
    expect(rig.harness.getState().session?.guestAccessToken).toBe("guest-token");
    // …and the booking can still be confirmed.
    confirmBookingHoldMock.mockResolvedValueOnce({ reservation: RESERVATION, outcome: "confirmed" });
    rig.booking.confirmHold();
    expect(confirmBookingHoldMock).toHaveBeenCalledTimes(1);
  });
});

describe("guard integration — same-tick orders", () => {
  it("submit() then login in the same tick: login refused, exactly one booking POST", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, "401");
    toSelected(rig);
    createBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.booking.submit();
    const login = rig.coordinator.login(CREDENTIALS);
    await expect(login).resolves.toEqual({ status: "blocked", reason: "booking-in-progress" });
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
    expect(rig.authCalls).toHaveLength(0);
  });

  it("login() then submit() in the same tick: zero booking POST, no key, no attempt, draft already discarded", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, "401");
    toSelected(rig);
    generateIdempotencyKeyMock.mockClear();

    const login = rig.coordinator.login(CREDENTIALS);
    rig.booking.submit(); // before React commits anything
    rig.booking.selectOffer(OFFER, "again");
    rig.booking.updateContact({ ...CONTACT, fullName: "Somebody Else" });
    rig.booking.retryExact();

    expect(createBookingHoldMock).not.toHaveBeenCalled();
    expect(generateIdempotencyKeyMock).not.toHaveBeenCalled();
    rig.harness.commit();
    expect(rig.harness.getState()).toMatchObject({ phase: "idle", offer: null, attempt: null });
    expect(JSON.stringify(rig.harness.getState())).not.toContain(CONTACT.email);

    rig.authCalls[0].d.resolve(undefined);
    await settle();
    rig.sessionReads[1].resolve(BOB);
    await expect(login).resolves.toMatchObject({ status: "settled", session: "authenticated" });
  });

  it("login() then logout() in the same tick: one auth request", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, ALICE);
    const login = rig.coordinator.login(CREDENTIALS);
    const logout = rig.coordinator.logout();
    await expect(logout).resolves.toEqual({ status: "blocked", reason: "identity-change-in-progress" });
    expect(rig.authCalls).toHaveLength(1);
    rig.authCalls[0].d.resolve(undefined);
    await settle();
    rig.sessionReads[1].resolve(BOB);
    await login;
  });
});

describe("guard integration — lock lifetime and session ordering", () => {
  it("booking mutations stay refused during the auth request and the recovery read, and work again once me is verified", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, ALICE);
    toSelected(rig);

    const login = rig.coordinator.login(CREDENTIALS);
    rig.harness.commit();
    expect(rig.session.getState()).toEqual({ status: "loading", customer: null }); // A is gone before the request settles

    // during the auth request
    rig.booking.selectOffer(OFFER, "l");
    rig.harness.commit();
    rig.booking.updateContact(CONTACT);
    rig.booking.submit();
    expect(createBookingHoldMock).not.toHaveBeenCalled();

    rig.authCalls[0].d.resolve(undefined);
    await settle();
    // during the recovery read
    expect(rig.coordinator.getState()).toEqual({ phase: "recovering" });
    rig.booking.submit();
    expect(rig.booking.tryBeginAvailabilitySearch()).toBe(false);
    expect(createBookingHoldMock).not.toHaveBeenCalled();

    rig.sessionReads[1].resolve(BOB);
    await expect(login).resolves.toMatchObject({ status: "settled", session: "authenticated" });
    expect(rig.session.getState()).toEqual({ status: "authenticated", customer: BOB });

    // verified: booking works, with a fresh key
    rig.booking.selectOffer(OFFER, "l");
    rig.harness.commit();
    rig.booking.updateContact(CONTACT);
    rig.harness.commit();
    createBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.booking.submit();
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
  });

  it("an unresolved recovery keeps booking blocked until a read-only retry gets an answer", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, ALICE);
    const login = rig.coordinator.login(CREDENTIALS);
    rig.authCalls[0].d.resolve(undefined);
    await settle();
    rig.sessionReads[1].reject(new ApiNetworkError());
    await expect(login).resolves.toMatchObject({ status: "recovery-unresolved" });
    expect(rig.session.getState()).toEqual({ status: "unknown", customer: null });

    rig.booking.selectOffer(OFFER, "l");
    rig.harness.commit();
    expect(rig.harness.getState().phase).toBe("idle"); // refused: no draft rebuilt
    expect(rig.authCalls).toHaveLength(1);

    rig.coordinator.requestRefresh();
    rig.sessionReads[2].reject(http(401));
    await settle();
    expect(rig.session.getState()).toEqual({ status: "anonymous", customer: null });
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(false);
    rig.booking.selectOffer(OFFER, "l");
    rig.harness.commit();
    expect(rig.harness.getState().phase).toBe("selected");
    expect(rig.authCalls).toHaveLength(1); // the login was never repeated
  });

  it("a late me answer for A (read before the change) cannot publish A while changing to B", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, ALICE);
    rig.coordinator.requestRefresh(); // an ordinary read of A is in flight
    expect(rig.sessionReads).toHaveLength(2);

    const login = rig.coordinator.login(CREDENTIALS); // identity change B starts
    rig.sessionReads[1].resolve(ALICE); // the older read for A arrives late
    await settle();
    expect(rig.session.getState()).toEqual({ status: "loading", customer: null });

    rig.authCalls[0].d.resolve(undefined);
    await settle();
    rig.sessionReads[2].resolve(BOB);
    await login;
    expect(rig.session.getState()).toEqual({ status: "authenticated", customer: BOB });
  });

  it("logout: me 401 is verified and releases the lock without claiming the cookie was cleared", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, ALICE);
    const logout = rig.coordinator.logout();
    rig.authCalls[0].d.reject(http(401)); // logout itself was refused
    await settle();
    rig.sessionReads[1].reject(http(401));
    await expect(logout).resolves.toMatchObject({ status: "settled", transport: "refused", session: "anonymous" });
    expect(rig.coordinator.isIdentityChangeLocked()).toBe(false);
  });

  it("an initial me read still in flight is superseded by the change, and anonymous booking works without any identity operation", async () => {
    const rig = await integrationRig(); // the first read has not answered
    expect(rig.session.getState().status).toBe("loading");
    // baseline: no identity operation → booking is not gated by the reader's loading state
    toSelected(rig);
    createBookingHoldMock.mockReturnValueOnce(new Promise(() => undefined));
    rig.booking.submit();
    expect(createBookingHoldMock).toHaveBeenCalledTimes(1);
  });
});

describe("guard integration — explicit finish, then change identity", () => {
  it("login is refused with the receipt on screen; finishBooking sends nothing; then login B leaves no receipt of A", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, ALICE);
    await LOCKED["reservation-result"](rig);
    rig.harness.commit();
    createBookingHoldMock.mockClear();
    confirmBookingHoldMock.mockClear();

    await expect(rig.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason: "receipt-not-finished" });
    expect(rig.harness.getState().phase).toBe("reservation-result"); // not auto-cleared

    expect(rig.booking.finishBooking("bbbbbbbb-0000-0000-0000-00000000dead")).toBe(false);
    expect(rig.booking.finishBooking(RESERVATION.reservationId)).toBe(true);
    expect(confirmBookingHoldMock).not.toHaveBeenCalled();
    expect(createBookingHoldMock).not.toHaveBeenCalled();

    const login = rig.coordinator.login(CREDENTIALS);
    rig.authCalls[0].d.resolve(undefined);
    await settle();
    rig.sessionReads[1].resolve(BOB);
    await expect(login).resolves.toMatchObject({ status: "settled", session: "authenticated" });
    rig.harness.commit();
    expect(JSON.stringify(rig.harness.getState())).not.toContain(CONTACT.email);
    expect(rig.harness.getState().reservationResult).toBeNull();
    expect(rig.harness.getState().phase).toBe("idle");
  });
});

describe("guard integration — wiring, lifecycle, instances", () => {
  it("without a binding the identity commands fail closed (the provider has not registered a booking flow)", async () => {
    const rig = await integrationRig();
    await startAndAnswerInitialRead(rig, "401");
    rig.unbind();
    await expect(rig.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason: "booking-unbound" });
    expect(rig.authCalls).toHaveLength(0);
  });

  it("StrictMode: stop → start of the session layer keeps the binding and the guard working", async () => {
    const rig = await integrationRig();
    rig.session.stop();
    rig.coordinator.deactivate();
    rig.coordinator.activate();
    rig.session.start();
    rig.sessionReads[1].resolve(ALICE);
    await settle();
    await LOCKED["active-session"](rig);
    await expect(rig.coordinator.login(CREDENTIALS)).resolves.toEqual({ status: "blocked", reason: "booking-in-progress" });
  });

  it("two instances share nothing: a booking in one never blocks, and an identity change in one never locks, the other", async () => {
    const one = await integrationRig();
    const two = await integrationRig();
    await startAndAnswerInitialRead(one, ALICE);
    await startAndAnswerInitialRead(two, ALICE);
    await LOCKED["active-session"](one);
    const loginTwo = two.coordinator.login(CREDENTIALS);
    expect(two.coordinator.isIdentityChangeLocked()).toBe(true);
    expect(one.coordinator.isIdentityChangeLocked()).toBe(false);
    await expect(one.coordinator.login(CREDENTIALS)).resolves.toMatchObject({ status: "blocked", reason: "booking-in-progress" });
    two.authCalls[0].d.resolve(undefined);
    await settle();
    two.sessionReads[1].resolve(BOB);
    await expect(loginTwo).resolves.toMatchObject({ status: "settled" });
  });
});
