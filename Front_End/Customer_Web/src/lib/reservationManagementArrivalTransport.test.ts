import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiHttpError, ApiNetworkError } from "@/lib/api/errors";

// BHA-CHECKOUT-001-PR09-C3: the controller on the REAL service and the REAL CSRF helper; only the HTTP client is replaced, so what reaches the transport is counted.
const apiGetMock = vi.fn();
const apiUnsafeRequestMock = vi.fn();
vi.mock("@/lib/api/httpClient", () => ({
  apiGet: (...a: unknown[]) => apiGetMock(...a),
  apiUnsafeRequest: (...a: unknown[]) => apiUnsafeRequestMock(...a),
  mergeHeaders: (h: Record<string, string>) => h,
  isRequestCancelledError: () => false,
}));

import { resetCsrfStateForTests } from "@/lib/api/csrf";
import { exchangeManagementLink, exchangeOnce, readManagedReservation, updateEstimatedArrival, whenExchangeSettled } from "@/lib/api/reservationManagementService";
import { MANAGE, createReservationManagementController, type ManageContext } from "./reservationManagement";

const ID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
const DTO = {
  reservationId: ID, confirmationNumber: "BHA-1", status: "Confirmed", propertyId: "p", roomTypeId: "r", ratePlanId: "p", fullName: "Jane Doe", checkIn: "2026-12-01", checkOut: "2026-12-03",
  adults: 2, children: 0, rooms: 1, currencyCode: "VND", totalAmount: 3000000, confirmedAtUtc: "2026-11-25T02:00:00Z", cancelledAtUtc: null, cancellationReason: null, nights: [],
  paymentMethod: "PayAtProperty", ledgerState: "Recorded", receivableAmount: 3000000, collectedAmount: 0, balanceDueAmount: 3000000, propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
};
const POST = `/api/v1/reservations/${ID}/manage/estimated-arrival`;
const calls = (mock: ReturnType<typeof vi.fn>, path: string) => mock.mock.calls.filter((c) => c[0] === path).length;
const MANAGE_PATH = `/api/v1/reservations/${ID}/manage`;

beforeEach(() => { apiGetMock.mockReset(); apiUnsafeRequestMock.mockReset(); resetCsrfStateForTests(); });

