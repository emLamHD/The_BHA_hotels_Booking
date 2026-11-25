# Runbook — Booking confirmation e-mails (BHA-CHECKOUT-001-PR07)

What is sent when a Direct (pay at the property) reservation is created, to whom, how to switch it on and off, and how to read what happened. It joins the `ReservationConfirmed` event (PR05), the e-mail outbox (PR03), the recipient resolver (PR04) and the guest management link (PR06). The pilot Property is The BHA Riverside. **Nothing is sent until the switches below are turned on; PR09 must be live at the link's origin first.**

## What is sent

One `ReservationConfirmed` v1 event (payload only `{"reservationId":"<guid>"}`, envelope `PropertyId`) becomes, in one fan-out transaction:

| Delivery | Purpose | Recipient key | Template | Recipient |
|---|---|---|---|---|
| Guest without account | `booking-confirmation.guest` | `guest:{reservationId:N}` | `booking-confirmation-guest` | the contact address stored on the reservation; **carries the one-use management link** |
| Account owner | `booking-confirmation.account` | `guest:{reservationId:N}` | `booking-confirmation-account` | the same stored address; **no link** |
| Property recipient (0..n) | `booking-confirmation.staff` | `staff:{id:N}` / `fallback:{propertyId:N}` | `booking-confirmation-staff` | each address `IBookingNotificationRecipients` returns for **that Property** (local before chain, duplicates collapsed, fallback only when the list is empty, opt-out respected). A Staff login address is never used. One `To` per person. |

