# PMS-CAL-002-CP01 — SPLIT_MOVE_STORE_COMMAND — completion report

Date: 2026-10-10 (Asia/Saigon). Scope: an **internal** application/store command only. No HTTP route, no UI, no schema, no cloud. `BACKEND_CD` is paused and untouched.

## 1. Identity

| | |
|---|---|
| Work item / roles | `PMS-CAL-002-CP01` — `IMPLEMENTER: CLAUDE`, `REVIEWER: CODEX_READ_ONLY` (Owner invokes) |
| Branch / base | `feature/pms-cal-002-cp01-split-move-store` → `develop`; START_HEAD = baseline = `841b4b75c4f2028e7d188c2b07d06f40de734d6c` (= `origin/develop`, tree `6ff7f55…`, clean tree) |
| Draft PR | <https://github.com/emLamHD/The_BHA_hotels_Booking/pull/97> (Draft, into `develop`) |
| Commits | `258b257` source + tests; the documentation commit that contains this report follows it |
| FINAL_HEAD, GitHub additions/deletions, CI run IDs | A commit cannot contain its own hash: they are in the handoff, taken after the last push |
| Write ownership | One writable checkout; the P1 branch `feature/bha-backend-cd-001-cp04-p1-setup-evidence` was left untouched (still at baseline, no edits). The Codex broker process is the read-only reviewer |

## 2. A1_BUILD_TEST_DOUBLE (OC amendment, 2026-10-10)

Blocker found in preflight, before any edit: `CountingAssignmentStore` in `Back_End/tests/TheBha.IntegrationTests/StaffCalendarWriteAuthorizationTests.cs` implements `IAssignmentMutationStore`, so a new interface member would stop it compiling; the file was outside the allowlist, so work stopped and reported the exact path. OC added the file with one narrow allowance. The diff of that file is exactly the new member, in the existing pattern:

```csharp
public Task<SegmentMutationResult> SplitMoveAsync(SplitMoveAssignmentCommand command, CancellationToken cancellationToken) =>
    Record(command.ActorReference);
```

(`git diff --stat`: 3 insertions, 0 deletions.) No default interface implementation, no `NotSupportedException`. The spy proves nothing about split-move RBAC and no route was added to the HTTP tests. This is part of this CP01 report, not a separate correction checkpoint.

## 3. Owner decisions recorded (2026-10-10)

* **D1 APPROVED.** If the source room's RoomType differs from the sold RoomType, keeping it on the prefix still needs a Manager, the cross-type confirmation and a reason; the old assignment's evidence is not inherited. CP01 proves the store half: the store requires fresh non-blank evidence **and** reason whenever **either** successor (prefix included) crosses the sold RoomType. It does not authenticate Staff or turn the evidence string into RBAC proof — that is the CP02 HTTP boundary.
* **D2 APPROVED.** A destination equal to the source room is rejected (`Invalid`); no split-in-place.
* **D3–D6 remain OPEN** (reason optionality, past split dates, route/response shape, check-in/repricing). Opening CP01 approved none of them; the implementation adds no today/check-in/repricing rule.

The design document records both decisions and the CP01 status; HTTP and UI stay TARGET.

## 4. Change

| File | Change |
|---|---|
| `Back_End/src/TheBha.Application/Scheduling/AssignmentMutations.cs` | `SplitMoveAssignmentCommand(PropertyId, SegmentId, ExpectedVersion, SplitDate, DestinationPhysicalRoomId, ActorReference, AuthorizationEvidence, Reason)` and `IAssignmentMutationStore.SplitMoveAsync` (+28) |
| `Back_End/src/TheBha.Infrastructure/Persistence/AssignmentMutationStore.cs` | `SplitMoveAsync` (+53), placed after `SupersedeAsync`; **0 deleted lines** in this file, so the `CreateAsync` and `SupersedeAsync` bodies are byte-identical |
| `Back_End/tests/TheBha.IntegrationTests/AssignmentMutationStoreTests.cs` | 27 new test cases and helpers (+416 incl. the guard-message assertions) |
| `Back_End/tests/TheBha.IntegrationTests/StaffCalendarWriteAuthorizationTests.cs` | the spy member above (+3) |
| `docs/design/PMS-CAL-002-split-move.md`, `docs/project/SNAPSHOT.md`, this report | decisions, status, evidence |