describe("the arrival update when the CSRF token cannot be read (PR09-C3 P2-2)", () => {
  it("sends 0 POSTs and no verifying GET; the next Save, once a token is read, sends exactly one POST", async () => {
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === MANAGE_PATH) return DTO;
      throw new ApiNetworkError(); // the CSRF token request fails
    });
    const controller = createReservationManagementController({
      exchange: async () => {}, whenExchangeSettled: async () => {}, requestSessionRefresh: () => {}, verifySession: async () => null,
      read: (id, signal) => readManagedReservation(id, { signal }), update: updateEstimatedArrival,
    });
    controller.bind({ reservationId: ID, identityKey: "guest" });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(controller.getState().save).toEqual({ status: "error", messageKey: MANAGE.etaNotSent }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(0);
    expect(calls(apiGetMock, MANAGE_PATH)).toBe(1); // the load only: no verifying GET

    apiGetMock.mockImplementation(async (path: string) => (path === MANAGE_PATH ? DTO : { token: "t", headerName: "X-CSRF-TOKEN" }));
    apiUnsafeRequestMock.mockResolvedValue({ status: 200, data: { ...DTO, estimatedArrival: { arrivalDate: "2026-12-02", arrivalTime: "09:00", timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" } } });
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(controller.getState().save).toEqual({ status: "saved" }));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
    expect(calls(apiGetMock, MANAGE_PATH)).toBe(1);
  });
});

// BHA-CHECKOUT-001-PR09-C11: coming back to the tab revalidates; an arrival update that is still waiting for its CSRF token belongs to the view that is being revalidated, so it is not
// sent (the C5 rule: a superseded view sends nothing). Disclosed as a limit: the visitor's Save disappears and the form is rebuilt from the fresh read.
describe("revalidate while an arrival update waits for its CSRF token (PR09-C11)", () => {
  it("0 POSTs: the not-yet-sent update is dropped, the view is rebuilt from a fresh read, and the visitor can save again", async () => {
    let release!: (value: unknown) => void;
    const token = new Promise((resolve) => { release = resolve; });
    apiGetMock.mockImplementation(async (path: string) => (path === MANAGE_PATH ? DTO : token));
    apiUnsafeRequestMock.mockImplementation(async (_path: string, _method: string, body: { arrivalDate: string; arrivalTime: string }) => ({
      status: 200, data: { ...DTO, estimatedArrival: { arrivalDate: body.arrivalDate, arrivalTime: body.arrivalTime, timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" } },
    }));
    const controller = createReservationManagementController({
      exchange: async () => {}, whenExchangeSettled: async () => {}, requestSessionRefresh: () => {}, verifySession: async () => "guest",
      read: (id, signal) => readManagedReservation(id, { signal }), update: updateEstimatedArrival,
    });
    controller.bind({ reservationId: ID, identityKey: "guest" });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(calls(apiGetMock, "/api/v1/auth/csrf")).toBe(1)); // the update waits for its token
    controller.revalidate();
    release({ token: "t", headerName: "X-CSRF-TOKEN" });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(0);
    controller.verifySave(); // "Check again" if the form was shut by the hold, a read only
    await new Promise((r) => setTimeout(r, 0));
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(controller.getState().save).toEqual({ status: "saved" }));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
  });
});

// BHA-CHECKOUT-001-PR09-C10 P3: the REAL controller, service and CSRF helper; only the HTTP client is replaced. A 200 that does not carry the arrival that was sent is an unusable
// answer: the result is unknown, the form stays shut, nothing is replayed, and a read that shows the submitted value still does not say "saved".
describe("a 200 for the arrival update that does not carry the submitted arrival (PR09-C10 P3)", () => {
  const eta = (date: string, time: string) => ({ arrivalDate: date, arrivalTime: time, timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" });
  const variants: [string, Record<string, unknown>][] = [
    ["a null estimate", { ...DTO, estimatedArrival: null }],
    ["a missing estimate", (({ estimatedArrival: _omitted, ...rest }) => rest)(DTO)],
    ["another date", { ...DTO, estimatedArrival: eta("2026-12-01", "09:00") }],
    ["another time", { ...DTO, estimatedArrival: eta("2026-12-02", "09:30") }],
  ];

  it.each(variants)("%s: unverified, the form stays shut, 1 POST in total, and a matching read does not confirm", async (_name, body) => {
    apiGetMock.mockImplementation(async (path: string) => (path === MANAGE_PATH ? { ...DTO, estimatedArrival: eta("2026-12-02", "09:00") } : { token: "t", headerName: "X-CSRF-TOKEN" }));
    apiUnsafeRequestMock.mockResolvedValue({ status: 200, data: body }); // a 200 of the wrong contract: a fixture, not the real API
    const controller = createReservationManagementController({
      exchange: async () => {}, whenExchangeSettled: async () => {}, requestSessionRefresh: () => {}, verifySession: async () => null,
      read: (id, signal) => readManagedReservation(id, { signal }), update: updateEstimatedArrival,
    });
    controller.bind({ reservationId: ID, identityKey: "guest" });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(controller.getState().save).toEqual({ status: "unverified" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getState().save).not.toEqual({ status: "saved" });
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "10:00" }); // the form is shut: nothing is sent
    controller.verifySave(); // "Check again" is a read: it never says saved and never reopens the form while the update is unsettled
    await new Promise((r) => setTimeout(r, 0));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
    expect(controller.getState().save).toEqual({ status: "unverified" });
  });

  it("control: a matching 200 is still 'saved', with exactly one POST", async () => {
    apiGetMock.mockImplementation(async (path: string) => (path === MANAGE_PATH ? DTO : { token: "t", headerName: "X-CSRF-TOKEN" }));
    apiUnsafeRequestMock.mockResolvedValue({ status: 200, data: { ...DTO, estimatedArrival: eta("2026-12-02", "09:00") } });
    const controller = createReservationManagementController({
      exchange: async () => {}, whenExchangeSettled: async () => {}, requestSessionRefresh: () => {}, verifySession: async () => null,
      read: (id, signal) => readManagedReservation(id, { signal }), update: updateEstimatedArrival,
    });
    controller.bind({ reservationId: ID, identityKey: "guest" });
    await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
    controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: "09:00" });
    await vi.waitFor(() => expect(controller.getState().save).toEqual({ status: "saved" }));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
  });
});

