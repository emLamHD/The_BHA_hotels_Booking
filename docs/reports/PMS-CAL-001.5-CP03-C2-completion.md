# PMS-CAL-001.5-CP03-C2 — storage retry, restore and pending-record validation

> Correction of Draft PR #71 (`feat/pms-cal-001-5-inflight-reload-safety`). Not merged. Owner decides Ready/merge.
> Implementer: Claude. Reviewer: Codex (read-only, invoked by Owner only).
> Scope: Admin Web only. Writes remain local-Development with no Admin authentication/RBAC — this is not a public-production claim.

## Findings, causes, changes

| # | Finding | Root cause | Change |
|---|---|---|---|
| F1 | A known outcome (not sent, 400, 409, created…) whose intent storage would not delete was forgotten; after a reload/bfcache the token came back as a false "unknown" write with a warning and a lock. | `finishIntent` and the five unloading/unmounted early returns ignored the boolean of `endPendingWrite`. | New module-level `discardPendingWrite` / `retryPendingCleanup` in `uncertainWriteStorage.ts`. A refused deletion is remembered (separate from the unknown-write hand-over set; no unresolved entry is created). Retried on: every list update including a no-op (each board read), every `persistTracked`, `beginPendingWrite`, and `restoreUncertainWrites` (so bfcache `pageshow` retries before restoring). While a token is owed a deletion, restore skips it. Module-level so a late answer after unmount, or a remount in the same document, keeps it. All five handlers' early returns now call `discardPendingWrite`. |
| F2 | `pageshow` added assignments first; the first `persistTracked` verified an assignments-only snapshot and then deleted every hand-over token, including the block's, before the block list was added. A refused full snapshot left the block with no durable record. | Two per-list persists; hand-over released all tokens on any verified snapshot. | `updateReconciliations` / `updateBlockReconciliations` take `persist = true`; `pageshow` puts both lists into the lock refs with `persist: false`, then calls `persistTracked()` once. Invariant: tokens are released only after a verified snapshot of both complete lists; if that write is refused, every intent stays and each write is restorable from it. |
| F3 | `readPendingRecords` checked only the envelope and cast; `beginPendingWrite` appended and then `.some` threw on `null`, after the intent had been written (0 POST, but a phantom intent, and valid intents could not be removed). | No per-entry validation; unreadable/unavailable record was replaced by `[]`. | `isPendingRecord` (reuses `readAssignment`/`readBlock`, i.e. the restore validators). `beginPendingWrite` refuses (returns `null`, no `setItem`) unless the stored record is readable and every entry is valid — nothing is replaced or cut down. Read-back and every other failure after `setItem` now go through `discardPendingWrite` for that token only. `endPendingWrite` is null-safe and keeps other entries verbatim. `restoreUncertainWrites` uses the same validator: valid entries restored, damaged ones flagged `unreadable`. |

## RED → GREEN

- Baseline at start (`4e464ba`): targeted suite 80 passed.
- RED (new tests on unfixed source): `npx vitest run …uncertainWriteStorage.test.ts …ReservationBoardCrossWriteLock.test.tsx` → **exit 1, 25 failed / 81 passed (106)**. 9 board tests + 16 unit tests fail; 1 new test (restore of valid entries beside a damaged one) already passed. RED reasons checked individually (e.g. F2: after `pageshow` both tokens were deleted while only the assignment reached `uncertainWrites`; F3: `[null, {token…}]` — a new intent appended).
- GREEN after fix: same command → **exit 0, 2 files, 106 passed**.
- Regression guards (source restored after each, byte-identical `cmp`):
  - `retryPendingCleanup` disabled → F1 red (8 failed).
  - `pageshow` back to per-list persist → F2 red (2 failed).
  - `beginPendingWrite` validation removed → F3 red (13 failed).
  - the five early returns back to `endPendingWrite` → F1 unloading test red (1 failed).

New tests: board level in `ReservationBoardCrossWriteLock.test.tsx` (`…(PMS-CAL-001.5-CP03-C2)`, 9 tests: 400 retried by a range read; bfcache with deletion still refused and after recovery; answer arriving during `pagehide`; `created` keeps its notice/re-read; mixed assignment+block restore with a quota that fits one kind but not both, repeated pageshow, reloads, recovery via Check again; an in-flight write of this page neither restored nor dropped; `null` entry; `null` beside a valid intent; stored-but-unreadable intent). Unit level in `uncertainWriteStorage.test.ts` (11 damaged-shape cases, restore beside damage, own-token removal beside damage, read-back failure, retry/skip semantics).

## Storage fault matrix

| Fault | Behaviour after this correction |
|---|---|
| `getItem` refused on the pending record while beginning a write | Not sent (`INTENT_NOT_RECORDED`); nothing overwritten (before: the record was replaced by `[]` on a read error). |
| `setItem` refused (quota) while beginning | Not sent; any partial intent discarded/remembered. |
| `setItem` OK, read-back refused/mismatch | Not sent; that token removed, or remembered and removed at the next chance; other intents untouched. |
| `removeItem`/`setItem` refused when deleting a **known-outcome** intent | Token remembered, deleted at next retry; never warned about or locked in this document. |
| Same, then a full reload before any retry succeeded | The token is restored as an unknown write (warning + lock): safe direction, **not preventable client-side**. |
| Refused two-list record at hand-over (mount, pageshow, unknown answer) | All intents kept; both writes restorable from them; hand-over retried on the next list update / read. |
| Pending array `[null]`, or valid + `null`, invalid kind/token/write, missing segment/version, non-forward range | New write refused before `setItem`; valid entries restored + banner; damaged entries left as stored. |
| Whole pending record unparseable / other format | Now also refuses new writes (before: replaced). See limitations. |
| `sessionStorage` entirely unavailable | `tabStorage()` is `null`: writes are refused as before; a full reload loses everything — no durable state is claimed. |

