import { beforeEach, describe, expect, it, vi } from "vitest";
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
      exchange: async () => {}, whenExchangeSettled: async () => {}, requestSessionRefresh: () => {},
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
    apiUnsafeRequestMock.mockImplementation(async (path: string) => (path === EXCHANGE ? (session = true, { status: 200, data: { reservationId: ID, expiresAtUtc: "x" } }) : { status: 200, data: SAVED }));
    const controller = createReservationManagementController({
      exchange: (rid, tok, stillCurrent) => exchangeOnce(rid, tok, (id, t) => exchangeManagementLink(id, t, stillCurrent)),
      whenExchangeSettled,
      requestSessionRefresh: () => {},
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
