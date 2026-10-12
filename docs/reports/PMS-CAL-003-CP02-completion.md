# PMS-CAL-003-CP02 — completion report

`BLOCK_MOVE_CLIENT_TARGET_RECONCILIATION_STORAGE` · implementer CLAUDE · reviewer CODEX_READ_ONLY (Owner invokes) · 2026-10-12

## 1. Identity

| | |
|---|---|
| Branch | `feature/pms-cal-003-cp02-block-move-client-reconciliation-storage` (created in the single checkout) |
| Baseline / START_HEAD | `1a09e656af128a6df93875bb5ae12de8f70ce435` (= `origin/develop`, PR #103 merged; CP01 closed) |
| Validation SHA (code + tests) | `a2b92b1` — every result below ran on this code |
| Later commit | documentation only (this report, design, BIBLE, SNAPSHOT) |
| Draft PR / FINAL_HEAD / CI | in the PR description and the hand-off message (a report cannot contain the CI of the commit that contains it) |

## 2. What changed (Admin_Web only)

- `types.ts`, `client.ts`: `MoveOperationalBlockRequest`; `moveOperationalBlock(propertyId, segmentId, request, options?)`; `OperationalBlockMoveOutcome` = `moved{segments|null}` / `not-sent` / `rejected` / `unknown`. One fetch, no retry; body built field by field; Staff `include` / LocalGate `omit`; JSON headers, `no-store`, `redirect: error`; timer and abort listener always cleaned up. Every `200` is `moved` (readable, unreadable, `null` or empty body); `401` carries the session-ended marker; `403`/`404` are detail-free `not-permitted` (also when the body carries the assignment cross-RoomType title — a block has no such branch); `409` `conflict` with the safe detail; other `4xx` `refused`; `5xx`, unexpected non-4xx statuses, network, timeout and abort-after-send `unknown`; invalid config/mode or a signal aborted before the call `not-sent` with zero fetches. Existing client functions are untouched.
- `blockMoveTarget.ts` (new, pure): `buildBlockMoveTarget` + `MAX_BLOCK_MOVE_NIGHTS = 366`. Requires the selected Property, exactly one board block for the clicked segment id matching `roomBlockId`, `segmentVersion`, room and own start/end, a `uint` version, real Gregorian dates 0001–9999 (the existing `gregorianDayNumber`; `dateMath.ts` untouched) spanning 1…366 nights, and the source room on the board — which may be inactive. Carries the full source range, the header and the Active rooms other than the source as facts (no free-ness or capacity claim). Reads no permission, session, clock or storage and never mutates its inputs.
- `blockCreateReconciliation.ts`: `BlockMoveReconciliationTarget` (named so as not to collide with the dialog target) joins `BlockWriteTarget`; `resolution` gains `changed`; `evaluateBlockMove` (verdicts below); `blockRoomsTouchedBy`; `isBlockSegmentWriteUnresolved`. Create/cancel semantics are unchanged and never yield `changed`.
- `reconciliation.ts`: one line group — `isRoomRangeUnresolved` locks every room an unresolved block write touches (both rooms of a move). No other predicate or verdict changed.
- `uncertainWriteStorage.ts`: a move serializes and parses as one more entry in `blocks` (v1, same two keys, same token/handoff algorithm). Serialized: ids, room numbers, version, full range — never a reason, actor, evidence or any guest/contact/session data. Parser strict: mandatory text fields, two different rooms, a true integer `uint` version, real Gregorian dates, 1…366 nights. Legacy validators and shapes unchanged.
- `ReservationBoard.tsx` (allowance only, +49/−…): the inline `UncertainBlockNotice` words a restored move as a move between two rooms (observed / changed / unresolved / locked / unreachable window), resolved notices dismiss through the existing path, and the two block dialogs' `uncertainResolution` props ignore the move-only `changed` value. No import or call of the new client, no dialog, action, handler, navigation or session change.

Verdict rules of `evaluateBlockMove` (a loaded board of the same Property whose window overlaps the source's nights, read after the write): **observed** — the source segment is no longer shown *and* a different segment of the same header holds exactly the source's nights in the destination; **unresolved** — the source is shown exactly as it was (id, version, header, room, range), even beside a look-alike in the destination; **changed** — everything else, and it claims neither success nor failure. Another Property, a non-overlapping window (half-open adjacency included), an old sequence and a failed read resolve nothing; `status` (re-read) and `resolution` are separate.

Not touched: backend, schema, auth/permissions, existing API behaviour, packages/lockfiles/config, `dateMath.ts`, the Gregorian helpers, dialogs/popovers/toolbar/timeline, `StaffSession`/provider, workflows, deploy, governance.

## 3. Checks (local, current session)

| Command | Outcome |
|---|---|
| `npm test` (Vitest 2.1.9, Admin_Web) | **46 files, 1464 tests passed** (was 1338; +126 tests, +4 files) |
| `npm run lint` | clean (0 warnings after removing one unused import) |
| `npx tsc --noEmit` | clean |
| `npm run build` (Next 16.1.6, `NEXT_PUBLIC_API_BASE_URL` set) | success |
| `git diff --check`, secret scan | clean |
| .NET / PostgreSQL / Docker / Chrome / live API | **NOT_REQUIRED / NOT_RUN** for a foundation-only frontend scope; the Vitest suites mock the client and are **not** a real-browser acceptance |

Tests added: `moveOperationalBlock.test.ts` 29 (route/encoded ids, body whitelist incl. a widened runtime object, modes/config/pre-abort with zero fetch, exactly one fetch per outcome, 200 variants, 401 marker, 403/404 conservative, 409, other 4xx, 5xx and unexpected statuses, timeout/abort, timer and listener cleanup); `blockMoveTarget.test.ts` 15 (exact header/id/version/room/dates/Property, clipped and one-night sources, inactive source, candidates, input immutability, uint range, 366/367 across leap and non-leap years, years 0001–0099, newline/malformed dates); `blockCreateReconciliation.test.ts` +9 (the full move truth table, wrong/correct header, successor id, intact beside a sibling, changed versions/rooms/ranges, wrong Property/non-overlap/adjacency/old sequence/failed read, status vs resolution, create/cancel unchanged, the segment predicate); `reconciliation.test.ts` +4 (both rooms, any view, half-open boundaries, other Property/room, resolution-only locking, assignment/block interplay); `uncertainWriteStorage.test.ts` +12 plus 32 strict-parse cases (round-trip, no reason/actor/PII, in-flight intent, token dedup, mixed lists, literal legacy v1 text, unknown/future operation and version, damaged and unsupported pending entries never overwritten, failed set/get/remove/readback, deletion retry); `ReservationBoardBlockMoveFoundation.test.tsx` 14 (restored move wording, in-flight wording, both rooms locked and only those, Cancel held, Check again re-reads only, failed read, observed/changed per scene, dismissal leaving other records and locks, mixed restore, no move client call, source scan); +1 regression each in the block create, block cancel and cross-write-lock suites; `clientAccessMode.test.ts` gains the new function in the Staff/LocalGate/invalid-mode matrices. No existing assertion was loosened.

**Mutation checks** (a throwaway script flipped one guard at a time, ran the ten affected suites, restored the file; 23 mutations): observed without the header / without the destination room / with the source still shown, intact ignoring version/header/room, never `changed`, window not checked, a lock dropping the destination or the source, the segment predicate cancel-only or locking when resolved, storage without the nights bound / distinct rooms / uint bound / header / source room number, the target without the header check / the 366 bound / allowing an inactive source / allowing a duplicated segment id, the client forwarding a confirmation. **22 caught; 1 survived** — "a successor may carry the source's id" — which is an equivalent mutant: the same condition already requires the source to be absent, so a block with the source's id cannot also be a successor; the guard stays as defence in depth.

## 4. Acceptance

| Group | Result |
|---|---|
| Client / types (A) | met, §2–3 |
| Pure exact target (B) | met |
| Reconciliation and locks (C) | met |
| Storage and read-only compatibility (D) | met; literal v1 text is only evidence that the *current* parser reads old records |
| Board allowance only; no action, dialog, handler, client import or call | met (source-scan and behaviour tests) |
| Mandatory checks | met locally; GitHub CI on FINAL_HEAD in the hand-off |

## 5. Deviations and limitations

- No edit outside the allowlist.
- `OLD_BUILD_DOWNGRADE_RUNTIME`: **NOT_VERIFIED** — no baseline parser was run in a scratch; nothing is inferred from source inspection.
- A restored `changed` or `observed` move is resolved: it is no longer kept in the tab and no longer locks; only `unresolved` persists. Warning-only outcomes are never turned into a claim that every write is locked, and an incomplete read is never read as "no locks".
- The notice still names rooms by number only; guest/header text is never shown for a restored move.
- PR size is above the 100–400 target: the size and reason are in the PR description (mostly tests; the production change is small).
- Skills: `diagnosing-bugs` not triggered; Graphify NOT_APPLICABLE. No Docker image was built; the image workflow is CI's evidence, not dispatched.
- Cleanup: no stack, container or database was created; the scratch mutation script lives outside the repository.

## 6. Status

`IMPLEMENTATION_CP02: PASS` · `BLOCK_MOVE_CLIENT_TARGET_RECONCILIATION_STORAGE: IMPLEMENTED` · `HTTP_OPERATIONAL_BLOCK_MOVE: ALREADY_IMPLEMENTED` · `UI_OPERATIONAL_BLOCK_MOVE: NOT_IMPLEMENTED` · `REVIEW_CP02: NOT_RUN — OWNER_ONLY` · `CP03: NOT_STARTED` · `PMS_CAL_003: IN_PROGRESS` · `OLD_BUILD_DOWNGRADE_RUNTIME: NOT_VERIFIED` · `CLOUD_CALLS_CP02 / LIVE_DEPLOY_CP02: NOT_RUN` · `BACKEND_CD: PAUSED / NOT_COMPLETE` (the two release flags were not read or changed; the `false` readbacks of 2026-10-10 are earlier evidence).
