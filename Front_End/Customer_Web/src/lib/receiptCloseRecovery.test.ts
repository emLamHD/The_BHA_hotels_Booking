import React, { Fragment } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountMiniDom, type MiniDom } from "./reactDomTestkit";

// BHA-CHECKOUT-001-PR09-C14 P2-1. The REAL providers (`CustomerSessionProvider` with its identity coordinator, `BookingHoldProvider` with its identity guard), the REAL receipt page
// (`PayDoneReceipt`) and management page (`ManageReservation`), the real controllers, services and CSRF helper, mounted with react-dom/client. Only the HTTP client, the router, the
// catalog and Headless UI's dialog shell (its portal and focus trap need a browser DOM; the dialog's own content, which is what is under test, is the page's) are replaced.
// A small fake API plays the browser's cookie: `cookie` is the account the browser is signed in as (X owns the booking, Y does not, `none` is signed out). Synthetic data only.
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
vi.mock("@headlessui/react", async () => {
  const R = await import("react");
  type P = { children?: React.ReactNode };
  const Dialog = Object.assign(
    ({ children }: P) => R.createElement("div", { "data-testid": "close-dialog", role: "dialog" }, children),
    {
      Panel: ({ children }: P) => R.createElement("div", null, children),
      Title: ({ children }: P) => R.createElement("h2", null, children),
      Description: ({ children }: P) => R.createElement("div", null, children),
    }
  );
  const Transition = Object.assign(({ show, children }: P & { show?: boolean }) => (show ? R.createElement(R.Fragment, null, children) : null), {
    Child: ({ children }: P) => R.createElement(R.Fragment, null, children),
  });
  return { Dialog, Transition };
});

import { ApiHttpError } from "@/lib/api/errors";
import { resetCsrfStateForTests } from "@/lib/api/csrf";
import { TEST_QUOTE } from "@/lib/api/quoteTestkit";
import type { SelectedOfferSnapshot } from "@/lib/api/bookingHoldAttempt";
import { loadPack, withI18n } from "@/lib/i18n/testkit";
import { BookingHoldProvider, useBookingHoldFlow, type BookingHoldFlowApi } from "../app/BookingHoldProvider";
import { CustomerSessionProvider, useCustomerSession, type CustomerSessionApi } from "../app/CustomerSessionProvider";
import PayDoneReceipt from "../app/paydone/PayDoneReceipt";
import ManageReservation from "../app/reservations/[reservationId]/manage/ManageReservation";

const ID = "7b1f6c52-0a43-4d2e-9c1f-3d8a5e6b7c90";
const ID2 = "9c2e7d63-1b54-4e3f-8d2a-4e9b6f7c8da1";
const ACCOUNT_X = "aaaaaaaa-0000-4000-8000-000000000001";
const ACCOUNT_Y = "bbbbbbbb-0000-4000-8000-000000000002";
const MANAGE_PATH = `/api/v1/reservations/${ID}/manage`;
const RESERVATIONS = "/api/v1/reservations";
const LOGIN = "/api/v1/auth/login";
const ME = "/api/v1/auth/me";
const CSRF = "/api/v1/auth/csrf";
const OFFER: SelectedOfferSnapshot = {
  propertyId: "10000000-0000-0000-0000-000000000001", roomTypeId: "30000000-0000-0000-0000-000000000001", ratePlanId: "60000000-0000-0000-0000-000000000001",
  checkIn: "2026-12-01", checkOut: "2026-12-03", adults: 2, children: 0, rooms: 1, quote: TEST_QUOTE,
};
const CONTACT = { fullName: "Jane Doe", email: "jane@example.com", phone: "+15551234567" };
const reservation = (reservationId: string, confirmationNumber: string) => ({
  reservationId, confirmationNumber, status: "Confirmed", propertyId: OFFER.propertyId, roomTypeId: OFFER.roomTypeId, ratePlanId: OFFER.ratePlanId, fullName: "Jane Doe", email: "jane@example.com",
  phone: "+15551234567", checkIn: "2026-12-01", checkOut: "2026-12-03", adults: 2, children: 0, rooms: 1, currencyCode: "VND", totalAmount: 3000000, confirmedAtUtc: "2026-11-25T02:00:00Z",
  cancelledAtUtc: null, cancellationReason: null, nights: [], paymentMethod: "PayAtProperty", ledgerState: "Recorded", receivableAmount: 3000000, collectedAmount: 0, balanceDueAmount: 3000000,
  propertyTimeZoneId: "Asia/Ho_Chi_Minh", estimatedArrival: null,
});
const problem = (status: number, code: string) => new ApiHttpError(status, { title: "t", status, code });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The fake API. */
const api = { cookie: "X" as "X" | "Y" | "none", next: [] as Array<{ id: string; code: string }>, log: [] as string[] };
const count = (prefix: string) => api.log.filter((l) => l.startsWith(prefix)).length;

