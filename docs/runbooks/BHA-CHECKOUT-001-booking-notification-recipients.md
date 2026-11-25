# Runbook — Booking notification recipients (BHA-CHECKOUT-001-PR04)

Who receives the booking e-mails of a Property, how a Manager changes it, and how an operator declares chain Managers. **PR04 itself sends nothing**: it only stores the preference and supplies the recipient list; PR07's handler and pre-send guard use it (`BHA-CHECKOUT-001-booking-confirmation-email.md`).

## Who can do what

| Actor | Can |
|---|---|
| Active Staff with **Manager** at the routed Property (`StaffPermission.BookingNotificationManage`) | Read the roster and change the preferences of **that** Property only |
| FrontDesk (any Property), Manager of another Property, website/blog global permission, customer, anonymous, disabled Staff | Nothing (401/403; the routes do not exist in `LocalGate`) |
| Operator (CLI / settings, never HTTP) | Create Staff and memberships (`--staff-create`, `--staff-grant`, `--staff-disable`), declare chain Managers (below) |

A FrontDesk member **may receive** mail but cannot administer it. The Property comes only from the route; the actor, role and Property are never read from the body. Saving here changes a notification preference only (no account, password, role, membership or e-mail).

## Admin screen and API

Admin_Web: **Email nhận đặt phòng** (`/booking-notifications`), for a Manager. It shows, per active FrontDesk/Manager of the selected Property, a masked account label (`d***@domain · #0f36aa6a`: first character of the login name, the login domain and a short Staff id — Staff have no display name; the login address itself is never sent to the browser and is never a recipient), a separate **Email nhận thông báo**, an on/off switch, and how the person is covered (`Chưa cấu hình`, own address, chain work address, opted out); plus the Property's **front-desk fallback**.

API (`/api/admin/v1/properties/{propertyId}/booking-notification-recipients`): `GET` (roster + fallback), `POST staff/{staffAccountId}/email` (save, or clear with a null/blank `email`), `POST staff/{staffAccountId}/enabled`, `POST fallback`. Every POST carries `expectedVersion` (0 = no row yet). Errors: `400 validation` (`field: email`), `404` (target is not an active FrontDesk/Manager of this Property), `409 stale-version`. A save that changes nothing writes no audit row and no version.

**Conflict handling:** a stale `expectedVersion` (another tab, another Manager, or a lost first-save race) is `409 stale-version`; nothing is changed, the UI keeps the draft and offers the server's current values. A write that got no answer is never resent by the UI.

**One address only:** trimmed, lower-cased, at most 254 characters, no control character (CR/LF anywhere is refused), no list (`,` `;` space). Dots, `+tags` and provider aliases are kept: `a.b@x` and `ab@x` are different addresses.

## The resolver (for PR07)

`IBookingNotificationRecipients.ResolveAsync(propertyId)` is internal (no route). It reads the **current** state on every call, opens no transaction and writes nothing, so it is safe inside the outbox fan-out transaction.

1. Candidates are active Staff with a FrontDesk or Manager membership **at that Property** (a disabled account or a revoked/downgraded membership stops qualifying on the next call; preference rows stay).
2. Per candidate (the four cases of a Staff member at one Property):

| Local row | Result |
|---|---|
| none | chain address if the person is a chain Manager **and** currently Manager here, else not a recipient |
| address, enabled | the local address (a local address wins over the chain one) |
| no address, enabled | same as no row (does **not** override the chain address) |
| disabled (with or without an address) | **opted out**: not a recipient and the chain address is blocked too |

3. Order is (local before chain, address ordinal, Staff id); a repeated address (case-insensitive, trimmed) keeps its first entry. 4. The Property **fallback** is added only when that list is empty. 5. No fallback and nobody eligible → an empty set (`IsEmpty`), never an error and never another Property's data.

Contract (`BookingNotificationRecipient`): `Key`, `Email`, `Kind` (`Staff` | `ChainManager` | `Fallback`), `StaffAccountId` (null for the fallback). **Recipient key** (fits `EmailDeliveryDraft.RecipientKey`, ≤128, no address inside): `staff:{StaffAccountId:N}` or `fallback:{PropertyId:N}`. It names *who* (the slot), not *which address*: the same person keeps the key when the address changes; two Staff who share an address collapse to the first by the order above (the key of the loser is never produced).

**Re-check before sending (PR07):** the dispatcher freezes the address at fan-out. Right before the provider call, PR07 asks `IsStillRecipientAsync(propertyId, address)` (or re-resolves and compares address). `false` means the person was disabled or lost the membership, opted out, or changed the address after fan-out: drop the delivery instead of sending to a stale address.

## Chain Managers (operator configuration)

Declared in settings (environment form), **empty by default**, validated at start-up (a bad entry stops the host):

```
BookingNotifications__ChainManagers__0__StaffId=<Staff account id (GUID)>
BookingNotifications__ChainManagers__0__Email=<declared work address>
BookingNotifications__ChainManagers__1__StaffId=...
```

Rules: one entry per Staff id (a duplicate stops the host); the address must be one valid address; no real address is ever seeded. A chain Manager receives **only at Properties where they currently hold Manager**; at a Property where they are only FrontDesk the chain address is ignored. A Property Manager cannot change this list and never sees the chain address (the roster only says `chainConfigured`). The list changes on restart; find a Staff id with `SELECT "Id","Email" FROM "StaffAccounts"`.

## Audit

`BookingNotificationAudits`: Staff actor (from the session), Property, target Staff (null for the fallback), action (`email-set|changed|cleared`, `enabled|disabled`, `fallback-set|changed|cleared`) and time, written in the same SaveChanges as the change. It has no address column; it is separate from the Calendar/Newsletter activity streams and the sidebar badge.

## Migration and rollback

`AddStaffBookingNotificationRecipients` is additive: `StaffBookingNotificationPreferences`, `BookingNotificationFallbacks`, `BookingNotificationAudits`. Nothing is backfilled; after `Up` every Property has no preference and no fallback, so **nobody receives mail until a Manager or the operator configures it**. The preference table has foreign keys to the Staff account and the Property only (not the membership), so revoking a membership is never blocked and an opt-out is never deleted by it. `Down` locks the three tables (`ACCESS EXCLUSIVE ... NOWAIT`) and **refuses while any holds a row**; export or clear them first. The tables are runtime data of one environment: the content pack never carries them (`ContentPackSpec.Excluded`).

## Not done in PR04

No worker, handler, template, outbox event, Resend call, failed-mail UI, mailbox provisioning or e-mail. No change to Staff provisioning, login, roles or memberships.
