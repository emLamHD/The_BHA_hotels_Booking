import { beforeEach, describe, expect, it, vi } from "vitest";
import { testT } from "@/lib/i18n/testkit";
import {
  BookingHoldFlowAction,
  BookingHoldFlowState,
  bookingHoldFlowReducer,
  initialBookingHoldFlowState,
} from "@/lib/api/bookingHoldFlow";
import type { SelectedOfferSnapshot } from "@/lib/api/bookingHoldAttempt";
import { ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import {
  AuthUiResult,
  createAuthSubmissionOwner,
  describeAuthEntry,
  describeSessionNotice,
  isStalePresentation,
  loginSucceeded,
  presentIdentityCommandResult,
  receiptCloseFailureMessage,
  receiptCloseTarget,
  validateLoginInput,
} from "@/lib/customerAuthUi";
import { IdentityCommandResult, createCustomerIdentityCoordinator } from "@/lib/customerIdentityChange";
import type { BookingIdentityGuard } from "@/lib/api/bookingHoldFlowController";
import type { SessionReadOutcome } from "@/lib/customerSession";
import { TEST_QUOTE } from "@/lib/api/quoteTestkit";

const t = testT("vi");
const createBookingHoldMock = vi.fn();
const confirmBookingHoldMock = vi.fn();
vi.mock("@/lib/api/bookingHoldService", () => ({
  createBookingHold: (...args: unknown[]) => createBookingHoldMock(...args),
  confirmBookingHold: (...args: unknown[]) => confirmBookingHoldMock(...args),
}));
vi.mock("@/lib/api/idempotencyKey", () => ({ generateIdempotencyKey: () => "bha-hold-key" }));

const http = (status: number) => new ApiHttpError(status, { title: "x", status, detail: "SECRET-SERVER-DETAIL" });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
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
});

/* ------------------------------------------------------------------ validation */

describe("validateLoginInput", () => {
  it("accepts a well-formed pair, trims the email, and sends the password exactly as typed", () => {
    const result = validateLoginInput("  bob@example.test \n", "  Pa55 word!  ");
    expect(result).toEqual({ ok: true, credentials: { email: "bob@example.test", password: "  Pa55 word!  " } });
  });

  it.each([
    ["", "secret", "email", "customer.auth.validation.emailRequired"],
    ["   ", "secret", "email", "customer.auth.validation.emailRequired"],
    ["not-an-email", "secret", "email", "customer.auth.validation.emailInvalid"],
    ["a@@b", "secret", "email", "customer.auth.validation.emailInvalid"],
    ["a b@c.test", "secret", "email", "customer.auth.validation.emailInvalid"],
    [`${"a".repeat(250)}@b.test`, "secret", "email", "customer.auth.validation.emailTooLong"],
  ] as const)("refuses email %j before any request, focusing the email", (email, password, focus, message) => {
    expect(validateLoginInput(email, password)).toEqual({ ok: false, errors: { email: message }, focus });
  });

  it.each([
    ["", "customer.auth.validation.passwordRequired"],
    ["     ", "customer.auth.validation.passwordRequired"],
    ["x".repeat(129), "customer.auth.validation.passwordTooLong"],
  ])("refuses password %j, focusing the password", (password, message) => {
    expect(validateLoginInput("bob@example.test", password)).toEqual({
      ok: false,
      errors: { password: message },
      focus: "password",
    });
  });

  it("accepts the limits exactly (256 email, 128 password) and reports both errors, email first", () => {
    expect(validateLoginInput(`${"a".repeat(249)}@b.test`, "x".repeat(128)).ok).toBe(true);
    expect(validateLoginInput("", "")).toEqual({
      ok: false,
      errors: { email: "customer.auth.validation.emailRequired", password: "customer.auth.validation.passwordRequired" },
      focus: "email",
    });
  });
});

/* ------------------------------------------------------------------ results → presentation */

const CTX = { bookingHref: "/listing-stay-detail?room=1" };
const settled = (
  transport: "succeeded" | "refused" | "lost",
  session: "authenticated" | "anonymous",
  transportError?: unknown
): IdentityCommandResult => ({ status: "settled", transport, session, transportError });

