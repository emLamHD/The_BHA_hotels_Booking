import { ApiConfigError, ApiHttpError, ApiNetworkError } from "@/lib/api/errors";
import { isRequestCancelledError } from "@/lib/api/httpClient";
import { CsrfTokenUnavailableError, RequestSupersededError } from "@/lib/api/csrf";
import { ManagementContractError, canonicalReservationId, type ArrivalInput, type ManagedReservation } from "@/lib/api/reservationManagementService";

/**
 * BHA-CHECKOUT-001-PR09: the logic behind `/reservations/{id}/manage`, free of React so it can be tested (the house pattern:
 * `customerSession.ts`, `bookingHoldFlowController.ts`). It never renders, stores or logs the link secret: the secret enters through
 * {@link ReservationManagementController.offerLink}, leaves the controller's memory as it is handed to the single exchange request, and
 * appears nowhere in state, errors or keys.
 */

/** The text keys of the page (all in the `customer` scope except the shared API errors). */
export const MANAGE = {
  meta: "customer.meta.manage",
  title: "customer.manage.title",
  intro: "customer.manage.intro",
  cta: "customer.receipt.manageBooking",
  loadingSession: "customer.receipt.owner.verifying",
  loadingLink: "customer.manage.loading.link",
  loadingReservation: "customer.manage.loading.reservation",
  identityUnknown: "customer.manage.identity.unknown",
  property: "customer.manage.property",
  cancelledNotice: "customer.manage.cancelledNotice",
  ledgerNotRecorded: "customer.manage.ledger.notRecorded",
  moneyTitle: "customer.manage.money.title",
  payAtPropertyNote: "customer.manage.money.payAtProperty",
  etaTitle: "customer.manage.eta.title",
  etaHelp: "customer.manage.eta.help",
  etaCurrent: "customer.manage.eta.current",
  etaNone: "customer.manage.eta.none",
  etaDate: "customer.manage.eta.date",
  etaTime: "customer.manage.eta.time",
  etaSave: "customer.manage.eta.save",
  etaSaving: "customer.manage.eta.saving",
  etaSaved: "customer.manage.eta.saved",
  etaVerifying: "customer.manage.eta.verifying",
  etaUnverified: "customer.manage.eta.unverified",
  etaCheckAgain: "customer.manage.eta.checkAgain",
  etaCancelled: "customer.manage.eta.cancelled",
  etaInvalidDate: "customer.manage.eta.error.date",
  etaInvalidTime: "customer.manage.eta.error.time",
  etaNotSent: "customer.manage.eta.error.notSent",
  retry: "customer.manage.retry",
  signIn: "customer.manage.signIn",
  contact: "customer.manage.contact",
  moreProperties: "customer.receipt.moreProperties",
} as const;

/** What went wrong, as the page tells it. Each has its own text; none quotes the server or the link. */
export type ManageFailure =
  | "invalid-id" // the address is not a reservation id: nothing was requested
  | "link-invalid" // the link is malformed, used or expired: a new link is needed
  | "link-not-sent" // nothing reached the server (security check / configuration): the link is NOT spent
  | "link-rate-limited" // 429 before the link was read: NOT spent
  | "exchange-uncertain" // the answer was lost or unusable: the link may be spent
  | "no-access" // generic: this browser/account may not open this reservation (never says whether it exists)
  | "session-invalid" // the customer session cookie is invalid: never treated as a guest
  | "rate-limited"
  | "network"
  | "config"
  | "server";

export const FAILURE_KEY: Readonly<Record<ManageFailure, string>> = {
  "invalid-id": "customer.manage.error.invalidId",
  "link-invalid": "customer.manage.error.linkInvalid",
  "link-not-sent": "customer.manage.error.linkNotSent",
  "link-rate-limited": "customer.manage.error.linkRateLimited",
  "exchange-uncertain": "customer.manage.error.exchangeUncertain",
  "no-access": "customer.manage.error.noAccess",
  "session-invalid": "shared.apiError.auth.session-invalid",
  "rate-limited": "customer.manage.error.rateLimited",
  network: "shared.apiError.network",
  config: "shared.apiError.config",
  server: "customer.manage.error.server",
};

/** Failures after which only a read (never an exchange) can be repeated by the visitor. */
export const READ_RETRYABLE: ReadonlySet<ManageFailure> = new Set<ManageFailure>(["exchange-uncertain", "rate-limited", "network", "server"]);

export type LinkOffer = { kind: "none" } | { kind: "token"; token: string } | { kind: "malformed" };