// BHA-CHECKOUT-001-PR09-C5 P2-2: the REAL controller, service and CSRF helper; only the HTTP client is replaced. A POST that waits for its CSRF token is handed to the
// transport only if the view that started it is still the current one.
describe("a POST that waits for its CSRF token when the view changes (PR09-C5 P2-2)", () => {
  const CSRF = "/api/v1/auth/csrf";
  const EXCHANGE = `${MANAGE_PATH}/exchange`;
  const SECRET = "Zq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwabc";
  const GUEST: ManageContext = { reservationId: ID, identityKey: "guest" };
  const OWNER: ManageContext = { reservationId: ID, identityKey: "customer:aaaa" };
  const TOKEN = { token: "t", headerName: "X-CSRF-TOKEN" };
  const SAVED = { ...DTO, estimatedArrival: { arrivalDate: "2026-12-02", arrivalTime: "09:00", timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" } };

  /** The token request is held until the test releases it. */
  function rig(options: { guestWithoutSession?: boolean } = {}) {
    let release!: (value: unknown) => void;
    const token = new Promise((resolve) => { release = resolve; });
    // Like the API: a guest has no management session until the exchange succeeded, and says so (PR09-C8: the page asks before it spends the link).
    let session = !options.guestWithoutSession;
    let account: "none" | "owner" | "stranger" = "none"; // "owner" reads its own booking; "stranger" is signed in but has no access yet (the API answers 404 reservation.not-found)
    let expiredCookie = false; // the browser still carries a customer cookie that no longer validates
    apiGetMock.mockImplementation(async (path: string) => {
      if (path !== MANAGE_PATH) return token;
      if (expiredCookie) throw new ApiHttpError(401, { title: "t", status: 401, code: "auth.session-invalid" });
      if (account === "stranger" && !session) throw new ApiHttpError(404, { title: "t", status: 404, code: "reservation.not-found" });
      if (!session && account !== "owner") throw new ApiHttpError(401, { title: "t", status: 401, code: "reservation.manage-session-invalid" });
      return DTO;
    });
    // Like the API, the update answers the reservation with the arrival that was sent.
    apiUnsafeRequestMock.mockImplementation(async (path: string, _method: string, body: { arrivalDate?: string; arrivalTime?: string }) =>
      path === EXCHANGE
        ? (session = true, { status: 200, data: { reservationId: ID, expiresAtUtc: "x" } })
        : { status: 200, data: { ...DTO, estimatedArrival: { ...SAVED.estimatedArrival, arrivalDate: body.arrivalDate, arrivalTime: body.arrivalTime } } }
    );
    const controller = createReservationManagementController({
      exchange: (rid, tok, stillCurrent) => exchangeOnce(rid, tok, (id, t) => exchangeManagementLink(id, t, stillCurrent)),
      whenExchangeSettled,
      requestSessionRefresh: () => {}, verifySession: async () => null,
      read: (id, signal) => readManagedReservation(id, { signal }),
      update: updateEstimatedArrival,
    });
    return {
      controller,
      releaseToken: () => release(TOKEN),
      signInAccount: (as: "owner" | "stranger" = "owner") => { account = as; },
      loseSession: () => { session = false; },
      setExpiredCookie: (value: boolean) => { expiredCookie = value; },
      get state() { return controller.getState(); },
    };
  }
  const ready = async (r: ReturnType<typeof rig>, ctx: ManageContext = GUEST) => {
    r.controller.bind(ctx);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
  };
  const save = (r: ReturnType<typeof rig>, time = "09:00") => r.controller.submitArrival({ arrivalDate: "2026-12-02", arrivalTime: time });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("control: the view is still the same when the token arrives: exactly one POST", async () => {
    const r = rig();
    await ready(r);
    save(r);
    r.releaseToken();
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
  });

  it("the visitor changed account while the token was being read: 0 POSTs; the new view shows no error from it, is free to save, and sends one POST when it does", async () => {
    const r = rig();
    await ready(r);
    save(r);
    r.controller.bind(OWNER);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: OWNER }));
    r.releaseToken();
    await flush();
    expect(calls(apiUnsafeRequestMock, POST)).toBe(0);
    expect(r.state).toMatchObject({ phase: "ready", bound: OWNER, save: { status: "idle" } }); // nothing from the old operation
    save(r, "10:00");
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
  });

  it("the visitor left the page while the token was being read: 0 POSTs", async () => {
    const r = rig();
    await ready(r);
    save(r);
    r.controller.dispose();
    r.releaseToken();
    await flush();
    expect(calls(apiUnsafeRequestMock, POST)).toBe(0);
  });

  it("another reservation: 0 POSTs for the old one", async () => {
    const r = rig();
    await ready(r);
    save(r);
    r.controller.bind({ reservationId: "11111111-2222-4333-8444-555555555555", identityKey: "guest" });
    r.releaseToken();
    await flush();
    expect(apiUnsafeRequestMock.mock.calls.filter((c) => String(c[0]).endsWith("/estimated-arrival"))).toHaveLength(0);
  });

  it("a session recheck (loading, then the same account): the old operation is not sent; its hold is released, so one Check again later the form is open", async () => {
    const r = rig();
    await ready(r);
    save(r);
    r.controller.bind({ reservationId: ID, identityKey: null });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    r.releaseToken();
    await flush();
    expect(calls(apiUnsafeRequestMock, POST)).toBe(0);
    expect(r.state.save).toEqual({ status: "unverified" }); // this view's read began while the operation was unsettled
    r.controller.verifySave(); // a read that begins after the operation was settled (never sent)
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "idle" }));
    save(r, "10:00");
    await vi.waitFor(() => expect(r.state.save).toEqual({ status: "saved" }));
    expect(calls(apiUnsafeRequestMock, POST)).toBe(1);
  });

  it("the link exchange: the visitor changed account while the token was being read: 0 exchange POSTs, no failure shown to the new view; opening the link again sends exactly one", async () => {
    const r = rig({ guestWithoutSession: true });
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(calls(apiGetMock, CSRF)).toBe(1)); // the exchange is waiting for its token
    r.signInAccount();
    r.controller.bind(OWNER);
    r.releaseToken();
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    await vi.waitFor(() => expect(r.state).toMatchObject({ bound: OWNER, phase: "ready" }));
    expect(JSON.stringify(r.state)).not.toContain(SECRET);

    r.signInAccount("stranger"); // a signed-in account with no access yet: the API says 404 reservation.not-found, and only then is the link exchanged
    r.controller.openLink({ kind: "token", token: SECRET });
    await vi.waitFor(() => expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1));
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
    expect(apiUnsafeRequestMock.mock.calls.filter((c) => c[0] === EXCHANGE)[0][2]).toEqual({ token: SECRET });
  });

  it("the link exchange with the view unchanged: exactly one exchange POST (control), and C4's same-tab reopen still sends one more", async () => {
    const r = rig({ guestWithoutSession: true });
    r.releaseToken();
    r.controller.offerLink({ kind: "token", token: SECRET });
    await ready(r);
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1);
    r.loseSession(); // the management session is gone (cleared cookies, a private window): the server says so, and the link is exchanged
    r.controller.openLink({ kind: "token", token: SECRET });
    await vi.waitFor(() => expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(2));
    await vi.waitFor(() => expect(r.state.phase).toBe("ready"));
  });

  it("PR09-C8: an expired customer cookie: the guest's link is not sent (0 exchange POSTs, the CSRF token is not even requested); once the cookie is gone the same link is exchanged exactly once and the booking is read", async () => {
    const r = rig({ guestWithoutSession: true });
    r.releaseToken();
    r.setExpiredCookie(true);
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "link-session-expired" }));
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    expect(calls(apiGetMock, CSRF)).toBe(0);
    expect(JSON.stringify(r.state)).not.toContain(SECRET);

    r.setExpiredCookie(false); // a private window / a clean browser: no customer cookie, no management session
    r.controller.openLink({ kind: "token", token: SECRET });
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1);
    expect(apiUnsafeRequestMock.mock.calls.find((c) => c[0] === EXCHANGE)?.[2]).toEqual({ token: SECRET });
  });

  it("PR09-C8: a booking the browser may already read is shown and the link is not spent", async () => {
    const r = rig(); // the guest already holds a management session
    r.releaseToken();
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    expect(calls(apiGetMock, CSRF)).toBe(0);
  });

  it("PR09-C9: a signed-in visitor who can already read the booking: shown, 0 exchange POSTs, the CSRF token is not requested; a signed-in account with no access yet (404): exactly one POST", async () => {
    const owner = rig({ guestWithoutSession: true });
    owner.releaseToken();
    owner.signInAccount("owner");
    owner.controller.offerLink({ kind: "token", token: SECRET });
    owner.controller.bind(OWNER);
    await vi.waitFor(() => expect(owner.state).toMatchObject({ phase: "ready", bound: OWNER }));
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    expect(calls(apiGetMock, CSRF)).toBe(0);

    apiGetMock.mockReset(); apiUnsafeRequestMock.mockReset();
    const stranger = rig({ guestWithoutSession: true });
    stranger.releaseToken();
    stranger.signInAccount("stranger");
    stranger.controller.offerLink({ kind: "token", token: SECRET });
    stranger.controller.bind(OWNER);
    await vi.waitFor(() => expect(stranger.state).toMatchObject({ phase: "ready", bound: OWNER }));
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1);
    expect(apiUnsafeRequestMock.mock.calls.find((c) => c[0] === EXCHANGE)?.[2]).toEqual({ token: SECRET });
  });
});