let dom: MiniDom;
let hash = "";
const probe: { flow: BookingHoldFlowApi | null; session: CustomerSessionApi | null } = { flow: null, session: null };
beforeEach(() => {
  api.cookie = "X"; api.next = [{ id: ID, code: "BHA-RCPT-1" }]; api.log = [];
  hash = "";
  probe.flow = null; probe.session = null;
  apiGetMock.mockReset();
  apiUnsafeRequestMock.mockReset();
  router.push.mockClear();
  resetCsrfStateForTests();
  apiGetMock.mockImplementation(async (path: string) => {
    if (path === CSRF) return { token: "t", headerName: "X-CSRF-TOKEN" };
    if (path === ME) {
      api.log.push("GET me");
      if (api.cookie === "none") throw problem(401, "auth.required");
      return { customerAccountId: api.cookie === "X" ? ACCOUNT_X : ACCOUNT_Y, email: `${api.cookie.toLowerCase()}@example.test` };
    }
    if (path === MANAGE_PATH) {
      api.log.push("GET manage");
      if (api.cookie === "X") return reservation(ID, "BHA-OWNER-1"); // the owner's booking: only the owner reads it
      if (api.cookie === "Y") throw problem(404, "reservation.not-found");
      throw problem(401, "reservation.manage-session-invalid");
    }
    throw new Error(`unexpected GET ${path}`);
  });
  apiUnsafeRequestMock.mockImplementation(async (path: string, _method: string, body: { email?: string }) => {
    if (path === RESERVATIONS) {
      api.log.push("POST reservations");
      const made = api.next.shift()!;
      return { status: 201, data: reservation(made.id, made.code) };
    }
    if (path === LOGIN) {
      api.log.push("POST login");
      api.cookie = body.email?.startsWith("y@") ? "Y" : "X"; // the visitor signs in as the account they typed
      return { status: 200, data: { customerAccountId: api.cookie === "X" ? ACCOUNT_X : ACCOUNT_Y, email: body.email } };
    }
    throw new Error(`unexpected POST ${path}`);
  });
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline"))); // the support channel is not under test here
  dom = mountMiniDom({ location: { get hash() { return hash; }, pathname: `/reservations/${ID}/manage`, search: "" }, history: { state: null, replaceState: vi.fn() } });
});
afterEach(() => { dom.restore(); vi.unstubAllGlobals(); });

const Probe = () => {
  probe.flow = useBookingHoldFlow();
  probe.session = useCustomerSession();
  return null;
};
/** One tree for every "page": the providers stay mounted when only the page changes, like the app's client-side navigation. */
const tree = (pageName: "paydone" | "manage") =>
  withI18n(
    React.createElement(
      CustomerSessionProvider,
      null,
      React.createElement(BookingHoldProvider, null, React.createElement(Fragment, null, React.createElement(Probe), pageName === "paydone" ? React.createElement(PayDoneReceipt) : React.createElement(ManageReservation, { reservationId: ID })))
    )
  );
const goTo = async (pageName: "paydone" | "manage") => { dom.render(tree(pageName)); await flush(); };
const comeBack = () => { dom.fireWindow("focus"); dom.fireDocument("visibilitychange"); };

type Found = { nodeName: string; childNodes: Found[]; outerHTML: string; [key: string]: unknown };
const reactProps = (node: Found) => node[Object.keys(node).find((k) => k.startsWith("__reactProps$")) as string] as Record<string, (e?: unknown) => void>;
const buttons = (node: Found, label: string): Found[] => [
  ...(node.nodeName === "BUTTON" && node.outerHTML.includes(label) ? [node] : []),
  ...node.childNodes.flatMap((child) => buttons(child, label)),
];
const dialogNode = (node: Found): Found | null => (node.nodeName === "DIV" && node.outerHTML.startsWith('<div data-testid="close-dialog"') && node.outerHTML.includes('role="dialog"') ? node : node.childNodes.map(dialogNode).find(Boolean) ?? null);
const root = () => dom.container as unknown as Found;
const dialogHtml = () => dialogNode(root())?.outerHTML ?? "";
const t = (() => { const pack = loadPack("vi"); return (key: string) => pack[key]; })();
const CLOSE = t("customer.receipt.closeReceipt");

