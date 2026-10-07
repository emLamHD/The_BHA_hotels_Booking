# PMS-CAL-001.5-CP03-C3 — a storage read that throws is not "nothing was recorded"

> Correction of Draft PR #71 (`feat/pms-cal-001-5-inflight-reload-safety`). Not merged. Owner decides Ready/merge.
> Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only).
> Scope: Admin Web only. Writes remain local-Development with no Admin authentication/RBAC — this is not a public-production claim.

## Finding, cause, fix

**Finding (Codex P2 on C2):** if `getItem` throws while a page restores, `restoreOutcomes` (unconfirmed record) and `restoreUncertainWrites` (intent record) returned empty with `unreadable: false`. The board had no warning and no locks; once storage answered again, `beginPendingWrite` saw valid intents but nothing brought them into the lock refs, and an overlapping request could be sent.

**Root cause:** a failed read was folded into "verified empty". Restoration ran once (mount, or `pageshow`), so nothing ever finished it.

**Fix**
- `uncertainWriteStorage.ts`: `RestoredUncertainWrites.incomplete`. A `getItem` that throws on either key, or a `null` storage in a browser (`window` defined), sets it. It is distinct from `unreadable` (something was read and is damaged) and from verified-empty. Server render (`window` undefined) is not a failure. The other key's entries are still returned. Persisted formats unchanged.
- `ReservationBoard.tsx`:
  - `restoreStoredWrites` is the former `pageshow` body, extracted and shared: dedupes by identity/intent, excludes actual in-flight and (via C2) known-cleanup tokens, puts **both** lists into the lock refs (`persist: false`), then records `incomplete`, then persists once.
  - `persistTracked` writes nothing while `incomplete` (its lists lack the unread record; that would delete it) and releases no intent.
  - The restoration is retried by: the operator's **Check storage again** button, every board read (`retryStorage`, via the no-op list-update path), `pageshow(persisted)`, and the pre-send gate. It requests a board GET only when it took entries in, so a storage that keeps failing causes no GET loop.
  - `refuseWhileStorageUnverified()` is the first statement of all five submit paths (assign, move — including drag-to-dialog —, unassign, block create, block cancel), before `isRoomLocked` and before `beginPendingWrite`. It reads the ref synchronously, retries the restoration, and only then decides — so a dialog opened, or a click made, before any re-render still meets the recovered locks. While the restoration stays incomplete the send is refused (`not-sent`, 0 POST).
  - Banner `unverified-storage-writes`: says the tab could not read the safety records, that changes are not sent until they can be, and that nothing new was sent; it offers **Check storage again**. It does not say that no earlier request exists and does not advise reloading or closing the tab.

## RED → GREEN

- Start `9d8e1ad`: targeted suite 106 passed.
- RED (new tests on unchanged source): `npx vitest run …uncertainWriteStorage.test.ts …ReservationBoardCrossWriteLock.test.tsx` → **exit 1, 30 failed / 101 passed (131)**. Five of them are the "readable again before the first confirm" cases: each of the five operations **sent one overlapping POST** (`expected 1 to be +0`). Others fail for the missing banner/notice or because `incomplete` did not exist. (Five older assertions that pinned the result shape were updated for the new field; they fail RED only for that reason. The other 25 failures are new behaviour tests: 20 board-level, 5 unit.)
- GREEN after the fix: same command → **exit 0, 2 files, 131 passed**.
- Guard probes (source restored, `cmp` identical after each):
  - P1 read error back to confirmed-empty → 24 failed.
  - P2 pre-send gate removed → 10 failed (all five operations, both variants).
  - P3 persist over an unread record → 3 failed (the cases where the unconfirmed record is the unread one; the overwrite would delete it).

## Matrix (what the tests assert: storage contents, notices, POST counts, remount)

| Case | Result |
|---|---|
| Pending key read fails at mount → recovery → overlapping confirm (all five operations, dialog opened before recovery) | 0 POST; first refused with the unverified message, then, once readable and without any operator re-check, refused as "still unconfirmed"; lock notice present; banner gone; intent handed over. |
| Same, storage readable again before the first confirm | 0 POST for all five operations (RED sent 1 each). |
| Unconfirmed key read fails | Same; the durable outcome is never rewritten while unread (record byte-identical), then returns with one notice and one remount notice. |
| Assignment in one key + block in the other; pending unread / uncertain unread / both unread | What is readable is locked at once; storage unchanged through range changes; after recovery each write appears once, pending emptied, record holds 1 + 1; reload shows each once; 0 POST. |
| Still unreadable at Check storage again / Confirm | Banner stays, 0 GET, 0 POST, no new intent, record unchanged, no exception in the UI. |
| Verified empty after failure | Banner closes, no notice, no replay; a deliberate confirm sends exactly 1 POST. |
| Recovery, then re-read shows nothing new | Lock stays; unrelated room (201) and adjacent nights (102 next night) usable; Check again = 1 GET. |
| `pageshow(persisted)` ×2, ordinary board read | Each retries the restoration; no duplicates. |
| Same write in both records | One notice. |
| Unit: read throws (each key, both), corrupt payload, verified empty, `null` storage in a browser vs no `window` | `incomplete` true / `unreadable` true / both false / true / false respectively. |
| Storage never written: guest name, confirmation number, reason, auth data | Unchanged (record formats untouched). |