Store flow (design §4.3): (1) no-tracking read of the segment by `SegmentId` + `PropertyId` + type `ReservationAssignment` + `ReservationUnitId != null`, selecting only room and nights — none → `NotFound`; (2) `SplitDate <= Start || SplitDate >= End` → `Invalid` (comparisons only, so `DateOnly` min/max cannot overflow); (3) destination == source room → `Invalid` (D2); (4) one `AssignmentSupersession(SegmentId, ExpectedVersion, [source room [Start, SplitDate), destination [SplitDate, End)])` with the command's actor, evidence and reason; (5) `return await SupersedeAsync(...)`, result unchanged. The pre-read decides nothing about the mutation: status, version, destination existence/`Active`, per-successor RoomType authorization, capacity and the commit are all re-evaluated by `SupersedeAsync` under the ReservationUnit advisory lock. The command carries no dates of the segment, replacement list, price, check-in state or role. No nested transaction, no lock bypass, no direct update of the source.

## 5. Acceptance and invariant evidence

Environment: **PostgreSQL 18.3** (`postgres:18.3`, server_version `18.3 (Debian 18.3-1.pgdg13+1)`) in a Docker container created for this run (own name, label `bha.session=pms-cal-002-cp01`, port published on `127.0.0.1` only, Docker-assigned, throw-away credentials); the test factory creates and drops its own databases on it. `ConnectionStrings__TheBhaDatabase` pointed only at that instance. The existing `the-bha-postgres-1` container, other databases/volumes and RDS were not touched. Clock: every new test pins `factory.Clock.UtcNow` to the fixture's `Now` (`2026-07-22T00:00:00Z`); the capacity case sets `Now + 60 days` explicitly, like the existing hold tests. No EF InMemory/SQLite.

| # | Acceptance | Evidence |
|---|---|---|
| 1 | Internal entry point only; reuses `SupersedeAsync`; no route/UI | `rg` of `IAssignmentMutationStore`: one implementation (the store), one test spy (A1), consumers resolve the interface through DI; the Api controller is unchanged; `git diff --stat` shows no Api/Frontend/migration file |
| 2 | Prefix/suffix from the real source range, same Unit, full partition, commercial rows unchanged | `AssertSplitAsync` (every positive case): result is exactly `[source Cancelled, prefix, suffix]`; source keeps id/room/nights and gets a new version; prefix `[Start, SplitDate)` in the source room, suffix `[SplitDate, End)` in the destination; all in the same Unit; exactly 3 rows for the Unit; each returned version equals the row's `xmin` read back; `CommercialSnapshotAsync` (sold RoomType, status, every night's date/rate plan/amount) equal before and after. Partial-stay case: assignment on nights 9/2–9/4 of a 9/1–9/5 stay → successors `[9/2, 9/3)` and `[9/3, 9/5)`, nothing outside the segment's own nights |
| 3 | D2 and split-date guards `Invalid`; Property/type guards `NotFound` | same-room; offsets −1, 0, 5, 6; `DateOnly.MinValue/MaxValue`; one-night segment at both ends — all `Invalid` and each asserts the guard's own message (so `SupersedeAsync`'s partition error cannot masquerade as the guard); unknown id, other Property, `OperationalBlock` segment → `NotFound` |
| 4 | Cross-type evidence on both successors; no inheritance; per-row audit | suffix-only, prefix-only (source in a cross-type room, destination the sold type, original `Created` row keeps `evidence:original-upgrade`/`Original upgrade` and a different `MutationGroupId`), both, and same-type: the new group has exactly 3 rows with one `MutationGroupId`; `Cancelled` never carries evidence; `Created` carries evidence only when that successor crosses; actor and reason on every row. Missing/blank evidence or reason × {suffix crosses, prefix crosses} (8 theory rows) → `Unauthorized`; fixtures have free destinations and ample capacity, so overlap/capacity cannot mask the authorization failure |
| 5 | Atomic failures, no extra successors/audit | every rejection (`Unauthorized` ×8, `Invalid`, `NotFound`, foreign destination `NotFound`, inactive destination `Conflict`, stale version `Conflict`, already-cancelled source `Conflict`, occupied destination `Conflict`, capacity `Conflict`) is followed by `StateAsync` with a fresh DbContext: every segment (identity, type, status, room, nights, `xmin`), every audit row (identity, group, event, actor, evidence, reason) and the commercial snapshot equal the state before, and `result.Segments` is null. The occupied-destination case is a real commit-time exclusion violation; the capacity case has the destination room free and an Active unexpired hold consuming the type's only room |
| 6 | Docs, Draft PR, final-head CI | design doc and SNAPSHOT updated; PR #97 Draft; CI in the handoff |