Rules:
- Every query is scoped by `PropertyId` **and** `ReservationId`; the reservation must be `Source = Direct` and `Confirmed`. A reservation **cancelled** before the fan-out completes the event with no mail. A Hold-sourced reservation, an unknown reservation, another Property's reservation or a payload that is not exactly `{"reservationId":"<guid>"}` is refused: the event is counted like any handler failure (bounded by `FanoutMaxAttempts`) and its outcome is a fixed code — `payload-invalid`, `reservation-not-found`, `reservation-not-direct`, `reservation-not-confirmed`, `link-not-eligible`, `recipients-exceed-limit` (`handler-error` for anything else).
- A missing or invalid guest address skips only the guest mail (log `guest-address-invalid`, ids only); an empty Staff list skips only the Staff mail. Every eligible Property recipient gets its own delivery: nobody is dropped. One fan-out is bounded by `EmailOutboxLimits.DeliveriesPerEvent` = 200 (a sanity bound, raised from 20 in PR07); if a Property ever has 200 or more eligible recipients (plus the guest) the event is **refused** with outcome `recipients-exceed-limit` (counted, then `Failed`, listed by `IEmailOutboxFailures`), never silently truncated. That would need an Owner decision (split the fan-out or raise the bound).
- No new event is written for old reservations (no backfill): a reservation with no event gets no mail.
- Language: Vietnamese. A reservation and a customer have no stored locale, so `vi` is always used; EN and FR templates exist and render (tested) for the day a locale source is added (resolved in `BookingConfirmationEmailHandler`). Dates are `dd/MM/yyyy` (the stay dates are the Property's local dates), check-in time is `Property.CheckInTime` (14:00 for Riverside), the amount is the confirmed `Reservation.TotalAmount` (the room-charge snapshot) shown exactly, never rounded (whole VND without decimals, otherwise with its decimals; separators follow the locale), with the label "Thanh toán khi nhận phòng". The folio balance, collected amount and the estimated arrival are **not shown** (nothing has been collected or estimated at creation). Name, address and check-in time are read from the `Properties` row (`Name`, `Address`, `City`, `CheckInTime`).
- Subjects carry only the confirmation number and the Property name. Never a guest name, address, phone or link. Values are HTML-encoded in the HTML part by the renderer; the plain-text part is verbatim.

## The guest link

Issued **inside the fan-out transaction** by `IReservationManagementLinkIssuer.IssueAsync` (72 hours), next to the delivery insert and the event's completion: a failure before commit rolls both back, the retry makes one link. The URL is `{CustomerWebOrigin}/reservations/{reservationId:D}/manage#<secret>`. The origin is a static setting, never taken from a request. The secret is in the fragment only: not in the event payload, not in a delivery key, not in a subject or the Staff mail, not in the logs or failure query, and the stored message is Data Protection protected (erased when the provider accepts).

**PR09 handoff** (the page behind that URL, route chosen here because the repo has none): serve it over HTTPS with `Referrer-Policy: no-referrer`; read the secret from the fragment and remove it at once (`history.replaceState`); send it once in the body of `POST /api/v1/reservations/{id}/manage/exchange` with `credentials: "include"` and a CSRF token; write the reservation id **in the same form** (`{id:D}`, 36 characters, lower case) in the exchange and every later `/manage` call, because the session cookie's path follows the spelling of the exchange; treat a `401` as "ask for a new link" and never retry an exchange with the same secret.

## Switches

All off by default; no committed settings file turns anything on.

| Setting | Default | Effect |
|---|---|---|
| `Booking:ConfirmationEmail:Enabled` | `false` | The booking handler and templates are registered only when this is `true`, the origin is valid **and** the provider is configured. Otherwise `ReservationConfirmed` has no handler: the event stays `Pending`, spends no attempt and issues no link. |
| `Booking:ConfirmationEmail:CustomerWebOrigin` | none | An `https` origin with no path, query or fragment (e.g. `https://riverside.example`). A malformed value stops the host at start-up; a missing one leaves the feature inactive (a warning is logged when the worker starts). |
| `Email:Outbox:DispatchEnabled` / `WorkerEnabled` / `Resend:*` | off | PR03 gates, unchanged (see the outbox runbook). |

Switching `Booking:ConfirmationEmail:Enabled` off only stops **new fan-out**: deliveries already queued are still sent, and still re-checked. **To stop sending, set `Email:Outbox:DispatchEnabled=false`** (the queue keeps everything).

## Before enabling for real (Owner / operator, not done by this PR)

1. PR09's management page is deployed at the origin you will put in `CustomerWebOrigin` and answers `Referrer-Policy: no-referrer`.
2. The sending domain is verified at the provider and **click tracking is turned off for that domain**, so the secret URL goes straight to Customer_Web and is not rewritten through a tracking redirect ([Resend: custom tracking domain](https://resend.com/blog/introducing-custom-tracking-domain)). Open tracking is irrelevant to the link.
3. The key ring (`DataProtection:KeysPath`) is shared by every process that runs the dispatcher.
4. At least one Property recipient is configured for the Property (otherwise only the guest is mailed).
5. Check the backlog first: `SELECT "Status", count(*) FROM "EmailOutboxEvents" WHERE "EventType" = 'ReservationConfirmed' GROUP BY 1`. Every `Pending` event created while the feature was off will be mailed when it is turned on (no backfill rule does not mean no backlog): old links would be issued fresh at that time, so confirm with the business that mailing those reservations is wanted, or mark them `Completed` by hand first.

## Before each send

A guard runs on every attempt (retries included), outside any transaction, before the provider is called:

- **Every booking mail (guest, account, Property)** — the reservation named by the delivery's event is read again (scoped by Property). A reservation cancelled after fan-out stops the delivery with `reservation-cancelled` (`reservation-not-found` when it cannot be read), because every booking mail says the reservation is confirmed. This narrows the window, it cannot close it: a mail already handed to the provider before the cancellation commits was true when sent; no cancellation mail exists in PR07.
- **Property recipient** — `IsStillRecipientAsync(propertyId, frozenAddress)`. If the person was disabled, opted out, lost the membership or changed the address after fan-out, the delivery is **stopped** with outcome `recipient-revoked`. The frozen destination is never changed.
- **Guest with link** — stopped with `link-expired` when `now + HttpTimeout >= CreatedAtUtc + 72 h` (the link was issued after the delivery's fan-out instant, so this bound is never later than the real expiry). The guest needs a new link; there is no resend flow yet.

A stop is `Failed` when no earlier attempt can have reached the provider, and `NeedsReconciliation` when one may have (`UncertainSend`). The idempotency-window rule (a retry must finish inside 22 h of the first attempt, call timeout included) is applied again on the clock **after** the guard, so a slow guard cannot carry a retry past the provider's window: that delivery becomes `NeedsReconciliation` (`window-expired`) and nothing is sent. Two more rules are applied on a fresh clock after the guard, immediately before the provider call: pinning renews the claim's lease to a full `LeaseSeconds` (validated to exceed `HttpTimeout` by 15 s) while this claim still owns an unexpired lease, so a slow guard cannot leave less lease than the call needs; if the lease was already lost nothing is sent and the attempt the claim spent is returned (`lease-lost`, retried after `RetryBaseSeconds`) only if that claim still owns the row, so a worker that reclaimed it keeps its own attempt and repeated slow guards cannot use up the attempts without a provider call; and a guard's deadline (the guest link's life) must still leave room for the call, otherwise the delivery stops (`link-expired`). If the check itself cannot be made (database fault) the attempt is given back (`guard-unavailable`) and the delivery waits.

## Operating it

- **Accepted** means the provider took the message over, not that it reached an inbox (see the outbox runbook).
- **Look up failures by Property:** `IEmailOutboxFailures.ListAsync(propertyId, limit)` (backend only) — `Purpose`, `Status`, `Attempts` and the outcome code, never an address, message or secret. SQL: `SELECT "Purpose","Status","Attempts","LastOutcome","CreatedAtUtc" FROM "EmailOutboxDeliveries" WHERE "PropertyId" = '<id>' AND "Status" IN ('Failed','NeedsReconciliation') ORDER BY "CreatedAtUtc" DESC`. Events refused by the handler: `SELECT "Id","Status","FanoutAttempts","LastOutcome" FROM "EmailOutboxEvents" WHERE "PropertyId" = '<id>' AND "EventType" = 'ReservationConfirmed' AND "Status" <> 'Completed'`.
- **`NeedsReconciliation`** (an uncertain attempt, an expired idempotency window, a changed account, or a Staff stop after an uncertain attempt): the mail may have been sent. Find it in the provider's dashboard by the key `bha-email-{DeliveryId:N}`, then decide by hand. For a guest mail that never left, the guest needs a new link, which has no UI yet.
- **Backlog:** `SELECT "Status", count(*), min("NextAttemptAtUtc") FROM "EmailOutboxDeliveries" GROUP BY 1`. A growing `Pending` with `LastOutcome` of `payload-unreadable` is a key-ring fault; `guard-unavailable` is a database fault.
- **Expired link:** a `Failed` guest delivery with `link-expired` means the mail could not be sent inside the link's life. Nothing sends it later.
- A failed or stopped mail changes no reservation, inventory, folio or Calendar row.

## Rollback

No migration. Set `Booking:ConfirmationEmail:Enabled=false` (new events wait again) and, to stop in-flight mail, `Email:Outbox:DispatchEnabled=false`. Links already issued stay valid until they expire or are used (PR06).

## Not done in PR07

No checkout UI (PR08), no management page (PR09), no resend route or button, no mailbox provisioning, no prepaid checkout, deposit, QR or card, no hold or surcharge policy, no production rollout, no stored locale, no balance or ETA in the mail, no change to Hold, Newsletter or the dispatcher's send, retry and reconciliation rules (it gained only the per-purpose guard and a handler-supplied safe outcome code for a refused event).