describe("presentIdentityCommandResult — what the auth request did AND what me verified", () => {
  it("login succeeded + me authenticated is the only success, and the only one that leaves the page", () => {
    const ok = settled("succeeded", "authenticated");
    expect(presentIdentityCommandResult("login", ok, CTX, t)).toMatchObject({ tone: "success" });
    expect(loginSucceeded(ok)).toBe(true);
    for (const other of [
      settled("succeeded", "anonymous"),
      settled("refused", "authenticated", http(401)),
      settled("lost", "authenticated", http(503)),
      { status: "recovery-unresolved", transport: "succeeded" } as const,
      { status: "blocked", reason: "booking-in-progress" } as const,
      { status: "aborted" } as const,
      { status: "failed" } as const,
    ] satisfies AuthUiResult[]) {
      expect(loginSucceeded(other)).toBe(false);
    }
  });

  it("401 is one generic message (no account enumeration), 429 asks to wait without inventing a cooldown", () => {
    const wrong = presentIdentityCommandResult("login", settled("refused", "anonymous", http(401)), CTX, t);
    expect(wrong).toMatchObject({ tone: "error", message: "Email hoặc mật khẩu không đúng." });
    const limited = presentIdentityCommandResult("login", settled("refused", "anonymous", http(429)), CTX, t);
    expect(limited?.message).toBe("Có quá nhiều lần thử. Hãy thử lại sau ít phút.");
    expect(limited?.message).not.toMatch(/\d+\s*(giây|phút)/);
  });

  it("a refusal while the previous account is still signed in does not read as a login", () => {
    const result = presentIdentityCommandResult("login", settled("refused", "authenticated", http(401)), CTX, t);
    expect(result?.tone).toBe("error");
    expect(result?.message).toContain("Email hoặc mật khẩu không đúng.");
    expect(result?.message).toContain("vẫn đang đăng nhập");
  });

  it("400 and any other refusal use safe copy that never echoes the server's detail or the credentials", () => {
    for (const status of [400, 422]) {
      const result = presentIdentityCommandResult("login", settled("refused", "anonymous", http(status)), CTX, t);
      expect(result?.tone).toBe("error");
      expect(result?.message).not.toContain("SECRET-SERVER-DETAIL");
    }
  });

  it.each([500, 502, 503, 504])(
    "a %s is lost, never a refusal or success: no false 'wrong password', and the verified session decides the sentence",
    (status) => {
      const signedIn = presentIdentityCommandResult("login", settled("lost", "authenticated", http(status)), CTX, t);
      expect(signedIn).toMatchObject({ tone: "warning" });
      expect(signedIn?.message).toContain("Chưa xác nhận được kết quả");
      expect(signedIn?.message).toContain("bạn đang đăng nhập");
      expect(signedIn?.message).not.toContain("không đúng");
      expect(signedIn?.message).not.toContain("SECRET-SERVER-DETAIL");
      const out = presentIdentityCommandResult("login", settled("lost", "anonymous", http(status)), CTX, t);
      expect(out?.message).toContain("chưa đăng nhập");
      expect(out?.message).not.toContain("không đúng");
    }
  );

  it("a lost response (network) is lost too, for login and for logout", () => {
    const login = presentIdentityCommandResult("login", settled("lost", "anonymous", new ApiNetworkError()), CTX, t);
    expect(login?.message).toContain("Chưa xác nhận được kết quả");
    const logout = presentIdentityCommandResult("logout", settled("lost", "authenticated", new ApiNetworkError()), CTX, t);
    expect(logout?.message).toContain("vẫn đang đăng nhập");
    expect(logout?.tone).toBe("warning");
  });

  it("logout: success needs me anonymous; a 401 + me 401 claims nothing about cookies", () => {
    expect(presentIdentityCommandResult("logout", settled("succeeded", "anonymous"), CTX, t)).toMatchObject({
      tone: "success",
      message: "Đã đăng xuất.",
    });
    expect(presentIdentityCommandResult("logout", settled("succeeded", "authenticated"), CTX, t)?.tone).toBe("warning");
    const refused = presentIdentityCommandResult("logout", settled("refused", "anonymous", http(401)), CTX, t);
    expect(refused?.tone).toBe("info");
    expect(refused?.message).not.toMatch(/cookie/i);
    expect(presentIdentityCommandResult("logout", settled("refused", "anonymous", http(429)), CTX, t)?.tone).toBe("warning");
  });

  it("blocked booking-in-progress explains and links back to the booking, with no refresh to offer", () => {
    const result = presentIdentityCommandResult("login", { status: "blocked", reason: "booking-in-progress" }, CTX, t);
    expect(result).toMatchObject({ tone: "warning", link: { href: "/listing-stay-detail?room=1" }, offerRefresh: false });
    const noTarget = presentIdentityCommandResult("logout", { status: "blocked", reason: "booking-in-progress" }, { bookingHref: null }, t);
    expect(noTarget?.link?.href).toBe("/");
  });

  it("blocked receipt-not-finished leads to the receipt, never auto-closing it", () => {
    const result = presentIdentityCommandResult("logout", { status: "blocked", reason: "receipt-not-finished" }, CTX, t);
    expect(result?.link).toEqual({ href: "/paydone", label: "Mở biên nhận" });
    expect(result?.message).toContain("mã đặt phòng");
  });

  it("blocked in-progress / unbound / inactive: safe, with a read-only check only where it helps", () => {
    expect(presentIdentityCommandResult("login", { status: "blocked", reason: "identity-change-in-progress" }, CTX, t)).toMatchObject({
      tone: "info",
      offerRefresh: false,
    });
    for (const reason of ["booking-unbound", "session-inactive"] as const) {
      expect(presentIdentityCommandResult("login", { status: "blocked", reason }, CTX, t)).toMatchObject({
        tone: "warning",
        offerRefresh: true,
      });
    }
  });

  it.each(["succeeded", "refused", "lost"] as const)(
    "recovery-unresolved after a %s request says the session could not be checked (the provider notice owns the retry action)",
    (transport) => {
      const result = presentIdentityCommandResult("login", { status: "recovery-unresolved", transport }, CTX, t);
      expect(result).toMatchObject({ tone: "warning", offerRefresh: false });
      expect(result?.message).toContain("chưa kiểm tra lại được phiên đăng nhập");
    }
  );

  it("an aborted command shows nothing and implies no rollback", () => {
    expect(presentIdentityCommandResult("login", { status: "aborted" }, CTX, t)).toBeNull();
  });

  it("a stored recovery-unresolved result is stale once the provider is idle again; a lost/settled one is not", () => {
    const unresolved: AuthUiResult = { status: "recovery-unresolved", transport: "lost" };
    expect(isStalePresentation(unresolved, "recovery-unresolved", "idle")).toBe(false);
    expect(isStalePresentation(unresolved, "recovering", "idle")).toBe(false);
    expect(isStalePresentation(unresolved, "idle", "idle")).toBe(true);
    expect(isStalePresentation(settled("lost", "authenticated"), "idle", "idle")).toBe(false);
  });

  it("a blocked-by-booking message is stale once the booking no longer blocks, and not before", () => {
    const inProgress: AuthUiResult = { status: "blocked", reason: "booking-in-progress" };
    const receipt: AuthUiResult = { status: "blocked", reason: "receipt-not-finished" };
    for (const phase of ["submitting", "uncertain", "active-session", "confirming", "confirm-known-error", "confirm-uncertain"] as const) {
      expect(isStalePresentation(inProgress, "idle", phase)).toBe(false);
    }
    for (const phase of ["idle", "selected", "known-error", "reservation-result"] as const) {
      expect(isStalePresentation(inProgress, "idle", phase)).toBe(true);
    }
    expect(isStalePresentation(receipt, "idle", "reservation-result")).toBe(false);
    expect(isStalePresentation(receipt, "idle", "idle")).toBe(true);
  });
});