## 6. Commands and outcomes

All from the repository root, with the scratch connection string exported in the shell only.

| Command | Outcome |
|---|---|
| `dotnet restore Back_End/TheBha.Booking.sln` | up to date |
| `dotnet build Back_End/TheBha.Booking.sln --configuration Release --no-restore` | 0 warnings, 0 errors |
| `dotnet test …IntegrationTests.csproj --configuration Release --no-build --filter "FullyQualifiedName~AssignmentMutationStoreTests"` | 60 passed, 0 failed |
| `… --filter "FullyQualifiedName~Split_move"` | 27 passed (all new) |
| `… --filter "FullyQualifiedName~StaffCalendarWriteAuthorizationTests"` | 14 passed; `Every_write_refuses_without_authority_or_boundary_before_the_store_is_called` passed on its own as well |
| `dotnet test Back_End/TheBha.Booking.sln --configuration Release --no-build` | **unit 244 passed; integration 873 passed** (846 existing + 27 new), 0 failed, 0 skipped — includes the existing split/move/swap/unassign and API/Staff regressions |
| `git diff --check` | clean |

### Mutation checks (scratch, reversible)

The store file was copied aside, one mutation applied at a time, rebuilt, `Split_move` tests run, then restored (failure counts are as observed; individual failing test names were not recorded); the sha256 of the restored file equals the original (`660cbafda18d19ff…`), and the full suite above ran on the restored code.

| Mutation | Result (of 27) |
|---|---|
| M1 remove the D2 same-room guard | 1 failed |
| M2 remove the split-date guard | 6 failed (the split-date guard tests assert its own message: 4 offset rows, min/max, one-night) |
| M3 the prefix uses the destination room instead of the source room | 9 failed |
| M4 suffix starts one night late (wrong partition) | 17 failed |

## 7. Scope check and limits

* Source diff proves `SupersedeAsync`/`CreateAsync` unchanged: `git diff` of the store shows only added lines (0 deletions); `AssignmentMutations.cs` only adds a record and one interface member.
* Forbidden areas untouched: domain, support, lock/capacity/constraints, controller/HTTP/OpenAPI/auth, frontend, migrations, packages, `.github/`, `deploy/`, runbooks, governance files.
* Size: 509 insertions, 4 deletions in the code/doc diff before this report; the PR is above the 100–400 target because about 416 lines are the integration tests that carry the safety case (27 cases, each rejection comparing the whole state); production code is about 80 lines. GitHub's actual numbers are in the handoff.
* `NOT_RUN` / not applicable: browser, Docker API image, frontend, load tests (no UI or image pipeline change); concurrency of two split-moves on one segment is covered by the existing `SupersedeAsync` lock tests and was not re-proven here.
* Limits: the store treats `AuthorizationEvidence` as an opaque non-blank string; Staff role and Origin checks, HTTP status mapping and OpenAPI are CP02. A split-move from a room deactivated after assignment is a `Conflict` (existing `SupersedeAsync` behaviour, design §6).
* Skills: `diagnosing-bugs` not triggered (no unexplained failure). Graphify `NOT_APPLICABLE`. No cloud call, no flag change, no nested agent, no reviewer invocation. Cleanup: the scratch container was removed after the checks, and its anonymous data volume (created by this run, identified by creation time and the anonymous label) was removed; no other container or volume was touched.
* Backend CD context: Owner paused `BHA-BACKEND-CD-001-CP04` P1 and the AWS CD plan; `BACKEND_RELEASE_PUBLISH_ENABLED` and `BACKEND_RELEASE_DEPLOY_ENABLED` read `false` in a read-only check at 2026-10-10T07:37Z (`CLAUDE_VERIFIED_READ_ONLY`); no `backend-production` environment; `main` unchanged at `0243160`. Nothing in CP01 touches them.

## 8. Statuses

IMPLEMENTATION_CP01 `PASS` (mandatory checks passed); HTTP_SPLIT_MOVE `NOT_IMPLEMENTED`; UI_SPLIT_MOVE `NOT_IMPLEMENTED`; REVIEW_CP01 `NOT_RUN — OWNER_ONLY`; BACKEND_CD `PAUSED / NOT_COMPLETE`; LIVE_DEPLOY_CP01 `NOT_RUN`; CP02–CP05 `NOT_STARTED`.