/** The identity says "booker" here: everything the receipt prints that belongs to the booking. */
const RECEIPT_DETAILS = { code: /BHA-RCPT-\d/, stay: /1 thg 12, 2026/, total: /3\.000\.000/, collected: /receipt-collected/, balance: /receipt-balance/ };
const leaksReceiptDetails = (html: string) => Object.values(RECEIPT_DETAILS).some((re) => re.test(html));
/** On /paydone the reservation id is private too; the management page names it in its own address (the sign-in link's returnTo), so there only the details count. */
const leaksReceipt = (html: string) => leaksReceiptDetails(html) || html.includes(ID) || html.includes(ID2);

async function bookAsOwner() {
  await vi.waitFor(() => expect(probe.session?.state.status).toBe("authenticated"));
  // No `act` here: each step is committed (the provider's state ref updated) before the next one reads it.
  probe.flow!.selectOffer(OFFER, "label", { channel: "direct" });
  await flush();
  probe.flow!.updateContact(CONTACT);
  await flush();
  probe.flow!.submitDirect();
  await vi.waitFor(() => expect(probe.flow!.state.phase).toBe("reservation-result"));
}
/** Another tab changed the browser's account; this tab reads it again. */
async function sessionChangesElsewhere(cookie: "X" | "Y" | "none", expected: "authenticated" | "anonymous") {
  api.cookie = cookie;
  probe.session!.refreshSession();
  await vi.waitFor(() => expect(probe.session!.state.status).toBe(expected));
  await flush();
}