/** The e-mail link carries the raw 43-character base64url secret after `#`. Anything else that is present is malformed and is never sent. */
export function parseManageFragment(hash: string): LinkOffer {
  if (hash === "" || hash === "#") return { kind: "none" };
  const match = /^#([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? { kind: "token", token: match[1] } : { kind: "malformed" };
}

/** The management address of a reservation: clean, canonical id, no token (what an account owner's receipt links to). */
export const manageHref = (canonicalId: string) => `/reservations/${canonicalId}/manage`;

/**
 * The receipt's "Manage booking" target: only for a Direct reservation of the signed-in account that booked it, while the VERIFIED session is that very
 * account. A guest (their link is in the e-mail), an unverified or different session, a Hold receipt or an unusable id gets none. Nothing maps a guest token to an account.
 */
export function receiptManageId(input: { isDirect: boolean; receiptOwnerKey: string | null; sessionOwnerKey: string | null; reservationId: unknown }): string | null {
  const { isDirect, receiptOwnerKey, sessionOwnerKey, reservationId } = input;
  if (!isDirect || !receiptOwnerKey || !receiptOwnerKey.startsWith("customer:") || sessionOwnerKey !== receiptOwnerKey) return null;
  return canonicalReservationId(reservationId);
}

/** The day after a `yyyy-MM-dd` calendar date (UTC arithmetic on the text: no browser time zone is involved). */
export function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The dates the API accepts for an arrival: the check-in date and the one after (overnight arrivals). */
export const arrivalDates = (checkIn: string): [string, string] => [checkIn, nextDay(checkIn)];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Local check before sending; the API still decides (DST, window, status, permission). */
export function validateArrival(input: ArrivalInput, checkIn: string): "date" | "time" | null {
  if (!arrivalDates(checkIn).includes(input.arrivalDate)) return "date";
  return TIME.test(input.arrivalTime) ? null : "time";
}

/** An exchange that ended without a usable 200. Certain refusals leave the link unspent; everything else is "may be spent" and is never retried. */
export function classifyExchangeError(error: unknown): ManageFailure {
  if (error instanceof ApiConfigError) return "config";
  // Nothing reached the server in either case: no token, or the view that wanted to send was gone (a joined exchange of another view whose POST was never sent).
  if (error instanceof CsrfTokenUnavailableError || error instanceof RequestSupersededError) return "link-not-sent";
  if (error instanceof ApiHttpError) {
    if (error.status === 401) return "link-invalid";
    if (error.status === 429) return "link-rate-limited";
    if (error.status === 400) return error.problem.code === "auth.csrf-invalid" ? "link-not-sent" : "link-invalid";
  }
  // network, 5xx, 403/404, a 2xx that is not the documented answer: the outcome is unknown.
  return "exchange-uncertain";
}

/** A failed read or an access-losing write. */
export function classifyReadError(error: unknown): ManageFailure {
  if (error instanceof ApiHttpError) {
    if (error.problem.code === "auth.session-invalid") return "session-invalid";
    if (error.status === 401 || error.status === 403 || error.status === 404) return "no-access";
    if (error.status === 429) return "rate-limited";
    return "server";
  }
  if (error instanceof ApiNetworkError) return "network";
  if (error instanceof ApiConfigError) return "config";
  return "server"; // includes a ManagementContractError
}

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  /** The result was unknown; the server is being read before anything is reported. Nothing can be submitted. */
  | { status: "verifying" }
  | { status: "saved" }
  /** A known refusal (text key); the form stays open for the visitor's own correction or retry. */
  | { status: "error"; messageKey: string }
  /**
   * The outcome of a lost update is not established and a read cannot establish it (even one that shows the submitted value: it may have been stored before).
   * Nothing can be submitted for the rest of this view; only another read ("Check again") is offered, and it never turns this into "saved".
   */
  | { status: "unverified" }
  /** A 409 was shown and the booking is being read again (`checking`) or that read failed (`!checking`: only another read is offered). Nothing can be submitted. */
  | { status: "conflict"; messageKey: string; checking: boolean };

export interface ManageContext {
  /** Canonical lowercase id. */
  reservationId: string;
  /** `verifiedOwnerKey(session)` (`guest` / `customer:<id>`), or null while the customer session is not settled. Nothing is requested for null. */
  identityKey: string | null;
}

export interface ManageState {
  phase: "waiting" | "exchanging" | "loading" | "ready" | "failed";
  failure: ManageFailure | null;
  reservation: ManagedReservation | null;
  save: SaveState;
  /** The context this state belongs to. A render for any other reservation or identity must not show `reservation` (it may be one frame behind). */
  bound: ManageContext | null;
}