/* ------------------------------------------------------------------ session notice / entry */

describe("describeSessionNotice — the provider is the authority", () => {
  it("busy while a guarded command or its recovery read runs, whatever me says", () => {
    expect(describeSessionNotice("loading", "transport", t)).toMatchObject({ kind: "busy", offerRefresh: false });
    expect(describeSessionNotice("loading", "recovering", t)).toMatchObject({ kind: "busy", offerRefresh: false });
  });
  it("unresolved after a failed recovery read offers the read-only check; idle + verified clears it", () => {
    expect(describeSessionNotice("loading", "recovery-unresolved", t)).toMatchObject({ kind: "unresolved", offerRefresh: true });
    expect(describeSessionNotice("authenticated", "idle", t)).toBeNull();
    expect(describeSessionNotice("anonymous", "idle", t)).toBeNull();
  });
  it("the initial read is 'checking'; a failed ordinary read is 'unknown' and offers a re-check without locking", () => {
    expect(describeSessionNotice("loading", "idle", t)).toMatchObject({ kind: "checking", offerRefresh: false });
    const unknown = describeSessionNotice("unknown", "idle", t);
    expect(unknown).toMatchObject({ kind: "unresolved", offerRefresh: true });
    expect(unknown?.message).not.toContain("khoá");
  });
});

