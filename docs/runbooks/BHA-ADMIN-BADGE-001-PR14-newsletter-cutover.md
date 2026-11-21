# Runbook — Newsletter activity cutover (BHA-ADMIN-BADGE-001-PR14)

Contract and decisions: `docs/ADR/0011-admin-menu-activity-and-unseen-badges.md` §E (the ADR is still `Proposed`; this runbook does not accept it). This page is what an operator does. **Nothing here has been run on a real environment by the work item that wrote it.** The cutover is an explicit operator command with its own confirmations; no startup step and no migration runs it.

## What changes, in one paragraph

Until the cutover the Newsletter's activity (one row per verification) lives only in `NewsletterVerificationActivities`. The cutover copies the rows that **still exist** into `AdminActivities` (same `Sequence`, same time, actor `Public`, title "a subscription"), writes the one-row marker `MenuActivityCutovers`, and from then on the shared table is the only source. After it, **deleting a subscription keeps its shared activity** (and adds one `Staff` delete event); the legacy table stays one more release for diagnosis, and a legacy insert is refused by a fence. History that the old cascade already deleted **before** the cutover cannot be recovered and no actor is guessed.

## Order (steps 3 and 4 may not be swapped)

| # | Step | Evidence to keep |
|---|---|---|
| 1 | **Migration 27 (`AddNewsletterActivityCutover`)**, additive: marker table + an *inert* fence trigger on `NewsletterVerificationActivities`. `dotnet ef database update …` as for any migration. | `__EFMigrationsHistory` shows `20261121162308_AddNewsletterActivityCutover`; `SELECT count(*) FROM "MenuActivityCutovers"` = 0. |
| 2 | **Deploy the API build that knows the marker** (this release). With no marker it reads **and writes the legacy table** exactly as before; the legacy `GET/POST /api/admin/v1/website/menu-unseen` routes and the Newsletter Hub stay for an older Admin build. | The build id in service. |
| 3 | **Retire every API instance and worker that runs an older build** (including a background dispatcher that shares the build). Record, **per instance**, the build that was in service and the time it stopped. | A table: instance, old build, stopped at. An old build knows nothing of the marker or the lock order and would be refused by the fence, but it must not be running when the command starts. |
| 4 | **Run the cutover command, once** (below). Do not create a Staff account while it runs (Staff accounts are only created by the API's CLI; this is what keeps "existed at the cutover" unambiguous). | The command's output (it prints no secret). |
| 5 | **Check** (below): marker, sequence, count per cursor. | The query results. |
| 6 | **Deploy the new Admin build** (it opens only the shared activity Hub and reads the shared routes). | The Admin build id. |
| 7 | **Confirm the old Admin build has left the rollout** (no instance, tab-serving cache or CDN still serves it) before anything removes the old routes or Hub. Removing `website/menu-unseen`, `newsletter-live` and the legacy table is a **later release**, not this one. | The same table as step 3, for Admin. |

## The command

```bash
dotnet TheBha.Api.dll --newsletter-activity-cutover \
  --expected-database <name from current_database()> \
  --confirm-older-api-retired \
  --confirm-no-staff-creation \
  [--lock-timeout-seconds 30]
```

It refuses (exit **2**, nothing changed) unless **all three** are given, and exits **3** if `--expected-database` is not the database this process is connected to. The two `--confirm-…` flags are the operator's statement that step 3 is done and that no Staff account is being created; the command cannot verify either.

What it does, in **one transaction** (READ COMMITTED), in this order:

1. `SET LOCAL lock_timeout` and `LOCK TABLE "NewsletterVerificationActivities" IN SHARE ROW EXCLUSIVE MODE`. It waits for every legacy writer already in flight (a verification insert, or the cascade delete of a subscription) and blocks every later one until it ends; plain reads are not blocked.
2. Only then the clock is read (`CutoverAtUtc`, from the same clock that stamps `StaffAccounts.CreatedAtUtc`), and the `newsletter` counter row is locked.
3. If the marker exists: nothing is copied, it reports the marker. If `AdminActivities` already holds `newsletter` rows with no marker: **abort** (never merged).
4. Copy exactly the legacy rows that exist now, then insert the marker once: `LegacyMaxSequence` = the counter's `LastSequence` **under the lock** (a deleted tail does not lower it), `CutoverAtUtc` as above. COMMIT.

**Run it at low traffic.** While the command waits for an in-flight writer it holds a pending lock request, so a verification or a Staff write that starts meanwhile queues behind it until it gets the lock or `--lock-timeout-seconds` runs out (30 s by default, 600 at most). A shorter timeout limits that wait; a timeout commits nothing in that run (see below) and the command can simply be run again.

| Exit | Output | Meaning | What to do |
|---|---|---|---|
| 0 | `COMMITTED` | PostgreSQL **confirmed** the commit: copied N rows, marker written | step 5 |
| 0 | `ALREADY DONE` | the marker already existed; **nothing was copied or changed** | step 5 |
| 1 | `LOCK TIMEOUT after Ns` | the **server** answered 55P03 before **this run** requested any COMMIT and before it read the marker: **this run** committed nothing. It says **nothing** about an earlier run (it may have ended in `OUTCOME UNKNOWN`) and nothing about which source is in use | run the same command again later (a short wait for the lock is normal while a verification is in flight). If an earlier run was `OUTCOME UNKNOWN`, it **stays unknown** until a run gets past the lock and reads the marker |
| 1 | `failed — the server answered with an error (SQLSTATE …)` | **this run's** transaction was not committed (the server rejected a statement or the COMMIT itself). Nothing about an earlier run | run the same command again; if it repeats, read the SQLSTATE and stop |
| 1 | `failed (…) before COMMIT was requested` | an error on the connection before COMMIT was sent, so **this run** committed nothing. Nothing about an earlier run | run the same command again (it is idempotent) |
| **5** | **`OUTCOME UNKNOWN`** | COMMIT **was requested and its answer never arrived** (lost connection, timeout, cancellation). **It may or may not have committed; nothing is claimed in either direction.** The command does **not** retry | **Do not assume rollback and do not assume success.** Run the **same command again on the same database** (below) |
| 2 | usage | a confirmation or the database name is missing | fix the arguments |
| 3 | `REFUSED` | `--expected-database` is not this database | fix the target |
| 4 | `ABORTED` | `AdminActivities` has `newsletter` rows but no marker | stop and investigate; do not delete rows to "make it work" |

**After `OUTCOME UNKNOWN`** — run the **same command again, on the same database** (same `--expected-database`). It takes its locks first (the legacy table, then the counter row), and only then checks the marker and decides whether to copy; it is idempotent:

| The rerun says | It means |
|---|---|
| `ALREADY DONE` (exit 0) | the earlier run **did commit**; nothing was copied twice and the marker did not move. Carry on with step 5 |
| `COMMITTED` (exit 0) | the earlier run did **not** commit (the rerun held the locks, so the earlier transaction had ended, and found no marker); this run did the cutover |
| `LOCK TIMEOUT` (exit 1) | the rerun did not get the lock, so it **never read the marker**: the earlier outcome is **still unknown**. Run it again later |
| anything else | the earlier outcome is still unknown; fix the cause and run it again |

Optionally, on a **new connection to the same database**:

```sql
SELECT "LegacyMaxSequence", "CutoverAtUtc" FROM "MenuActivityCutovers" WHERE "MenuKey" = 'newsletter';
```

**One row means the cutover committed** (the copy is in `AdminActivities`; carry on with step 5). **No row proves nothing**: the earlier transaction may still be completing, so a `SELECT` that does not see the marker must **never** be read as "it rolled back". Only a completed rerun (above) settles it.

**Timeouts.** The command sets the PostgreSQL `lock_timeout` to `--lock-timeout-seconds` and gives its database commands a client timeout 30 s longer, so the server always gives up first and answers 55P03 (the output then says `LOCK TIMEOUT`, not a transport error). Only the cutover's own commands get that longer timeout; the application's default is unchanged.

**After a `LOCK TIMEOUT` or a `failed …` line**: run the same command again; it is safe and starts from the beginning. Those lines describe **that run only**; if an earlier run ended in `OUTCOME UNKNOWN`, that outcome is settled only by a rerun that reaches the marker. **After a commit**: running it again only reports the marker; the marker and the copy are never redone. A committed cutover is **not reverted by a migration** (Down of migration 27 refuses while the marker exists); there is no "undo" command.

## Check (step 5)

```sql
-- the marker, once
SELECT "MenuKey", "LegacyMaxSequence", "CutoverAtUtc" FROM "MenuActivityCutovers";
-- the sequence: the counter did not move, and the next event takes the next number of the SAME row
SELECT "LastSequence" FROM "MenuActivityStreams" WHERE "MenuKey" = 'newsletter';       -- = LegacyMaxSequence right after the cutover
SELECT count(*), max("Sequence") FROM "AdminActivities" WHERE "MenuKey" = 'newsletter'; -- = rows that still existed, max <= LegacyMaxSequence
SELECT count(*) FROM "NewsletterVerificationActivities";                                -- equals the line above (the legacy copy is untouched)
```

Count per cursor (the number an existing Staff member sees must be the same before and after, at the same cursor): read `GET /api/admin/v1/menu-unseen` for a few Staff members before step 4 and after it and compare `menus.newsletter.count`, `lastSeenWatermark`, `currentWatermark`. A Staff member who existed at the cutover keeps every still-existing legacy event above their cursor (with or without a cursor row, including one older than the account); their cursor is never raised. A Staff member created **after** the cutover counts only events at or after their account was created.

## What is different afterwards

- A guest's verification, and a Staff **create, update or delete** of a subscription, append one event to the shared activity (the Staff ones only after the marker). Unsubscribe, archive, restore and invite append nothing (the ADR lists add, update and delete).
- The old `newsletterVerified` signal is still sent, beside the shared hint (`{ menuKey, propertyId? }` and nothing else), so the Admin build still in service during the rollout keeps working.
- **Deleting a subscription after the cutover keeps the imported verification and adds exactly one `Staff` delete event** (a change from before: a deleted subscription used to take its count with it). Deleting one **before** the cutover still reads 0 → 0.
- A legacy insert after the marker fails with SQLSTATE `BH014`. The API retries the verification transaction **once** when it sees exactly that error; a timeout, a deadlock or an unknown commit result is never retried. `BH014` showing up in a log after step 3 means an old build is still running: find it.

## Not covered

No Redis backplane or outbox (a hint reaches only the connections of the instance that committed; the 30 s poll covers the rest). No backfill of history the cascade already removed. No removal of the legacy tables, routes or Hub (a later release). No change to the ADR's status.