type Draft = Omit<ManageState, "bound">;
const WAITING: Draft = { phase: "waiting", failure: null, reservation: null, save: { status: "idle" } };

/** True when `state` was produced for exactly this reservation and verified identity. */
export function isStateFor(state: ManageState, reservationId: string, identityKey: string | null): boolean {
  return !!state.bound && identityKey !== null && state.bound.reservationId === reservationId && state.bound.identityKey === identityKey;
}

export interface ReservationManagementDeps {
  /**
   * The single exchange request (joins one already in flight for the id). `stillCurrent` says whether the view that asked is still the current one; it is asked
   * right before the POST is handed to the transport, and a view that is gone sends nothing.
   */
  exchange: (reservationId: string, token: string, stillCurrent: () => boolean) => Promise<void>;
  /** Resolves when an exchange of this id that is under way has finished (so a read never races its own cookie). */
  whenExchangeSettled: (reservationId: string) => Promise<void>;
  read: (reservationId: string, signal: AbortSignal) => Promise<ManagedReservation>;
  /** The arrival update, with the same `stillCurrent` rule: a superseded request is never sent (it rejects with `RequestSupersededError`). */
  update: (reservationId: string, input: ArrivalInput, stillCurrent: () => boolean) => Promise<ManagedReservation>;
  /** The customer session is read again (an invalid customer cookie asks for it). */
  requestSessionRefresh: () => void;
}

export interface ReservationManagementController {
  getState: () => ManageState;
  subscribe: (listener: () => void) => () => void;
  /** Hands over what the address fragment held, once, when the page opens. */
  offerLink: (offer: LinkOffer) => void;
  /**
   * The visitor opens a link while the page is already open (a fragment-only navigation in this tab): an explicit open, handled like a fresh one, with at most
   * one exchange for it. Nothing is sent while an exchange of this view is already out, and nothing is replayed by this or by any render, refresh or read.
   */
  openLink: (offer: LinkOffer) => void;
  /** The reservation and verified identity this view is for. A change clears everything private and invalidates answers still on their way. */
  bind: (context: ManageContext) => void;
  /** A visitor's own repeat of the READ (never an exchange). */
  retry: () => void;
  submitArrival: (input: ArrivalInput) => void;
  /** Reads the server again to settle an unknown arrival result. */
  verifySave: () => void;
  dispose: () => void;
}