## Checks (run in this correction session, on the final source)

From `Front_End/Admin_Web`: targeted vitest 2 files **106 passed**; `npm test` **29 files / 647 tests passed**; `npm run lint` exit 0; `npx tsc --noEmit` exit 0; `npm run build` exit 0. From root: `git diff --check` clean. `npm ci` not needed (dependencies already installed; lockfile untouched).

Size: correction (source + tests, before this report) 4 files, +625 / −48; source only +136 / −47 (of which a large part is comments), the rest is regression tests (+489 / −1). Whole PR ≈ +1837 / −100 at that point, above the 400-line slicing guideline (a guideline, not a gate): the PR is one safety mechanism (intent record, hand-over, restore) plus its adversarial tests, and the correction adds only what the three findings need.

## UI_LIVE: PARTIAL

Environment (created by this session, removed after): isolated database `thebha_c2_live` on the existing Postgres container (migrated, `--seed-development`, two SQL-inserted reservation units with unassigned nights); API from `dotnet run --launch-profile https` with the mkcert leaf via `Kestrel__Certificates__Default__*` and `AdminCalendar__EnableUnauthenticatedWrite=true`; Admin Web as a **production build** (`next start`, port 3002) behind a 20-line HTTPS proxy on `https://localhost:3001` (scratch, outside the tree) so Chrome's real back/forward cache applies. Chrome via the extension; no TLS/gate bypass.

| Step | Real | Injected / seeded |
|---|---|---|
| Board reads (`GET`), assignment `POST`, server 409 `conflict` ("already has an overlapping Effective assignment") | real API + PostgreSQL. The conflict was produced by assigning the same range through a real `curl` POST after opening the dialog. | — |
| `removeItem` on the pending key refused during and after the 409 | — | page-side override |
| bfcache `pagehide persisted=true` / `pageshow persisted=true`, twice | real Chrome bfcache (navigate to `/signin`, history back) | — |
| Two intents (assignment + block) present at `pageshow`; `setItem` of a two-list record refused | — | seeded by script into `sessionStorage`; quota fault by override |
| Real reload, block dialog and server refusal | real | — |

Evidence:
- **F1**: after the real 409 the pending record held 1 token (`removeItem` refused 3×), no notice, no banner, `uncertainWrites` empty. Back/forward-cache return with deletion still refused: `pageshow persisted=true`, still no notice/lock, token still there, **POSTs = 1** (the original). Storage recovered, second bfcache round trip: `pendingWrites = null`, no notice, POSTs still 1.
- **F2** (clean run 2): seeded `assignment(room 102, unit 2)` + `block(room 201)`; `pageshow persisted=true` → 1 assignment notice + 1 block notice, `pendingWrites` = both tokens, `uncertainWrites` = null (three attempted two-list writes, all refused; no one-list snapshot was ever written), no POST. Real reload (fault gone): both restored exactly once, then handed over — `pendingWrites = null`, `uncertainWrites` = 1 assignment + 1 block. Block on room 201 for the same night: "An earlier request to block this room… is still unconfirmed"; block on room 101 (unrelated) was sent to the server (the server refused it on capacity: real business rule, not a lock).
- Run 1 of F2 used a unit that the real board already showed as assigned; the existing rules correctly settled it as `changed` after the re-read and a one-list record was then legitimately saved. Kept as a note; run 2 is the evidence.
- Not captured: the extension's network tool only starts recording when first called, so POST/GET counts come from an in-page `fetch` wrapper and the database (`RoomOccupancySegments` = 1, the `curl` assignment; the browser's rejected/never-sent writes created nothing). `pageshow` in jsdom is not counted as evidence here.
- Cleanup: servers and proxy stopped, `thebha_c2_live` dropped, credentials file shredded, tab closed. Other databases and the running Postgres container untouched.

## Skill policy, self-review, deviations

- `diagnosing-bugs`: **not invoked** — each finding had a reproducing regression written first; red/green matched.
- Graphify: **not used** (`ALLOWED_IF_RELEVANT`; scope small enough to read directly).
- Self-review: a token is now in exactly one of {in flight, hand-over, owed deletion}; hand-over tokens are released only after a verified two-list snapshot; the cleanup set is not persisted and only ever removes tokens.
- Deviation: a garbled/unreadable pending **envelope** used to be replaced by `beginPendingWrite`; it is now refused like a damaged entry (same reasoning: corrupt storage does not prove no write is in flight; a newer-format record from another build must not be overwritten). Consequence: such a tab cannot start new writes until it is closed, and the operator message is the generic "could not keep the safety record". Not in the finding text, flagged for OC.

## Residual limitations

- No client can guarantee durability if the browser refuses all storage until a full reload; a deletion refused until then reappears as a warning + lock (safe direction).
- Same-tab only; no cross-tab, no server idempotency. No Admin authentication/RBAC.
- The damaged-record message is generic (above).
- `restored.unreadable` banner appears per page load while a damaged entry remains stored.
- Source drift outside scope: none found.

## Review

`REVIEW: NOT RUN` at the time of writing — Owner invokes `/codex:review --base origin/develop`.