Old assertions that pinned "read fails = empty, no warning" (`restoreUncertainWrites(refusing|null)`) were changed to `incomplete: true`; that behaviour was the defect.

## Checks (this session, final source)

From `Front_End/Admin_Web`: targeted vitest **131 passed**; `npm test` **29 files / 672 tests passed**; `npm run lint` exit 0; `npx tsc --noEmit` exit 0; `npm run build` exit 0. Root: `git diff --check` clean. Lockfile untouched.

Size (before this report): correction 4 files, +600 / −55 (source +150 / −48, of which the `pageshow` extraction is largely moved code; tests +450 / −7). It is above 100–400 because the finding touches five submit paths, two records and every retry route, and the tests are table-driven across them.

## UI_LIVE: PARTIAL

Environment created by this session and removed after: isolated database `thebha_c3_live` (migrated, `--seed-development`, one SQL-inserted reservation unit with unassigned nights); API from `dotnet run --launch-profile https` with the mkcert leaf; Admin Web as a production build behind an HTTPS proxy on `https://localhost:3001` (scratch script outside the tree) so Chrome's real back/forward cache applies. No TLS or write-gate bypass.

| Step | Real | Seeded / injected |
|---|---|---|
| Board GETs, real API + PostgreSQL | real | — |
| `pagehide persisted=true` / `pageshow persisted=true` (navigate to `/signin`, history back) | real Chrome bfcache | — |
| A pending intent (block, room 102, one night) | — | seeded into `sessionStorage` |
| `getItem` refused for the pending key / both keys | — | page-side override |
| Assign dialog opened, room 102 chosen, Assign clicked | real UI | — |

Evidence (POST/GET counts from an in-page `fetch` wrapper, not server logs; the extension's network tool was not used):
- After the bfcache return with the read refused: banner shown, no notice, `pendingWrites` still holds the intent, POSTs = 0.
- Assign clicked while refused: dialog message "Nothing was sent: this browser tab could not read the safety records…", POSTs = 0.
- Storage readable again, **no board action by the operator**, same Assign clicked: "An earlier request for this room on overlapping nights is still unconfirmed", POSTs = 0, banner gone, one block notice, `pendingWrites` = null and the unconfirmed record holds the block, one board GET scheduled. No reload.
- Block dialog: room 102 same night → refused as unconfirmed; room 201 same night and room 102 the next night → no refusal at review (client guard only; I did not confirm the creation).
- Check again → exactly 1 GET, 0 POST. Idle for 4 s → 0 GETs.
- Second round, both records refused with a new seeded assignment intent: after the bfcache return the banner is up and the earlier block is still warned; Check storage again clicked twice: 0 GETs, record byte-identical, 0 POST; storage readable → the assignment notice appears (assignments 1, blocks 1 in the record), `pendingWrites` = null, 1 GET, POSTs = 0.
- A first attempt at driving the block dialog by script hung the page and produced ~20 GETs; the app was idle afterwards and the steps repeated one at a time showed 0 GET per dialog action and 1 per Check again, so this was the test script, not a loop in the app. Recorded for transparency.
- Cleanup: servers and proxy stopped, `thebha_c3_live` dropped, credentials file shredded, tab closed; other databases and the Postgres container untouched.
- What live did not cover: the cancel/move/unassign dialogs (jsdom only), and a real permanent refusal of `sessionStorage` (`null`), which is unit-tested. jsdom `pageshow` is not counted as evidence.

## Semantics

- **Incomplete** = a read threw or storage could not be reached; nothing is assumed; writes closed; readable entries locked; nothing written over unread records. **Corrupt** = something was read and is damaged; unchanged from C2 (valid entries kept, banner, no overwrite). **Confirmed empty** = both records read and empty; only then do writes reopen by the ordinary guards.
- The gate closes only for the duration of the failure; recovery reopens it and leaves exactly the room/night locks the records justify.

## Skill policy, deviations, residuals

- `diagnosing-bugs`: not invoked — the root cause was specific and the red/green matched. Graphify: not used (source and tests sufficed).
- Deviation: none from the assigned scope; only allowed files changed.
- Residual: a tab whose `sessionStorage` is refused for good stays gated (banner, sends refused with the storage message) — no durable state can be claimed. A read failure that begins after a page is already live is only noticed at the next `pageshow`, board-read retry or send attempt that touches storage, not continuously. Same-tab only, no server idempotency, no Admin authentication/RBAC. The C2 note remains: a damaged pending record refuses new writes.
- Source drift outside scope: none found.

## Review

`REVIEW: NOT RUN` at the time of writing — Owner invokes `/codex:review --base origin/develop`.
