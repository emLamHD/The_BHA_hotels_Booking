"use client";

import React, { FC, FormEvent, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import ButtonPrimary from "@/shared/ButtonPrimary";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { useStaySearch } from "@/components/StaySearchProvider";
import { verifiedOwnerKey } from "@/lib/api/directBookingAttempt";
import { calculateNights } from "@/lib/api/availabilityValidation";
import {
  canonicalReservationId,
  exchangeManagementLink,
  exchangeOnce,
  readManagedReservation,
  updateEstimatedArrival,
  whenExchangeSettled,
  type ManagedReservation,
} from "@/lib/api/reservationManagementService";
import {
  FAILURE_KEY,
  MANAGE,
  READ_RETRYABLE,
  arrivalDates,
  createReservationManagementController,
  isStateFor,
  parseManageFragment,
  type LinkOffer,
  type ManageFailure,
  type SaveState,
} from "@/lib/reservationManagement";
import { LOGIN_PAGE } from "@/lib/customerAuthUi";
import { loginForReservationHref } from "@/lib/authReturnTarget";
import { formatAsGiven } from "@/lib/i18n/display";
import { useApiMessage } from "@/lib/i18n/apiMessage";
import { useDateFormat } from "@/lib/i18n/dates";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { resolveProperty } from "@/lib/roomDetailsRoute";
import { chooseContact, fetchContactSettings, type ContactChoice } from "@/lib/social/settings";

// `useLayoutEffect` warns when rendered on the server; the cleanup it carries only matters in the browser.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const Row: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1 sm:flex-row text-neutral-6000 dark:text-neutral-300">
    <span className="sm:flex-1">{label}</span>
    <span className="sm:flex-1 font-medium text-neutral-900 dark:text-neutral-100 break-words">{children}</span>
  </div>
);

/**
 * The one support channel of the page (PR09-C6), shared by the details and the error screens: the public Website Social Settings, Phone, then Zalo, then Messenger.
 * It needs no booking and no session, so it works for a guest who cannot read the reservation; nothing about the booking, the address or the link is added to it.
 * While it is being read nothing is shown; when it cannot be read or no channel is usable, a notice is shown instead of a button.
 */
function useContactChoice(): ContactChoice {
  const [choice, setChoice] = useState<ContactChoice>({ status: "loading" });
  useEffect(() => {
    const abort = new AbortController();
    fetchContactSettings(abort.signal).then(
      (settings) => { if (!abort.signal.aborted) setChoice(chooseContact(settings)); },
      () => { if (!abort.signal.aborted) setChoice({ status: "none" }); }
    );
    return () => abort.abort();
  }, []);
  return choice;
}

const ContactAction: FC<{ contact: ContactChoice }> = ({ contact }) => {
  const { t } = useI18n();
  if (contact.status === "loading") return null;
  if (contact.status === "none") return <p className="text-sm text-neutral-500 dark:text-neutral-400" data-testid="manage-contact-unavailable">{t(MANAGE.contactUnavailable)}</p>;
  // Phone opens the dialler; Zalo and Messenger open in a new tab with no referrer, so this address never reaches them.
  return <ButtonSecondary href={contact.href as Route} targetBlank={contact.kind !== "phone"}>{t(MANAGE.contact)}</ButtonSecondary>;
};

const FIELD =
  "block w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-primary-300 focus:ring focus:ring-primary-200 focus:ring-opacity-50 dark:border-neutral-700 dark:bg-neutral-900";

