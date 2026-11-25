import { apiGet } from "./httpClient";
import { submitCsrfProtectedRequestOnce } from "./csrf";

/**
 * BHA-CHECKOUT-001-PR09: the three PR06 calls behind the reservation management page
 * (`docs/runbooks/BHA-CHECKOUT-001-reservation-management.md`). The reservation id is written in ONE spelling, the lowercase
 * 36-character form the confirmation e-mail carries, in every call: the session cookie's path follows the spelling of the exchange
 * request and browsers match cookie paths case-sensitively.
 */

const GUID_D = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The canonical lowercase `D` form of a reservation id, or null when the text is not exactly a 36-character GUID (nothing is requested then). */
export function canonicalReservationId(raw: unknown): string | null {
  return typeof raw === "string" && GUID_D.test(raw) ? raw.toLowerCase() : null;
}

export const managePath = (reservationId: string) => `/api/v1/reservations/${reservationId}/manage`;

/** A success status with a body that is not the documented shape: the outcome is unknown, never "done". */
export class ManagementContractError extends Error {
  constructor() {
    super("The server returned an unexpected reservation management response.");
    this.name = "ManagementContractError";
  }
}

export interface EstimatedArrival {
  arrivalDate: string;
  arrivalTime: string;
  timeZoneId: string;
  updatedAtUtc: string;
}

