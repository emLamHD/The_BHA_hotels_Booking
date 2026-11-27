import React, { Fragment, StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountMiniDom, type MiniDom } from "./reactDomTestkit";

// BHA-CHECKOUT-001-PR09-C6 P2-1. The REAL page (`ManageReservation`) mounted with react-dom/client, the real controller, service and CSRF helper; only the HTTP client, the
// router, the customer session and the catalog are replaced. The order "commit -> token returns -> passive cleanup" is forced by a sibling whose LAYOUT effect releases the
// token in the very commit that removes or re-keys the page (never `act`, which would flush the passive cleanup first; no sleeps decide any order).
// The page chooses `useLayoutEffect` or `useEffect` once, when its module loads, by whether `window` exists (the server must not warn). A browser has one, so the test gives the
// module one before it is imported (hoisted above the imports); the mini DOM replaces it per test.
vi.hoisted(() => { (globalThis as Record<string, unknown>).window ??= {}; });
const apiGetMock = vi.fn();
const apiUnsafeRequestMock = vi.fn();
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
let session: { status: string; customer: unknown } = { status: "anonymous", customer: null };
vi.mock("@/app/CustomerSessionProvider", () => ({ useCustomerSession: () => ({ state: session, refreshSession: vi.fn() }) }));

import { resetCsrfStateForTests } from "@/lib/api/csrf";
import { ApiHttpError } from "@/lib/api/errors";
import { withI18n } from "@/lib/i18n/testkit";
import ManageReservation from "../app/reservations/[reservationId]/manage/ManageReservation";