describe("describeAuthEntry — one entry for every header and the app bar", () => {
  it("a verified signed-in Customer leads to /account; anonymous, loading and unknown lead to /login", () => {
    expect(describeAuthEntry("anonymous", "idle", null, t)).toMatchObject({ label: "Đăng nhập", href: "/login", indicator: "none" });
    expect(describeAuthEntry("authenticated", "idle", "a@b.test", t)).toMatchObject({
      label: "Tài khoản",
      ariaLabel: "Tài khoản a@b.test",
      href: "/account",
    });
    for (const status of ["loading", "unknown"] as const) {
      expect(describeAuthEntry(status, "idle", null, t).href).toBe("/login");
      expect(describeAuthEntry(status, "idle", null, t).label).toBe("Tài khoản");
    }
  });
  it("never offers /account without a verified email, even for an authenticated status", () => {
    expect(describeAuthEntry("authenticated", "idle", null, t).href).toBe("/login");
    for (const phase of ["transport", "recovering", "recovery-unresolved"] as const) {
      expect(describeAuthEntry("loading", phase, null, t).href).toBe("/login");
      expect(describeAuthEntry("authenticated", phase, "a@b.test", t).href).toBe("/login"); // a stale snapshot while pending
    }
  });
  it("never carries an email unless authenticated, and flags busy / attention states", () => {
    expect(describeAuthEntry("loading", "transport", "stale@b.test", t).ariaLabel).not.toContain("stale@b.test");
    expect(describeAuthEntry("loading", "transport", null, t).indicator).toBe("busy");
    expect(describeAuthEntry("loading", "recovering", null, t).indicator).toBe("busy");
    expect(describeAuthEntry("loading", "recovery-unresolved", null, t).indicator).toBe("attention");
    expect(describeAuthEntry("unknown", "idle", null, t).indicator).toBe("attention");
  });
});

/* ------------------------------------------------------------------ the submission owner */

describe("createAuthSubmissionOwner", () => {
  it("two events in the same tick start one command (the claim is synchronous, not a rendered flag)", async () => {
    const owner = createAuthSubmissionOwner();
    const d = deferred<IdentityCommandResult>();
    const command = vi.fn(() => d.promise);
    const onSettled = vi.fn();
    expect(owner.run(command, onSettled)).toBe(true);
    expect(owner.run(command, onSettled)).toBe(false);
    expect(owner.isBusy()).toBe(true);
    expect(command).toHaveBeenCalledTimes(1);
    d.resolve({ status: "aborted" });
    await settle();
    expect(onSettled).toHaveBeenCalledWith({ status: "aborted" });
    expect(owner.isBusy()).toBe(false);
    expect(owner.run(command, onSettled)).toBe(true); // a new attempt is possible after it settled
  });

  it("a result that arrives after dispose is never delivered (no message, no redirect)", async () => {
    const owner = createAuthSubmissionOwner();
    const d = deferred<IdentityCommandResult>();
    const onSettled = vi.fn();
    owner.run(() => d.promise, onSettled);
    owner.dispose();
    d.resolve({ status: "settled", transport: "succeeded", session: "authenticated" });
    await settle();
    expect(onSettled).not.toHaveBeenCalled();
    expect(owner.run(() => d.promise, onSettled)).toBe(false); // a disposed owner starts nothing
  });

  it("an unexpected rejection or throw becomes a 'failed' result and releases the owner", async () => {
    const owner = createAuthSubmissionOwner();
    const results: AuthUiResult[] = [];
    owner.run(() => Promise.reject(new Error("boom")), (r) => results.push(r));
    await settle();
    owner.run(() => {
      throw new Error("sync boom");
    }, (r) => results.push(r));
    expect(results).toEqual([{ status: "failed" }, { status: "failed" }]);
    expect(owner.isBusy()).toBe(false);
  });
});