/** What the page shows. Only fields it uses are kept (no guest name, e-mail, phone or ids of rooms/plans). */
export interface ManagedReservation {
  reservationId: string;
  confirmationNumber: string;
  status: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  currencyCode: string;
  totalAmount: number;
  confirmedAtUtc: string;
  paymentMethod: string;
  ledgerState: "NotRecorded" | "Recorded";
  collectedAmount: number | null;
  balanceDueAmount: number | null;
  propertyTimeZoneId: string;
  estimatedArrival: EstimatedArrival | null;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function toEstimatedArrival(data: unknown): EstimatedArrival | null {
  if (data === null || data === undefined) return null;
  if (typeof data === "object") {
    const e = data as Record<string, unknown>;
    if (typeof e.arrivalDate === "string" && DATE.test(e.arrivalDate) && typeof e.arrivalTime === "string" && TIME.test(e.arrivalTime) && isText(e.timeZoneId)) {
      return { arrivalDate: e.arrivalDate, arrivalTime: e.arrivalTime, timeZoneId: e.timeZoneId, updatedAtUtc: typeof e.updatedAtUtc === "string" ? e.updatedAtUtc : "" };
    }
  }
  throw new ManagementContractError();
}

/** Accepts only a body for exactly this reservation that carries everything the page shows; the amounts are kept as the API sent them. */
export function toManagedReservation(data: unknown, reservationId: string): ManagedReservation {
  if (typeof data === "object" && data !== null) {
    const r = data as Record<string, unknown>;
    const recorded = r.ledgerState === "Recorded";
    if (
      typeof r.reservationId === "string" &&
      r.reservationId.toLowerCase() === reservationId &&
      isText(r.confirmationNumber) &&
      isText(r.status) &&
      isText(r.propertyId) &&
      typeof r.checkIn === "string" && DATE.test(r.checkIn) &&
      typeof r.checkOut === "string" && DATE.test(r.checkOut) &&
      isNumber(r.adults) && isNumber(r.children) && isNumber(r.rooms) &&
      isText(r.currencyCode) &&
      isNumber(r.totalAmount) &&
      typeof r.confirmedAtUtc === "string" &&
      r.paymentMethod === "PayAtProperty" &&
      (recorded || r.ledgerState === "NotRecorded") &&
      isText(r.propertyTimeZoneId) &&
      // A recorded ledger carries its amounts; NotRecorded carries none and none is inferred.
      (!recorded || (isNumber(r.collectedAmount) && isNumber(r.balanceDueAmount)))
    ) {
      return {
        reservationId,
        confirmationNumber: r.confirmationNumber as string,
        status: r.status as string,
        propertyId: r.propertyId as string,
        checkIn: r.checkIn as string,
        checkOut: r.checkOut as string,
        adults: r.adults as number,
        children: r.children as number,
        rooms: r.rooms as number,
        currencyCode: r.currencyCode as string,
        totalAmount: r.totalAmount as number,
        confirmedAtUtc: r.confirmedAtUtc as string,
        paymentMethod: "PayAtProperty",
        ledgerState: recorded ? "Recorded" : "NotRecorded",
        collectedAmount: recorded ? (r.collectedAmount as number) : null,
        balanceDueAmount: recorded ? (r.balanceDueAmount as number) : null,
        propertyTimeZoneId: r.propertyTimeZoneId as string,
        estimatedArrival: toEstimatedArrival(r.estimatedArrival),
      };
    }
  }
  throw new ManagementContractError();
}

/**
 * `POST /manage/exchange` with `{ token }`: consumes the one-time link and sets the session cookie. Handed to the transport ONCE through the
 * no-retry CSRF path (the shared helper would replay it after an antiforgery failure). No signal: aborting cannot un-consume a link, it would only
 * lose the answer. A 2xx whose body is not this reservation's is a {@link ManagementContractError} (unknown outcome).
 */
export async function exchangeManagementLink(reservationId: string, token: string): Promise<void> {
  const response = await submitCsrfProtectedRequestOnce<unknown>(`${managePath(reservationId)}/exchange`, "POST", { token });
  const body = response.data as { reservationId?: unknown; expiresAtUtc?: unknown } | undefined;
  if (
    response.status !== 200 ||
    typeof body !== "object" || body === null ||
    typeof body.reservationId !== "string" || body.reservationId.toLowerCase() !== reservationId ||
    typeof body.expiresAtUtc !== "string"
  ) {
    throw new ManagementContractError();
  }
}

/** `GET /manage` with the cookie (and the customer session cookie, if any): safe to repeat. */
export async function readManagedReservation(reservationId: string, options: { signal?: AbortSignal } = {}): Promise<ManagedReservation> {
  return toManagedReservation(await apiGet<unknown>(managePath(reservationId), { signal: options.signal }), reservationId);
}

export interface ArrivalInput {
  /** `yyyy-MM-dd`, the property's calendar date. */
  arrivalDate: string;
  /** `HH:mm`, the property's wall clock. */
  arrivalTime: string;
}

/** `POST /manage/estimated-arrival` with exactly `{ arrivalDate, arrivalTime }`, once (never replayed here). Answers the updated reservation. */
export async function updateEstimatedArrival(reservationId: string, input: ArrivalInput): Promise<ManagedReservation> {
  const response = await submitCsrfProtectedRequestOnce<unknown>(`${managePath(reservationId)}/estimated-arrival`, "POST", {
    arrivalDate: input.arrivalDate,
    arrivalTime: input.arrivalTime,
  });
  if (response.status !== 200) throw new ManagementContractError();
  return toManagedReservation(response.data, reservationId);
}

/**
 * One exchange per link-open, even if the page is mounted again while the request is out: the second mount joins the first's request instead of
 * sending anything, and a read that starts meanwhile waits for it (a read before the cookie exists would answer 401 for a link that is about to work).
 * Kept at module scope on purpose; it holds a promise, never the token.
 */
const exchangesInFlight = new Map<string, Promise<void>>();

export function exchangeOnce(reservationId: string, token: string, send: (id: string, token: string) => Promise<void> = exchangeManagementLink): Promise<void> {
  const running = exchangesInFlight.get(reservationId);
  if (running) return running;
  const request = send(reservationId, token).finally(() => {
    if (exchangesInFlight.get(reservationId) === request) exchangesInFlight.delete(reservationId);
  });
  exchangesInFlight.set(reservationId, request);
  return request;
}

/** Resolves when no exchange of this reservation is outstanding (its failure is the exchanging caller's to report, not this waiter's). */
export function whenExchangeSettled(reservationId: string): Promise<void> {
  const running = exchangesInFlight.get(reservationId);
  return running ? running.then(() => undefined, () => undefined) : Promise.resolve();
}