const ID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
const SECRET = "Zq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwZq9xK2pwabc";
const MANAGE_PATH = `/api/v1/reservations/${ID}/manage`;
const EXCHANGE = `${MANAGE_PATH}/exchange`;
const ARRIVAL = `${MANAGE_PATH}/estimated-arrival`;
const CSRF = "/api/v1/auth/csrf";
const DTO = {
  reservationId: ID, confirmationNumber: "BHA-1", status: "Confirmed", propertyId: "p", roomTypeId: "r", ratePlanId: "p", fullName: "Jane Doe", checkIn: "2026-12-01", checkOut: "2026-12-03",
  adults: 2, children: 0, rooms: 1, currencyCode: "VND", totalAmount: 3000000, confirmedAtUtc: "2026-11-25T02:00:00Z", cancelledAtUtc: null, cancellationReason: null, nights: [],
  paymentMethod: "PayAtProperty", ledgerState: "Recorded", receivableAmount: 3000000, collectedAmount: 0, balanceDueAmount: 3000000, propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
};
const OWNER = { status: "authenticated", customer: { customerAccountId: "AAAAAAAA-0000-4000-8000-000000000001" } };
const posts = (path: string) => apiUnsafeRequestMock.mock.calls.filter((c) => c[0] === path).length;
const gets = (path: string) => apiGetMock.mock.calls.filter((c) => c[0] === path).length;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Releases `onArm` in a LAYOUT effect, in the commit in which `armed` turns true. React's scheduler runs the passive-effect flush as the next task of the same time slice
 * unless the slice (5 ms) is used up, in which case it goes to the next macrotask and the microtasks run in between: the real navigation of a page is slower than 5 ms, a tiny
 * test tree is not, so this render takes 8 ms to model it. The order commit -> (microtasks, i.e. the token's continuation) -> passive cleanup is what is under test.
 */
const Releaser = ({ armed, onArm }: { armed: boolean; onArm: () => void }) => {
  if (armed) {
    const until = performance.now() + 8;
    while (performance.now() < until) { /* a slow render: the scheduler must yield before the passive flush */ }
  }
  useLayoutEffect(() => {
    if (armed) onArm();
  }, [armed, onArm]);
  return null;
};

let dom: MiniDom;
let releaseToken: () => void;
let released = false; // the layout effect really released the token (a "0 POSTs" result must not come from a token that never arrived)
let hash = "";
beforeEach(() => {
  apiGetMock.mockReset();
  apiUnsafeRequestMock.mockReset();
  resetCsrfStateForTests();
  session = { status: "anonymous", customer: null };
  hash = `#${SECRET}`;
  released = false;
  const token = new Promise<{ token: string; headerName: string }>((resolve) => { releaseToken = () => resolve({ token: "t", headerName: "X-CSRF-TOKEN" }); });
  apiGetMock.mockImplementation(async (path: string) => (path === CSRF ? token : DTO));
  apiUnsafeRequestMock.mockImplementation(async (path: string) =>
    path === EXCHANGE ? { status: 200, data: { reservationId: ID, expiresAtUtc: "x" } } : { status: 200, data: { ...DTO, estimatedArrival: { arrivalDate: "2026-12-02", arrivalTime: "09:00", timeZoneId: "Asia/Ho_Chi_Minh", updatedAtUtc: "u" } } });
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline"))); // the support channel is not under test here
  dom = mountMiniDom({ location: { get hash() { return hash; }, pathname: `/reservations/${ID}/manage`, search: "" }, history: { state: null, replaceState: vi.fn() } });
});
afterEach(() => {
  dom.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const page = () => withI18n(React.createElement(ManageReservation, { reservationId: ID }));
const tree = (opts: { page: boolean; armed: boolean; strict?: boolean }) => {
  const inner = React.createElement(Fragment, null, opts.page ? page() : null, React.createElement(Releaser, { armed: opts.armed, onArm: () => { released = true; releaseToken(); } }));
  return opts.strict ? React.createElement(StrictMode, null, inner) : inner;
};

type Found = { nodeName: string; childNodes: Found[]; [key: string]: unknown };
const find = (node: Found, name: string): Found | null => {
  if (node.nodeName === name) return node;
  for (const child of node.childNodes) { const hit = find(child, name); if (hit) return hit; }
  return null;
};
const reactProps = (node: Found) => node[Object.keys(node).find((k) => k.startsWith("__reactProps$")) as string] as Record<string, (e: unknown) => void>;
/** Types a time into the arrival form and submits it, through the props React attached to the nodes (no browser events exist here). */
async function saveArrival(time: string) {
  const root = dom.container as unknown as Found;
  reactProps(find(root, "INPUT") as Found).onChange({ target: { value: time } });
  await flush();
  reactProps(find(root, "FORM") as Found).onSubmit({ preventDefault() {} });
}

describe("a link exchange waiting for its CSRF token when the page is removed or re-keyed (PR09-C6 P2-1)", () => {
  it("control: the page stays mounted when the token arrives: exactly one exchange POST, then the booking is read", async () => {
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(gets(CSRF)).toBe(1));
    dom.render(tree({ page: true, armed: true }));
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-1"));
    expect(posts(EXCHANGE)).toBe(1);
    expect(apiUnsafeRequestMock.mock.calls.find((c) => c[0] === EXCHANGE)?.[2]).toEqual({ token: SECRET });
  });

  it("client-side navigation away: the token is released in the commit that removes the page, before its passive cleanup: 0 exchange POSTs", async () => {
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(gets(CSRF)).toBe(1));
    dom.render(tree({ page: false, armed: true }));
    await flush();
    expect(released).toBe(true);
    expect(posts(EXCHANGE)).toBe(0);
  });

  it("the signed-in account changes in place (same component, new identity): the old view's exchange is not sent either", async () => {
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(gets(CSRF)).toBe(1));
    session = OWNER;
    dom.render(tree({ page: true, armed: true }));
    await flush();
    expect(released).toBe(true);
    expect(posts(EXCHANGE)).toBe(0);
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-1")); // the new identity's own view reads the booking (the link was not spent)
  });

  it("production mount: the initial link is exchanged exactly once and the booking is read", async () => {
    releaseToken();
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-1"));
    expect(posts(EXCHANGE)).toBe(1);
    expect(gets(MANAGE_PATH)).toBe(1);
  });

  it("StrictMode (development: mount, unmount, mount in one flush): the initial link is neither dropped nor sent twice, and the booking is read", async () => {
    releaseToken();
    dom.render(tree({ page: true, armed: false, strict: true }));
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-1"));
    await flush();
    expect(posts(EXCHANGE)).toBe(1);
    expect(gets(MANAGE_PATH)).toBe(1);
  });

  it("StrictMode with the token still pending: the one exchange waits for it and is then sent once", async () => {
    dom.render(tree({ page: true, armed: false, strict: true }));
    await vi.waitFor(() => expect(gets(CSRF)).toBeGreaterThanOrEqual(1));
    await flush();
    expect(posts(EXCHANGE)).toBe(0);
    dom.render(tree({ page: true, armed: true, strict: true }));
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-1"));
    expect(posts(EXCHANGE)).toBe(1);
  });
});