describe("a receipt hidden because the account changed can be closed, so the visitor can sign in again (PR09-C14 P2-1)", () => {
  it("the owner opens Manage booking from /paydone, signs out in another tab: sign-in is refused while the receipt is open; back on /paydone the masked receipt is closed on purpose, then sign-in from the clean management address works and reads the booking", async () => {
    await goTo("paydone");
    await bookAsOwner();
    // positive controls: what the receipt shows to its owner, and the Manage booking entry
    for (const [name, re] of Object.entries(RECEIPT_DETAILS)) expect(re.test(dom.html()), `positive control: ${name}`).toBe(true);
    expect(dom.html()).toContain(`href="/reservations/${ID}/manage"`);

    await goTo("manage"); // client-side navigation: the receipt stays in BookingHoldProvider
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-1"));
    api.cookie = "none"; // signed out in another tab
    comeBack();
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    expect(dom.html()).not.toContain("BHA-OWNER-1");
    expect(dom.html()).toContain(`href="/login?returnTo=/reservations/${ID}/manage"`); // the sign-in entry returns to the clean management path: no fragment, no query

    // the guard refuses while the receipt is open: no request, nothing changed (the guard itself is unchanged)
    const blocked = await probe.session!.guardedLogin({ email: "x@example.test", password: "synthetic" });
    expect(blocked).toEqual({ status: "blocked", reason: "receipt-not-finished" });
    expect(count("POST login")).toBe(0);

    await goTo("paydone"); // back on the receipt page
    expect(probe.flow!.state.phase).toBe("reservation-result"); // nothing closed it: not the tab change, not the session change, not the page
    const notice = dom.html();
    expect(notice).toContain('data-testid="receipt-owner-notice"');
    expect(leaksReceipt(notice)).toBe(false);
    expect(notice).not.toContain("close-dialog"); // no dialog until the visitor asks
    const closeButtons = buttons(root(), CLOSE);
    expect(closeButtons).toHaveLength(1);

    reactProps(closeButtons[0]).onClick!(); // the visitor chooses Close receipt
    await flush();
    const dialog = dialogHtml();
    expect(dialog).toContain(t("customer.receipt.closeQuestion"));
    expect(dialog).toContain(t("customer.receipt.closeWarn"));
    expect(leaksReceipt(dialog)).toBe(false);
    expect(leaksReceipt(dom.html())).toBe(false);
    expect(probe.flow!.state.phase).toBe("reservation-result"); // opening the dialog closes nothing

    reactProps(buttons(dialogNode(root())!, CLOSE)[0]).onClick!(); // confirm
    await flush();
    expect(probe.flow!.state.phase).toBe("idle"); // the local state is gone, with no HTTP of its own
    expect(router.push).toHaveBeenCalledWith("/");
    expect(count("POST")).toBe(1); // only the booking's own POST from before: closing sent nothing

    // the sign-in the guard had refused, from the clean management address (no fragment, no query): it works now
    const signedIn = await probe.session!.guardedLogin({ email: "x@example.test", password: "synthetic" });
    expect(signedIn).toMatchObject({ status: "settled", transport: "succeeded", session: "authenticated" });
    expect(count("POST login")).toBe(1);
    await goTo("manage");
    await vi.waitFor(() => expect(dom.html()).toContain("BHA-OWNER-1")); // the booking is read because the API allows it for this account
    expect(hash).toBe("");
  });

  it("the account that signs in may not read the booking: the API's refusal decides, nothing of the booking or of the old receipt is shown", async () => {
    await goTo("paydone");
    await bookAsOwner();
    await sessionChangesElsewhere("none", "anonymous");
    expect(buttons(root(), CLOSE)).toHaveLength(1);
    reactProps(buttons(root(), CLOSE)[0]).onClick!();
    await flush();
    reactProps(buttons(dialogNode(root())!, CLOSE)[0]).onClick!();
    await flush();
    expect(probe.flow!.state.phase).toBe("idle");
    const signedIn = await probe.session!.guardedLogin({ email: "y@example.test", password: "synthetic" });
    expect(signedIn).toMatchObject({ status: "settled", transport: "succeeded", session: "authenticated" });
    await goTo("manage");
    await vi.waitFor(() => expect(dom.html()).toContain('data-failure="no-access"'));
    expect(dom.html()).not.toContain("BHA-OWNER-1");
    expect(leaksReceiptDetails(dom.html())).toBe(false);
  });

  it("a dialog already open when access is lost drops the booking code at once and keeps only the generic text; it still closes on the visitor's confirmation", async () => {
    await goTo("paydone");
    await bookAsOwner();
    reactProps(buttons(root(), CLOSE)[0]).onClick!(); // the owner's own Close receipt
    await flush();
    expect(dialogHtml()).toContain("BHA-RCPT-1"); // positive control: authorized, the dialog names the booking code
    expect(dialogHtml()).toContain(t("customer.receipt.closeWarnWithCode").replace("{code}", "BHA-RCPT-1"));

    await sessionChangesElsewhere("none", "anonymous"); // the account is no longer the owner
    const dialog = dialogHtml();
    expect(dialog).toContain(t("customer.receipt.closeQuestion")); // still open: nothing closed it
    expect(dialog).toContain(t("customer.receipt.closeWarn"));
    expect(leaksReceipt(dialog)).toBe(false);
    expect(leaksReceipt(dom.html())).toBe(false);
    expect(probe.flow!.state.phase).toBe("reservation-result");

    reactProps(buttons(dialogNode(root())!, CLOSE)[0]).onClick!();
    await flush();
    expect(probe.flow!.state.phase).toBe("idle");
  });

  it("the receipt changed before the visitor confirmed: it is kept, a generic error is shown, nothing of either receipt is in the page", async () => {
    await goTo("paydone");
    await bookAsOwner();
    await sessionChangesElsewhere("none", "anonymous");
    reactProps(buttons(root(), CLOSE)[0]).onClick!(); // the dialog is about receipt 1
    await flush();
    expect(dialogHtml()).not.toBe("");

    // meanwhile receipt 1 is closed elsewhere and the owner books again: the page now holds receipt 2
    api.next = [{ id: ID2, code: "BHA-RCPT-2" }];
    api.cookie = "X";
    probe.session!.refreshSession();
    await vi.waitFor(() => expect(probe.session!.state.status).toBe("authenticated"));
    expect(probe.flow!.finishBooking(ID)).toBe(true);
    await flush();
    await bookAsOwner();
    await sessionChangesElsewhere("none", "anonymous"); // masked again, now receipt 2
    expect(leaksReceipt(dom.html())).toBe(false);

    reactProps(buttons(dialogNode(root())!, CLOSE)[0]).onClick!(); // confirm: the dialog was about receipt 1
    await flush();
    expect(probe.flow!.state.phase).toBe("reservation-result"); // receipt 2 kept
    expect(probe.flow!.state.reservationResult?.reservation.reservationId).toBe(ID2);
    expect(router.push).not.toHaveBeenCalled();
    expect(dom.html()).toContain(t("customer.auth.receipt.changed")); // the generic error, translated (not the raw key)
    expect(dom.html()).not.toContain("customer.auth.receipt.changed");
    expect(leaksReceipt(dom.html())).toBe(false);
    expect(dialogHtml()).toBe(""); // the dialog is closed; the error stays in the page
  });

  it("while the identity is only being verified there is no Close receipt in the notice", async () => {
    await goTo("paydone");
    await bookAsOwner();
    api.cookie = "none";
    // the session is unknown (the read fails), not a verified other identity
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === ME) throw new ApiHttpError(503, { title: "t", status: 503, code: "error.unavailable" });
      throw new Error(`unexpected GET ${path}`);
    });
    probe.session!.refreshSession();
    await vi.waitFor(() => expect(probe.session!.state.status).toBe("unknown"));
    await flush();
    expect(dom.html()).toContain('data-testid="receipt-owner-notice"');
    expect(buttons(root(), CLOSE)).toHaveLength(0);
    expect(leaksReceipt(dom.html())).toBe(false);
  });
});