describe("the owner with the real identity coordinator", () => {
  function rig() {
    const reads: ReturnType<typeof deferred<SessionReadOutcome>>[] = [];
    const transports: ReturnType<typeof deferred<unknown>>[] = [];
    const login = vi.fn(() => {
      const d = deferred<unknown>();
      transports.push(d);
      return d.promise;
    });
    const guard: BookingIdentityGuard = { identityChangeBlockReason: () => null, scrubForIdentityChange: () => true };
    const coordinator = createCustomerIdentityCoordinator({
      session: {
        beginIdentityChange: () => true,
        read: () => {
          const d = deferred<SessionReadOutcome>();
          reads.push(d);
          return d.promise;
        },
        refresh: () => undefined,
      },
      login,
      logout: () => Promise.resolve(undefined),
    });
    coordinator.activate();
    coordinator.bindBooking(guard);
    return { coordinator, reads, transports, login };
  }
  const CREDENTIALS = { email: "bob@example.test", password: "Pa55 word!" };

  it("rapid submits cause exactly one transport call; the other is refused by the owner itself", async () => {
    const { coordinator, transports, login } = rig();
    const owner = createAuthSubmissionOwner();
    const onSettled = vi.fn();
    const started = [1, 2, 3].map(() => owner.run(() => coordinator.login(CREDENTIALS), onSettled));
    expect(started).toEqual([true, false, false]);
    expect(login).toHaveBeenCalledTimes(1);
    expect(transports).toHaveLength(1);
  });

  it("a 503 whose me then says authenticated is presented as lost + signed in; the login is not repeated", async () => {
    const { coordinator, reads, transports, login } = rig();
    const owner = createAuthSubmissionOwner();
    const seen: AuthUiResult[] = [];
    owner.run(() => coordinator.login(CREDENTIALS), (r) => seen.push(r));
    transports[0].reject(http(503));
    await settle();
    expect(coordinator.isIdentityChangeLocked()).toBe(true);
    reads[0].resolve("authenticated");
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ status: "settled", transport: "lost", session: "authenticated" });
    expect(loginSucceeded(seen[0])).toBe(false);
    const shown = presentIdentityCommandResult("login", seen[0], CTX, t);
    expect(shown?.tone).toBe("warning");
    expect(shown?.message).not.toContain("không đúng");
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("unmounting during the attempt neither redirects nor reports: the provider still verifies me", async () => {
    const { coordinator, reads, transports } = rig();
    const owner = createAuthSubmissionOwner();
    const onSettled = vi.fn();
    owner.run(() => coordinator.login(CREDENTIALS), onSettled);
    owner.dispose(); // the page was left
    transports[0].resolve(undefined);
    await settle();
    expect(coordinator.isIdentityChangeLocked()).toBe(true); // recovery went on without the page
    reads[0].resolve("authenticated");
    await settle();
    expect(coordinator.isIdentityChangeLocked()).toBe(false);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("after a failed me read the lock stays and the notice offers the check; a verified read clears it", async () => {
    const { coordinator, reads, transports } = rig();
    const owner = createAuthSubmissionOwner();
    const seen: AuthUiResult[] = [];
    owner.run(() => coordinator.login(CREDENTIALS), (r) => seen.push(r));
    transports[0].resolve(undefined);
    await settle();
    reads[0].resolve("unknown");
    await settle();
    expect(seen[0]).toMatchObject({ status: "recovery-unresolved", transport: "succeeded" });
    expect(describeSessionNotice("loading", coordinator.getState().phase, t)).toMatchObject({ kind: "unresolved", offerRefresh: true });
    coordinator.requestRefresh(); // the read-only check
    reads[1].resolve("anonymous");
    await settle();
    expect(coordinator.getState().phase).toBe("idle");
    expect(isStalePresentation(seen[0], coordinator.getState().phase, "idle")).toBe(true);
    expect(describeSessionNotice("anonymous", coordinator.getState().phase, t)).toBeNull();
    expect(transports).toHaveLength(1); // the login was never resent
  });
});

/* ------------------------------------------------------------------ closing the receipt */

describe("receiptCloseTarget + finishBooking", () => {
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
  const CONTACT = { fullName: "Jane Doe", email: "jane@example.com", phone: "+15551234567" };
  const HOLD = {
    holdId: "aaaaaaaa-0000-0000-0000-000000000001",
    status: "Active",
    ...OFFER,
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
    ...OFFER,
    fullName: CONTACT.fullName,
    email: CONTACT.email,
    phone: CONTACT.phone,
    currencyCode: "VND",
    totalAmount: 3000000,
    confirmedAtUtc: "2026-07-30T02:00:10.123Z",
    cancelledAtUtc: null,
    cancellationReason: null,
    nights: [],
  };

  async function toReceipt() {
    const { createBookingHoldFlowController } = await import("@/lib/api/bookingHoldFlowController");
    let state: BookingHoldFlowState = initialBookingHoldFlowState;
    const queue: BookingHoldFlowAction[] = [];
    const commit = () => {
      while (queue.length) state = bookingHoldFlowReducer(state, queue.shift() as BookingHoldFlowAction);
    };
    let locked = false;
    const booking = createBookingHoldFlowController({
      getState: () => state,
      dispatch: (action) => queue.push(action),
      isIdentityChangeLocked: () => locked,
    });
    booking.selectOffer(OFFER, "label");
    commit();
    booking.updateContact(CONTACT);
    commit();
    createBookingHoldMock.mockResolvedValueOnce({ hold: HOLD, outcome: "created" });
    booking.submit();
    await settle();
    commit();
    expect(receiptCloseTarget(state)).toBeNull(); // an active hold has no receipt to close
    confirmBookingHoldMock.mockResolvedValueOnce({ reservation: RESERVATION, outcome: "confirmed" });
    booking.confirmHold();
    await settle();
    commit();
    return { booking, commit, getState: () => state, lock: (value: boolean) => (locked = value) };
  }

  it("only a confirmed receipt has a target; its id goes to finishBooking, which scrubs without any HTTP", async () => {
    const rig = await toReceipt();
    const target = receiptCloseTarget(rig.getState());
    expect(target).toBe(RESERVATION.reservationId);
    createBookingHoldMock.mockClear();
    confirmBookingHoldMock.mockClear();
    expect(rig.booking.finishBooking(target as string)).toBe(true);
    rig.commit();
    expect(rig.getState().phase).toBe("idle");
    expect(JSON.stringify(rig.getState())).not.toContain(CONTACT.email);
    expect(receiptCloseTarget(rig.getState())).toBeNull();
    expect(createBookingHoldMock).not.toHaveBeenCalled();
    expect(confirmBookingHoldMock).not.toHaveBeenCalled();
  });

  it("a stale id (the receipt changed since the dialog opened) or an identity change in flight is refused and keeps the receipt", async () => {
    const rig = await toReceipt();
    expect(rig.booking.finishBooking("bbbbbbbb-0000-0000-0000-00000000dead")).toBe(false);
    rig.lock(true);
    expect(rig.booking.finishBooking(RESERVATION.reservationId)).toBe(false);
    rig.commit();
    expect(rig.getState().phase).toBe("reservation-result");
    expect(t(receiptCloseFailureMessage("idle"))).toContain("đã thay đổi");
    expect(t(receiptCloseFailureMessage("recovering"))).toContain("Phiên đăng nhập");
  });
});
