import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountMiniDom, type MiniDom } from "./reactDomTestkit";

// BHA-CHECKOUT-001-PR09-C11. The REAL page, the REAL `CustomerSessionProvider` (session controller and identity coordinator), controller, service and CSRF helper, mounted with
// react-dom/client; only the HTTP client, the router, the catalog and the i18n snapshot are replaced. A small fake API plays two tabs of one browser: `cookie` is what the browser
// holds (shared by both tabs), and each response is held by a deferred gate when a test wants a request to stay out.
const apiGetMock = vi.fn();
const apiUnsafeRequestMock = vi.fn();
vi.hoisted(() => { (globalThis as Record<string, unknown>).window ??= {}; });
vi.mock("@/lib/api/httpClient", () => ({
  apiGet: (...a: unknown[]) => apiGetMock(...a),
  apiUnsafeRequest: (...a: unknown[]) => apiUnsafeRequestMock(...a),
  mergeHeaders: (h: Record<string, string>) => h,
  isRequestCancelledError: () => false,
}));
const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: (props: { href: string; children?: React.ReactNode }) => React.createElement("a", { href: String(props.href) }, props.children) }));
vi.mock("@/components/StaySearchProvider", () => ({ useStaySearch: () => null }));

import { ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { resetCsrfStateForTests } from "@/lib/api/csrf";
import { loadPack, withI18n } from "@/lib/i18n/testkit";
import { CustomerSessionProvider } from "../app/CustomerSessionProvider";
import ManageReservation from "../app/reservations/[reservationId]/manage/ManageReservation";

const ID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
const SECRET = "Zq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwabc";
const ACCOUNT_X = "aaaaaaaa-0000-4000-8000-000000000001";
const ACCOUNT_Y = "bbbbbbbb-0000-4000-8000-000000000002";
const MANAGE_PATH = `/api/v1/reservations/${ID}/manage`;
const EXCHANGE = `${MANAGE_PATH}/exchange`;
const ME = "/api/v1/auth/me";
const CSRF = "/api/v1/auth/csrf";
const dto = (confirmationNumber: string) => ({
  reservationId: ID, confirmationNumber, status: "Confirmed", propertyId: "p", roomTypeId: "r", ratePlanId: "p", fullName: "Jane Doe", checkIn: "2026-12-01", checkOut: "2026-12-03",
  adults: 2, children: 0, rooms: 1, currencyCode: "VND", totalAmount: 3000000, confirmedAtUtc: "2026-11-25T02:00:00Z", cancelledAtUtc: null, cancellationReason: null, nights: [],
  paymentMethod: "PayAtProperty", ledgerState: "Recorded", receivableAmount: 3000000, collectedAmount: 0, balanceDueAmount: 3000000, propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
});
const problem = (status: number, code: string) => new ApiHttpError(status, { title: "t", status, code });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The fake API: who the browser's cookie says (`X` owns the booking, `Y` is another account, `none` is a guest), whether a management session was granted, and the request log. */
const api = {
  cookie: "X" as "X" | "Y" | "none",
  granted: false,
  confirmation: "BHA-OWNER-1",
  meGate: null as null | { promise: Promise<void>; open: () => void },
  manageGate: null as null | { promise: Promise<void>; open: () => void },
  meMode: "ok" as "ok" | "fail",
  manageMode: "normal" as "normal" | "fail",
  log: [] as string[],
};
const count = (prefix: string) => api.log.filter((l) => l.startsWith(prefix)).length;

let dom: MiniDom;
let hash = "";
beforeEach(() => {
  api.cookie = "X"; api.granted = false; api.confirmation = "BHA-OWNER-1"; api.meGate = null; api.manageGate = null; api.meMode = "ok"; api.manageMode = "normal"; api.log = [];
  hash = "";
  apiGetMock.mockReset();
  apiUnsafeRequestMock.mockReset();
  resetCsrfStateForTests();
  apiGetMock.mockImplementation(async (path: string) => {
    if (path === CSRF) return { token: "t", headerName: "X-CSRF-TOKEN" };
    if (path === ME) {
      api.log.push("GET me");
      if (api.meGate) await api.meGate.promise;
      if (api.meMode === "fail") throw new ApiNetworkError();
      if (api.cookie === "none") throw problem(401, "auth.required");
      return { customerAccountId: api.cookie === "X" ? ACCOUNT_X : ACCOUNT_Y, email: `${api.cookie.toLowerCase()}@example.test` };
    }
    if (path === MANAGE_PATH) {
      api.log.push("GET manage");
      // The API decides when the request ARRIVES (what the browser's cookie said then); a gate only delays the answer, so a held response can be a stale one.
      const { cookie, granted, confirmation } = api;
      if (api.manageGate) await api.manageGate.promise;
      if (api.manageMode === "fail") throw new ApiNetworkError();
      if (cookie === "X" || granted) return dto(confirmation);
      if (cookie === "Y") throw problem(404, "reservation.not-found");
      throw problem(401, "reservation.manage-session-invalid");
    }
    throw new Error(`unexpected GET ${path}`);
  });
  apiUnsafeRequestMock.mockImplementation(async (path: string) => {
    api.log.push(path === EXCHANGE ? "POST exchange" : "POST other");
    if (path === EXCHANGE) { api.granted = true; return { status: 200, data: { reservationId: ID, expiresAtUtc: "x" } }; }
    throw new Error(`unexpected POST ${path}`);
  });
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline"))); // the support channel is not under test here
  dom = mountMiniDom({ location: { get hash() { return hash; }, pathname: `/reservations/${ID}/manage`, search: "" }, history: { state: null, replaceState: vi.fn() } });
});
afterEach(() => { dom.restore(); vi.unstubAllGlobals(); });

const page = () => withI18n(React.createElement(CustomerSessionProvider, null, React.createElement(ManageReservation, { reservationId: ID })));
const gate = () => { const g = deferred<void>(); return { promise: g.promise, open: () => g.resolve() }; };
const showsOwnersBooking = () => /BHA-OWNER/.test(dom.html()) || dom.html().includes('data-testid="manage-money"');
async function mountWithBooking() {
  dom.render(page());
  await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-1"));
}
/** The tab comes back to the foreground: the browser fires `focus` on the window and `visibilitychange` on the document. */
const comeBack = () => { dom.fireWindow("focus"); dom.fireDocument("visibilitychange"); };

describe("coming back to a tab that shows a booking (PR09-C11 P2-1, real session provider)", () => {
  it("another tab signed out: the old details leave the view before any answer, and stay out after the API refuses; /auth/me and GET once each, no POST", async () => {
    await mountWithBooking();
    const before = { me: count("GET me"), manage: count("GET manage") };
    api.cookie = "none";
    api.meGate = gate();
    comeBack();
    await flush();
    expect(showsOwnersBooking()).toBe(false); // hidden while the session is being verified
    expect(count("GET me")).toBe(before.me + 1);
    expect(count("GET manage")).toBe(before.manage); // the GET waits for the verified session
    api.meGate.open();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    expect(showsOwnersBooking()).toBe(false);
    expect(count("GET me")).toBe(before.me + 1);
    expect(count("GET manage")).toBe(before.manage + 1);
    expect(count("POST")).toBe(0);
  });

  it("another tab switched to an account that may not read it: hidden while waiting, then no-access (404); the old confirmation number, dates and balance are absent throughout", async () => {
    await mountWithBooking();
    api.cookie = "Y";
    api.meGate = gate();
    api.manageGate = gate();
    comeBack();
    await flush();
    expect(showsOwnersBooking()).toBe(false);
    api.meGate.open();
    await vi.waitFor(() => expect(api.log.filter((l) => l === "GET manage").length).toBeGreaterThanOrEqual(2));
    expect(showsOwnersBooking()).toBe(false); // the new identity's GET is still out
    api.manageGate.open();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    expect(showsOwnersBooking()).toBe(false);
    expect(count("POST")).toBe(0);
  });

  it("the same account: the details come back only after a fresh GET, and they are that GET's (a changed confirmation number proves it); no POST, no duplicate check", async () => {
    await mountWithBooking();
    const before = { me: count("GET me"), manage: count("GET manage") };
    api.confirmation = "BHA-OWNER-2";
    api.manageGate = gate();
    comeBack();
    await flush();
    expect(showsOwnersBooking()).toBe(false); // the old details are gone while the fresh GET is out
    await vi.waitFor(() => expect(count("GET manage")).toBe(before.manage + 1));
    expect(showsOwnersBooking()).toBe(false);
    api.manageGate.open();
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-2"));
    expect(dom.html()).not.toContain("BHA-OWNER-1");
    await flush();
    expect(count("GET me")).toBe(before.me + 1); // focus and visibilitychange of one return: one verification
    expect(count("GET manage")).toBe(before.manage + 1);
    expect(count("POST")).toBe(0);
  });

  it("the session cannot be verified (/auth/me fails): the details stay hidden (the provider says unknown), no GET /manage, no POST", async () => {
    await mountWithBooking();
    const before = count("GET manage");
    api.meMode = "fail";
    comeBack();
    await vi.waitFor(() => expect(dom.html()).toContain(loadPack("vi")["customer.manage.identity.unknown"].slice(0, 20)));
    expect(showsOwnersBooking()).toBe(false);
    await flush();
    expect(count("GET manage")).toBe(before);
    expect(count("POST")).toBe(0);
  });

  it("the fresh GET fails: the details stay hidden and a failure is shown", async () => {
    await mountWithBooking();
    api.manageMode = "fail";
    comeBack();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="network"'));
    expect(showsOwnersBooking()).toBe(false);
    expect(count("POST")).toBe(0);
  });

  it("a page that shows no private details does nothing on focus", async () => {
    api.cookie = "none";
    dom.render(page());
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    const before = api.log.length;
    comeBack();
    await flush();
    expect(api.log.length).toBe(before);
  });

  it("a tab that is not visible does nothing, even with the booking on screen (the guard is exercised, then a visible return does revalidate)", async () => {
    await mountWithBooking();
    const before = api.log.length;
    dom.setVisibility("hidden");
    comeBack(); // `focus` and `visibilitychange` while the document is hidden
    await flush();
    expect(api.log.length).toBe(before);
    expect(dom.html()).toContain("BHA-OWNER-1"); // the details are still there: nothing was revalidated
    dom.setVisibility("visible");
    comeBack();
    await vi.waitFor(() => expect(api.log.length).toBeGreaterThan(before)); // a visible return does
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-1"));
  });
});

type Found = { nodeName: string; childNodes: Found[]; textContent: string; [key: string]: unknown };
const findAll = (node: Found, name: string, out: Found[] = []): Found[] => { if (node.nodeName === name) out.push(node); node.childNodes.forEach((child) => findAll(child, name, out)); return out; };
const reactProps = (node: Found) => node[Object.keys(node).find((k) => k.startsWith("__reactProps$")) as string] as Record<string, () => void>;
const pressRetry = () => {
  const label = loadPack("vi")["customer.manage.retry"];
  const button = findAll(dom.container as unknown as Found, "BUTTON").find((b) => b.textContent.includes(label));
  expect(button, "the retry button").toBeDefined();
  reactProps(button as Found).onClick();
};
/** The visitor pastes the e-mailed link into this tab: only the address fragment changes. */
const pasteLink = () => { hash = `#${SECRET}`; dom.fireWindow("hashchange"); };
const guidance = () => loadPack("vi")["customer.manage.error.linkNotSent"].slice(0, 30);

describe("an explicit link open whose session verification fails (PR09-C11 P2-2, real session provider)", () => {
  async function staleTabWithFailingVerification() {
    api.cookie = "none";
    dom.render(page());
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"')); // tab A is a guest
    api.cookie = "Y"; // another tab signed in as an account that may not read the booking: the API now sees that cookie
    api.meMode = "fail"; // ... and the session read will fail
    pasteLink();
  }

  it("GET mismatch, then /auth/me fails (loading → unknown): the guidance to reopen the original e-mail link is shown, the fragment is gone, 0 exchange POSTs", async () => {
    await staleTabWithFailingVerification();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="link-not-sent"'));
    expect(dom.html()).toContain(guidance());
    expect(dom.html()).not.toContain(SECRET);
    expect((globalThis as unknown as { window: { history: { replaceState: ReturnType<typeof vi.fn> } } }).window.history.replaceState).toHaveBeenCalledWith(null, "", `/reservations/${ID}/manage`);
    expect(router.replace).toHaveBeenCalledWith(`/reservations/${ID}/manage`);
    await flush();
    expect(count("POST")).toBe(0);
    expect(dom.html()).toContain(loadPack("vi")["customer.manage.retry"]); // the provider is unknown: the button that reads the session again is still there
  });

  it("Retry only reads the session again: it never replays the old link (no POST), and the guidance gives way to the ordinary view; a fresh explicit open then works", async () => {
    await staleTabWithFailingVerification();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="link-not-sent"'));
    api.meMode = "ok";
    pressRetry();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"')); // account Y is verified, the API refuses it (404)
    expect(dom.html()).not.toContain(guidance());
    expect(count("POST")).toBe(0);
    pasteLink(); // the visitor opens the original link again, now that the session is recovered
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-1"));
    expect(count("POST exchange")).toBe(1);
  });

  it("a late failure of an older verification does not overwrite a newer open: only the newer link is exchanged, once", async () => {
    api.cookie = "none";
    dom.render(page());
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    api.cookie = "Y";
    api.meGate = gate(); // the session re-check of the first open waits here
    pasteLink();
    await vi.waitFor(() => expect(count("GET me")).toBe(2)); // the first open's session re-check is out (initial read + 1)
    pasteLink(); // a newer explicit open replaces it (the provider is loading, so it waits for the identity)
    await flush();
    api.meGate.open();
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-1"));
    expect(dom.html()).not.toContain('data-failure="link-not-sent"');
    expect(count("POST exchange")).toBe(1);
  });

  it("another reservation's page does not show a stale guidance: nothing of it is kept for a different reservation id", async () => {
    await staleTabWithFailingVerification();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="link-not-sent"'));
    dom.render(withI18n(React.createElement(CustomerSessionProvider, null, React.createElement(ManageReservation, { reservationId: "11111111-2222-4333-8444-555555555555" }))));
    await flush();
    expect(dom.html()).not.toContain('data-failure="link-not-sent"');
    expect(dom.html()).not.toContain(guidance());
    expect(count("POST")).toBe(0);
  });
});

describe("PR09-C12 P2-1: a GET /manage still out when the tab returns (real session provider)", () => {
  /** The owner's tab: its FIRST GET /manage is held, so no booking is in the DOM yet. */
  async function mountWithFirstGetOut() {
    const first = gate();
    api.manageGate = first;
    dom.render(page());
    await vi.waitFor(() => expect(count("GET manage")).toBe(1));
    expect(showsOwnersBooking()).toBe(false);
    api.manageGate = null;
    return first;
  }

  it("another tab signed out: the old DTO arrives while the verification is pending, and again while the new GET is pending: confirmation, dates and balance never appear; GET me +1, GET manage +1, POST 0", async () => {
    const first = await mountWithFirstGetOut();
    const before = { me: count("GET me"), manage: count("GET manage") };
    api.cookie = "none";
    api.meGate = gate();
    comeBack(); // focus + visibilitychange, dispatched by the harness
    await flush();
    first.open(); // the DTO of the owner's session, answered after the sign-out
    await flush();
    expect(dom.html()).not.toMatch(/BHA-OWNER|2026-12-01|3\.000\.000|3,000,000/);
    expect(count("GET manage")).toBe(before.manage); // the new GET waits for the verified session
    api.manageGate = gate();
    const second = api.manageGate;
    api.meGate.open();
    await vi.waitFor(() => expect(count("GET manage")).toBe(before.manage + 1));
    expect(showsOwnersBooking()).toBe(false);
    second.open();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    expect(dom.html()).not.toMatch(/BHA-OWNER|2026-12-01/);
    expect(count("GET me")).toBe(before.me + 1);
    expect(count("GET manage")).toBe(before.manage + 1);
    expect(count("POST")).toBe(0);
  });

  it("another tab switched to an account that may not read it: the old DTO arrives while the NEW GET is pending: still nothing of it; then no-access", async () => {
    const first = await mountWithFirstGetOut();
    const before = { me: count("GET me"), manage: count("GET manage") };
    api.cookie = "Y";
    api.manageGate = gate();
    const second = api.manageGate;
    comeBack();
    await vi.waitFor(() => expect(count("GET manage")).toBe(before.manage + 1)); // the new GET is out (verification done)
    first.open(); // the old DTO, now
    await flush();
    expect(dom.html()).not.toMatch(/BHA-OWNER|2026-12-01|3\.000\.000|3,000,000/);
    second.open();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    expect(dom.html()).not.toMatch(/BHA-OWNER|2026-12-01/);
    expect(count("GET me")).toBe(before.me + 1);
    expect(count("GET manage")).toBe(before.manage + 1);
    expect(count("POST")).toBe(0);
  });

  it("the same account: hidden through the verification and the new GET (the old DTO is dropped), shown only from the new GET (its confirmation number proves it)", async () => {
    const first = await mountWithFirstGetOut();
    const before = { me: count("GET me"), manage: count("GET manage") };
    api.confirmation = "BHA-OWNER-2";
    api.meGate = gate();
    comeBack();
    await flush();
    first.open(); // BHA-OWNER-1, while the verification is pending
    await flush();
    expect(showsOwnersBooking()).toBe(false);
    api.manageGate = gate();
    const second = api.manageGate;
    api.meGate.open();
    await vi.waitFor(() => expect(count("GET manage")).toBe(before.manage + 1));
    expect(showsOwnersBooking()).toBe(false);
    second.open();
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-2"));
    expect(dom.html()).not.toContain("BHA-OWNER-1");
    await flush();
    expect(count("GET me")).toBe(before.me + 1); // one return, one verification
    expect(count("GET manage")).toBe(before.manage + 1);
    expect(count("POST")).toBe(0);
  });
});

describe("PR09-C12 P2-2: a link open waiting for its session verification (real session provider)", () => {
  /** Tab A is a guest; another tab signed in as account Y (the API answers the guest tab 404); the link is pasted; the session re-check is held at /auth/me. */
  async function staleGuestTabWithRecheckOut() {
    api.cookie = "none";
    dom.render(page());
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    api.cookie = "Y";
    api.meGate = gate();
    pasteLink();
    await vi.waitFor(() => expect(count("GET me")).toBe(2)); // initial + the re-check, held; the provider has published loading
    return { before: { manage: count("GET manage") } };
  }

  it("loading → the ORIGINAL identity (the provider republishes the guest) → the next GET would answer 'no access yet': the link is not exchanged, 0 POST", async () => {
    const { before } = await staleGuestTabWithRecheckOut();
    api.cookie = "none"; // the other tab signed out again: /auth/me answers the guest, and the API answers a guest's GET 401 (which would allow the exchange)
    api.meGate!.open();
    await vi.waitFor(() => expect(count("GET me")).toBe(2));
    await flush();
    await flush();
    expect(count("POST")).toBe(0); // the code before C12 sent the exchange here
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    expect(count("GET manage")).toBeLessThanOrEqual(before.manage + 1); // only the ordinary read of the re-bound view
  });

  it("the identity really changed (account Y verified): exactly one new preflight GET, at most one exchange for this open, then the booking", async () => {
    const { before } = await staleGuestTabWithRecheckOut();
    api.meGate!.open(); // Y is verified; the API answers Y's preflight 404 -> the exchange may follow
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-1"));
    expect(count("POST exchange")).toBe(1);
    expect(count("POST")).toBe(1);
    expect(count("GET manage")).toBe(before.manage + 2); // the fresh preflight, then the read after the exchange
    expect(dom.html()).not.toContain(SECRET);
  });
});