/** Estimated arrival: the property's own wall clock. Nothing here is converted through the browser's time zone. */
const ArrivalForm: FC<{ reservation: ManagedReservation; save: SaveState; onSubmit: (date: string, time: string) => void; onCheckAgain: () => void }> = ({
  reservation,
  save,
  onSubmit,
  onCheckAgain,
}) => {
  const { t, has } = useI18n();
  const dates = useDateFormat();
  const message = useApiMessage();
  const [first, second] = arrivalDates(reservation.checkIn);
  const estimate = reservation.estimatedArrival;
  const [date, setDate] = useState(estimate && [first, second].includes(estimate.arrivalDate) ? estimate.arrivalDate : first);
  const [time, setTime] = useState(estimate?.arrivalTime ?? "");
  // A newly read reservation (after a save or a re-read) shows the server's value in the fields.
  useEffect(() => {
    setDate(estimate && [first, second].includes(estimate.arrivalDate) ? estimate.arrivalDate : first);
    setTime(estimate?.arrivalTime ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate?.arrivalDate, estimate?.arrivalTime, estimate?.updatedAtUtc, reservation.reservationId]);

  const cancelled = reservation.status === "Cancelled";
  const checkingRefusal = save.status === "conflict" && save.checking;
  const busy = save.status === "saving" || save.status === "verifying" || checkingRefusal;
  const locked = cancelled || busy || save.status === "unverified" || save.status === "conflict";
  const canCheckAgain = save.status === "unverified" || (save.status === "conflict" && !save.checking);
  const zone = reservation.propertyTimeZoneId;
  const dateId = "manage-eta-date";
  const timeId = "manage-eta-time";
  const noteId = "manage-eta-note";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(date, time);
  };

  const statusText =
    save.status === "saving" ? t(MANAGE.etaSaving)
    : save.status === "verifying" ? t(MANAGE.etaVerifying)
    : save.status === "saved" ? t(MANAGE.etaSaved)
    : save.status === "unverified" ? t(MANAGE.etaUnverified)
    : "";
  const errorText = save.status === "error" || save.status === "conflict" ? (has(save.messageKey) ? t(save.messageKey) : message(save.messageKey)) : "";

  return (
    <form className="space-y-5" onSubmit={submit} aria-labelledby="manage-eta-title" noValidate>
      <h3 id="manage-eta-title" className="text-2xl font-semibold">{t(MANAGE.etaTitle)}</h3>
      <p id={noteId} className="text-sm text-neutral-6000 dark:text-neutral-300">{t(MANAGE.etaHelp, { zone })}</p>
      <p className="text-sm font-medium" data-testid="manage-eta-current">
        {estimate ? t(MANAGE.etaCurrent, { date: dates.stayDate(estimate.arrivalDate), time: estimate.arrivalTime, zone: estimate.timeZoneId }) : t(MANAGE.etaNone)}
      </p>
      {cancelled && <p role="status" className="text-sm text-amber-600 dark:text-amber-400">{t(MANAGE.etaCancelled)}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={dateId} className="mb-1 block text-sm font-medium">{t(MANAGE.etaDate)}</label>
          <select id={dateId} className={FIELD} value={date} disabled={locked} aria-describedby={noteId} onChange={(e) => setDate(e.target.value)}>
            {[first, second].map((value) => (
              <option key={value} value={value}>{dates.stayDate(value)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={timeId} className="mb-1 block text-sm font-medium">{t(MANAGE.etaTime)}</label>
          <input id={timeId} type="time" step={60} className={FIELD} value={time} disabled={locked} aria-describedby={noteId} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div className="min-h-[1.5rem]" role="status" aria-live="polite" data-testid="manage-eta-status">
        {statusText && <p className={`text-sm ${save.status === "saved" ? "text-green-600 dark:text-green-400" : "text-neutral-6000 dark:text-neutral-300"}`}>{statusText}</p>}
      </div>
      {errorText && <p role="alert" className="text-sm text-red-600 dark:text-red-400" data-testid="manage-eta-error">{errorText}</p>}
      <div className="flex flex-wrap gap-3">
        {canCheckAgain ? (
          <ButtonSecondary type="button" onClick={onCheckAgain}>{t(MANAGE.etaCheckAgain)}</ButtonSecondary>
        ) : (
          <ButtonPrimary type="submit" disabled={locked} loading={busy}>{busy && !checkingRefusal ? t(MANAGE.etaSaving) : t(MANAGE.etaSave)}</ButtonPrimary>
        )}
      </div>
    </form>
  );
};

/** Exported for the money-block regression test (`reservationManagementMoney.test.ts`). */
export const Details: FC<{
  reservation: ManagedReservation;
  save: SaveState;
  onSubmit: (date: string, time: string) => void;
  onCheckAgain: () => void;
  contact?: ContactChoice;
}> = ({ reservation, save, onSubmit, onCheckAgain, contact = { status: "loading" } }) => {
  const { t, has, content, formatLocale } = useI18n();
  const dates = useDateFormat();
  const stay = useStaySearch();
  // The booked property is looked up in the whole public catalog the provider already loaded (a booking may belong to any property, not only Riverside).
  const property = stay ? resolveProperty(stay.properties, reservation.propertyId) : undefined;
  const nights = calculateNights(reservation.checkIn, reservation.checkOut);
  const cancelled = reservation.status === "Cancelled";
  const money = (amount: number) => formatAsGiven(amount, reservation.currencyCode, formatLocale);
  const statusKey = `customer.booking.reservation.status.${reservation.status}`;

  return (
    <div className="w-full flex flex-col space-y-10 px-0 sm:p-6 xl:p-8">
      <div className="space-y-3">
        <h2 className="text-3xl lg:text-4xl font-semibold">{t(MANAGE.title)}</h2>
        <p className="text-neutral-6000 dark:text-neutral-300">{t(MANAGE.intro)}</p>
      </div>
      {cancelled && <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{t(MANAGE.cancelledNotice)}</p>}
      <div className="border-b border-neutral-200 dark:border-neutral-700" />
      <div className="space-y-4">
        <Row label={t("customer.receipt.bookingCode")}><span className="font-mono text-sm">{reservation.confirmationNumber}</span></Row>
        <Row label={t("customer.receipt.status")}>{has(statusKey) ? t(statusKey) : reservation.status}</Row>
        <Row label={t(MANAGE.property)}>
          {property ? content("property", property.id, "name", property.name ?? "The BHA") : "The BHA"}
          {property?.address && <span className="block text-sm font-normal text-neutral-500 dark:text-neutral-400">{property.address}</span>}
        </Row>
        <Row label={t("customer.receipt.stayDates")}>
          {dates.stayDate(reservation.checkIn)} → {dates.stayDate(reservation.checkOut)}
          {nights !== null && <span className="block text-sm font-normal text-neutral-500">{t("customer.booking.nights", { nights })}</span>}
        </Row>
        <Row label={t("customer.receipt.guests")}>
          {t("customer.booking.adults", { adults: reservation.adults })}{reservation.children > 0 ? `, ${t("customer.booking.children", { children: reservation.children })}` : ""}
          <span className="block text-sm font-normal text-neutral-500">{t("customer.booking.rooms", { rooms: reservation.rooms })}</span>
        </Row>
      </div>
      <div className="space-y-4" data-testid="manage-money">
        <h3 className="text-2xl font-semibold">{t(MANAGE.moneyTitle)}</h3>
        <Row label={t("customer.receipt.payment")}>{t("customer.receipt.paymentMethod.PayAtProperty")}</Row>
        <Row label={t("customer.receipt.total")}><span data-testid="manage-total">{money(reservation.totalAmount)}</span></Row>
        {reservation.ledgerState === "Recorded" ? (
          <>
            <Row label={t("customer.receipt.collected")}><span data-testid="manage-collected">{money(reservation.collectedAmount ?? 0)}</span></Row>
            {/* A cancelled booking is not offered as "still to pay": the API keeps the folio's balance, but what is owed after a cancellation is the property's to say. */}
            {!cancelled && <Row label={t("customer.receipt.balanceDue")}><span data-testid="manage-balance">{money(reservation.balanceDueAmount ?? 0)}</span></Row>}
          </>
        ) : (
          <Row label={t("customer.receipt.collected")}><span data-testid="manage-not-recorded">{t(MANAGE.ledgerNotRecorded)}</span></Row>
        )}
        {!cancelled && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t(MANAGE.payAtPropertyNote)}</p>}
      </div>
      <div className="border-b border-neutral-200 dark:border-neutral-700" />
      <ArrivalForm reservation={reservation} save={save} onSubmit={onSubmit} onCheckAgain={onCheckAgain} />
      <div className="flex flex-wrap gap-3">
        <ButtonPrimary href="/">{t(MANAGE.moreProperties)}</ButtonPrimary>
        <ContactAction contact={contact} />
      </div>
    </div>
  );
};

/** Exported for the support-channel regression test (`reservationManagementContact.test.ts`). */
export const Problem: FC<{ failure: ManageFailure; onRetry?: () => void; contact?: ContactChoice; loginHref?: string }> = ({ failure, onRetry, contact = { status: "loading" }, loginHref = LOGIN_PAGE }) => {
  const { t } = useI18n();
  const signIn = failure === "session-invalid" || failure === "no-access";
  return (
    <div role="alert" data-testid="manage-failure" data-failure={failure} className="w-full space-y-6 px-0 sm:p-6 xl:p-8">
      <h2 className="text-3xl lg:text-4xl font-semibold">{t(MANAGE.title)}</h2>
      <p className="text-neutral-6000 dark:text-neutral-300">{t(FAILURE_KEY[failure])}</p>
      <div className="flex flex-wrap gap-3">
        {onRetry && READ_RETRYABLE.has(failure) && <ButtonPrimary type="button" onClick={onRetry}>{t(MANAGE.retry)}</ButtonPrimary>}
        {signIn && <ButtonSecondary href={loginHref as Route}>{t(MANAGE.signIn)}</ButtonSecondary>}
        <ContactAction contact={contact} />
        <ButtonSecondary href="/">{t(MANAGE.moreProperties)}</ButtonSecondary>
      </div>
    </div>
  );
};

const Status: FC<{ messageKey: string; children?: React.ReactNode }> = ({ messageKey, children }) => {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite" data-testid="manage-status" className="w-full space-y-4 px-0 sm:p-6 xl:p-8">
      <p className="text-neutral-6000 dark:text-neutral-300">{t(messageKey)}</p>
      {children}
    </div>
  );
};

/**
 * Reads what the address fragment holds and removes it at once: first through `history.replaceState` with the entry's own state, then through the App Router,
 * which keeps its own copy of the address and would write the secret back on every `router.refresh()`.
 */
function takeFragment(router: ReturnType<typeof useRouter>): LinkOffer {
  const offer = parseManageFragment(window.location.hash);
  if (window.location.hash !== "") {
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(window.history.state, "", clean);
    router.replace(clean as never);
  }
  return offer;
}

/**
 * BHA-CHECKOUT-001-PR09. The link secret is read from the address fragment ONCE, the fragment is removed at once (first through
 * `history.replaceState` with the entry's own state, then through the App Router, which keeps its own copy of the address and would write the
 * secret back on every `router.refresh()`, e.g. a language switch), and the secret goes only to the controller, which sends it in one request body.
 * What is shown is only what the controller holds for exactly this reservation and this verified identity.
 */
const ManageReservation: FC<{ reservationId: string }> = ({ reservationId }) => {
  const id = canonicalReservationId(reservationId);
  const router = useRouter();
  const { t } = useI18n();
  const { state: session, refreshSession, verifySession } = useCustomerSession();
  const stay = useStaySearch();
  const refreshRef = useRef(refreshSession);
  refreshRef.current = refreshSession;
  const verifyRef = useRef(verifySession);
  verifyRef.current = verifySession;
  const [controller] = useState(() =>
    createReservationManagementController({
      exchange: (rid, token, stillCurrent, onHandedOver) => exchangeOnce(rid, token, exchangeManagementLink, stillCurrent, onHandedOver),
      whenExchangeSettled,
      read: (rid, signal) => readManagedReservation(rid, { signal }),
      update: updateEstimatedArrival,
      requestSessionRefresh: () => refreshRef.current(),
      verifySession: () => (verifyRef.current ? verifyRef.current() : Promise.resolve(null)),
    })
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const identityKey = verifiedOwnerKey(session);
  const contact = useContactChoice();
  // After signing in the owner comes back to this reservation's clean management address (built from the route's id alone: no query, fragment or link secret).
  const loginHref = (id && loginForReservationHref(id)) || LOGIN_PAGE;
  const stripped = useRef(false);

  useEffect(() => {
    stay?.ensureCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Once: after the first run the fragment is gone, and a second run must not read "no link" over the real one.
    if (stripped.current) return;
    stripped.current = true;
    controller.offerLink(takeFragment(router));
  }, [controller, router]);

  useEffect(() => {
    // A link opened in this very tab while the page stays mounted (paste into the address bar after a refusal) changes only the fragment: no new mount, no effect above.
    // Each such open is an explicit one: the fragment is removed at once and the controller sends at most one exchange for it. Our own cleaning fires no hashchange.
    const onHashChange = () => controller.openLink(takeFragment(router));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [controller, router]);

  useEffect(() => {
    if (id) controller.bind({ reservationId: id, identityKey });
  }, [controller, id, identityKey]);

  // PR09-C11: coming back to this tab (it may have been signed out, or switched to another account, elsewhere) hides the private details and asks the API again under a
  // re-verified session. `focus` and `visibilitychange` of the same return reach the controller twice; the second finds nothing private left to hide and does nothing.
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      controller.revalidate();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [controller]);

  // The view is invalidated while the commit that removes (or re-keys) it is applied, not in the passive cleanup that follows: a token that resolves between the two
  // would otherwise still find the old view current and a pending exchange or arrival update would be handed to the transport after the visitor left (PR09-C6).
  // Starting the work stays in the passive `bind` effect above (deferred one microtask in the controller), so StrictMode's mount-unmount-mount costs no link.
  useIsoLayoutEffect(() => () => controller.dispose(), [controller, id, identityKey]);

  const body = () => {
    if (!id) return <Problem failure="invalid-id" contact={contact} />;
    // An explicit link open that stopped because the session could not be verified keeps its guidance (reopen the original e-mail link) while the identity is unverified,
    // also when the provider says "unknown". The button only reads the session again: it never opens the link (the token is gone).
    if (identityKey === null && state.openFailure?.reservationId === id) {
      return (
        <>
          <Problem failure={state.openFailure.failure} contact={contact} loginHref={loginHref} />
          {session.status === "unknown" && (
            <div className="w-full px-0 sm:px-6 xl:px-8 pt-4">
              <ButtonPrimary type="button" onClick={refreshSession}>{t(MANAGE.retry)}</ButtonPrimary>
            </div>
          )}
        </>
      );
    }
    if (session.status === "unknown") {
      return (
        <Status messageKey={MANAGE.identityUnknown}>
          <ButtonPrimary type="button" onClick={refreshSession}>{t(MANAGE.retry)}</ButtonPrimary>
        </Status>
      );
    }
    // Between a change of identity and the controller's reaction nothing of the old view is shown.
    if (identityKey === null || !isStateFor(state, id, identityKey) || state.phase === "waiting") return <Status messageKey={MANAGE.loadingSession} />;
    if (state.phase === "exchanging") return <Status messageKey={MANAGE.loadingLink} />;
    if (state.phase === "loading") return <Status messageKey={MANAGE.loadingReservation} />;
    if (state.phase === "failed" && state.failure) return <Problem failure={state.failure} onRetry={controller.retry} contact={contact} loginHref={loginHref} />;
    if (state.phase === "ready" && state.reservation) {
      return (
        <Details
          reservation={state.reservation}
          save={state.save}
          onSubmit={(arrivalDate, arrivalTime) => controller.submitArrival({ arrivalDate, arrivalTime })}
          onCheckAgain={controller.verifySave}
          contact={contact}
        />
      );
    }
    return <Status messageKey={MANAGE.loadingReservation} />;
  };

  return (
    <div className="nc-ManageReservation">
      <main className="container mt-11 mb-24 lg:mb-32">
        <div className="max-w-4xl mx-auto">{body()}</div>
      </main>
    </div>
  );
};

export default ManageReservation;