// BHA-CHECKOUT-001-PR09-C13: the REAL controller, service, registry and CSRF helper; only the HTTP client is replaced. A return to the tab while the exchange has NOT been handed to the
// transport (it waits for its CSRF token) invalidates that attempt and reruns the open's read; a POST that was already handed over is left alone.
describe("a return to the tab while the exchange POST has not been sent (PR09-C13)", () => {
  const CSRF = "/api/v1/auth/csrf";
  const EXCHANGE = `${MANAGE_PATH}/exchange`;
  const SECRET = "Zq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwabc";
  const GUEST: ManageContext = { reservationId: ID, identityKey: "guest" };
  const OWNER: ManageContext = { reservationId: ID, identityKey: "customer:aaaa" };
  const TOKEN = { token: "t", headerName: "X-CSRF-TOKEN" };
  const NO_SESSION = new ApiHttpError(401, { title: "t", status: 401, code: "reservation.manage-session-invalid" });
  const NOT_FOUND = new ApiHttpError(404, { title: "t", status: 404, code: "reservation.not-found" });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function rig() {
    let releaseToken!: (value: unknown) => void;
    const token = new Promise((resolve) => { releaseToken = resolve; });
    let postAnswer!: (value: unknown) => void;
    const postResponse = new Promise((resolve) => { postAnswer = resolve; });
    let holdPost = false;
    /** What the API answers the next reads of /manage with: a function of the identity script of the test. */
    let answer: () => unknown = () => { throw NO_SESSION; };
    let manageGets = 0;
    apiGetMock.mockImplementation(async (path: string) => {
      if (path !== MANAGE_PATH) return token; // the CSRF token request: held until the test releases it
      manageGets += 1;
      return answer();
    });
    apiUnsafeRequestMock.mockImplementation(async (path: string) => {
      if (path !== EXCHANGE) throw new Error("unexpected POST");
      answer = () => DTO; // the link was consumed: the browser now holds the management session
      if (holdPost) await postResponse;
      return { status: 200, data: { reservationId: ID, expiresAtUtc: "x" } };
    });
    let verified: string | null = "guest";
    const verifySession = vi.fn(async () => verified);
    const controller = createReservationManagementController({
      exchange: (rid, tok, stillCurrent, onHandedOver) => exchangeOnce(rid, tok, exchangeManagementLink, stillCurrent, onHandedOver),
      whenExchangeSettled,
      requestSessionRefresh: () => {}, verifySession,
      read: (id, signal) => readManagedReservation(id, { signal }),
      update: updateEstimatedArrival,
    });
    return {
      controller, verifySession,
      releaseToken: () => releaseToken(TOKEN),
      answerPost: () => postAnswer(undefined),
      holdThePost: () => { holdPost = true; },
      /** What the API answers /manage with from now on. */
      serverAnswers: (next: () => unknown) => { answer = next; },
      setVerified: (next: string | null) => { verified = next; },
      get manageGets() { return manageGets; },
      get state() { return controller.getState(); },
    };
  }
  /** A guest opens the link: the preflight GET is refused (no session yet), the exchange waits for its CSRF token. */
  async function exchangeWaitingForToken(r: ReturnType<typeof rig>, ctx: ManageContext = GUEST) {
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(ctx);
    await vi.waitFor(() => expect(calls(apiGetMock, CSRF)).toBe(1));
    expect(r.state.phase).toBe("exchanging");
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
  }
  /** The tab comes back: window focus and visibilitychange, as the page fires them (the second finds the view loading and does nothing). */
  const comeBack = (r: ReturnType<typeof rig>) => { r.controller.revalidate(); r.controller.revalidate(); };

  it("the booking became readable before the return: the fresh GET shows it at once (not stuck behind the unsent attempt), and the old attempt, released later, sends 0 POSTs", async () => {
    const r = rig();
    await exchangeWaitingForToken(r);
    r.serverAnswers(() => DTO); // e.g. another tab opened a link of this booking / signed in as its owner
    comeBack(r);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(r.manageGets).toBe(2); // the preflight and the fresh one, in that order
    expect(r.verifySession).toHaveBeenCalledTimes(1);
    r.releaseToken(); // the CSRF response of the superseded attempt arrives
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    expect(r.state).toMatchObject({ phase: "ready", failure: null });
    expect(JSON.stringify(r.state)).not.toContain(SECRET);
  });

  it("the CSRF response of the superseded attempt arrives right after the return, before anything else: 0 POSTs although the booking is already readable (START_HEAD sent 1)", async () => {
    const r = rig();
    await exchangeWaitingForToken(r);
    r.serverAnswers(() => DTO);
    comeBack(r);
    r.releaseToken(); // the held response is released while the verification and the fresh GET are still on their way
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
  });

  it("the fresh GET still allows the exchange: the whole open sends exactly one POST (the new attempt, released with the same CSRF response), then the booking is read", async () => {
    const r = rig();
    await exchangeWaitingForToken(r);
    comeBack(r); // nothing changed: the API still says "no access yet"
    await vi.waitFor(() => expect(r.manageGets).toBe(2));
    await vi.waitFor(() => expect(r.state.phase).toBe("exchanging"));
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    r.releaseToken(); // one response settles both attempts: the old one is superseded, the new one is handed over
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1);
    expect(apiUnsafeRequestMock.mock.calls.find((c) => c[0] === EXCHANGE)?.[2]).toEqual({ token: SECRET });
    expect(calls(apiGetMock, CSRF)).toBe(1); // the token was read once; the return did not ask for another
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1);
  });

  it("control: the POST was handed over before the return: not cancelled, not replayed, no second read; the page settles when the POST answers", async () => {
    const r = rig();
    r.holdThePost();
    await exchangeWaitingForToken(r);
    r.releaseToken();
    await vi.waitFor(() => expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1)); // handed over, unanswered
    const getsBefore = r.manageGets;
    comeBack(r);
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1);
    expect(r.manageGets).toBe(getsBefore); // no read of the return, no takeover
    expect(r.verifySession).not.toHaveBeenCalled();
    expect(r.state.phase).toBe("exchanging");
    r.answerPost();
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(1);
  });

  it("the identity changed while the exchange waited: the token goes to the bind of that identity, whose fresh GET decides; the old attempt sends 0 POSTs", async () => {
    const r = rig();
    await exchangeWaitingForToken(r);
    r.setVerified("customer:aaaa"); // another tab signed in as the booking's owner
    r.serverAnswers(() => DTO);
    comeBack(r);
    await vi.waitFor(() => expect(r.verifySession).toHaveBeenCalledTimes(1));
    r.controller.bind(OWNER); // the provider re-binds the page to the verified identity
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: OWNER }));
    r.releaseToken();
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
  });

  it("a verification that fails after the return: the open stops with the link not sent, 0 POSTs, no token left", async () => {
    const r = rig();
    await exchangeWaitingForToken(r);
    r.setVerified(null);
    comeBack(r);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "link-not-sent" }));
    r.releaseToken();
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    expect(JSON.stringify(r.state)).not.toContain(SECRET);
  });

  it("the open's one session re-check is kept: re-check used, then exchanging, then a return and the same contradiction again stops it (0 POSTs, two verifications in all)", async () => {
    const r = rig();
    // A guest tab whose identity is stale: the API answers 404 (the browser is signed in as a stranger). The one re-check verifies that account, the page re-binds to it.
    r.serverAnswers(() => { throw NOT_FOUND; });
    r.setVerified("customer:aaaa");
    r.controller.offerLink({ kind: "token", token: SECRET });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(r.verifySession).toHaveBeenCalledTimes(1));
    r.controller.bind(OWNER);
    await vi.waitFor(() => expect(calls(apiGetMock, CSRF)).toBe(1)); // as the account: 404 reservation.not-found → the exchange waits for its token
    expect(r.state.phase).toBe("exchanging");
    r.serverAnswers(() => { throw NO_SESSION; }); // after the return the API contradicts the account again (it sees a guest)
    comeBack(r);
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "failed", failure: "no-access" }));
    expect(r.verifySession).toHaveBeenCalledTimes(2); // the re-check, and the return's verification: no second re-check
    r.releaseToken();
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
  });
});

