# Runbook — Transactional e-mail outbox (BHA-CHECKOUT-001-PR03)

What an operator needs to know. **Nothing here is switched on by this PR: no booking handler, no booking template and no code path that queues a booking e-mail exists yet** (PR05 writes the events, PR04 supplies the Staff list, PR07 owns the templates and handlers). The provider (Resend) is a technical choice of PR03, not a locked production provider.

## How a mail travels

1. **Enqueue.** The business transaction calls `IEmailOutbox.EnqueueAsync` on its own open transaction. The event (type, schema version, Property, a small JSON object of ids) exists exactly when the caller's rows do. The same event id with the same content is a no-op; with other content it answers `Conflict` and changes nothing.
2. **Fan-out.** A registered `IEmailOutboxEventHandler` for that exact (type, version) turns the event into deliveries (one recipient + purpose each, message rendered once and stored protected) and the event becomes `Completed` in the same transaction. An event type nobody handles stays `Pending`, is never claimed and costs nothing, so PR05 may enqueue before PR07 exists.
3. **Send.** A delivery is claimed (lease + claim token), the claim is committed, then the provider is called with `Idempotency-Key: bha-email-{DeliveryId}`. Only the holder of the claim can finish or reschedule it.

## States and what they mean

| Delivery status | Meaning |
|---|---|
| `Pending` | Waiting for its time (`NextAttemptAtUtc`). |
| `Sending` | Claimed by a worker; if the lease runs out the next worker takes it over (an uncertain attempt). |
| `Accepted` | **The provider took the message over.** It is not proof the mail reached an inbox (no bounce, spam or open tracking exists here). The address and the message are erased. |
| `Failed` | The provider definitely did not process it and never will (a refusal of this message, or attempts used up on definite refusals only such as rate limits). Final. |
| `NeedsReconciliation` | The mail MAY have been sent. Nothing more is sent. See below. |

An event is `Pending`, `Completed` (deliveries exist) or `Failed` (its handler kept throwing; bounded by `FanoutMaxAttempts`).

## Switches (all off by default, no `appsettings` change)

| Setting | Default | Effect |
|---|---|---|
| `Email:Outbox:DispatchEnabled` | `false` | Off: a pass claims nothing and spends no attempt. |
| `Email:Outbox:WorkerEnabled` | `false` | Starts the host's timer (every `WorkerPollSeconds`). The two flags are separate on purpose. |
| `Email:Outbox:Resend:ApiKey` | none | **Secret. Environment only** (`Email__Outbox__Resend__ApiKey`); never in a file, a log or the database. |
| `Email:Outbox:Resend:FromAddress` / `FromName` | none | The sender. Unconfigured (no key or no address) means no delivery is claimed and no attempt is spent; the queue waits. |
| `Email:Outbox:Resend:BaseUrl` | `https://api.resend.com` | Changeable only in Development (the host refuses it elsewhere), https only (http only for loopback). |
| `MaxAttempts` 6, `RetryBaseSeconds` 30, `RetryMaxSeconds` 1800, `RetryAfterMaxSeconds` 3600, `BatchSize` 20, `FanoutMaxAttempts` 5 | | Bounded backoff: doubling from the base to the cap; a provider `Retry-After` can lengthen a delay up to its own cap, never shorten it. |
| `LeaseSeconds` 90, `HttpTimeoutSeconds` 20 | | The host refuses a lease shorter than the timeout + 15 s. |
| `IdempotencyWindowMinutes` | 1320 (22 h) | The provider keeps a key for 24 h. The window counts from the FIRST attempt and must stay below 23 h. |

**Enable:** set the secret and the sender in the environment, then `DispatchEnabled=true` and `WorkerEnabled=true` and restart. **Disable:** set `DispatchEnabled=false` (the worker idles, the queue keeps everything). Turning dispatch on later sends whatever has queued meanwhile, including old events: check `SELECT status, count(*) FROM "EmailOutboxDeliveries" GROUP BY 1` before enabling after a long pause.

## Key ring (multi-process)

The recipient and the message are protected with ASP.NET Data Protection under their own purpose (`TheBha.EmailOutbox.Pii.v1`). **Every process that runs the dispatcher must share one persistent key ring** (`DataProtection:KeysPath` or the host's shared store). A process with another ring cannot read a delivery: it gives the attempt back (`LastOutcome = payload-unreadable`) and the delivery waits; a lost ring therefore blocks the queue, it does not lose or fail mail by itself.

## Ambiguous outcomes (the lost answer)

A timeout, a dropped connection, a 5xx or an answer that cannot be read is **unknown**: the provider may hold the mail. The delivery is retried with the same key, the same stored message and the same pinned sender and account, so the provider answers with the first result instead of sending again. It becomes `NeedsReconciliation` (nothing more is sent, no new key is ever issued) when:

- the retry would fall past the idempotency window (`window-expired`), counted from the first attempt;
- the account is not the pinned one (`account-changed`: the fingerprint is a hash of provider + endpoint + API key; **rotating the key inside the same account also triggers it, which is safe**);
- the provider says the key was used for another payload (`key-conflict`);
- attempts ran out after an uncertain attempt (`uncertain`).

A changed `FromAddress` does not create a new send: retries keep the sender pinned at the first attempt.

To reconcile, find the message in the provider's dashboard (search by the Idempotency-Key `bha-email-{DeliveryId}` or the recipient) and decide; there is no resend button and no HTTP route in PR03. A daily-quota 429 near the window edge also ends in `NeedsReconciliation` by design. `401/403/404/405` answers (key, domain or address wrong) give the attempt back and wait the longest backoff. **Fixing the configuration does not always let those deliveries proceed:** the first attempt pins the account, so a new API key (the usual fix for "API key is invalid") is a different account and the waiting deliveries become `NeedsReconciliation` (`account-changed`) even though the provider refused them and nothing was sent; the same happens to any pinned delivery that crosses the 22-hour window. This is deliberately conservative (it never claims "not sent" without evidence); check them against the provider's dashboard and re-queue by hand if appropriate.

## Looking at the queue

`IEmailOutboxFailures.ListAsync(propertyId, limit)` (backend only) lists a Property's `Failed` and `NeedsReconciliation` deliveries and `Failed` events: ids, status, attempts, outcome code, times, provider message id. It never returns an address, a message or a secret. Logs carry only ids and outcome codes; no address, subject, body, provider answer or key is logged.

## Migration and rollback

`AddTransactionalEmailOutbox` is additive: two tables, their indexes and constraints, one row trigger (`thebha_email_outbox_deliveries_frozen`). It reads and changes nothing that exists. `Down` locks both tables (`ACCESS EXCLUSIVE ... NOWAIT`) and **refuses while either holds a row**: drain or archive the queue first (a queued mail is a notification the previous schema has no place for). The tables are runtime data of one environment: the content pack never carries them (`ContentPackSpec.Excluded`). There is no retention policy yet; accepted deliveries keep their ids and times, not the address or message.

## Not done in PR03

No business e-mail, no live provider, no webhook or delivery tracking, no UI, no Admin/public HTTP route, no change to Newsletter (its queue, Gmail sender and secrets are separate and untouched).