describe("an arrival update waiting for its CSRF token when the page is removed (PR09-C6 P2-1)", () => {
  beforeEach(() => { hash = ""; }); // no link: the booking is read at once and the form is used

  it("control: the page stays mounted: exactly one POST", async () => {
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-1"));
    await saveArrival("09:00");
    await vi.waitFor(() => expect(gets(CSRF)).toBe(1));
    dom.render(tree({ page: true, armed: true }));
    await vi.waitFor(() => expect(posts(ARRIVAL)).toBe(1));
  });

  it("navigation away while the update waits for its token: 0 POSTs", async () => {
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-1"));
    await saveArrival("09:00");
    await vi.waitFor(() => expect(gets(CSRF)).toBe(1));
    dom.render(tree({ page: false, armed: true }));
    await flush();
    expect(released).toBe(true);
    expect(posts(ARRIVAL)).toBe(0);
  });
});

// BHA-CHECKOUT-001-PR09-C6 P2-2 on the real page: the page reads the public Website Social Settings once (a fixture `fetch` here, not the API) and offers the same channel on the
// details screen and on the error screen of a guest who cannot read the booking.
describe("the support channel on the mounted page (PR09-C6 P2-2)", () => {
  const SETTINGS = { revision: 1, generatedAtUtc: "2026-11-27T00:00:00Z", phoneEnabled: true, phoneNumber: "0000 000 000", phoneHref: "tel:+84000000000", messengerEnabled: true,
    messengerUrl: "https://m.me/example-page", zaloEnabled: true, zaloUrl: "https://zalo.me/0000000000", backToTopEnabled: true };
  const settingsFetch = (body: unknown, ok = true) => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test");
    const fetchMock = vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const noAccess = () => apiGetMock.mockImplementation(async () => { throw new ApiHttpError(403, { title: "t", status: 403 }); });
  beforeEach(() => { hash = ""; });

  it("error screen (the guest may not read the booking): the Phone channel, read once, with no request that names the booking", async () => {
    const fetchMock = settingsFetch(SETTINGS);
    noAccess();
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(dom.html()).toContain('href="tel:+84000000000"'));
    expect(dom.html()).toContain('data-testid="manage-failure"');
    expect(dom.html()).not.toContain('href="/contact"');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://api.example.test/api/v1/website/social-media"); // no reservation id, no session
  });

  it("details screen: Zalo when Phone is off", async () => {
    settingsFetch({ ...SETTINGS, phoneEnabled: false });
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(dom.html()).toContain('href="https://zalo.me/0000000000"'));
    expect(dom.html()).toContain("BHA-1");
    expect(dom.html()).not.toContain('href="/contact"');
  });

  it("error screen: no channel is usable (all disabled): the notice, no dead button", async () => {
    settingsFetch({ ...SETTINGS, phoneEnabled: false, zaloEnabled: false, messengerEnabled: false });
    noAccess();
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(dom.html()).toContain('data-testid="manage-contact-unavailable"'));
    expect(dom.html()).toContain('data-testid="manage-failure"');
    expect(dom.html()).not.toContain('href="/contact"');
    expect(dom.html()).not.toContain("tel:");
  });

  it("details screen: the settings cannot be read (HTTP error): the notice, no dead button", async () => {
    settingsFetch({}, false);
    dom.render(tree({ page: true, armed: false }));
    await vi.waitFor(() => expect(dom.html()).toContain('data-testid="manage-contact-unavailable"'));
    expect(dom.html()).toContain("BHA-1");
    expect(dom.html()).not.toContain('href="/contact"');
  });
});