export function createReservationManagementController(deps: ReservationManagementDeps): ReservationManagementController {
  let context: ManageContext | null = null;
  let state: ManageState = { ...WAITING, bound: null };
  let epoch = 0;
  let link: LinkOffer = { kind: "none" };
  let reading: AbortController | null = null;
  let saveLock = false;
  /**
   * Arrival updates whose result is not settled, per view key (`reservationId|verified identity`): set when the POST is handed over, released only by a
   * definite answer of THAT request (never by a read, never by a change of epoch). Unlike `saveLock` it survives the identity going through loading/unknown
   * and coming back (a session recheck), because the request may still be applied. It holds an empty token: no reservation data, nothing about the guest.
   */
  const writeHolds = new Map<string, object>();
  /** A context whose read was refused for an invalid customer session: not repeated by itself (the refresh below passes through "loading"). */
  let sessionInvalidFor: string | null = null;
  const listeners = new Set<() => void>();

  const keyOf = (c: ManageContext) => `${c.reservationId}|${c.identityKey}`;

  function publish(next: Draft): void {
    state = { phase: next.phase, failure: next.failure, reservation: next.reservation, save: next.save, bound: context };
    listeners.forEach((listener) => listener());
  }

  function invalidate(): void {
    epoch += 1;
    reading?.abort();
    reading = null;
    saveLock = false;
  }

  const current = (at: number) => at === epoch;

  /**
   * What a freshly read view of the current context shows for saving: shut ("not confirmed") while an update of this very view is unsettled, and also when the read
   * itself BEGAN while one was (`underHold`): such a GET may predate the POST's effect, so it cannot open the form even if the POST's answer arrived first.
   * Only a successful read that began after the hold was gone opens it.
   */
  const saveStateOf = (result: ReadResult): SaveState => (result.underHold || writeHolds.has(keyOf(context!)) ? { status: "unverified" } : { status: "idle" });

  function fail(failure: ManageFailure): void {
    publish({ phase: "failed", failure, reservation: null, save: { status: "idle" } });
  }

  function failRead(error: unknown): void {
    const failure = classifyReadError(error);
    if (failure === "session-invalid") {
      sessionInvalidFor = keyOf(context!);
      fail(failure);
      deps.requestSessionRefresh(); // never treated as a guest; the session is read again
      return;
    }
    fail(failure);
  }

  /** A successful read of the current view, and whether an arrival update of this view was unsettled when the request was handed over. */
  interface ReadResult {
    reservation: ManagedReservation;
    underHold: boolean;
  }

  async function read(at: number): Promise<ReadResult | null> {
    const ctx = context!;
    await deps.whenExchangeSettled(ctx.reservationId);
    if (!current(at)) return null;
    reading?.abort();
    const controller = new AbortController();
    reading = controller;
    const underHold = writeHolds.has(keyOf(ctx));
    try {
      const reservation = await deps.read(ctx.reservationId, controller.signal);
      if (!current(at)) return null;
      // Defence in depth (the service already checks): an answer for any other reservation is never shown.
      if (reservation.reservationId !== ctx.reservationId) throw new ManagementContractError();
      return { reservation, underHold };
    } catch (error) {
      if (!current(at) || isRequestCancelledError(error)) return null;
      throw error;
    }
  }

  async function load(at: number): Promise<void> {
    publish({ ...WAITING, phase: "loading" });
    try {
      const result = await read(at);
      // `read` checked the epoch before it returned, but this continuation runs later: the view may have changed in between, and then nothing is published.
      if (result && current(at)) publish({ phase: "ready", failure: null, reservation: result.reservation, save: saveStateOf(result) });
    } catch (error) {
      if (current(at)) failRead(error);
    }
  }

  async function begin(at: number): Promise<void> {
    const ctx = context!;
    if (sessionInvalidFor === keyOf(ctx)) {
      fail("session-invalid");
      return;
    }
    const offer = link;
    link = { kind: "none" }; // the secret leaves the controller here; it can be sent at most once
    if (offer.kind === "malformed") {
      fail("link-invalid");
      return;
    }
    if (offer.kind === "none") {
      await load(at);
      return;
    }
    publish({ ...WAITING, phase: "exchanging" });
    try {
      await deps.exchange(ctx.reservationId, offer.token, () => current(at));
    } catch (error) {
      if (current(at)) fail(classifyExchangeError(error));
      return;
    }
    if (current(at)) await load(at);
    // If the view changed while the exchange was out, the new context's own read waits for it (whenExchangeSettled).
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    offerLink: (offer) => {
      if (link.kind === "none") link = offer;
    },
    openLink: (offer) => {
      if (offer.kind === "none") return;
      if (!context || context.identityKey === null) {
        link = offer; // no verified identity yet: it is opened (once) when the identity settles, like the link of a fresh page
        return;
      }
      if (state.phase === "exchanging") return; // never a second exchange beside the one that is out
      invalidate(); // an unsettled arrival update keeps its hold (writeHolds); only the epoch-bound lock and answers are dropped
      link = offer;
      void begin(epoch);
    },
    bind: (next) => {
      if (context && context.reservationId === next.reservationId && context.identityKey === next.identityKey) return;
      invalidate();
      context = next;
      if (next.identityKey === null) {
        publish(WAITING); // nothing private is kept or requested while the identity is not verified
        return;
      }
      void begin(epoch);
    },
    retry: () => {
      if (!context || context.identityKey === null || state.phase !== "failed" || !state.failure || !READ_RETRYABLE.has(state.failure)) return;
      invalidate();
      void load(epoch);
    },
    submitArrival: (input) => {
      const reservation = state.reservation;
      const ctx = context;
      if (!ctx || state.phase !== "ready" || !reservation || reservation.status === "Cancelled" || saveLock) return;
      const viewKey = keyOf(ctx);
      if (writeHolds.has(viewKey) || ["saving", "verifying", "unverified", "conflict"].includes(state.save.status)) return;
      const invalid = validateArrival(input, reservation.checkIn);
      if (invalid) {
        publish({ ...state, save: { status: "error", messageKey: invalid === "date" ? MANAGE.etaInvalidDate : MANAGE.etaInvalidTime } });
        return;
      }
      saveLock = true; // synchronous: a second click or Enter in the same tick sends nothing
      const at = epoch;
      const mine = {};
      writeHolds.set(viewKey, mine);
      // Only a definite answer of THIS request frees the hold, and it does so even when the view it came from is gone (hidden, rebound, another identity):
      // then nothing is shown or rebuilt from the answer, and no other view's lock is touched.
      const release = () => {
        if (writeHolds.get(viewKey) === mine) writeHolds.delete(viewKey);
      };
      publish({ ...state, save: { status: "saving" } });
      void (async () => {
        try {
          const updated = await deps.update(ctx.reservationId, { arrivalDate: input.arrivalDate, arrivalTime: input.arrivalTime }, () => current(at));
          release();
          if (!current(at)) return;
          saveLock = false;
          publish({ phase: "ready", failure: null, reservation: updated, save: { status: "saved" } });
        } catch (error) {
          // Definite: a refusal, an access refusal, or a request that never left (no token was read, or the view was gone before the hand-over). Anything else (network, 5xx, unusable answer) is unknown and keeps the hold.
          const neverSent = error instanceof CsrfTokenUnavailableError || error instanceof RequestSupersededError;
          if ((error instanceof ApiHttpError && [400, 401, 403, 404, 409, 429].includes(error.status)) || neverSent) release();
          if (!current(at)) return;
          if (error instanceof ApiHttpError && [400, 409, 429].includes(error.status)) {
            // A refusal before anything was written: shown, and the visitor decides. A 409 means the reservation is no longer changeable: it is read again with the form shut.
            const key = error.status === 429 ? "shared.apiError.auth.rate-limited" : error.problem.code ? `shared.apiError.${error.problem.code}` : "shared.apiError.error.unknown";
            if (error.status === 409) {
              await refreshAfterRefusal(at, key);
              return;
            }
            saveLock = false;
            publish({ ...state, save: { status: "error", messageKey: key } });
            return;
          }
          if (error instanceof ApiHttpError && [401, 403, 404].includes(error.status)) {
            saveLock = false;
            failRead(error); // access lost: nothing private stays on screen
            return;
          }
          if (neverSent) {
            // The POST never reached the transport (no token; a superseded view never gets here, it returned above): nothing can be applied later. Retryable by the visitor, with their input kept.
            saveLock = false;
            publish({ ...state, save: { status: "error", messageKey: MANAGE.etaNotSent } });
            return;
          }
          await settle(at); // network, 5xx or an unusable answer: unknown, so the server is read before anything is reported
        }
      })();
    },
    // Only ever a READ: it never sends the update again, and a press while a read is out starts nothing.
    verifySave: () => {
      if (!context || state.phase !== "ready") return;
      if (state.save.status === "unverified") void settle(epoch);
      else if (state.save.status === "conflict" && !state.save.checking) void refreshAfterRefusal(epoch, state.save.messageKey);
    },
    // Unmount: answers still on their way are dropped. The controller can be bound again (a re-mount), it is never poisoned.
    dispose: () => {
      invalidate();
      context = null;
    },
  };

  /**
   * The submitted result is unknown: read the server and show what it holds, nothing more. Even a read equal to what was sent proves nothing: the same value
   * may have been stored before the request, and the lost POST may still be on its way. So this never reports "saved" and never opens the form while the update is unsettled (`writeHolds`; only that request's own answer releases it).
   */
  async function settle(at: number): Promise<void> {
    saveLock = true;
    publish({ ...state, save: { status: "verifying" } });
    try {
      const result = await read(at);
      if (!result || !current(at)) return; // the view changed after read() returned: no state and no lock is touched
      // Still not confirmed while the update is unsettled, or when this read began while it was. Only a read that began after its own answer came opens the form: the read content never decides.
      const save = saveStateOf(result);
      saveLock = save.status !== "idle";
      publish({ phase: "ready", failure: null, reservation: result.reservation, save });
    } catch (error) {
      if (!current(at)) return;
      const failure = classifyReadError(error);
      if (failure === "no-access" || failure === "session-invalid") failRead(error);
      else publish({ ...state, save: { status: "unverified" } });
    }
  }

  /** After a 409 the form is shut (controller lock + UI) before the read starts and opens again only when a read says the booking is still editable. */
  async function refreshAfterRefusal(at: number, messageKey: string): Promise<void> {
    saveLock = true;
    publish({ ...state, save: { status: "conflict", messageKey, checking: true } });
    try {
      const result = await read(at);
      if (!result || !current(at)) return;
      saveLock = false; // a Cancelled booking stays shut by its status
      publish({ phase: "ready", failure: null, reservation: result.reservation, save: { status: "error", messageKey } });
    } catch (error) {
      if (!current(at)) return;
      const failure = classifyReadError(error);
      if (failure === "no-access" || failure === "session-invalid") failRead(error);
      else publish({ ...state, save: { status: "conflict", messageKey, checking: false } });
    }
  }
}