// BHA-CHECKOUT-001-PR09-C14: a NEW link opened in the same tab (the page's hashchange -> openLink) while the earlier open's exchange has not handed its POST to the transport. Same real
// controller, service, registry and CSRF helper as C13; only the HTTP client is replaced. Synthetic links A and B (distinct secrets); the POST body says which of them was sent.
describe("a second link opened in the same tab before the first exchange POST was sent (PR09-C14)", () => {
  const CSRF = "/api/v1/auth/csrf";
  const EXCHANGE = `${MANAGE_PATH}/exchange`;
  const LINK_A = "AaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaaaa";
  const LINK_B = "BbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbbbb";
  const LINK_C = "CcccCcccCcccCcccCcccCcccCcccCcccCcccCcccccc";
  const GUEST: ManageContext = { reservationId: ID, identityKey: "guest" };
  const NO_SESSION = new ApiHttpError(401, { title: "t", status: 401, code: "reservation.manage-session-invalid" });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const sentTokens = () => apiUnsafeRequestMock.mock.calls.filter((c) => c[0] === EXCHANGE).map((c) => (c[2] as { token: string }).token);
  // The exchange registry lives at module scope: whatever a test leaves waiting (a held CSRF response, a held POST) is released after it, so a failing test cannot leak a live entry into the next.
  const settleLater: Array<() => void> = [];
  afterEach(async () => {
    settleLater.splice(0).forEach((settle) => settle());
    await flush();
  });

  function rig() {
    let releaseToken!: (value: unknown) => void;
    const token = new Promise((resolve) => { releaseToken = resolve; });
    let postAnswer!: (value: unknown) => void;
    const postResponse = new Promise((resolve) => { postAnswer = resolve; });
    let holdPost = false;
    let answer: () => unknown = () => { throw NO_SESSION; };
    let manageGets = 0;
    let postsInFlight = 0;
    let maxPostsInFlight = 0;
    apiGetMock.mockImplementation(async (path: string) => {
      if (path !== MANAGE_PATH) return token; // the CSRF token request: held until the test releases it
      manageGets += 1;
      return answer();
    });
    apiUnsafeRequestMock.mockImplementation(async (path: string) => {
      if (path !== EXCHANGE) throw new Error("unexpected POST");
      postsInFlight += 1;
      maxPostsInFlight = Math.max(maxPostsInFlight, postsInFlight);
      answer = () => DTO; // the link was consumed: the browser now holds the management session
      try {
        if (holdPost) await postResponse;
        return { status: 200, data: { reservationId: ID, expiresAtUtc: "x" } };
      } finally { postsInFlight -= 1; }
    });
    const controller = createReservationManagementController({
      exchange: (rid, tok, stillCurrent, onHandedOver) => exchangeOnce(rid, tok, exchangeManagementLink, stillCurrent, onHandedOver),
      whenExchangeSettled,
      requestSessionRefresh: () => {}, verifySession: async () => "guest",
      read: (id, signal) => readManagedReservation(id, { signal }),
      update: updateEstimatedArrival,
    });
    settleLater.push(() => { controller.dispose(); releaseToken({ token: "t", headerName: "X-CSRF-TOKEN" }); postAnswer(undefined); });
    return {
      controller,
      releaseToken: () => releaseToken({ token: "t", headerName: "X-CSRF-TOKEN" }),
      answerPost: () => postAnswer(undefined),
      holdThePost: () => { holdPost = true; },
      serverAnswers: (next: () => unknown) => { answer = next; },
      get manageGets() { return manageGets; },
      get maxPostsInFlight() { return maxPostsInFlight; },
      get state() { return controller.getState(); },
    };
  }
  /** The page opened link A in a clean browser: the preflight GET is refused (no session yet), the exchange waits for its CSRF token. */
  async function openAWaitingForToken(r: ReturnType<typeof rig>) {
    r.controller.offerLink({ kind: "token", token: LINK_A });
    r.controller.bind(GUEST);
    await vi.waitFor(() => expect(calls(apiGetMock, CSRF)).toBe(1));
    expect(r.state.phase).toBe("exchanging");
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
  }
  const openWhenReady = async (r: ReturnType<typeof rig>, token: string, gets: number) => {
    r.controller.openLink({ kind: "token", token });
    await vi.waitFor(() => expect(r.manageGets).toBe(gets)); // the new open's own preflight GET
    await vi.waitFor(() => expect(r.state.phase).toBe("exchanging"));
  };

  it("open A, hold the CSRF response, open B in the same tab, release: 0 POSTs for A, exactly 1 for B, then the booking is read (START_HEAD dropped B and A failed as expired)", async () => {
    const r = rig();
    await openAWaitingForToken(r);
    await openWhenReady(r, LINK_B, 2);
    r.releaseToken(); // one response: A's attempt is superseded, B's is handed over
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(sentTokens()).toEqual([LINK_B]);
    expect(r.maxPostsInFlight).toBe(1);
    expect(r.manageGets).toBe(3); // A's preflight, B's preflight, the read after B's exchange: A's late cleanup read nothing and failed nothing
    await flush();
    expect(sentTokens()).toEqual([LINK_B]);
    expect(r.state).toMatchObject({ phase: "ready", failure: null });
    expect(JSON.stringify(r.state)).not.toContain(LINK_A);
    expect(JSON.stringify(r.state)).not.toContain(LINK_B);
  });

  it("B's preflight GET answers 200 (the booking is readable): B shows it and sends no POST; A, released later, sends none either", async () => {
    const r = rig();
    await openAWaitingForToken(r);
    r.serverAnswers(() => DTO); // e.g. another tab opened a link of this booking
    r.controller.openLink({ kind: "token", token: LINK_B });
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    expect(r.manageGets).toBe(2);
    r.releaseToken();
    await flush();
    expect(calls(apiUnsafeRequestMock, EXCHANGE)).toBe(0);
    expect(r.state).toMatchObject({ phase: "ready", failure: null });
  });

  it("control: A's POST was already handed to the transport: B is not queued, A is not cancelled or replayed, there is never a second POST; A's answer settles the page", async () => {
    const r = rig();
    r.holdThePost();
    await openAWaitingForToken(r);
    r.releaseToken();
    await vi.waitFor(() => expect(sentTokens()).toEqual([LINK_A])); // handed over, unanswered
    const getsBefore = r.manageGets;
    r.controller.openLink({ kind: "token", token: LINK_B }); // the page removed B from the address bar; the controller leaves the exchange that is out alone
    await flush();
    expect(sentTokens()).toEqual([LINK_A]);
    expect(r.manageGets).toBe(getsBefore);
    expect(r.state.phase).toBe("exchanging");
    r.answerPost();
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    await flush();
    expect(sentTokens()).toEqual([LINK_A]); // B was not kept to be sent later
    expect(r.maxPostsInFlight).toBe(1);
    expect(JSON.stringify(r.state)).not.toContain(LINK_B);
  });

  it("open A, then B, then C while the CSRF response is held: only C is ever sent, once", async () => {
    const r = rig();
    await openAWaitingForToken(r);
    await openWhenReady(r, LINK_B, 2);
    await openWhenReady(r, LINK_C, 3);
    r.releaseToken();
    await vi.waitFor(() => expect(r.state).toMatchObject({ phase: "ready", bound: GUEST }));
    await flush();
    expect(sentTokens()).toEqual([LINK_C]);
    expect(r.maxPostsInFlight).toBe(1);
  });
});
